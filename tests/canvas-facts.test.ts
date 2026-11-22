import test from "node:test";
import assert from "node:assert/strict";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES, type Raw } from "../packages/domain/index.ts";
import { VseLlm } from "../apps/server/vsellm.ts";

const now = Date.parse("2026-11-22T02:30:00Z");
const base = generate(1).rows[0];
function row(
  id: string,
  stateId: number,
  submitDate: string,
  overrides: Raw = {},
) {
  return normalize(
    {
      ...base,
      id,
      sysId: id,
      stateId,
      state: STATES[stateId].label,
      stateEnum: STATES[stateId].enum,
      submitDate,
      completionDate: null,
      assignedGroupName: "Платформа",
      productName: "Кабинет",
      ...overrides,
    },
    "demo",
  );
}
function setup(
  modelReply: unknown = {
    conversation: { title: "Ответ", text: "Всё уже закрыто." },
    showData: false,
  },
) {
  const current = "2026-11-21T21:00:00Z";
  const rows = [
    row("INC-1", 0, current, { relatedIncidentIds: ["INC-2"] }),
    row("INC-2", 7, current, {
      assignedGroupName: "Сеть",
      completionDate: "2026-11-21T22:00:00Z",
    }),
    row("INC-3", 10, "2025-09-01T00:00:00Z", {
      assignedGroupName: "Архив",
      completionDate: "2026-01-01T00:00:00Z",
    }),
    row("INC-4", 10, "2023-01-01T00:00:00Z", {
      completionDate: "2025-11-22T02:29:59Z",
    }),
    row("INC-5", 2, "2026-11-21T20:59:59Z", {
      assignedGroupName: "  платформа ",
    }),
    row("INC-6", 10, "2025-01-01T00:00:00Z", { assignedGroupName: "" }),
    row("INC-7", 0, "2026-11-22T09:00:00Z"),
  ];
  const source = {
    namespace: "demo",
    revision: 9,
    rows: new Map(rows.map((r) => [r.id, r])),
  };
  let calls = 0;
  const model = new VseLlm("test", "test", async () => {
    calls++;
    return Response.json({
      choices: [{ message: { content: JSON.stringify(modelReply) } }],
    });
  });
  return { source, service: new CanvasService(model), calls: () => calls };
}

