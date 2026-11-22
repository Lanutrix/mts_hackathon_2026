import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";

function fixture() {
  const rows = generate(42).rows.slice(0, 50).map(raw => normalize(raw, "demo"));
  return { namespace: "demo", revision: 1, rows: new Map(rows.map(row => [row.id, row])) };
}

test("changing the medium retains the exact fact snapshot and its drill-down after the source changes", async () => {
  const source = fixture(), ui = new CanvasService();
  const first = await ui.read(source, "viewer", "Какой статус встречается чаще всего?");
  assert.ok(first.total > 0 && first.turnToken);
  const changed = { ...source, revision: 2, rows: new Map() };
  for (const [question, display] of [
    ["А теперь покажи это кольцевой диаграммой", "ring"],
    ["А теперь в виде списка", "list"],
    ["Те же данные в сравнительной таблице", "table"],
    ["Теперь таблицей", "table"],
    ["Покажи результат карточками", "cards"],
    ["Нарисуй это схемой", "diagram"],
  ]) {
    const view = await ui.read(changed, "viewer", question, first.intent, first.turnToken);
    assert.equal(view.intent.fact?.display, display);
    assert.ok(validContext(view.intent));
    assert.equal(view.revision, first.revision);
    assert.equal(view.selection, first.selection);
    assert.equal(view.total, first.total);
    assert.deepEqual(view.groups, first.groups);
    assert.equal(ui.page(source.namespace, "viewer", view.selection, view.groups[0].key, 0)?.total, view.groups[0].count);
  }
  const differentUser = await ui.read(changed, "other", "Теперь таблицей", first.intent, first.turnToken);
  assert.equal(differentUser.total, 0);
  assert.notEqual(differentUser.selection, first.selection);
  const differentQuestion = await ui.read(changed, "viewer", "Сколько сейчас команд?", first.intent, first.turnToken);
  assert.equal(differentQuestion.total, 0);
  assert.equal(differentQuestion.intent.fact?.operation, "distinct");
});

test("an explicit list of team shares uses the same teams and open queue as a self-contained ring", async () => {
  const source = fixture(), service = new CanvasService();
  const row = [...source.rows.values()].find(r => [0, 2, 20].includes(r.stateId!))!;
  source.rows.set(row.id, { ...row, team: "", raw: { ...row.raw, assignedGroupName: null } });
  const orbit = await service.read(source, "me", "Покажи доли команд круговой диаграммой");
  const list = await service.read(source, "me", "Покажи доли команд списком");
  assert.equal(list.intent.presentation, "register");
  assert.equal(list.intent.layout, "comparison");
  assert.equal(list.total, orbit.total);
  assert.deepEqual(list.groups, orbit.groups);
  assert.ok(list.groups.some(g => g.label === "Команда не указана"));
  const redraw = await service.read({ ...source, revision: 2, rows: new Map() }, "me",
    "А теперь в виде списка", orbit.intent, orbit.turnToken);
  assert.equal(redraw.selection, orbit.selection);
  assert.deepEqual(redraw.groups, orbit.groups);
});

test("specifying a chart in the first request preserves the count of distinct teams", async () => {
  const source = fixture(), service = new CanvasService();
  const base = await service.read(source, "me", "Сколько разных команд?");
  for (const [format, display] of [["таблицей", "table"], ["кольцевой диаграммой", "ring"]]) {
    const view = await service.read(source, "me", "Сколько разных команд? Покажи " + format);
    assert.equal(view.intent.fact?.operation, "distinct");
    assert.equal(view.intent.fact?.display, display);
    assert.equal(view.total, base.total);
    assert.deepEqual(view.groups, base.groups);
  }
});
