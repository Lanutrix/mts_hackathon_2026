import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES, type Raw } from "../packages/domain/index.ts";

const base = generate(1).rows[0];
const now = Date.parse("2026-11-22T09:00:00Z");
function row(id: string, priorityId: number, deadline: string | null, stateId = 2, fields: Raw = {}) {
  return normalize({
    ...base, id, sysId: id, priorityId, deadline, stateId,
    state: STATES[stateId].label, stateEnum: STATES[stateId].enum,
    submitDate: "2026-11-22T07:00:00Z", completionDate: null, isNeedUp: false,
    assignedGroupName: "Дежурные", header: "Масштабная катастрофа",
    description: "Служебные данные", assignedEmployeeLogin: "private-login", ...fields,
  }, "workspace");
}
function setup() {
  const rows = [
    row("INC-2", 3, "2026-11-22T08:00:00Z"),
    row("INC-3", 3, "2026-11-22T09:08:00Z"),
    row("INC-4", 2, "2026-11-22T07:55:00Z"),
    row("INC-5", 4, null, 10),
    row("INC-6", 4, null, 20, { assignedGroupName: "Другая" }),
    row("INC-7", 4, null, 2, { submitDate: "2026-11-18T09:00:00Z" }),
  ];
  const source = { namespace: "workspace", revision: 1, rows: new Map(rows.map(r => [r.id, r])) };
  let calls = 0;
  const service = new CanvasService(new VseLlm("test", "test", async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: '{"supported":false}' } }] });
  }));
  return { source, service, calls: () => calls };
}

test("shift advice uses the current cohort, grounds the next check and opens a single real card", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  const scope = await service.read(source, "me", "Сколько заявок сегодня у команды Дежурные?");
  assert.equal(scope.intent.fact?.period, "today");
  const original = structuredClone(source);
  for (const q of ["С чего начать смену?", "На какую заявку посмотреть в первую очередь?", "С какой заявки начать?"]) {
    const result = await service.read(source, "me", q, scope.intent, scope.turnToken);
    assert.equal(result.intent.presentation, "spotlight", q);
    assert.ok(validContext(result.intent));
    assert.equal(result.total, 3);
    assert.deepEqual(result.tickets.map(t => t.id), ["INC-2"]);
    assert.equal(service.page("workspace", "me", result.selection, undefined, 0)?.items[0]?.id, "INC-2");
    const answer = result.conversation?.text ?? "";
    assert.match(answer, /INC-2/);
    assert.match(answer, /высокий/iu);
    assert.match(answer, /срок.*прош[её]л/iu);
    assert.match(answer, /запросите.*срок/iu);
    assert.doesNotMatch(answer, /катастроф|private-login|Служебные данные/u);
    assert.deepEqual(source, original);
  }
  assert.equal(calls(), 0);
});

test("why refers to the recommended card, refresh recalculates and a foreign turn cannot supply the evidence", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { source, service, calls } = setup();
  const scope = { groupBy: "ticket" as const, layout: "list" as const, filters: { ids: ["INC-2", "INC-3"] } };
  const initial = await service.read(source, "me", "С чего начать смену?", scope);
  source.rows.set("INC-3", row("INC-3", 4, "2026-11-22T09:08:00Z"));
  source.revision++;
  const question = "Почему именно эта заявка?";
  const why = await service.read(source, "me", question, initial.intent, initial.turnToken);
  assert.deepEqual(why.tickets.map(t => t.id), ["INC-2"]);
  assert.match(why.summary, /раньше|ранний|раннего/iu);
  assert.match(why.summary, /приоритет/iu);
  assert.doesNotMatch(why.summary, /катастроф/u);
  const fresh = await service.read(source, "me", undefined, initial.intent);
  assert.deepEqual(fresh.tickets.map(t => t.id), ["INC-3"]);
  assert.match(fresh.conversation?.text ?? "", /15 минут/);
  const other = await service.read(source, "another", question, initial.intent, initial.turnToken);
  assert.equal(other.tickets.length, 0);
  assert.doesNotMatch(other.summary, /INC-2|INC-3/u);
  source.rows.delete("INC-2");
  const gone = await service.read(source, "me", question, initial.intent, initial.turnToken);
  assert.equal(gone.tickets.length, 0);
  assert.match(gone.summary, /недоступна|отсутствует|нет в|больше не/iu);
  assert.equal(calls(), 0);
});

test("empty or closed queues have no recommendation and unrelated questions keep their own routing", async () => {
  const { source, service } = setup();
  for (const filters of [{ states: [7, 10] }, { teams: ["Архив"] }]) {
    const result = await service.read(source, "me", "С какой заявки начать?", { groupBy: "team", layout: "groups", filters });
    assert.match(result.conversation?.text ?? "", /нет открытых|открытых заявок нет/iu);
    assert.equal(result.selection, "");
    assert.deepEqual(result.tickets, []);
  }
  const unsupported = await service.read(source, "me", "С чего начать смену пароля?");
  assert.notEqual(unsupported.intent.presentation, "spotlight");
  const unanchored = await service.read(source, "me", "Почему она?");
  assert.notEqual(unanchored.conversation?.followUp, "С какой заявки начать?");
  const analytical = await service.read(source, "me", "Какая команда самая загруженная?");
  assert.equal(analytical.intent.fact?.operation, "frequency");
});

test("a coordinator can start with the tickets at a selected rank and refresh that same subgroup", async () => {
  const { source, service } = setup();
  const ranking = await service.read(source, "me", "Какая команда самая загруженная?");
  const second = await service.read(source, "me", "Кто на втором месте?", ranking.intent, ranking.turnToken);
  assert.deepEqual(second.tickets.map(r => r.id), ["INC-6"]);
  const advice = await service.read(source, "me", "С какой из этих заявок начать?", second.intent, second.turnToken);
  assert.deepEqual(advice.tickets.map(r => r.id), ["INC-6"]);
  assert.ok(validContext(advice.intent));
  assert.equal(advice.total, 1);
  assert.match(advice.summary, /запросите срок/iu);
  const fresh = await service.read(source, "me", undefined, advice.intent);
  assert.deepEqual(fresh.tickets.map(r => r.id), ["INC-6"]);
  assert.equal(fresh.total, 1);
});

test("equal urgency uses a stable identifier and an empty source has no card", async () => {
  const { source, service } = setup();
  source.rows.clear();
  let advice = await service.read(source, "me", "С чего начать смену?");
  assert.equal(advice.selection, "");
  assert.match(advice.summary, /источник.*нет заявок/iu);
  for (const id of ["INC-10", "INC-2"]) source.rows.set(id, row(id, 2, null));
  advice = await service.read(source, "me", "С чего начать смену?");
  assert.deepEqual(advice.tickets.map(r => r.id), ["INC-2"]);
  const why = await service.read(source, "me", "Почему именно эта заявка?", advice.intent, advice.turnToken);
  assert.match(why.summary, /совпада|одинаков|равны/iu);
  assert.match(why.summary, /номер/iu);
  assert.doesNotMatch(why.summary, /катастроф/iu);
  const different = await service.read({ ...source, namespace: "demo" }, "me", "Почему именно эта заявка?", advice.intent, advice.turnToken);
  assert.deepEqual(different.tickets, []);
  assert.doesNotMatch(different.summary, /INC-2/u);
});
