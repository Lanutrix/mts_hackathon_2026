import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { validContext } from "../apps/server/canvasPlan.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES } from "../packages/domain/index.ts";

const now = Date.parse("2026-11-22T09:00:00Z");
function fixture(namespace = "demo") {
  const raw = generate(1).rows[0];
  const row = (id: string, stateId: number, team: string, day: number, deadline: string | null, isNeedUp: boolean) =>
    normalize({ ...raw, id, sysId: id, stateId, state: STATES[stateId].label, stateEnum: STATES[stateId].enum,
      assignedGroupName: team, submitDate: "2026-11-" + day + "T06:00:00Z", deadline, isNeedUp,
      header: "Текст из приватной карточки", assignedEmployeeLogin: "secret-login" }, namespace);
  const rows = [
    row("INC-101", 0, "Первая линия", 21, "2026-11-22T08:30:00Z", true),
    row("INC-102", 2, "Первая линия", 22, "2026-11-22T09:07:00Z", true),
    row("INC-103", 20, "Первая линия", 22, null, false),
    row("INC-104", 10, "Первая линия", 22, "2026-11-22T08:00:00Z", true),
    row("INC-105", 2, "Вторая линия", 22, "2026-11-22T08:00:00Z", false),
  ];
  const packets: string[] = [];
  const canvas = new CanvasService(new VseLlm("test", "test", async (_, init) => {
    packets.push(String(init?.body));
    const conversation = { title: "Сводка", text: "Рекомендуется обратить внимание на проблемы." };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ supported: true, conversation, showData: true }) } }] });
  }));
  return { canvas, packets, source: { namespace, revision: 1, rows: new Map(rows.map(r => [r.id, r])) } };
}

test("handover requests produce a sendable text with the open queue's actual counts and ticket drilldown", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { canvas, source, packets } = fixture();
  for (const question of [
    "Составь короткую сводку по открытым заявкам для передачи смены",
    "Подготовь отчёт по заявкам",
    "Могли бы вы подготовить краткий отчёт по очереди?",
    "Что передать дежурному?",
    "Напиши сообщение следующей смене",
  ]) {
    const result = await canvas.read(source, "me", question);
    const text = result.conversation?.text ?? "";
    assert.match(text, /открыт[^.]*4/iu, question);
    assert.match(text, /срок[^.]*прош[её]л[^.]*2/iu);
    assert.match(text, /последств[^.]*2/iu);
    assert.match(text, /INC-102[^.]*12:07|12:07[^.]*INC-102/u);
    assert.doesNotMatch(text, /рекомендуется|secret-login|приватной|INC-104/iu);
    assert.equal(result.total, 4);
    assert.equal(canvas.page(source.namespace, "me", result.selection, undefined, 0)?.total, 4);
    assert.ok(validContext(result.intent));
  }
  assert.equal(packets.length, 0);
});

test("briefing retains the date window and team, recalculates on refresh and keeps the local answer out of model history", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { canvas, source, packets } = fixture("workspace");
  const previous = await canvas.read(source, "me", "Сколько открытых заявок сегодня у команды Первая линия?");
  for (const result of [
    await canvas.read(source, "me", "Сводку по ним для передачи смены", previous.intent, previous.turnToken),
    await canvas.read(source, "me", "Подготовь сводку по открытым заявкам для команды Первая линия за сегодня"),
  ]) {
    assert.equal(result.total, 2);
    assert.equal(result.metrics.find(m => m.key === "overdue")?.value, 0);
    const text = result.conversation?.text ?? "";
    assert.match(text, /открыт[^.]*2/iu);
    assert.match(text, /Первая линия/u);
    assert.match(text, /регистрац.*22\.11\.2026/iu);
    assert.ok(validContext(result.intent));
    const refresh = await canvas.read({ ...source, rows: new Map(), revision: 2 }, "me", undefined, result.intent);
    assert.equal(refresh.total, 0);
    assert.match(refresh.conversation?.text ?? "", /нет заявок|заявок нет|заявки отсутствуют/iu);
    assert.doesNotMatch(refresh.conversation?.text ?? "", /INC-102|12:07/u);
    await canvas.read(source, "me", "Напиши хокку", result.intent, result.turnToken);
  }
  assert.doesNotMatch(packets.join("\n"), /INC-102|Первая линия|secret-login|приватной/iu);
});

test("instructions and unavailable report scopes do not return broad operational figures", async () => {
  const { canvas, source } = fixture();
  const guide = await canvas.read(source, "me", "Как составить сводку для передачи смены?");
  assert.equal(guide.selection, "");
  assert.match(guide.conversation?.text ?? guide.answer?.lead ?? "", /укажите|запишите|перечислите|отметьте/iu);
  for (const q of ["Сводка по заявкам для команды Неизвестная", "Сводка по заявкам команды Неизвестная",
    "Составь отчёт по заявкам за прошлый квартал"]) {
    const reply = await canvas.read(source, "me", q);
    assert.equal(reply.mode, "unsupported");
    assert.equal(reply.total, 0);
    assert.equal(reply.selection, "");
  }
});

test("a request to include overdue and follow-up counts keeps all open tickets in the report", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { canvas, source } = fixture();
  const report = await canvas.read(source, "me", "Сделай сводку по открытым заявкам: сколько просрочено и сколько с последствиями?");
  assert.equal(report.total, 4);
  assert.match(report.conversation?.text ?? "", /срок[^.]*прош[её]л[^.]*2/iu);
  const scoped = await canvas.read(source, "me", "Сделай сводку только по просроченным заявкам с последствиями");
  assert.equal(scoped.total, 1);
});

test("refresh keeps the selected rank when the handover adds a date filter", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { canvas, source } = fixture();
  const ranking = await canvas.read(source, "me", "У какой команды больше всего заявок?");
  const second = await canvas.read(source, "me", "Кто на втором месте?", ranking.intent, ranking.turnToken);
  const brief = await canvas.read(source, "me", "Сводка по ним за сегодня", second.intent, second.turnToken);
  const refresh = await canvas.read(source, "me", undefined, brief.intent);
  for (const result of [brief, refresh]) {
    assert.ok(validContext(result.intent));
    assert.equal(result.total, 1);
    assert.deepEqual(canvas.page(source.namespace, "me", result.selection, undefined, 0)?.items.map(r => r.id), ["INC-105"]);
  }
});
