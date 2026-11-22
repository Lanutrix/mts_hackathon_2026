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
import { liveStep } from "../packages/domain/liveStep.ts";
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


function guidanceClient(reply: object | ((packet: any) => object), grounded = true, packets: any[] = []) {
  return new VseLlm("test", "test-model", async (_url, options) => {
    const packet = JSON.parse(JSON.parse(String(options!.body)).messages[1].content);
    packets.push(packet);
    const content = packet.candidate ? { grounded, manual: true } : typeof reply === "function" ? reply(packet) : reply;
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
}

test("live advice publishes original prose tied to changing ticket and queue facts, deduplicating concurrent reads", async () => {
  const packets: any[] = [];
  const slow = { observation: "У этой заявки наивысший приоритет и прошёл срок решения, а в группе уже две просроченные заявки.", action: "Уточните у исполнителя, когда появится обновлённая оценка срока.", refs: ["deadline", "priorityId", "group.overdue"] };
  const clear = { observation: "У заявки есть запас по сроку решения.", action: "Сверьте с командой время следующего сообщения о ходе работ.", refs: ["deadline", "assignedGroupName"] };
  const client = guidanceClient(p => p.facts["group.overdue"] === 2 ? slow : clear, true, packets);
  for (const [deadline, expected] of [[-1, slow], [30, clear]] as const) {
    const rows = [0, 1].map(n => ticket(n, { deadline: new Date(now + deadline*60_000).toISOString(),
      isNeedUp: false, assignedGroupName: "Секретная команда", assignedEmployee: "Иван Иванов",
      header: "Секретный заголовок", description: "Секретные персональные сведения." }));
    const group = buildTriage(rows, "priority", 1, now).cases[0];
    const read = () => refineLiveStep(client, group.step, rows[0], group, now);
    const [result, twin] = await Promise.all([read(), read()]);
    assert.equal(result.mode, "model");
    assert.equal(result.text, expected.observation + " " + expected.action);
    assert.equal(result.action, expected.action);
    assert.deepEqual(twin, result);
  }
  assert.equal(packets.length, 4);
  const transport = JSON.stringify(packets);
  assert.doesNotMatch(transport, /Секрет|Иванов|T-0|T-1|preferredCheck|checks|starts|words/iu);
});

test("absent generation, unsupported evidence and provider-only choice never count as generated advice", async () => {
  const row = ticket(0);
  const group = buildTriage([row], "priority", 1, now).cases[0];
  const actual = { observation: "У заявки прошёл срок решения.", action: "Уточните у команды ожидаемый срок.", refs: ["deadline"] };
  for (const [reply, grounded] of [
    [{ choice: 2 }, true], [{ ref: "deadline", preferredCheck: "B" }, true],
    [{ ...actual, refs: ["rootCause"] }, true],
    [{ ...actual, observation: "Затронуты 48 серверов." }, true],
    [{ ...actual, action: "Закройте заявку и отправьте письмо." }, true],
    [{ ...actual, observation: "Ни одна заявка в группе не назначена конкретному исполнителю." }, true],
    [{ ...actual, action: "Проверьте наличие исполнителя и при необходимости обновите эту информацию." }, true],
    [{ ...actual, action: "Проверьте, можно ли назначить срок решения для этой заявки." }, true],
    [{ ...actual, action: "Уточните, требуется ли устранение последствий для этой заявки." }, true],
    [{ ...actual, observation: "Причина задержки — пожар в дата-центре." }, false],
  ] as const) {
    const result = await refineLiveStep(guidanceClient(reply, grounded), group.step, row, group, now);
    assert.equal(result.mode, "local", JSON.stringify(reply));
    assert.equal(result.text, undefined);
    assert.equal(result.reason, "unverified");
  }
  const offline = await refineLiveStep(undefined, group.step, row, group, now);
  assert.equal(offline.reason, "unconfigured");
  assert.equal(offline.text, undefined);
  // The provider may repeat the focus alias alongside its field name.
  assert.equal((await refineLiveStep(guidanceClient({ ...actual, refs: ["deadline", "focus"] }), group.step, row, group, now)).mode, "model");
});

test("live situation identity follows facts used in the prose and ignores unrelated snapshot changes", () => {
  const row = ticket(0, { assignedGroupName: "Сеть" });
  const group = { count: 3, overdue: 1, soon: 1 };
  const key = liveStep(row, now, group).key;
  assert.equal(liveStep({ ...row, revision: 9 }, now, group).key, key);
  assert.notEqual(liveStep({ ...row, groups: ["critical", "coordinators"] }, now, group).key, key);
  const surge = {count: 801, soon: 110, overdue: 35};
  assert.equal(liveStep(row, now, surge).key, liveStep(row, now, {count: 802, soon: 112, overdue: 33}).key);
  assert.notEqual(liveStep(row, now, surge).key, liveStep(row, now, {...surge, overdue: 100}).key);
  assert.notEqual(liveStep(row, now, group).key, liveStep(row, now, {...group, count: 4}).key);
  const changedDeadline = ticket(0, { assignedGroupName: "Сеть", deadline: new Date(now - 120_000).toISOString() });
  assert.equal(liveStep(row, now, surge).key, liveStep(changedDeadline, now, surge).key);
});

test("a fluctuating large group shares a safe range and cannot publish the lower bound as an exact count", async () => {
  const row = ticket(0), base = buildTriage([row], "priority", 1, now).cases[0];
  const packets: any[] = [];
  const answer = { observation: "В группе не менее 800 заявок. У этой заявки прошёл срок решения.",
    action: "Уточните, когда команда рассчитывает завершить работы.", refs: ["deadline", "group.count"] };
  const client = guidanceClient(answer, true, packets);
  for (const count of [801, 802]) {
    const group = { ...base, count };
    const read = await refineLiveStep(client, liveStep(row, now, group), row, group, now);
    assert.equal(read.mode, "model");
  }
  assert.equal(packets.length, 2);
  assert.doesNotMatch(JSON.stringify(packets), /801|802/u);
  const group = { ...base, count: 802 };
  const bad = guidanceClient({ ...answer, observation: "В группе ровно 800 заявок." });
  assert.equal((await refineLiveStep(bad, liveStep(row, now, group), row, group, now)).mode, "local");
});

test("six different live situations can complete generation and review without using the interactive reserve", async () => {
  const row = ticket(0);
  const group = buildTriage([row], "priority", 1, now).cases[0];
  const client = guidanceClient({
    observation: "Срок решения заявки прошёл.", action: "Уточните у команды актуальный срок решения.", refs: ["deadline"],
  });
  for (let count = 1; count <= 7; count++) {
    const next = { ...group, count };
    const result = await refineLiveStep(client, liveStep(row, now, next), row, next, now);
    assert.equal(result.mode, count <= 6 ? "model" : "local", "group size " + count);
  }
  assert.ok("json" in await client.json("interactive", "test", { text: "test" }, 1000));
});

test("a repeated ticket-only paragraph reuses its check when unrelated queue counts change", async () => {
  const row = ticket(0), base = buildTriage([row], "priority", 1, now).cases[0];
  const packets: any[] = [];
  const client = guidanceClient({observation: "У заявки прошёл срок решения.",
    action: "Уточните текущий прогноз решения.", refs: ["deadline"]}, true, packets);
  for (const count of [1, 2]) {
    const group = {...base, count};
    assert.equal((await refineLiveStep(client, liveStep(row, now, group), row, group, now)).mode, "model");
  }
  assert.equal(packets.filter(p => !p.candidate).length, 2);
  assert.equal(packets.filter(p => p.candidate).length, 1);
  assert.ok(!Object.hasOwn(packets[1].facts, "group.count"));
});

test("a decision superseded during generation never spends another call reviewing that draft", async () => {
  const row = ticket(0), group = buildTriage([row], "priority", 1, now).cases[0];
  const packets: any[] = [];
  let current = true;
  const client = guidanceClient(() => {
    current = false;
    return {observation: "Срок решения уже прошёл.", action: "Запросите новый прогноз решения.", refs: ["deadline"]};
  }, true, packets);
  const result = await refineLiveStep(client, group.step, row, group, now, () => current);
  assert.equal(result.mode, "local");
  assert.equal(packets.length, 1);
});

test("live requests for a changed queue wait for an occupied slot and skip superseded work", async () => {
  const row = ticket(0), first = buildTriage([row], "priority", 1, now).cases[0];
  const next = {...first, count: 4};
  const packets: any[] = [];
  let start!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const client = new VseLlm("test", "test", async (_url, options) => {
    const p = JSON.parse(JSON.parse(String(options?.body)).messages[1].content);
    packets.push(p);
    if (packets.length === 1) { start(); await hold; }
    const content = p.candidate ? {grounded: true, manual: true} : {
      observation: "Срок решения уже прошёл.", action: "Запросите новый прогноз решения.", refs: ["deadline"]};
    return Response.json({choices: [{message: {content: JSON.stringify(content)}}]});
  });
  let current = true;
  const old = refineLiveStep(client, first.step, row, first, now, () => current);
  await started;
  current = false;
  const fresh = refineLiveStep(client, liveStep(row, now, next), row, next, now);
  release();
  assert.equal((await old).mode, "local");
  assert.equal((await fresh).mode, "model");
  assert.equal(packets.length, 3);
});

test("a rejected paragraph receives one targeted revision and only a separately verified revision is published", async () => {
  const row = ticket(0), group = buildTriage([row], "priority", 1, now).cases[0];
  const wrong = {observation: "В группе все заявки назначены конкретным исполнителям.", action: "Уточните текущую оценку срока решения.", refs: ["deadline"]};
  const fixed = {observation: "У заявки истёк срок решения.", action: "Уточните у команды ожидаемое время завершения работ.", refs: ["deadline"]};
  const packets: any[] = [];
  const client = guidanceClient(p => p.revisionRequest ? fixed : wrong, true, packets);
  const read = () => refineLiveStep(client, group.step, row, group, now);
  const advice = await read();
  assert.equal(advice.text, fixed.observation + " " + fixed.action);
  assert.deepEqual((await read()), advice);
  assert.equal(packets.length, 3);
  assert.match(packets[1].revisionRequest, /групп/iu);
  assert.equal(packets[2].candidate.action, fixed.action);
});

test("the named coordinator team is a ticket fact; the queue has no aggregate status or assignee", async () => {
  const row = ticket(1, {stateId:20, stateEnum:STATES[20].enum, state:STATES[20].label,
    deadline:new Date(now+5*60_000).toISOString(), isNeedUp:false});
  const group = buildTriage([row], "priority", 1, now).cases[0];
  const genuine = {observation:"Срок решения истекает в течение 15 минут, заявка на исследовании в группе координаторов.",
    action:"Уточните, когда ожидается завершение исследования.",refs:["deadline","stateId","assignedGroupName","reason","focus"]};
  const ask = (answer: object) => refineLiveStep(guidanceClient(answer), group.step, row, group, now);
  assert.equal((await ask(genuine)).mode, "model");
  for (const observation of ["В группе одна заявка, все в работе.", "Эта заявка сейчас находится в работе.", "В группе нет просрочек, все в пределах сроков."])
    assert.equal((await ask({...genuine, observation, refs:["deadline","stateId","group.count","group.overdue"]})).mode, "local", observation);
});

test("matching count bands do not prove equality of deadline counts; a change of actual equality updates the decision", async () => {
  const row = ticket(0), base = buildTriage([row], "priority", 1, now).cases[0];
  const ask = async (overdue: number, observation: string) => {
    const group = { ...base, count:45, overdue, soon:0 };
    const step = liveStep(row, now, group);
    const client = guidanceClient({ observation, action:"Уточните у команды текущий прогноз завершения.", refs:["deadline","group.count","group.overdue"] });
    const result = await refineLiveStep(client, step, row, group, now);
    return { key:step.key, mode:result.mode };
  };
  for (const text of ["В группе от 30 до 99 заявок, из них столько же просроченных.", "В группе от 30 до 99 заявок, все с просроченным сроком."]) {
    const partial = await ask(42,text), all = await ask(45,text);
    assert.equal(partial.mode,"local");
    assert.equal(all.mode,"model");
    assert.notEqual(all.key,partial.key);
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
