import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { normalize, STATES } from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import { VseLlm } from "../apps/server/vsellm.ts";

const now = Date.parse("2026-12-02T11:30:00Z");
const template = generate(1).rows[0];
function incident(n: number, submitted: string | null, finished: string | null = null) {
  const state = finished ? 7 : 2;
  return normalize({ ...template, sysId: "K" + n, id: "INC-" + n, stateId: state,
    state: STATES[state].label, stateEnum: STATES[state].enum, assignedGroupName: n === 10 ? "Другая" : "Сеть",
    submitDate: submitted, completionDate: finished }, "demo");
}
const rows = [
  incident(1, "2026-10-31T20:59:59Z"), incident(2, "2026-10-31T21:00:00Z"),
  incident(3, "2026-11-25T11:30:00Z"), incident(4, "2026-11-29T20:59:59Z"),
  incident(5, "2026-11-29T21:00:00Z", "2026-12-02T06:00:00Z"), incident(6, "2026-11-30T21:00:00Z"),
  incident(7, "2026-12-02T05:59:59Z", "2026-12-02T09:00:00Z"), incident(8, "2026-12-02T06:00:00Z"),
  incident(9, "2026-12-02T08:59:59.999Z"), incident(10, "2026-12-02T09:00:00Z"),
  incident(11, "2026-12-02T10:30:00Z"), incident(12, "2026-12-02T11:30:00Z"),
  incident(13, "2026-12-02T11:30:00.001Z"), incident(14, null),
];
const source = { namespace: "demo", revision: 1, rows: new Map(rows.map(r => [r.key, r])) };

for (const [period, expected] of [
  ["на этой неделе", [5, 6, 7, 8, 9, 10, 11, 12]],
  ["с начала недели", [5, 6, 7, 8, 9, 10, 11, 12]],
  ["за последние 7 дней", [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ["на прошлой неделе", [3, 4]],
  ["в прошлом месяце", [2, 3, 4, 5]],
  ["в этом месяце", [6, 7, 8, 9, 10, 11, 12]],
  ["в прошлом году", []],
  ["в этом году", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
  ["за последний час", [11, 12]],
  ["сегодня с 9 до 12", [8, 9]],
  ["сегодня с 14:30 до 24:00", [12]],
  ["2 декабря 2026 с 09:00 до 12:00", [8, 9]],
] as const) {
  test("grounded count of registrations " + period, async t => {
    t.mock.timers.enable({ apis: ["Date"], now });
    const service = new CanvasService();
    const result = await service.read(source, "me", "Сколько заявок зарегистрировали " + period + "?");
    assert.equal(result.intent.fact?.operation, "count");
    assert.equal(result.total, expected.length);
    const all = service.page(source.namespace, "me", result.selection, undefined, 0)!.items;
    assert.deepEqual(all.map(r => Number(r.id.slice(4))).sort((a, b) => a - b), [...expected]);
    assert.match(result.fact!.headline, new RegExp(String.raw`\b` + expected.length + String.raw`\b`));
    assert.match(result.fact!.method, /submitDate.*МСК/u);
    assert.ok(validContext(result.intent));
    assert.equal((await service.read(source, "me", undefined, result.intent)).total, expected.length);
  });
}

test("a new period alone preserves the completion field and the team filter", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  const completed = await service.read(source, "me", "Сколько заявок команды Сеть завершили сегодня?");
  assert.equal(completed.total, 2);
  const part = await service.read(source, "me", "а сегодня с 9 до 12?", completed.intent, completed.turnToken);
  assert.equal(part.intent.fact?.dateField, "completionDate");
  assert.deepEqual(part.intent.filters.teams, ["Сеть"]);
  assert.deepEqual(part.tickets.map(r => r.id), ["INC-5"]);
  const month = await service.read(source, "me", "а в прошлом месяце?", part.intent, part.turnToken);
  assert.equal(month.intent.fact?.dateField, "completionDate");
  assert.equal(month.total, 0);
  assert.ok(validContext(month.intent));
});

test("a rolling week retains the historical genitive phrasing", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const r = await new CanvasService().read(source, "me", "Сколько заявок зарегистрировали в течение последней недели?");
  assert.equal(r.intent.fact?.period, "week");
  assert.equal(r.total, 10);
});

test("bare mean retains its denominator when limited to a clock window", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const r = await new CanvasService().read(source, "me", "Среднее время сегодня с 9 до 12?");
  assert.deepEqual(r.fact?.durationSummary, { measure: "mean", valueMs: 57 * 3600000, measuredCount: 1, scopeCount: 14 });
});