test("mode of today's registrations includes finished states, ties and Moscow boundary", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  for (const q of [
    "Какой статус чаще всего встречается сегодня?",
    "Какое состояние преобладает за сегодняшний день?",
    "какой самый встречаемый статус сегодня",
  ]) {
    const result = await service.read(source, "me", q);
    assert.equal(result.intent.fact?.operation, "frequency");
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.groups.map((g) => [g.label, g.count]),
      [
        ["Завершён", 1],
        ["Назначен", 1],
      ],
    );
    assert.match(result.summary, /Завершён/);
    assert.match(result.summary, /Назначен/);
    assert.match(result.fact!.method, /22\.11\.2026.*МСК/);
    assert.equal(calls(), 0);
  }
});
test("distinct source teams, missing and canonical names, filters, pagination and refresh", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  const result = await service.read(
    source,
    "me",
    "Сколько сейчас команд и как они называются?",
  );
  assert.equal(result.intent.fact?.operation, "distinct");
  assert.deepEqual(result.groups.map((g) => g.label).sort(), [
    "Архив",
    "Платформа",
    "Сеть",
  ]);
  assert.match(result.summary, /3/);
  assert.match(result.fact!.notes.join(" "), /1/);
  assert.equal(validContext(result.intent), true);
  const explanation = await service.read(
    source,
    "me",
    "Объясни текущий срез",
    result.intent,
  );
  assert.equal(explanation.fact?.headline, result.fact?.headline);
  assert.doesNotMatch(JSON.stringify(explanation), /undefined/);
  const group = result.groups.find((g) => g.label === "Платформа")!;
  assert.equal(
    service.page("demo", "me", result.selection, group.key, 0)!.total,
    4,
  );
  assert.equal(
    service.page("demo", "other", result.selection, group.key, 0),
    undefined,
  );
  const filtered = await service.read(
    source,
    "me",
    "А только среди открытых?",
    result.intent,
  );
  assert.equal(filtered.intent.fact?.operation, "distinct");
  assert.deepEqual(
    filtered.groups.map((g) => g.label),
    ["Платформа"],
  );
  const refresh = await service.read(source, "me", undefined, filtered.intent);
  assert.deepEqual(refresh.groups, filtered.groups);
  assert.equal(calls(), 0);
});
test("duration cohorts use real completion within rolling year, allow earlier registration and disclose missing fields", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  const result = await service.read(
    source,
    "me",
    "На устранение какого инцидента за последние 12 месяцев ушло больше всего времени?",
  );
  assert.equal(result.intent.fact?.operation, "duration");
  assert.deepEqual(
    result.fact?.durations?.map((r) => r.id),
    ["INC-3", "INC-2"],
  );
  assert.equal(result.fact?.durations?.[0].ms, 122 * 86_400_000);
  assert.match(result.summary, /INC-3/);
  assert.match(result.fact!.method, /22\.11\.2025/);
  assert.match(result.fact!.notes.join(" "), /1/);
  const colloquial = await service.read(
    source,
    "me",
    "назови за последний год самую долгорешаемую проблему",
  );
  assert.deepEqual(colloquial.fact?.durations, result.fact?.durations);
  source.rows.clear();
  const empty = await service.read(
    source,
    "me",
    "Какой инцидент решали дольше всего за последний год?",
  );
  assert.equal(empty.total, 0);
  assert.match(empty.summary, /нет|недостаточно/iu);
});
test("resolution leaders include source problem names, missing subjects and every tied winner", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  source.rows.clear();
  for (let i = 1; i <= 12; i++) {
    const r = row("INC-" + i, 7, "2026-01-01T00:00:00Z", {
      header: i === 2 ? "  " : "Сбой узла " + i,
      completionDate: "2026-01-02T00:00:00Z",
    });
    source.rows.set(r.id, r);
  }
  const result = await service.read(
    source,
    "me",
    "Назови самую долгорешаемую проблему за год",
  );
  assert.match(result.fact!.headline, /Сбой узла 1(?!\d)/);
  assert.equal(result.fact!.durations!.length, 12);
  assert.equal(result.fact!.durations![1].header, null);
  assert.equal(result.fact!.durations!.at(-1)?.header, "Сбой узла 12");
});

test("graph distinguishes source reference, matching attributes, and absent IDs; flags do not create edges", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  const result = await service.read(
    source,
    "me",
    "Нарисуй взаимосвязи между INC-1, INC-2, INC-5 и INC-999.",
  );
  assert.equal(result.intent.fact?.operation, "relations");
  assert.deepEqual(
    result.fact!.nodes!.map((n) => [n.id, n.found]),
    [
      ["INC-1", true],
      ["INC-2", true],
      ["INC-5", true],
      ["INC-999", false],
    ],
  );
  const edges = result.fact!.edges!;
  assert.ok(
    edges.some(
      (e) =>
        e.from === "INC-1" &&
        e.to === "INC-2" &&
        e.kind === "reference" &&
        e.evidence.some((v) => v.includes("relatedIncidentIds")),
    ),
  );
  assert.ok(edges.some((e) => e.to === "INC-5" && e.kind === "similarity"));
  assert.equal(
    edges.some((e) => e.to === "INC-999"),
    false,
  );
  assert.equal(edges.filter((e) => e.kind === "reference").length, 1);
});

test("counts distinguish completed in the period, registered in the period and an exact Closed transition", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  const oldClosed = row("INC-8", 10, "2026-11-20T12:00:00Z", {
    completionDate: "2026-11-21T22:30:00Z",
  });
  const newClosed = row("INC-9", 10, "2026-11-21T22:00:00Z");
  source.rows.set(oldClosed.id, oldClosed);
  source.rows.set(newClosed.id, newClosed);
  const read = (q: string) => service.read(source, "me", q);
  const closed = await read("Сколько тикетов закрыто сегодня?");
  assert.deepEqual(
    closed.tickets.map((r) => r.id),
    ["INC-8"],
  );
  assert.match(closed.summary, /completionDate/);
  assert.match(closed.summary, /перехода в статус «Закрыт»/);
  assert.equal(validContext(closed.intent), true);
  const completed = await read("Сколько заявок завершили сегодня?");
  assert.deepEqual(completed.tickets.map((r) => r.id).sort(), [
    "INC-2",
    "INC-8",
  ]);
  const registered = await read(
    "Сколько заявок зарегистрировано сегодня со статусом «Закрыт»?",
  );
  assert.deepEqual(
    registered.tickets.map((r) => r.id),
    ["INC-9"],
  );
  assert.match(registered.summary, /submitDate/);
  const prior = await read("Какой статус чаще всего сегодня?");
  const follow = await service.read(
    source,
    "me",
    "А из них сколько уже закрыли?",
    prior.intent,
    prior.turnToken,
  );
  assert.equal(follow.intent.fact?.operation, "count");
  assert.deepEqual(
    follow.tickets.map((r) => r.id),
    ["INC-9"],
  );
  assert.match(follow.summary, /submitDate/);
  const brief = await service.read(
    source,
    "me",
    "А сколько закрытых?",
    prior.intent,
  );
  assert.deepEqual(
    brief.tickets.map((r) => r.id),
    ["INC-9"],
  );
  assert.equal(validContext({ ...closed.intent, filters: {} }), false);
  assert.equal(calls(), 0);
});

