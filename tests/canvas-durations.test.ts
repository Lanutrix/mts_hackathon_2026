import test from "node:test";
import assert from "node:assert/strict";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { formatFactDuration } from "../packages/contracts/canvasFacts.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES } from "../packages/domain/index.ts";

const hour = 3_600_000;
const now = Date.parse("2026-11-22T12:00:00Z");
const start = now - 8 * hour;
const base = generate(1).rows[0];
function incident(id: number, hours: number | null, team: string, state = 7) {
  return normalize({
    ...base, id: "INC-" + id, sysId: "INC-" + id, stateId: state,
    state: STATES[state].label, stateEnum: STATES[state].enum,
    submitDate: hours === -1 ? null : new Date(start).toISOString(),
    completionDate: hours === null ? null : new Date(start + hours * hour).toISOString(),
    assignedGroupName: team, productName: "Кабинет",
    header: id <= 2 ? "Ошибка авторизации" : "Таймаут ответа",
  }, "client");
}
const snapshot = (rows = [
  incident(1, 1, "Сеть"), incident(2, 5, "Сеть", 10), incident(3, 3, "Хостинг"),
  incident(4, 8, "Хостинг"), incident(5, null, "Сеть", 2), incident(6, 2, "Хостинг", 0),
  incident(7, null, "Сеть"), incident(8, -1, "Хостинг"), incident(9, 9, "Сеть"),
]) => ({ namespace: "client", revision: 8, rows: new Map(rows.map(r => [r.id, r])) });

test("time comparisons return observed elapsed time, extrema and every page of source evidence", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService(), source = snapshot();
  for (const question of ["Сравнение инцидентов по времени", "Сравни все инциденты по времени", "Сопоставь заявки по длительности решения"]) {
    const r = await service.read(source, "me", question);
    assert.equal(r.intent.fact?.operation, "duration", question);
    assert.equal(r.intent.fact?.durationMeasure, "individual", question);
    assert.equal(r.total, 4);
    assert.deepEqual(r.fact!.durations!.map(d => [d.id, d.ms]), [
      ["INC-4", 8 * hour], ["INC-2", 5 * hour], ["INC-3", 3 * hour], ["INC-1", hour],
    ]);
    assert.match(r.fact!.notes.join(" "), /незаверш[её]н\S*[^.]*2/iu);
    assert.match(r.fact!.notes.join(" "), /без даты завершения[^.]*1/iu);
    assert.match(r.fact!.notes.join(" "), /корректной пары дат[^.]*1/iu);
    assert.ok(validContext(r.intent));
  }
  for (const question of ["Самый долгий инцидент", "Какой инцидент длился дольше всего?"]) {
    const r = await service.read(source, "me", question);
    assert.match(r.fact!.headline, /INC-4.*8 ч/u, question);
  }
  const many = snapshot(Array.from({ length: 43 }, (_, i) => incident(i, i / 10, "Сеть")));
  const r = await service.read(many, "me", "Сравни все инциденты по времени");
  assert.equal(r.total, 43);
  assert.ok(r.fact!.durations!.length <= 10);
  assert.deepEqual(service.page("client", "me", r.selection, undefined, 40)?.items.map(t => [t.id, t.duration?.ms]),
    [["INC-2", hour / 5], ["INC-1", hour / 10], ["INC-0", 0]]);
  assert.equal(service.page("client", "other", r.selection, undefined, 40), undefined);
});

