import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";

function fixture() {
  const rows = generate(60, 42).rows.map(row => normalize(row, "demo"));
  return { namespace: "demo", revision: 1, rows: new Map(rows.map(r => [r.id, r])) };
}

test("typing an acceptance executes the offered follow-up for that turn and no other conversation", async () => {
  const source = fixture(), service = new CanvasService();
  const first = await service.read(source, "one", "С чего начать смену?");
  assert.equal(first.conversation?.followUp, "Почему именно эта заявка?");
  const clicked = await service.read(source, "one", first.conversation!.followUp, first.intent, first.turnToken);
  for (const text of ["Да, сделай", "давай", "Сделай это, пожалуйста"]) {
    const typed = await service.read(source, "one", text, first.intent, first.turnToken);
    assert.equal(typed.conversation?.text, clicked.conversation?.text);
    assert.equal(typed.selection, clicked.selection);
    assert.equal(typed.tickets[0].id, first.tickets[0].id);
    const bare = await service.read(source, "one", "да", typed.intent, typed.turnToken);
    assert.equal(bare.selection, "");
    assert.match(bare.summary, /уточните|какой результат/iu);
  }
  const foreign = await service.read(source, "other", "Да, сделай", first.intent, first.turnToken);
  assert.equal(foreign.selection, "");
  assert.ok(!foreign.summary.includes(first.tickets[0].id));
});

test("a requested ticket comment returns ready-to-use text grounded in its own fields", async () => {
  const source = fixture(), service = new CanvasService(), id = "DEMO-42-00046";
  const draft = await service.read(source, "one", "Напиши комментарий для " + id + " о просроченном сроке");
  assert.match(draft.conversation?.title ?? "", /черновик/iu);
  assert.ok(draft.conversation!.text.includes(id));
  assert.match(draft.conversation!.text, /срок решения прошёл/iu);
  assert.deepEqual(draft.tickets.map(t => t.id), [id]);
  assert.equal(service.page("demo", "one", draft.selection, undefined, 0)?.total, 1);
  const refreshed = await service.read(source, "one", undefined, draft.intent);
  assert.equal(refreshed.conversation?.text, draft.conversation?.text);
  const neutral = await service.read(source, "one", "Напиши комментарий о сроке");
  assert.equal(neutral.tickets.length, 0);
  assert.match(neutral.conversation?.text ?? "", /номер/iu);
  const filled = await service.read(source, "one", id, neutral.intent, neutral.turnToken);
  assert.equal(filled.conversation?.text, draft.conversation?.text);
  const wrong = await service.read(source, "one", "Напиши комментарий для DEMO-42-99999", draft.intent, draft.turnToken);
  assert.equal(wrong.tickets.length, 0);
  assert.ok(!wrong.summary.includes(id));
});