test("incomplete, conflicting or impossible time qualifiers never silently widen the count", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  for (const when of ["сегодня с 12 до 9", "сегодня с 25:00 до 26:00", "сегодня в 9:65",
    "сегодня и вчера", "сегодня за последний час", "сегодня с 9", "сегодня в 9", "сегодня после 9 утра",
    "вчера вечером", "с 9 до 12", "на следующей неделе", "завтра"]) {
    const r = await service.read(source, "me", "Сколько заявок зарегистрировали " + when + "?");
    assert.equal(r.mode, "unsupported", when);
    assert.equal(r.selection, "", when);
  }
});

test("model cannot add an unasked retrospective window to a grounded metric", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const model = new VseLlm("test", "test", async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ supported: true, groupBy: "status", filters: {},
      fact: { operation: "frequency", period: "previousYear" } }) } }],
  }));
  const r = await new CanvasService(model).read(source, "me", "Каков разброс по стадиям?");
  assert.notEqual(r.intent.fact?.period, "previousYear");
});

test("calendar refresh recomputes Monday at Moscow midnight when UTC still reads Sunday", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-29T20:59:59Z") });
  const service = new CanvasService();
  const sunday = await service.read(source, "me", "Сколько заявок на этой неделе?");
  assert.deepEqual(sunday.tickets.map(t => t.id).sort(), ["INC-3", "INC-4"]);
  t.mock.timers.tick(1000);
  const monday = await service.read(source, "me", undefined, sunday.intent);
  assert.deepEqual(monday.tickets.map(t => t.id), ["INC-5"]);
});

test("completed lists show and order by the event in the question, including a missing registration", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const extra = incident(15, null, "2026-12-02T08:30:00Z");
  const extraSource = { ...source, rows: new Map(source.rows).set(extra.key, extra) };
  const r = await new CanvasService().read(extraSource, "me", "Покажи заявки, которые завершили сегодня с 9 до 12");
  assert.equal(r.intent.fact?.operation, "recent");
  assert.deepEqual(r.tickets.map(r => [r.id, r.completedAt]), [
    ["INC-15", "2026-12-02T08:30:00.000Z"], ["INC-5", "2026-12-02T06:00:00.000Z"],
  ]);
  assert.match(r.fact!.method, /completionDate/u);
  assert.ok(validContext(r.intent));
});

test("registration cohort for resolution duration is explicit and excludes future finishes", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const future = incident(15, "2026-12-02T05:30:00Z", "2026-12-03T11:31:00Z");
  const extraSource = { ...source, rows: new Map(source.rows).set(future.key, future) };
  const r = await new CanvasService().read(extraSource, "me", "Среднее время решения заявок, зарегистрированных сегодня");
  assert.equal(r.fact?.durationSummary?.measuredCount, 1);
  assert.equal(r.fact?.durationSummary?.valueMs, 3 * 3_600_000 + 1000);
  assert.match(r.fact!.method, /по дате регистрации \(submitDate\)/iu);
  assert.ok(validContext(r.intent));
});

test("unmeasured transitions do not become counts of registrations", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const question of ["Сколько заявок перевели в работу сегодня?", "Сколько заявок назначили на команду за последний час?"]) {
    const result = await new CanvasService().read(source, "me", question);
    assert.equal(result.mode, "unsupported", question);
    assert.equal(result.selection, "");
  }
});
