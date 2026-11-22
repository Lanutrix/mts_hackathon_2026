import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { normalize, STATES } from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import { VseLlm } from "../apps/server/vsellm.ts";

const hour = 3_600_000;
const now = Date.parse("2026-11-22T12:00:00Z");
const base = generate(1).rows[0];
function row(n: number, date: string | null, duration: number | null, team = "Сеть", state = 7) {
  return normalize({ ...base, id: "INC-" + n, sysId: "K" + n, header: "Тема " + n,
    assignedGroupName: team, productName: "Почта", stateId: state, state: STATES[state].label,
    stateEnum: STATES[state].enum, submitDate: date,
    completionDate: duration === null || !date ? null : new Date(Date.parse(date) + duration * hour).toISOString(),
  }, "demo");
}
const rows = [
  row(20, "2026-11-19T22:00:00Z", 1), row(3, "2026-11-19T22:00:00Z", 3),
  row(4, "2026-11-20T21:00:00Z", 8, "Платформа", 10), row(5, "2026-11-21T21:00:00Z", null, "Сеть", 2),
  row(6, null, null), row(7, "2026-11-23T00:00:00Z", 2),
];
const source = { namespace: "demo", revision: 1, rows: new Map(rows.map(r => [r.key, r])) };

test("registration order composes direction, limit and cohort independently of phrasing", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  for (const q of ["покажи первый инцидент самый", "самый первый", "Я забыл, какую заявку завели раньше всех?",
    "что у нас пришло самым первым?", "самая старая заявка", "покажи инцедент который поступил первым",
    "с какой заявки всё началось?", "с какого обращения началась история?"]) {
    const r = await service.read(source, "me", q);
    assert.deepEqual(r.tickets.map(t => t.id), ["INC-3"], q);
    assert.ok(r.tickets[0].submittedAt, q);
    assert.match(r.fact!.method, /submitDate/u);
    assert.ok(validContext(r.intent));
    assert.equal((await service.read(source, "me", undefined, r.intent)).tickets[0].id, "INC-3");
  }
  const pair = await service.read(source, "me", "покажи две самые ранние заявки");
  assert.deepEqual(pair.tickets.map(t => t.id), ["INC-3", "INC-20"]);
  const last = await service.read(source, "me", "а теперь последнюю", pair.intent, pair.turnToken);
  assert.deepEqual(last.tickets.map(t => t.id), ["INC-5"]);
  const pinned = await service.read(source, "me", "самая ранняя из них", last.intent, last.turnToken);
  assert.deepEqual(pinned.tickets.map(t => t.id), ["INC-5"]);
  for (const q of ["Первый инцидент команды Фантом", "Покажи первый из инцидентов INC-404"]) {
    const invalid = await service.read(source, "me", q);
    assert.equal(invalid.mode, "unsupported", q);
    assert.equal(invalid.selection, "");
  }
});

test("aggregate resolution has one grounded value and a verifiable denominator", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  for (const q of ["среднее время", "ну и сколько в среднем чинили?", "сколько обычно уходит времени на решение в среднем?",
    "посчитай среднюю длительность", "за какое время в среднем закрываем заявки?"]) {
    const r = await service.read(source, "me", q);
    assert.deepEqual(r.fact?.durationSummary, { measure: "mean", valueMs: 4 * hour, measuredCount: 3, scopeCount: 6 }, q);
    assert.match(r.fact!.headline, /решения.*4 ч/iu);
    assert.match(r.fact!.method, /submitDate.*completionDate/u);
    assert.ok(validContext(r.intent));
  }
  const r = await service.read(source, "me", "среднее время решения для команды Сеть");
  assert.equal(r.fact?.durationSummary?.valueMs, 2 * hour);
  const no = await service.read(source, "me", "среднее время", undefined);
  const interval = await service.read(source, "me", "а между сменами статуса?", no.intent, no.turnToken);
  assert.equal(interval.fact?.statusIntervals?.meanMs, null);
  const sameInterval = await service.read(source, "me", "а среднее время?", interval.intent, interval.turnToken);
  assert.equal(sameInterval.intent.fact?.operation, "statusInterval");
  assert.ok(no.suggestions.some(q => /сменами статуса/iu.test(q)));
  const registration = await service.read(source, "me", "среднее время регистрации");
  assert.match(registration.summary, /регистрац/iu);
  assert.equal(registration.fact?.durationSummary, undefined);
  for (const q of ["Среднее время загрузки страницы", "Среднее время жизни договора", "Среднее время ожидания ответа"]) {
    const unrelated = await service.read(source, "me", q);
    assert.equal(unrelated.fact?.durationSummary, undefined, q);
  }
  const empty = { ...source, rows: new Map() };
  const missing = await service.read(empty, "me", "какое среднее время решения инцидентов?");
  assert.deepEqual(missing.fact?.durationSummary, { measure: "mean", valueMs: null, measuredCount: 0, scopeCount: 0 });
});

test("informal workload and composition requests choose ranked bars or a distribution from their meaning", async () => {
  const service = new CanvasService();
  for (const [q, count] of [["У какой команды завал с заявками?", 1], ["На какую команду приходится больше всего обращений?", 5]] as const) {
    const r = await service.read(source, "me", q);
    assert.equal(r.intent.fact?.operation, "frequency", q);
    assert.equal(r.intent.fact?.display, "bars");
    assert.equal(r.groups[0].label, "Сеть");
    assert.equal(r.groups[0].count, count);
  }
  for (const q of ["Покажи расклад по статусам", "Как поделились обращения между командами?"]) {
    const r = await service.read(source, "me", q);
    assert.equal(r.intent.presentation, "orbit", q);
    assert.ok(r.groups.length);
  }
});

