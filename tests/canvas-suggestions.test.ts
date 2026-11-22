import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize } from "../packages/domain/index.ts";
import type { CanvasResult } from "../packages/contracts/canvas.ts";

function fixture() {
  const rows = generate(35, 42).rows.map(raw => normalize(raw, "demo"));
  return { namespace: "demo", revision: 1, rows: new Map(rows.map(row => [row.id, row])) };
}

async function follow(source: ReturnType<typeof fixture>, service: CanvasService, result: CanvasResult) {
  assert.equal(new Set(result.suggestions).size, 3);
  return Promise.all(result.suggestions.map(async q => {
    const next = await service.read(source, "me", q, result.intent, result.turnToken);
    assert.notEqual(next.mode, "unsupported", q);
    assert.ok(validContext(next.intent), q);
    return next;
  }));
}

test("canvas prompts offer distinct next actions beyond every displayed panel and preserve the selected cohort", async () => {
  const source = fixture(), service = new CanvasService();
  const start = await service.read(source, "me");
  const answers = await follow(source, service, start);
  assert.ok(answers.some(r => r.intent.shiftAdvice && r.tickets.length === 1));
  assert.ok(answers.some(r => r.intent.brief && r.total === start.total));
  for (const result of answers) {
    if (!result.conversation && !result.answer) {
      assert.ok(![start.intent, ...start.blocks].some(view => view.groupBy === result.intent.groupBy));
    }
  }
  const team = start.tickets[0].team;
  const scoped = await service.read(source, "me", undefined, {
    groupBy: "product", layout: "groups", filters: { teams: [team] }, blocks: [{ groupBy: "team", layout: "comparison" }],
  });
  for (const answer of await follow(source, service, scoped)) {
    if (answer.answer?.kind === "knowledge") continue;
    assert.deepEqual(answer.intent.filters.teams, [team]);
    assert.ok(answer.conversation || !["product", "team"].includes(answer.intent.groupBy));
  }
  const advice = answers.find(r => r.intent.shiftAdvice)!;
  const continuations = await follow(source, service, advice);
  assert.ok(continuations.some(r => r.intent.commentDraft && r.tickets[0]?.id === advice.tickets[0].id));
  assert.ok(continuations.some(r => r.title.includes("Почему") && r.tickets[0].id === advice.tickets[0].id));
});

test("an empty canvas offers three different answerable help topics and skips the one just explained", async () => {
  const source = fixture(), service = new CanvasService();
  source.rows.clear();
  const initial = await service.read(source, "me");
  const answers = await follow(source, service, initial);
  assert.ok(answers.every(r => r.answer?.kind === "knowledge"));
  assert.equal(new Set(answers.map(r => r.answer?.topic)).size, 3);
  for (const result of await follow(source, service, answers[0])) {
    assert.notEqual(result.answer?.topic, answers[0].answer?.topic);
  }
});

test("model prompt choices are restricted to distinct supported actions and bad extras preserve the answer", async () => {
  const source = fixture();
  const payload = { conversation: { title: "Дежурство", text: "Дежурный слышит звёздный хор.",
    followUp: "Закрой все заявки", suggestions: [
      "Что означает приоритет заявки?", "Что означает приоритет заявки?",
      "Закрой все заявки", "Дежурный слышит звёздный хор.", 7,
    ] } };
  const service = new CanvasService(new VseLlm("test", "test", async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] })));
  const result = await service.read(source, "me", "Сочини двустишие про дежурного");
  assert.equal(result.conversation?.text, payload.conversation.text);
  assert.equal(result.suggestions[0], "Что означает приоритет заявки?");
  assert.equal(new Set(result.suggestions).size, 3);
  assert.equal(result.conversation?.followUp, undefined);
  assert.ok(result.suggestions.every(q => !/закрой|звёздный хор/iu.test(q)));
});

test("recent incidents offer an overdue check on those exact cards and overdue totals offer a priority breakdown", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-24T09:00:00Z") });
  const source = fixture(), service = new CanvasService();
  const recent = await service.read(source, "me", "Покажи последние три инцидента");
  const ids = new Set(recent.tickets.map(ticket => ticket.id));
  const next = await follow(source, service, recent);
  const overdue = next.find(r => r.intent.fact?.operation === "count" && r.intent.filters.deadline === "overdue");
  assert.ok(overdue, "an overdue check for this recent list should be offered");
  assert.ok(overdue.total > 0);
  assert.equal(overdue.intent.fact?.sourceSelection, recent.selection);
  for (const result of next) {
    assert.ok(result.tickets.every(ticket => ids.has(ticket.id)));
    assert.ok(!result.answer && result.tickets.length);
  }
  const lateIds = new Set(overdue.tickets.map(ticket => ticket.id));
  const afterCount = await follow(source, service, overdue);
  const priority = afterCount.find(r => r.intent.groupBy === "priority" && r.intent.fact?.operation === "frequency");
  assert.ok(priority);
  assert.deepEqual(new Set(priority.tickets.map(ticket => ticket.id)), lateIds);
  assert.ok(afterCount.some(r => r.intent.brief && r.total === overdue.total));
});

test("missing transition history offers fresh registrations and current overdue tickets from the source", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-24T09:00:00Z") });
  const source = fixture(), service = new CanvasService();
  const interval = await service.read(source, "me", "Среднее время между сменами статуса");
  assert.equal(interval.fact?.statusIntervals?.meanMs, null);
  const next = await follow(source, service, interval);
  assert.ok(next.some(r => r.intent.fact?.operation === "recent" && r.total === 3));
  assert.ok(next.some(r => r.intent.filters.deadline === "overdue" && r.total > 0));
  assert.ok(next.every(r => r.tickets.length > 0 && !r.answer));
});