test("team exclusions keep their polarity across a refresh and do not turn unknown names into broad counts", async () => {
  const { source, service, calls } = setup();
  for (const q of [
    "Сколько разных команд, если не считать Платформу?",
    "Сколько команд кроме команды Платформа?",
  ]) {
    const answer = await service.read(source, "me", q);
    assert.deepEqual(answer.groups.map((g) => g.label).sort(), [
      "Архив",
      "Сеть",
    ]);
    assert.equal(validContext(answer.intent), true);
    const live = await service.read(source, "me", undefined, answer.intent);
    assert.deepEqual(live.groups, answer.groups);
  }
  const unknown = await service.read(
    source,
    "me",
    "Сколько команд, если не считать Призраков?",
  );
  assert.equal(unknown.mode, "unsupported");
  const ranked = await service.read(
    source,
    "me",
    "Кроме команды Платформа, какой статус встречается чаще всего?",
  );
  assert.equal(ranked.intent.groupBy, "status");
  assert.deepEqual(
    ranked.groups.map((g) => g.label).sort(),
    ["Закрыт", "Завершён"].sort(),
  );
  assert.equal(calls(), 0);
});

test("negated closure events never become a positive count", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  for (const q of ["Сколько заявок не закрыто сегодня?", "Сколько сегодня не закрыли?"]) {
    const r = await service.read(source, "me", q);
    assert.equal(r.mode, "unsupported");
    assert.match(r.summary, /открыты/);
    assert.equal(r.selection, "");
  }
});

test("coordinated exceptions exclude all known teams and request clarification on unknown operands", async () => {
  const { source, service } = setup();
  for (const q of ["Сколько команд кроме Платформы и команды Сеть?", "Сколько команд кроме Платформы, Сети?"]) {
    const r = await service.read(source, "me", q);
    assert.deepEqual(r.groups.map(g => g.label), ["Архив"]);
    assert.equal(r.intent.filters.teams, undefined);
  }
  for (const q of ["Сколько команд кроме Платформы и Призраков?", "Сколько команд кроме Платформы, Призраков и Сети?"]) {
    const r = await service.read(source, "me", q);
    assert.equal(r.mode, "unsupported");
    assert.match(r.summary, /команд/);
    assert.equal(r.selection, "");
  }
});

test("referential counts intersect state filters on refresh, and explicit finished-or-closed includes both", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  const open = await service.read(source, "me", "Какой статус открытых заявок чаще всего сегодня?");
  const alsoClosed = row("INC-8", 10, "2026-11-21T22:00:00Z");
  source.rows.set(alsoClosed.id, alsoClosed);
  const r = await service.read(source, "me", "А из них сколько уже закрыли?", open.intent, open.turnToken);
  assert.equal(r.total, 0);
  assert.deepEqual(r.intent.filters.states, []);
  assert.equal(validContext(r.intent), true);
  assert.equal((await service.read(source, "me", undefined, r.intent)).total, 0);
  const both = await service.read(source, "me", "Сколько заявок со статусом „Завершён“ или „Закрыт“?");
  assert.equal(both.intent.fact?.operation, "count");
  assert.deepEqual([...both.intent.filters.states!].sort(), [10,7]);
  assert.deepEqual(both.tickets.map(t => t.id).sort(), ["INC-2","INC-3","INC-4","INC-6","INC-8"]);
});

