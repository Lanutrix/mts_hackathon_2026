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
import { liveChecks } from "../packages/domain/liveStep.ts";
import { refineLiveStep } from "../apps/server/liveGuidance.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
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

test("live guidance follows the ticket deadline through both boundaries without a source revision", () => {
  const deadline = new Date(now + 16 * 60_000).toISOString();
  const row = ticket(1, { deadline, isNeedUp: false, assignedGroupName: "Команда сети" });
  const at = (clock: number) => buildTriage([row], "priority", 7, clock);
  const initial = at(now);
  assert.ok(initial.cases[0].step, "a recommendation must refer to a specific incident");
  assert.equal(initial.nextChangeAt, now + 60_000);
  const soon = at(now + 60_000);
  assert.equal(soon.cases[0].step.reason, "soon");
  assert.equal(soon.nextChangeAt, Date.parse(deadline) + 1);
  assert.notEqual(soon.cases[0].step.key, initial.cases[0].step.key);
  const overdue = at(Date.parse(deadline) + 1);
  assert.equal(overdue.cases[0].step.reason, "overdue");
  assert.equal(overdue.cases[0].step.ticketId, "T-1");
  assert.equal(overdue.cases[0].step.evidence.field, "deadline");
  assert.notEqual(overdue.cases[0].step.key, soon.cases[0].step.key);
  assert.equal(overdue.nextChangeAt, null);
  const expanded = buildTriage([row, ticket(5, {deadline: null})], "priority", 7, Date.parse(deadline) + 1);
  assert.equal(expanded.cases[0].step.ticketId, "T-1");
  assert.notEqual(expanded.cases[0].step.key, overdue.cases[0].step.key);
  row.sourcePresent = false;
  assert.equal(at(Date.parse(deadline) + 1).cases[0].step.reason, "missingSource");
});

test("live AI renders distinct grounded manual checks and rejects invented facts and unrelated references", async () => {
  const row = ticket(0);
  const group = buildTriage([row], "priority", 1, now).cases[0];
  for (const [action, ref, expected] of [
    ["Уточните у команды новый срок решения.", "deadline", "model"],
    ["Уточните у координатора причину задержки срока решения в карточке заявки.", "deadline", "model"],
    ["Спросите, когда исполнитель сообщит новый срок.", "deadline", "model"],
    ["Уточните срок восстановления после пожара.", "deadline", "local"],
    ["Уточните у команды новый срок решения.", "unverifiedCause", "local"],
    ["Назначьте заявку другой команде.", "deadline", "local"],
  ]) {
    const reply = { action, ref, choice: 2 };
    const client = new VseLlm("key", "test-model", async () =>
      Response.json({choices: [{message: {content: JSON.stringify(reply)}}]}));
    const result = await refineLiveStep(client, group.step, row, group, now);
    assert.equal(result.mode, expected);
    assert.equal(result.action, expected === "model" ? action : group.step.action);
  }
});

