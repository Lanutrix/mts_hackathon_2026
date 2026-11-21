import test from "node:test";
import assert from "node:assert/strict";
import {
  normalize,
  STATES,
  PRIORITIES,
  TEAM,
} from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import { buildTriage, filterDashboard } from "../packages/domain/triage.ts";
import { createApp } from "../apps/server/api.ts";
import { AnalysisService } from "../apps/server/analysis.ts";
import { analyzeCase } from "../apps/server/caseAnalysis.ts";
import { Auth } from "../apps/server/auth.ts";
import { Store } from "../apps/worker/ingestion.ts";
import type { DB } from "../apps/server/db.ts";

const source = generate(1).rows[0];
const now = Date.parse("2026-11-21T09:00:00.000Z");
function ticket(n: number, overrides = {}) {
  return normalize(
    {
      ...source,
      id: "T-" + n,
      sysId: String(n),
      header: n % 2 ? "Ошибка входа" : "Ошибки авторизации",
      stateId: 2,
      state: STATES[2].label,
      stateEnum: STATES[2].enum,
      priorityId: 4,
      priority: PRIORITIES[4],
      assignedGroupName: TEAM,
      deadline: n === 3 ? null : new Date(now + (n - 1) * 60_000).toISOString(),
      isNeedUp: n % 3 === 0 ? null : n % 3 === 1,
      ...overrides,
    },
    "triage",
  );
}
test("all unique matching signal rows aggregate before paging with stable membership and source evidence", () => {
  const active = Array.from({ length: 65 }, (_, i) => ticket(i));
  const closed = ticket(80, {
    stateId: 10,
    state: STATES[10].label,
    stateEnum: STATES[10].enum,
  });
  const input = [...active, active[0], closed];
  const build = (rows: typeof input) =>
    buildTriage(rows, "symptom", 7, now, "critical");
  const result = build(input);
  const c = result.cases[0];
  assert.equal(result.unique, 65);
  assert.equal(result.cases.length, 1);
  assert.equal(c.count, 65);
  assert.equal(c.priorities["4"], 65);
  assert.equal(c.overdue, 1);
  assert.equal(c.soon, 15);
  assert.equal(c.escalations, 22);
  assert.equal(c.deadlineMissing, 1);
  assert.equal(c.escalationUnknown, 22);
  assert.equal(c.topId, "T-0");
  assert.ok(c.evidence.some((e) => e.id === c.topId && e.field === "header"));
  assert.deepEqual(build([...input].reverse()).cases, result.cases);
  assert.equal(buildTriage(input, "product", 7, now, "high").unique, 0);
  const filtered = filterDashboard(input, {
    q: "T-64",
    service: String(source.serviceTypeId),
    up: "1",
  });
  assert.deepEqual(
    filtered.map((r) => r.id),
    ["T-64"],
  );
});

const unusedDB: DB = {
  query: async () => ({ rows: [] }),
  transaction: async () => {
    throw new Error("unexpected write");
  },
  close: async () => {},
};