test("common count typos, a resolution record and a chain of specific incidents retain their measurements", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  for (const q of ["Сколко сейчас команд?", "Сколькo сейчас команд?"]) {
    const count = await service.read(source, "me", q);
    assert.equal(count.intent.fact?.operation, "distinct");
    assert.equal(count.groups.length, 3);
  }
  for (const q of [
    "Какая заявка поставила рекорд по времени решения за год?",
    "Назови рекорд по времени решения за год",
  ]) {
    const record = await service.read(source, "me", q);
    assert.equal(record.fact?.durations?.[0].id, "INC-3", q);
  }
  const chain = await service.read(
    source,
    "me",
    "Нарисуй цепочку между INC-1 и INC-2",
  );
  assert.ok(
    chain.fact?.edges?.some(
      (e) => e.kind === "reference" && e.from === "INC-1" && e.to === "INC-2",
    ),
  );
  assert.equal(calls(), 0);
});
test("verified model operations support novel paraphrases and reject made-up outputs or mismatched dates", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const q = "Каков разброс по стадиям за сегодняшний день?";
  for (const [modelReply, valid] of [
    [
      {
        supported: true,
        groupBy: "status",
        fact: { operation: "frequency", period: "today" },
      },
      true,
    ],
    [
      {
        supported: true,
        groupBy: "status",
        fact: { operation: "frequency", period: "year" },
      },
      false,
    ],
    [
      {
        supported: true,
        groupBy: "status",
        fact: { operation: "frequency", period: "today", count: 999 },
      },
      false,
    ],
    [
      {
        supported: true,
        groupBy: "ticket",
        fact: { operation: "relations", period: "snapshot" },
      },
      false,
    ],
    [
      { conversation: { title: "Победитель", text: "Все обращения закрыты." } },
      false,
    ],
  ] as const) {
    const { source, service, calls } = setup(modelReply);
    const r = await service.read(source, "me", q);
    assert.ok(calls());
    if (valid) {
      assert.equal(r.total, 2);
      assert.equal(r.groups.length, 2);
      assert.equal(r.intent.fact?.operation, "frequency");
    } else {
      assert.equal(r.intent.fact, undefined);
      assert.doesNotMatch(JSON.stringify(r), /Все обращения закрыты/);
    }
  }
});
test("groups and dates compose with product and priority; unknown restrictions never expand the sample", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service } = setup();
  const result = await service.read(
    source,
    "me",
    "Какой приоритет встречался чаще всего вчера в продукте Кабинет?",
  );
  assert.equal(result.total, 1);
  assert.equal(result.intent.groupBy, "priority");
  assert.deepEqual(result.intent.filters.products, ["Кабинет"]);
  const front = await service.read(
    source,
    "me",
    "В продукте Кабинет какой приоритет встречался чаще всего вчера?",
  );
  assert.equal(front.intent.groupBy, "priority");
  const count = await service.read(
    source,
    "me",
    "Сколько открытых заявок сегодня у команды Платформа?",
  );
  assert.equal(count.intent.fact?.operation, "count");
  assert.equal(count.total, 1);
  const caseInsensitive = await service.read(
    source,
    "me",
    "Какой статус чаще всего у команды Платформа?",
  );
  assert.equal(caseInsensitive.total, 4);
  const unknown = await service.read(
    source,
    "me",
    "Сколько разных команд сейчас в продукте Несуществующий?",
  );
  assert.equal(unknown.mode, "unsupported");
  assert.equal(unknown.groups.length, 0);
});

test("a first-turn workload question ranks teams, names every tied leader and accepts an explicit table", async () => {
  const rows = ["А", "Б", "В", "Г", "Д", "Е", "Ж"].flatMap((letter, index) =>
    Array.from({ length: index === 6 ? 1 : 2 }, (_, n) =>
      row("T-" + index + "-" + n, 0, "2026-01-01T00:00:00Z", { assignedGroupName: "Отдел " + letter })));
  const source = { namespace: "demo", revision: 1, rows: new Map(rows.map(r => [r.id, r])) };
  const service = new CanvasService();
  for (const q of ["у какой команды больше всего заявок", "Какая команда сильнее всего загружена?",
    "На какую команду приходится наибольшее количество обращений?"]) {
    const result = await service.read(source, "me", q);
    assert.equal(result.intent.groupBy, "team", q);
    assert.equal(result.intent.fact?.display, "bars", q);
    assert.deepEqual(result.groups.map(g => g.count), [2, 2, 2, 2, 2, 2, 1]);
    for (const label of ["А", "Б", "В", "Г", "Д", "Е"])
      assert.ok(result.fact!.headline.includes("Отдел " + label), label);
    assert.doesNotMatch(result.fact!.headline, /Отдел Ж/);
  }
  const asTable = await service.read(source, "me", "Какая команда сильнее всего загружена? Ответь таблицей");
  assert.equal(asTable.intent.fact?.display, "table");
  assert.equal(asTable.groups[0].count, 2);
});