test("live model can explicitly rank a grounded check when its free wording is unusable", async () => {
  const row = ticket(0);
  const group = buildTriage([row], "priority", 1, now).cases[0];
  const replies = [
    { ref: "deadline", preferredCheck: "B", action: "Фантазия модели" },
    { ref: "unverified", preferredCheck: "B", action: "Фантазия модели" },
  ];
  for (const reply of replies) {
    const client = new VseLlm("key", "test-model", async () =>
      Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
    const result = await refineLiveStep(client, group.step, row, group, now);
    assert.equal(result.mode, reply.ref === "deadline" ? "model" : "local");
    assert.doesNotMatch(result.action, /Фантазия/);
    if (result.mode === "model") assert.equal(result.action, liveChecks[group.step.reason][1]);
  }
});

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
  const headers = { cookie: "wm_session=viewer", "x-csrf-token": "csrf" };
  const read = (url: string) => app.inject({ url, headers });
  try {
    const snapshot = (await read("/api/dashboard?signal=critical")).json();
    assert.equal(snapshot.triage.unique, 72);
    assert.equal(snapshot.groups.critical.items.length, 30);
    assert.equal(snapshot.groups.coordinators.count, 72);
    assert.equal(
      (await read("/api/dashboard?signal=high")).json().triage.unique,
      0,
    );
    assert.equal(calls, 0);
    const c = snapshot.triage.cases[0];
    const params = "?signal=critical&revision=4&hash=" + c.hash;
    const path = "/api/triage/" + c.id;
    const first = (await read(path + params + "&sort=id&limit=35")).json();
    assert.equal(first.nextOffset, 35);
    demo.rows = new Map(demo.rows);
    demo.rows.delete(members[0].key);
    demo.revision = 5;
    const second = (
      await read(path + params + "&sort=id&offset=35&limit=100")
    ).json();
    assert.equal(second.revision, 4);
    assert.equal(second.nextOffset, null);
    assert.deepEqual(
      [...first.items, ...second.items].map((r) => r.id),
      members.map((r) => r.id).sort((a, b) => a.localeCompare(b)),
    );
    const live = (await read("/api/dashboard?signal=critical")).json();
    assert.equal(live.triage.unique, 71);
    assert.notEqual(live.triage.cases[0].hash, c.hash);
    assert.equal(
      (await app.inject(path + params + "&ns=workspace")).statusCode,
      401,
    );
    assert.equal(
      (await read(path + params.replace(c.hash, "a".repeat(64)))).statusCode,
      409,
    );
    assert.equal((await read(path)).statusCode, 400);
    const analysisUrl = path + "/analysis" + params;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: analysisUrl,
          headers: { ...headers, origin: "https://other.invalid" },
        })
      ).statusCode,
      403,
    );
    const analyzed = await app.inject({
      method: "POST",
      url: analysisUrl,
      headers,
    });
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
    await app.inject({ method: "POST", url: analysisUrl, headers });
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
    assert.equal((await app.inject("/api/public/focus")).statusCode, 401);
  } finally {
    await app.close();
    await ai.close();
  }
  const closed = await createApp({ ...options, publicDemo: false });
  try {
    assert.equal((await closed.inject("/api/public/focus")).statusCode, 401);
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

test("response order partitions the active queue once and exposes the same lead at every level", () => {
  const active = [
    ticket(1, { deadline: null }),
    ticket(2, { deadline: new Date(now + 60_000).toISOString() }),
    ticket(3, { priorityId: 3, deadline: new Date(now - 60_000).toISOString() }),
    ticket(4, { deadline: new Date(now - 1).toISOString() }),
    ticket(5, { priorityId: 3, deadline: new Date(now + 900_000).toISOString() }),
  ];
  const missing = { ...ticket(6), sourcePresent: false };
  const closed = ticket(7, { stateId: 7, state: STATES[7].label, stateEnum: STATES[7].enum });
  const queue = [active[0], ...active, missing, closed];
  const run = (rows: typeof queue, time: number) => buildTriage(rows, "response", 1, time);
  const all = run(queue, now);
  assert.equal(all.unique, 6);
  assert.deepEqual(all.cases.map(c => [c.responseRank, c.count]), [[0, 2], [1, 1], [2, 1], [3, 1], [8, 1]]);
  assert.deepEqual(all.cases, run([...queue].reverse(), now).cases);
  for (const c of all.cases) {
    assert.equal(c.step.ticketId, c.lead.id);
    assert.equal(all.members.get(c.id)![0].id, c.lead.id);
  }
  assert.equal(all.cases[0].lead.id, "T-4");
  const inside = filterDashboard(queue, { band: "criticalDeadline" }, now);
  assert.equal(buildTriage(inside, "symptomProduct", 1, now).unique, 2);
  assert.equal(all.cases.at(-1)!.step.reason, "missingSource");
  assert.deepEqual(run(queue, now + 900_001).cases.map(c => [c.responseRank, c.count]), [[0,2],[1,1],[2,2],[8,1]]);
});
