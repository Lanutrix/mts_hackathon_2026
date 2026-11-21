import { strict as assert } from "node:assert";
import test from "node:test";
import {
  normalize,
  type Raw,
  type Incident,
} from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import {
  answerInsightIds,
  insightDefinitions,
} from "../packages/contracts/answerInsights.ts";
import { answerExhibits } from "../packages/contracts/answerCatalog.ts";
import {
  buildAnswerInsights,
  readAnswerInsightRequest,
} from "../apps/server/answerInsights.ts";

const now = Date.UTC(2026, 10, 22, 9),
  hour = 3600000;
function ticket(id: string, overrides: Raw): Incident {
  return normalize(
    {
      ...generate(1).rows[0],
      id,
      sysId: null,
      stateId: 2,
      stateEnum: "WorkInProgress",
      state: "Выполняется",
      priorityId: 3,
      priority: "Высокий",
      submitDate: new Date(now - hour * 4).toISOString(),
      deadline: new Date(now - hour).toISOString(),
      ...overrides,
    },
    "workspace",
  );
}
test("each named answer insight can be independently requested and computed, including an empty source", () => {
  const records = generate(72).rows.map((row) => normalize(row, "demo"));
  assert.ok(new Set([...answerInsightIds, ...answerExhibits]).size >= 100);
  for (const id of answerInsightIds) {
    const q = insightDefinitions[id].title;
    assert.deepEqual(readAnswerInsightRequest(q).ids, [id], q);
    const [item] = buildAnswerInsights(q, records, now);
    assert.equal(item.id, id);
    assert.ok(item.value.trim());
    assert.ok(!/NaN|Infinity/.test(item.value));
    for (const point of item.points) {
      assert.ok(Number.isFinite(point.value) && point.value >= 0);
      if (point.ticket) assert.ok(records.some((r) => r.id === point.ticket));
    }
    assert.equal(buildAnswerInsights(q, [], now)[0].id, id);
  }
  const compound = readAnswerInsightRequest(
    "Для продукта Платёж покажи возраст очереди и полноту отметки эскалации",
  );
  assert.deepEqual(compound.ids, ["age-bands", "escalation-known"]);
  assert.match(compound.rest, /продукта платеж/);
  assert.doesNotMatch(compound.rest, /эскалаци/);
});
test("closed durations and SLA shares use only records with eligible dates", () => {
  const rows = [
    ticket("OPEN", {}),
    ticket("EARLY", {
      stateId: 7,
      stateEnum: "Resolved",
      completionDate: new Date(now - 2 * hour).toISOString(),
    }),
    ticket("LATE", {
      stateId: 10,
      stateEnum: "Closed",
      completionDate: new Date(now).toISOString(),
    }),
    ticket("MISSING", {
      stateId: 7,
      stateEnum: "Resolved",
      completionDate: null,
    }),
  ];
  const [ontime] = buildAnswerInsights("Решения в срок", rows, now);
  assert.equal(ontime.value, "50 %");
  assert.equal(ontime.evidence, "EARLY");
  assert.deepEqual(
    ontime.points.map((p) => p.value),
    [1, 1],
  );
  const [duration] = buildAnswerInsights("Среднее время решения", rows, now);
  assert.equal(duration.value, "3 ч");
  assert.equal(
    buildAnswerInsights("Ближайший выход из ожидания", rows, now)[0].value,
    "Нет данных",
  );
});
test("time charts cross the Moscow midnight boundary and preserve complete group counts", () => {
  const ref = Date.UTC(2026, 10, 22, 22);
  const rows = [
    ticket("A", { submitDate: "2026-11-22T20:59:00Z" }),
    ticket("B", { submitDate: "2026-11-22T21:01:00Z" }),
    ticket("C", { submitDate: "2026-11-25T18:00:00Z" }),
  ];
  const [item] = buildAnswerInsights("Поступления за семь дней", rows, ref);
  assert.equal(item.value, "2");
  assert.deepEqual(
    item.points.slice(-2).map((p) => [p.label, p.value]),
    [
      ["22.11", 1],
      ["23.11", 1],
    ],
  );
  const missing = buildAnswerInsights(
    "Поступления за семь дней",
    [ticket("D", { submitDate: null })],
    ref,
  )[0];
  assert.equal(missing.value, "Нет данных");
  const groups = Array.from({ length: 8 }, (_, i) =>
    ticket("T" + i, {
      productName: "Продукт " + i,
      assignedGroupName: "Команда " + i,
    }),
  );
  const [relation] = buildAnswerInsights(
    "Связи продуктов и команд",
    groups,
    now,
  );
  assert.equal(relation.value, "8");
  assert.equal(
    relation.points.reduce((n, p) => n + p.value, 0),
    8,
  );
  assert.equal(relation.points.at(-1)?.label, "Остальные");
  assert.deepEqual(
    buildAnswerInsights("то же в этом срезе", groups, now, ["product-team"])[0]
      .points,
    relation.points,
  );
});