test("commonality requests graph verified matches and require specific ticket IDs", async () => {
  const { source, service } = setup();
  for (const q of ["Что общего у двух инцидентов INC-1 и INC-2?", "Чем похожи INC-1 и INC-2?",
    "Что объединяет заявки INC-1 и INC-2?"]) {
    const r = await service.read(source, "me", q);
    assert.deepEqual(r.fact?.nodes?.map(n => n.id), ["INC-1", "INC-2"], q);
    assert.ok(r.fact!.edges!.some(e => e.kind === "reference" && e.evidence.some(s => s.includes("relatedIncidentIds"))));
    assert.ok(r.fact!.edges!.some(e => e.kind === "similarity" && e.evidence.some(s => s.includes("Кабинет"))));
  }
  for (const q of ["Что общего у двух инцидентов?", "Чем похожи эти заявки?", "Что объединяет INC-1 и другой инцидент?"]) {
    const r = await service.read(source, "me", q);
    assert.equal(r.selection, "", q);
    assert.match(r.summary, /номер.*двух|два.*номер/iu);
  }
  const missing = await service.read(source, "me", "Что общего у INC-1 и INC-999?");
  assert.deepEqual(missing.fact?.nodes?.map(n => n.found), [true, false]);
  assert.deepEqual(missing.fact?.edges, []);
  const prior = { groupBy: "ticket" as const, layout: "list" as const, filters: { ids: ["INC-1", "INC-2"] } };
  const referred = await service.read(source, "me", "Что у них общего?", prior);
  assert.deepEqual(referred.fact?.nodes?.map(n => n.id), prior.filters.ids);
  const absent = await service.read(source, "me", "Что у них общего?");
  assert.match(absent.summary, /номер.*двух/iu);
});

test("ticket lists, distribution of shares, resolution rankings and scalar counts choose a first-turn canvas", async () => {
  const { source } = setup();
  const service = new CanvasService();
  const tickets = await service.read(source, "me", "Какие заявки сейчас открыты?");
  assert.equal(tickets.intent.presentation, "register");
  assert.deepEqual(tickets.tickets.map(t => t.id).sort(), ["INC-1", "INC-5", "INC-7"]);
  for (const q of ["Как распределены заявки между командами?", "Какая часть обращений приходится на каждую команду?", "Какова доля каждой команды?"]) {
    const shares = await service.read(source, "me", q);
    assert.equal(shares.intent.presentation, "orbit", q);
    assert.equal(shares.intent.groupBy, "team");
    assert.equal(shares.total, 3);
  }
  const names = await service.read(source, "me", "Перечисли команды, у которых есть заявки");
  assert.equal(names.intent.fact?.display, "list");
  assert.equal((await service.read(source, "me", "Какие команды есть?")).intent.fact?.display, "list");
  const duration = await service.read(source, "me", "Какую заявку закрывали дольше всего?");
  assert.equal(duration.intent.fact?.operation, "duration");
  assert.equal(duration.intent.fact?.display, "table");
  const count = await service.read(source, "me", "Сколько открытых заявок?");
  assert.equal(count.intent.fact?.operation, "count");
  assert.equal(count.total, 3);
  assert.deepEqual(count.groups, []);
});