test("short spoken follow-ups keep the metric and cohort across multiple turns", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  const initial = await service.read(source, "me", "среднее время решения для команды Сеть");
  const median = await service.read(source, "me", "а медиана?", initial.intent, initial.turnToken);
  assert.deepEqual(median.fact?.durationSummary, { measure: "median", valueMs: 2 * hour, measuredCount: 2, scopeCount: 5 });
  const mean = await service.read(source, "me", "ну а какое среднее значение?", median.intent, median.turnToken);
  assert.deepEqual(mean.fact?.durationSummary, initial.fact?.durationSummary);
  const status = await service.read(source, "me", "среднее время смены статуса");
  const same = await service.read(source, "me", "а среднее?", status.intent, status.turnToken);
  assert.equal(same.intent.fact?.operation, "statusInterval");
  assert.deepEqual(same.fact?.statusIntervals, status.fact?.statusIntervals);
  const notMean = await service.read(source, "me", "а медиана?", same.intent, same.turnToken);
  assert.equal(notMean.fact?.statusIntervals?.medianMs, null);
  assert.match(notMean.fact!.headline, /медиан.*статус/iu);
  const ambiguous = await service.read(source, "me", "а среднее?");
  assert.equal(ambiguous.mode, "unsupported");
  assert.match(ambiguous.summary, /решения.*статус/iu);
  const overall = await service.read(source, "me", "медиана времени решения");
  assert.equal(overall.fact?.durationSummary?.valueMs, 3 * hour);
  for (const [term, axis] of [["продуктам", "product"], ["статусам", "status"], ["приоритетам", "priority"]] as const) {
    const grouped = await service.read(source, "me", "среднее время решения по " + term);
    assert.equal(grouped.intent.groupBy, axis);
    assert.ok(validContext(grouped.intent));
    assert.ok(grouped.groups.every(group => Number.isFinite(group.durationMs)));
    assert.equal(grouped.groups.reduce((sum, group) => sum + group.count, 0), 3);
    assert.match(grouped.title, new RegExp(term));
    const changed = await service.read(source, "me", "а медиану?", grouped.intent, grouped.turnToken);
    assert.equal(changed.intent.fact?.durationMeasure, "median");
    assert.equal(changed.intent.groupBy, axis);
  }
});

test("calendar filters preserve Moscow boundaries and the field measured by a follow-up", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  for (const q of ["Сколько заявок зарегистрировали 20.11.2026?", "Сколько инцидентов за 2026-11-20?", "Сколько заявок за 20 ноября 2026?"]) {
    const r = await service.read(source, "me", q);
    assert.deepEqual(r.tickets.map(t => t.id).sort(), ["INC-20", "INC-3"], q);
    assert.ok(validContext(r.intent));
  }
  const r = await service.read(source, "me", "среднее время с 20.11.2026 по 21.11.2026");
  assert.equal(r.fact?.durationSummary?.valueMs, 4 * hour);
  const follow = await service.read(source, "me", "а только для команды Платформа?", r.intent, r.turnToken);
  assert.equal(follow.fact?.durationSummary?.valueMs, 8 * hour);
  assert.deepEqual((await service.read(source, "me", undefined, follow.intent)).fact?.durationSummary, follow.fact?.durationSummary);
  const bad = await service.read(source, "me", "первый инцидент за 31.02.2026");
  assert.equal(bad.mode, "unsupported");
  assert.equal(bad.selection, "");
  const days = await service.read(source, "me", "Какие обращения пришли с 20 по 21 ноября 2026?");
  assert.deepEqual(days.tickets.map(t => t.id), ["INC-4", "INC-3", "INC-20"]);
  assert.ok(validContext(days.intent));
  const calendarBrief = await service.read(source, "me", "Сколько зарегистрировали позавчера?");
  assert.equal(calendarBrief.total, 2);
  const lookback = await service.read(source, "me", "сколько заявок за последние 48 часов?");
  assert.deepEqual(lookback.tickets.map(t => t.id).sort(), ["INC-4", "INC-5"]);
  for (const [window, hours, count] of [["7 часов", 7, 0], ["7 дней", 168, 4], ["365 часов", 365, 4], ["365 дней", 8760, 4]] as const) {
    const r = await service.read(source, "me", "Количество заявок за " + window);
    assert.equal(r.intent.fact?.lookbackHours, hours, window);
    assert.equal(r.total, count);
    assert.ok(validContext(r.intent));
  }
  for (const q of ["покажи первый инцидент за 48 часов", "первый инцидент за 7 дней"]) {
    const r = await service.read(source, "me", q);
    assert.equal(r.total, 1, q);
  }
  for (const q of ["сколько заявок за 20.11.2026 и вчера?", "какие заявки по состоянию на 20.11.2026?", "сколько заявок за 0 часов?"]) {
    const result = await service.read(source, "me", q);
    assert.equal(result.mode, "unsupported", q);
  }
});

test("the provider can express chronology in a validated plan for indirect language", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const model = new VseLlm("test", "test", async () => Response.json({ choices: [{ message: {
    content: JSON.stringify({ supported: true, groupBy: "ticket", filters: {}, fact: { operation: "recent", ascending: true, limit: 1, period: "snapshot" } }),
  } }] }));
  const r = await new CanvasService(model).read(source, "me", "С какой записи всё началось?");
  assert.deepEqual(r.tickets.map(t => t.id), ["INC-3"]);
  assert.match(r.fact!.method, /submitDate/u);
});