test("duration by team or symptom uses measured group statistics and the same incident members on drill-down", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService(), source = snapshot();
  const result = await service.read(source, "me", "Анализ времени по командам за неделю");
  assert.equal(result.intent.fact?.operation, "duration");
  assert.equal(result.intent.groupBy, "team");
  assert.deepEqual(result.groups.map(g => [g.label, g.durationMs, g.count]), [["Хостинг", 5.5 * hour, 2], ["Сеть", 3 * hour, 2]]);
  assert.match(result.fact!.headline, /Хостинг.*5 ч 30 мин/u);
  assert.match(result.fact!.method, /медиан/iu);
  assert.equal(result.total, 4);
  assert.ok(validContext(result.intent));
  assert.deepEqual(service.page("client", "me", result.selection, result.groups[0].key, 0)!.items.map(t => t.id), ["INC-4", "INC-3"]);
  const redraw = await service.read(snapshot([]), "me", "Таблицей", result.intent, result.turnToken);
  assert.deepEqual(redraw.groups, result.groups);
  const bySymptom = await service.read(source, "me", "А по симптомам?", result.intent, result.turnToken);
  assert.equal(bySymptom.intent.groupBy, "symptom");
  assert.equal(bySymptom.intent.fact?.period, "week");
  assert.deepEqual(bySymptom.groups.map(g => [g.durationMs, g.count]), [[5.5 * hour, 2], [3 * hour, 2]]);
  const byTicket = await service.read(source, "me", "А по отдельным инцидентам?", bySymptom.intent, bySymptom.turnToken);
  assert.equal(byTicket.intent.groupBy, "ticket");
  assert.equal(byTicket.intent.fact?.period, "week");
  assert.equal(byTicket.fact?.durations?.length, 4);
  const counted = await service.read(source, "me", "Сколько из них?", result.intent, result.turnToken);
  assert.equal(counted.intent.fact?.operation, "count");
  assert.equal(counted.total, 4);
  assert.ok(validContext(counted.intent));
  const refreshed = await service.read(source, "me", undefined, counted.intent);
  assert.equal(refreshed.total, counted.total);
  const empty = await service.read(snapshot([]), "me", "Анализ времени по командам");
  assert.equal(empty.total, 0);
  assert.match(empty.fact!.headline, /нет завершённых/iu);
});

test("grouped averages, the smallest and largest durations and partial ID matches have distinct answers", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService();
  const source = snapshot([incident(1, 0, "Сеть"), incident(2, 2, "Сеть"), incident(3, 7, "Сеть"),
    incident(4, 1.5, "Приложения"), incident(5, 1.75, "Приложения")]);
  const average = await service.read(source, "me", "Среднее время решения по командам");
  assert.equal(average.groups[0].durationMs, 3 * hour);
  const median = await service.read(source, "me", "Анализ времени по командам");
  assert.equal(median.groups[0].durationMs, 2 * hour);
  const meanFollowUp = await service.read(source, "me", "А в среднем?", median.intent, median.turnToken);
  assert.equal(meanFollowUp.groups[0].durationMs, 3 * hour);
  const small = await service.read(source, "me", "Самый быстрый инцидент за неделю");
  assert.match(small.fact!.headline, /INC-1.*0 с/u);
  const large = await service.read(source, "me", "А самый долгий?", small.intent, small.turnToken);
  assert.equal(large.intent.fact?.period, "week");
  assert.match(large.fact!.headline, /INC-3.*7 ч/u);
  const unknown = await service.read(source, "me", "Сравни INC-2 и INC-404 по времени");
  assert.equal(unknown.mode, "unsupported");
  assert.equal(unknown.selection, "");
  assert.equal(formatFactDuration(7.25 * hour + 30_000), "7 ч 15 мин 30 с");
});

test("an explicitly overall count covers all statuses, while current queue and requested team retain their meaning", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const service = new CanvasService(), source = snapshot();
  for (const question of ["Общее число инцидентов", "Общее количество заявок", "Сколько всего инцидентов?", "Количество инцидентов во всех статусах", "Сколько заявок во всей выгрузке, включая завершённые и закрытые?", "Сколько инцидентов во всей выгрузке?"]) {
    const r = await service.read(source, "me", question);
    assert.equal(r.intent.fact?.operation, "count", question);
    assert.equal(r.total, 9, question);
  }
  const queue = await service.read(source, "me", "Сколько сейчас заявок?");
  assert.equal(queue.total, 2);
  assert.ok(validContext(queue.intent));
  const duration = await service.read(source, "me", "Самый долгий инцидент", queue.intent, queue.turnToken);
  assert.match(duration.fact!.headline, /INC-4/u);
  const total = await service.read(source, "me", "Общее число инцидентов", queue.intent, queue.turnToken);
  assert.equal(total.total, 9);
  const scoped = await service.read(source, "me", "Общее число инцидентов у команды Сеть");
  assert.equal(scoped.total, 5);
});