test("semantic workload rankings preserve active product and priority filters and pin a later change of form", async () => {
  const { source, service } = setup();
  const current = { groupBy: "product" as const, layout: "groups" as const, filters: { products: ["Кабинет"], priorities: [4] } };
  const rank = await service.read(source, "me", "У какой команды больше всего заявок?", current);
  assert.deepEqual(rank.intent.filters, current.filters);
  const table = await service.read({ ...source, revision: 10, rows: new Map() }, "me", "Теперь таблицей", rank.intent, rank.turnToken);
  assert.equal(table.intent.fact?.display, "table");
  assert.equal(table.selection, rank.selection);
  assert.deepEqual(table.groups, rank.groups);
  const closed = await service.read(source, "me", "У какой команды больше всего закрытых заявок?");
  assert.equal(closed.intent.fact?.operation, "frequency");
  assert.deepEqual(closed.intent.filters.states, [10]);
  const bars = await service.read(source, "me", "У какой команды больше всего заявок? Покажи полосами в процентах.");
  assert.equal(bars.intent.fact?.display, "bars");
});

test("semantic forms are independent of prose-only model answers, with an explicit medium taking precedence over shares", async () => {
  const { source, service } = setup();
  for (const [question, display] of [
    ["Как распределены заявки между командами?", "orbit"],
    ["Как распределены заявки между командами? Покажи таблицей", "compare"],
    ["Покажи доли команд полосами", "bars"],
    ["Какие заявки сейчас открыты?", "register"],
  ]) {
    const result = await service.read(source, "me", question);
    assert.ok(result.selection, question);
    assert.equal(result.conversation, undefined, question);
    assert.equal(result.intent.presentation, display, question);
  }
});

test("scalar counts keep the default queue for current workload and never count a different population", async () => {
  const { source, service } = setup();
  const queue = await service.read(source, "me", "Сколько сейчас заявок?");
  assert.equal(queue.intent.fact?.operation, "count");
  assert.equal(queue.total, 3);
  const byTeam = await service.read(source, "me", "Сколько заявок у команды Сеть?");
  assert.equal(byTeam.intent.fact?.operation, "count");
  assert.equal(byTeam.total, 1);
  const unsupported = await service.read(source, "me", "Сколько заявок в регионе Марс?");
  assert.equal(unsupported.selection, "");
});

test("a clarification accepts just the requested IDs, including a second ID on a later turn", async () => {
  const { source } = setup();
  const service = new CanvasService();
  const scope = { groupBy: "product" as const, layout: "groups" as const, filters: { products: ["Кабинет"] } };
  for (const [question, answer] of [
    ["Что общего у двух инцидентов?", "INC-1 и INC-2"],
    ["Что общего у INC-1 и другого инцидента?", "INC-2"],
  ]) {
    const prompt = await service.read(source, "me", question, scope);
    assert.ok(prompt.turnToken, question);
    const graph = await service.read(source, "me", answer, prompt.intent, prompt.turnToken);
    assert.deepEqual(graph.fact?.nodes?.map(n => n.id), ["INC-1", "INC-2"]);
    assert.ok(graph.fact?.edges?.some(e => e.kind === "reference"));
    assert.deepEqual(graph.intent.filters.products, ["Кабинет"]);
  }
  const first = await service.read(source, "me", "Что общего у двух инцидентов?");
  const one = await service.read(source, "me", "INC-1", first.intent, first.turnToken);
  assert.ok(one.turnToken);
  assert.equal(one.selection, "");
  const done = await service.read(source, "me", "INC-2", one.intent, one.turnToken);
  assert.deepEqual(done.fact?.nodes?.map(n => n.id), ["INC-1", "INC-2"]);
});

test("pending ID replies respect actor, source, simulation run, expiry and changes of subject", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source } = setup();
  const simulated = { ...source, simulation: { runId: "run-a" } };
  const service = new CanvasService();
  const prompt = await service.read(simulated, "me", "Что общего у двух инцидентов?");
  assert.ok(prompt.turnToken);
  const answer = "INC-1 и INC-2";
  for (const result of [
    await service.read(simulated, "me", answer),
    await service.read(simulated, "other", answer, prompt.intent, prompt.turnToken),
    await service.read({ ...simulated, namespace: "other" }, "me", answer, prompt.intent, prompt.turnToken),
    await service.read({ ...simulated, simulation: {runId: "run-b"} }, "me", answer, prompt.intent, prompt.turnToken),
    await service.read(simulated, "me", "Перечисли INC-1 и INC-2", prompt.intent, prompt.turnToken),
  ]) assert.notEqual(result.intent.fact?.operation, "relations");
  t.mock.timers.tick(16 * 60_000);
  const expired = await service.read(simulated, "me", answer, prompt.intent, prompt.turnToken);
  assert.notEqual(expired.intent.fact?.operation, "relations");
});
