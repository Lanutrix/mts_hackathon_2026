import test from "node:test";
import assert from "node:assert/strict";
import { allocateShift } from "../apps/server/shift.ts";
import { openDB } from "../apps/server/db.ts";
import { Auth } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES, PRIORITIES } from "../packages/domain/index.ts";

const now = Date.parse("2026-11-22T12:00:00Z");
const source = generate(1).rows[0];
function rows(count: number, priority = 2) {
  return Array.from({ length: count }, (_, i) => ({
    ...source,
    id: "SHIFT-" + String(i + 1).padStart(4, "0"),
    sysId: "SHIFT-" + i,
    priorityId: priority,
    priority: PRIORITIES[priority],
    stateId: 2,
    stateEnum: STATES[2].enum,
    state: STATES[2].label,
    deadline: null,
    isNeedUp: false,
    solution: null,
    completionDate: null,
    header: i % 2 ? "Сеть" : "Платежи",
  }));
}
const cluster = (r: ReturnType<typeof normalize>) => ({
  key: String(r.raw.header),
  label: String(r.raw.header),
  field: "header",
  origin: "model" as const,
});
test("one shared shift prioritizes urgency and divides 0, 10, 30 and 800 tickets without double counting", () => {
  for (const n of [0, 10, 30, 800]) {
    const data = rows(n).map((row) => normalize(row, "demo"));
    const plan = allocateShift(data, new Map(), ["Вера", "Антон", "Иван"], cluster, now);
    const again = allocateShift(data.reverse(), new Map(), ["Иван", "Вера", "Антон"], cluster, now);
    assert.deepEqual(again, plan);
    const sizes = ["Антон", "Вера", "Иван"].map((name) => plan.filter((t) => t.suggested === name).length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.equal(new Set(plan.map((t) => t.id)).size, n);
  }
  const [critical] = rows(1, 4).map((r) =>
    normalize(
      { ...r, id: "URGENT", sysId: "CRITICAL-SHIFT", deadline: new Date(now - 100).toISOString() },
      "demo",
    ),
  );
  const normal = rows(4).map((r) => normalize(r, "demo"));
  const plan = allocateShift(
    [...normal, critical],
    new Map([[normal[0].key, { owner: "Иван", version: 2 }]]),
    ["Иван", "Анна"],
    cluster,
    now,
  );
  assert.equal(plan[0].id, "URGENT");
  assert.equal(plan[0].suggested, "Анна");
  assert.match(plan[0].basis, /срок/iu);
  assert.equal(plan.find((r) => r.id === normal[0].id)?.owner, "Иван");
});

test("multi-coordinator ownership is durable, versioned, isolated from the ticket and scoped to role and source", async () => {
  const db = await openDB(":memory:");
  const store = new Store(db, "demo"),
    auth = new Auth();
  const incoming = rows(10);
  await store.ingest(JSON.stringify(incoming));
  const authFor = (user: string) => ({ cookie: "wm_session=" + user, "x-csrf-token": "csrf-" + user });
  for (const [name, role] of [
    ["a", "coordinator"],
    ["b", "coordinator"],
    ["v", "viewer"],
  ] as const)
    auth.sessions.set(auth.digest(name), {
      username: name,
      csrf: "csrf-" + name,
      role,
      expires: Date.now() + 120_000,
    });
  const options = {
    stores: new Map([["demo", store]]),
    sources: new Map(),
    auth,
    publicDemo: true,
    secure: false,
    origin: "",
  };
  const app = await createApp(options);
  const read = (user: string, suffix = "") =>
    app.inject({ method: "GET", url: "/api/shift?ns=demo" + suffix, headers: authFor(user) });
  const id = incoming[0].id;
  const write = (user: string, version: number, owner: string | null, ns = "demo") =>
    app.inject({
      method: "POST",
      url: "/api/shift/" + id + "/owner?ns=" + ns,
      headers: authFor(user),
      payload: { runId: "", version, owner },
    });
  try {
    assert.equal((await read("v")).statusCode, 403);
    assert.equal((await write("v", 0, "v")).statusCode, 403);
    await read("a");
    await read("b");
    assert.equal((await read("a")).json().total, 5);
    const before = store.revision;
    const results = await Promise.all([write("a", 0, "a"), write("b", 0, "b")]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = results[0].statusCode === 200 ? "a" : "b",
      other = winner === "a" ? "b" : "a";
    const mine = await read(winner, "&tab=mine");
    assert.equal(mine.json().rows[0].id, id);
    assert.equal((await write(other, 1, null)).statusCode, 409);
    assert.equal((await write(winner, 1, other)).statusCode, 200);
    assert.equal((await read(other, "&tab=mine")).json().rows[0].version, 2);
    assert.equal((await write(other, 2, null)).statusCode, 200);
    assert.equal((await write(winner, 0, winner)).statusCode, 409);
    assert.equal((await write(winner, 3, winner, "missing")).statusCode, 404);
    assert.equal(store.revision, before);
    assert.equal((await db.query("SELECT owner,version FROM shift_owners")).rows[0].version, 3);
    assert.equal((await db.query("SELECT * FROM audit WHERE action='shift.owner'")).rows.length, 3);
  } finally {
    await app.close();
    await db.close();
  }
});
