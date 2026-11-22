import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";

function fixture() {
  const rows = generate(600, 42).rows.map(raw => normalize(raw, "demo"));
  return { namespace: "demo", revision: 1, rows: new Map(rows.map(row => [row.id, row])) };
}

test("a plain-language explanation uses the displayed counts even after the source changes", async () => {
  const source = fixture(), canvas = new CanvasService();
  const first = await canvas.read(source, "user", "У какой команды больше всего заявок?");
  const updated = { ...source, revision: 2, rows: new Map() };
  for (const question of ["Откуда эти цифры?", "Объясни этот срез простыми словами"]) {
    const reply = await canvas.read(updated, "user", question, first.intent, first.turnToken);
    assert.ok(reply.conversation);
    assert.equal(reply.selection, first.selection);
    assert.equal(reply.revision, first.revision);
    assert.equal(reply.turnToken, first.turnToken);
    assert.ok(reply.conversation.text.includes(first.groups[0].label));
    assert.match(reply.conversation.text, /300 из 600/);
    assert.match(reply.conversation.text, /50\s?%/);
    assert.equal(canvas.page("demo", "user", reply.selection, first.groups[0].key, 0)?.total, 300);
    const format = await canvas.read(updated, "user", "Теперь таблицей", reply.intent, reply.turnToken);
    assert.equal(format.selection, reply.selection);
    assert.equal(format.intent.fact?.display, "table");
  }
  const other = await canvas.read(updated, "other", "Откуда эти цифры?", first.intent, first.turnToken);
  assert.equal(other.total, 0);
  assert.ok(!other.conversation?.text.includes(first.groups[0].label));
});

test("an explanation distinguishes shared fields from a documented reference", async () => {
  const source = fixture(), canvas = new CanvasService();
  const first = await canvas.read(source, "user", "Что общего у DEMO-42-00001 и DEMO-42-00004?");
  const reply = await canvas.read(source, "user", "Что это значит?", first.intent, first.turnToken);
  assert.equal(reply.selection, first.selection);
  assert.match(reply.conversation?.text ?? "", /Демо-сервис 1/);
  assert.match(reply.conversation?.text ?? "", /Ошибки авторизации/);
  assert.equal(reply.fact?.edges?.filter(edge => edge.kind === "reference").length, 0);
});

test("a top-N explanation reports the combined share of the displayed groups", async () => {
  const source = fixture(), canvas = new CanvasService();
  const top = await canvas.read(source, "user", "Покажи топ-2 команд по количеству заявок");
  const reply = await canvas.read(source, "user", "Как ты посчитал?", top.intent, top.turnToken);
  assert.equal(reply.selection, top.selection);
  assert.match(reply.conversation?.text ?? "", /600 из 600/);
  assert.match(reply.conversation?.text ?? "", /100\s?%/);
});

test("tied teams at the requested place keep their own clickable bars", async () => {
  const source = fixture(), canvas = new CanvasService();
  const ranking = await canvas.read(source, "user", "У какой команды больше всего заявок?");
  const place = await canvas.read(source, "user", "А кто на втором месте?", ranking.intent, ranking.turnToken);
  assert.deepEqual(place.groups, ranking.groups.filter(g => g.count === 100));
  for (const group of place.groups)
    assert.equal(canvas.page("demo", "user", place.selection, group.key, 0)?.total, 100);
});
