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
