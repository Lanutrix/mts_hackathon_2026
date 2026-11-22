import test from "node:test";
import assert from "node:assert/strict";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { openDB } from "../apps/server/db.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES } from "../packages/domain/index.ts";
import { VseLlm } from "../apps/server/vsellm.ts";

const base = generate(1).rows[0];
const now = Date.parse("2026-11-22T12:00:00Z");
const minute = 60_000;
const at = (offset: number) => new Date(now + offset * minute).toISOString();
function incident(id: number, state: number, submitted: number | null, due: number | null) {
  return normalize({
    ...base, id: "INC-" + id, sysId: "key-" + id, header: "Тема " + id,
    stateId: state, state: STATES[state].label, stateEnum: STATES[state].enum,
    deadline: due === null ? null : at(due), completionDate: null,
    submitDate: submitted === null ? null : at(submitted),
  }, "demo");
}
const rows = [
  incident(20, 10, -2, -10), incident(3, 7, -2, -10), incident(4, 20, -1, -5),
  incident(1, 0, -8, -1), incident(5, 2, null, 0), incident(6, 2, -9, null),
  { ...incident(99, 0, 0, -5), sourcePresent: false }, incident(8, 7, 5, 8),
];
const source = { namespace: "demo", revision: 2, rows: new Map(rows.map(row => [row.key, row])) };
const proseModel = new VseLlm("test", "test", async () => Response.json({
  choices: [{ message: { content: JSON.stringify({ conversation: { title: "Совет", text: "Выберите фильтр." } }) } }],
}));

test("latest incidents use registration order and include finished tickets, even when the provider offers prose", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const service of [new CanvasService(), new CanvasService(proseModel)]) {
    for (const question of ["дай инфу о последних трех инцедентах", "Расскажи про 3 последних заявки", "Дай сводку по трём последним инцидентам", "Покажи 3 самых новых заявки"]) {
      const result = await service.read(source, "me", question);
      assert.equal(result.intent.fact?.operation, "recent", question);
      assert.equal(result.total, 3);
      assert.deepEqual(result.tickets.map(ticket => [ticket.id, ticket.submittedAt]), [
        ["INC-4", at(-1)], ["INC-3", at(-2)], ["INC-20", at(-2)],
      ]);
      assert.ok(validContext(result.intent));
      assert.equal(service.page("demo", "me", result.selection, undefined, 0)?.total, 3);
      const answer = await service.read(source, "me", "Сколько из них просрочено?", result.intent, result.turnToken);
      assert.deepEqual(answer.tickets.map(t => t.id), ["INC-4"]);
      const foreign = await service.read(source, "another", undefined, answer.intent);
      assert.equal(foreign.mode, "unsupported");
      const foreignFollow = await service.read(source, "another", "Сколько из них просрочено?", answer.intent);
      assert.equal(foreignFollow.mode, "unsupported");
      const fresh = await service.read(source, "me", "Дай три последних инцидента", answer.intent, answer.turnToken);
      assert.equal(fresh.total, 3);
    }
    const single = await service.read(source, "me", "Покажи последнюю заявку");
    assert.deepEqual(single.tickets.map(t => t.id), ["INC-4"]);
  }
});

test("overdue count uses passed deadlines of currently unresolved incidents including research", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const question of ["сколько просроченных инцедентов", "У скольких заявок уже истёк срок?", "Количество просрочек", "Сколько инцидентов просрочено?"]) {
    const result = await new CanvasService(proseModel).read(source, "me", question);
    assert.equal(result.intent.fact?.operation, "count", question);
    assert.equal(result.intent.filters.deadline, "overdue");
    assert.equal(result.total, 2);
    assert.deepEqual(result.tickets.map(t => t.id).sort(), ["INC-1", "INC-4"]);
    assert.match(result.fact!.headline, /просроч[^.]*2/iu);
    assert.ok(validContext(result.intent));
  }
  const elapsed = await new CanvasService().read(source, "me", "На сколько времени в среднем просрочены инциденты?");
  assert.notEqual(elapsed.intent.fact?.operation, "count");
  const service = new CanvasService();
  const closed = await service.read(source, "me", "Сколько закрытых заявок?");
  const late = await service.read(source, "me", "Сколько из них просрочено?", closed.intent, closed.turnToken);
  assert.equal(late.total, 0);
  assert.ok(validContext(late.intent));
});

test("status timing uses successive observed changes, skipping plain edits and interrupted histories", async t => {
  const db = await openDB(":memory:");
  try {
    const store = await new Store(db, "demo").load();
    const states = (n: number, state: number) => incident(n, state, -200, -1).raw;
    const put = async (...rows: ReturnType<typeof states>[]) => store.ingest(JSON.stringify(rows));
    await put(states(1, 0), states(2, 0), states(3, 0));
    await put(states(1, 2), states(2, 2), states(3, 2));
    await put({ ...states(1, 2), header: "Уточнение" }, states(2, 2));
    await put(states(1, 20), states(2, 2), states(3, 7));
    await put(states(1, 2), states(2, 7), states(3, 10));
    for (const [i, offset] of [-30, -20, -18, -15, -7].entries())
      await db.query("UPDATE events SET at=$1 WHERE namespace=$2 AND revision=$3", [at(offset), "demo", i+1]);
    t.mock.timers.enable({ apis: ["Date"], now });
    const service = new CanvasService(proseModel);
    for (const question of ["время смены статуса среднее", "Сколько времени в среднем проходит между изменениями статуса?", "Как часто в среднем меняется статус заявки?", "Среднее время между статусами"]) {
      const result = await service.read(store, "me", question);
      assert.equal(result.intent.fact?.operation, "statusInterval", question);
      assert.deepEqual(result.fact?.statusIntervals, {
        meanMs: 26*minute/3, intervalCount: 3, ticketCount: 2, scopeCount: 3,
      });
      assert.deepEqual(result.tickets.map(t => [t.id, t.statusIntervals]), [
        ["INC-1", { intervalCount: 2, meanMs: 6.5*minute }], ["INC-2", { intervalCount: 1, meanMs: 13*minute }],
      ]);
      assert.ok(validContext(result.intent));
      assert.match(result.fact!.method, /наблюд/iu);
      assert.match(result.fact!.notes.join(" "), /1/u);
    }
    const med = await service.read(store, "me", "медиана интервалов смены статуса");
    assert.equal(med.fact?.statusIntervals?.medianMs, 8 * minute);
    assert.ok(validContext(med.intent));
    const mean = await service.read(store, "me", "а среднее?", med.intent, med.turnToken);
    assert.equal(mean.fact?.statusIntervals?.medianMs, undefined);
    assert.match(mean.fact!.headline, /Среднее время между сменами статуса/);
    const empty = await service.read(source, "me", "Среднее время между сменами статуса");
    assert.equal(empty.fact?.statusIntervals?.meanMs, null);
    assert.equal(empty.total, 0);
    assert.match(empty.fact!.headline, /недостаточно|нет/iu);
  } finally { await db.close(); }
});

test("a provider can request a grounded recent list for an indirect question", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const model = new VseLlm("test", "test", async () => Response.json({
    choices: [{ message: { content: JSON.stringify({
      supported: true, fact: { operation: "recent", period: "snapshot", limit: 1 }, groupBy: "ticket", filters: {},
    }) } }],
  }));
  const result = await new CanvasService(model).read(source, "me", "Что зарегистрировали ближе всего к настоящему моменту?");
  assert.equal(result.intent.fact?.operation, "recent");
  assert.deepEqual(result.tickets.map(t => t.id), ["INC-4"]);
  assert.ok(validContext(result.intent));
});