test("case pages pin all members to the same revision and locally analyze only the selected source", async () => {
  const demo = new Store(unusedDB, "demo");
  const privateStore = new Store(unusedDB, "workspace");
  const members = Array.from({ length: 72 }, (_, n) => ticket(n));
  demo.rows = new Map(members.map((r) => [r.key, r]));
  demo.revision = 4;
  const sensitive = ticket(1000, { header: "Private workspace record" });
  privateStore.rows.set(sensitive.key, sensitive);
  privateStore.revision = 7;
  const auth = new Auth();
  for (const role of ["viewer", "coordinator"] as const)
    auth.sessions.set(auth.digest(role), {
      username: role,
      role,
      csrf: "csrf",
      expires: Date.now() + 60_000,
    });
  let calls = 0;
  const ai = new AnalysisService(
    unusedDB,
    undefined,
    500,
    async (sentences) => {
      calls++;
      return { indices: sentences.length > 1 ? [1, 0] : [0], dimensions: 384 };
    },
  );
  const options = {
    auth,
    stores: new Map([
      ["demo", demo],
      ["workspace", privateStore],
    ]),
    sources: new Map(),
    secure: false,
    publicDemo: true,
    origin: "http://localhost",
    ai,
  };
  const app = await createApp(options);
  try {
    const snapshot = (
      await app.inject("/api/dashboard?signal=critical")
    ).json();
    assert.equal(snapshot.triage.unique, 72);
    assert.equal(snapshot.groups.critical.items.length, 30);
    assert.equal(snapshot.groups.coordinators.count, 72);
    assert.equal(
      (await app.inject("/api/dashboard?signal=high")).json().triage.unique,
      0,
    );
    assert.equal(calls, 0);
    const c = snapshot.triage.cases[0];
    const params = "?signal=critical&revision=4&hash=" + c.hash;
    const path = "/api/triage/" + c.id;
    const first = (
      await app.inject(path + params + "&sort=id&limit=35")
    ).json();
    assert.equal(first.nextOffset, 35);
    demo.rows = new Map(demo.rows);
    demo.rows.delete(members[0].key);
    demo.revision = 5;
    const second = (
      await app.inject(path + params + "&sort=id&offset=35&limit=100")
    ).json();
    assert.equal(second.revision, 4);
    assert.equal(second.nextOffset, null);
    assert.deepEqual(
      [...first.items, ...second.items].map((r) => r.id),
      members.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
    );
    const live = (await app.inject("/api/dashboard?signal=critical")).json();
    assert.equal(live.triage.unique, 71);
    assert.notEqual(live.triage.cases[0].hash, c.hash);
    assert.equal(
      (await app.inject(path + params + "&ns=workspace")).statusCode,
      401,
    );
    assert.equal(
      (await app.inject(path + params.replace(c.hash, "a".repeat(64))))
        .statusCode,
      409,
    );
    assert.equal((await app.inject(path)).statusCode, 400);
    const analysisUrl = path + "/analysis" + params;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: analysisUrl,
          headers: { origin: "https://other.invalid" },
        })
      ).statusCode,
      403,
    );
    const analyzed = await app.inject({ method: "POST", url: analysisUrl });
    assert.equal(analyzed.statusCode, 200, analyzed.body);
    const result = analyzed.json();
    assert.equal(result.stale, true);
    assert.equal(result.inputHash, c.hash);
    assert.equal(result.mode, "model");
    assert.equal(result.evidence.length, 2);
    assert.ok(
      result.evidence.every((e: { id: string }) =>
        members.some((r) => r.id === e.id),
      ),
    );
    assert.equal(result.sampled, 20);
    assert.match(result.model, /e5-small/);
    await app.inject({ method: "POST", url: analysisUrl });
    assert.equal(calls, 1);
    const privateUrl = analysisUrl + "&ns=workspace";
    assert.equal(
      (await app.inject({ method: "POST", url: privateUrl })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: privateUrl,
          headers: { cookie: "wm_session=viewer", "x-csrf-token": "csrf" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: privateUrl,
          headers: { cookie: "wm_session=coordinator" },
        })
      ).statusCode,
      403,
    );
    const focus = (
      await app.inject({
        url: "/api/public/focus?ns=workspace",
        headers: { cookie: "wm_session=coordinator" },
      })
    ).json();
    assert.ok(members.some((r) => r.id === focus.tracking.id));
    assert.ok(!JSON.stringify(focus).includes(sensitive.id));
  } finally {
    await app.close();
    await ai.close();
  }
  const closed = await createApp({ ...options, publicDemo: false });
  try {
    assert.deepEqual((await closed.inject("/api/public/focus")).json(), {
      tracking: null,
    });
  } finally {
    await closed.close();
  }
});

test("offline extractive analysis provides source quotations and explicitly handles missing text", async () => {
  const a = ticket(1, {
    productName: "Шлюз авторизации",
    description:
      "Шлюз повторно запрашивает пароль. Клиент видит ошибку авторизации.",
  });
  const b = ticket(2, {
    productName: "Шлюз авторизации",
    description:
      "Авторизация завершается ошибкой. При входе поле пароля очищается.",
  });
  const { cases, members } = buildTriage([a, b], "symptom", 3, now);
  const c = cases[0];
  const result = await analyzeCase(c, members.get(c.id)!);
  assert.equal(result.model, "TF-IDF · TextRank");
  assert.equal(result.mode, "model");
  assert.equal(new Set(result.evidence.map((e) => e.id)).size, 2);
  assert.ok(
    result.summary.some(
      (s) => s.includes("Шлюз авторизации") && s.includes("2 из 2"),
    ),
  );
  for (const e of result.evidence) {
    const source = [a, b].find((r) => r.id === e.id)!;
    assert.ok(String(source.raw[e.field]).includes(e.value));
  }
  const unknown = ticket(3, { header: null, description: null });
  const blank = buildTriage([unknown], "product", 3, now);
  assert.equal((await analyzeCase(blank.cases[0], [unknown])).mode, "fallback");
});
