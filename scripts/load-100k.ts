import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { tmpdir, cpus } from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Agent, get } from "node:http";
import { createApp } from "../apps/server/api.ts";
import { Auth, passwordHash } from "../apps/server/auth.ts";
import { openDB } from "../apps/server/db.ts";
import { FileSource, Store } from "../apps/worker/ingestion.ts";
import { generate, FIXED_CLOCK } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";
import { buildTriage } from "../packages/domain/triage.ts";

// The fixture owns its loopback-only HTTP server, client sockets and database.
// The workload cannot be pointed at another server or external provider.
const seed = 8142;
const total = 100_000;
const concurrency = 16;
const clients = 500;
const size = 240;
const fixtures = generate(size, seed).rows;
const time = () => performance.now();
const ms = (n: number) => Math.round(n * 100) / 100;
function timing(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => ms(ordered[Math.ceil(ordered.length * p) - 1]);
  return { count: values.length, p50Ms: percentile(0.50), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
}
const dir = await mkdtemp(join(tmpdir(), "srez-api-bench-"));
const db = await openDB(":memory:");
const store = await new Store(db, "demo").load();
const auth = new Auth();
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
auth.users.push({ role: "coordinator", username: "bench", salt, hash: passwordHash(password, salt) });
const source = new FileSource(store, join(dir, "incidents.json"));
const app = await createApp({ auth, stores: new Map([["demo", store]]), sources: new Map([["demo", source]]), publicDemo: false, secure: false, origin: "http://localhost" });
const agent = new Agent({keepAlive: true, maxSockets: concurrency, maxFreeSockets: 1});
try {
  await store.ingest(JSON.stringify(fixtures));
  const login = await app.inject({ method: "POST", url: "/api/login", payload: { username: "bench", password } });
  assert.equal(login.statusCode, 200);
  const session = login.cookies.find(cookie => cookie.name === "wm_session");
  assert.ok(session);
  const headers = { cookie: "wm_session=" + session.value };
  const local = await app.listen({ host: "127.0.0.1", port: 0 });
  function read(path: string, lane: number): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const req = get(local + path, { headers, agent, localAddress: "127.10." + Math.floor(lane / 250) + "." + (1 + lane % 250) }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          try { resolve({status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8"))}); }
          catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.setTimeout(20_000, () => req.destroy(new Error("Local fixture request timed out")));
    });
  }
  // Deterministic mix of real read operations. Each fixture client stays under
  // the production limit. Production authentication and rate limiting stay enabled.
  const routes = ["dashboard", "incidents", "incident", "notifications"] as const;
  const mix = [0, 1, 2, 3, 2, 1, 2, 3, 2, 1];
  const elapsedByRoute = routes.map(() => [] as number[]);
  const byStatus: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  const windows: {requests: number, elapsedSeconds: number, heapMiB: number, rssMiB: number}[] = [];
  let next = 0, completed = 0, valid = 0;
  // A warm-up request exercises each route and checks representative content.
  const url = (r: number, i: number) => ["/api/dashboard?register=1&groupBy=response&limit=12", "/api/incidents?offset=" + (i % 4) * 50, "/api/incident/" + fixtures[i % size].id, "/api/notifications"][r];
  const check = (r: number, b: any, i: number) => {
    if (r === 2) return b.incident?.id === fixtures[i % size].id && Array.isArray(b.history);
    if (b.revision !== 1) return false;
    if (r === 0) return b.namespace === "demo" && Array.isArray(b.register?.items) && Array.isArray(b.triage?.cases) && b.triage.unique > 0;
    return Array.isArray(b.items) && (r === 3 || b.total === size);
  };
  for (const [r, name] of routes.entries()) {
    const warm = await app.inject({url: url(r, 0), headers});
    assert.ok(warm.statusCode === 200 && check(r, warm.json(), 0), "Warm-up failed: " + name);
  }
  const start = time();
  async function run() {
    while (next < total) {
      const i = next++;
      const lane = i % clients;
      const r = mix[(i + Math.floor(i / clients)) % mix.length];
      const tick = time();
      const response = await read(url(r, i), lane);
      const ok = response.status === 200 && check(r, response.body, i);
      elapsedByRoute[r].push(time() - tick);
      byStatus[response.status] = (byStatus[response.status] ?? 0) + 1;
      if (ok) valid++;
      else rejected[routes[r]] = (rejected[routes[r]] ?? 0) + 1;
      completed++;
      if (completed % 10000 === 0) {
        const elapsedSeconds = ms((time() - start) / 1000);
        const mem = process.memoryUsage();
        windows.push({requests: completed, elapsedSeconds, heapMiB: ms(mem.heapUsed/1048576), rssMiB: ms(mem.rss/1048576)});
        console.log(windows.at(-1));
      }
    }
  }
  await Promise.all(Array.from({length: concurrency}, run));
  const seconds = (time() - start) / 1000;
  // Separate scale check: validate grouping over 100,000 distinct normalized
  // records; this measures the coordinator's selection, not database ingestion.
  const clock = Date.parse(FIXED_CLOCK);
  const input = Array.from({length: total}, (_, i) =>
    normalize({...fixtures[i % size], id: "BENCH-" + i, sysId: "bench-sys-" + i}, "bench")
  );
  assert.equal(new Set(input.map(row => row.key)).size, total);
  const eligible = input.filter(row => row.groups.length > 0).length;
  const groupStart = time();
  const result = buildTriage(input, "response", 1, clock);
  const groupMs = ms(time() - groupStart);
  const membershipCount = result.cases.reduce((a, c) => a + c.count, 0);
  assert.equal(result.unique, eligible);
  assert.equal(membershipCount, eligible);
  const report = {
    measuredAt: new Date().toISOString(), platform: process.platform, node: process.version, cpu: cpus()[0]?.model,
    transport: "HTTP/1.1 over loopback TCP; client and server share one local Node process", database: "PGlite in memory", excludes: ["TLS and reverse proxy", "external LLM", "write load"],
    seed, datasetRows: size, syntheticClients: clients, inFlight: concurrency, requests: completed, valid, byStatus, rejected,
    durationSeconds: ms(seconds), requestsPerSecond: ms(completed / seconds),
    latency: timing(elapsedByRoute.flat()), routes: Object.fromEntries(routes.map((r, i) => [r, timing(elapsedByRoute[i])])),
    checkpoints: windows, triage: {input: input.length, eligible, grouped: membershipCount, groups: result.cases.length, durationMs: groupMs},
  };
  await mkdir(".runtime/qa", { recursive: true });
  await writeFile(".runtime/qa/load-100k.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  assert.equal(valid, total);
} finally {
  agent.destroy();
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
