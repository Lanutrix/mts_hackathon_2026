import assert from "node:assert/strict";
import test from "node:test";
import { CanvasService } from "../apps/server/canvas.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { generate } from "../packages/domain/generator.ts";
import { normalize, STATES } from "../packages/domain/index.ts";

const tutorial = { title: "Инструкция", text: "Откройте список заявок и выберите фильтр по командам." };
const promise = { title: "Сравнение", text: "Сейчас подготовлю сравнение и покажу результат." };

function fixture(replies: unknown[], namespace = "demo") {
  const template = generate(1).rows[0];
  const rows = ["Альфа", "Альфа", "Бета"].map((team, index) => normalize({
    ...template, id: "INC-" + (index + 1), sysId: "local-" + index,
    stateId: 2, state: STATES[2].label, stateEnum: STATES[2].enum,
    assignedGroupName: team, assignedEmployee: "Скрытый Петров",
    deadline: index === 1 ? "2099-01-01T00:00:00Z" : "2020-01-01T00:00:00Z",
  }, namespace));
  const packets: unknown[] = [];
  const client = new VseLlm("test", "test", async (_, init) => {
    const wire = JSON.parse(String(init?.body));
    packets.push(JSON.parse(wire.messages[1].content));
    const reply = replies[Math.min(packets.length, replies.length) - 1];
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  });
  const source = { namespace, revision: 1, rows: new Map(rows.map(row => [row.id, row])) };
  const service = new CanvasService(client);
  return { ask: (question: string) => service.read(source, "me", question), packets };
}

for (const question of [
  "Можешь разложить просроченные заявки по командам?",
  "Помоги разложить просроченные заявки по командам",
]) {
  test(question, async () => {
    const { ask } = fixture([{ conversation: tutorial }]);
    const result = await ask(question);
    assert.ok(result.selection);
    assert.deepEqual(result.intent.filters, { deadline: "overdue" });
    assert.equal(result.intent.groupBy, "team");
    assert.deepEqual(result.groups.map(group => group.count), [1, 1]);
    assert.equal(result.conversation, undefined);
  });
}

test("a claimed overdue register is replaced by the actual rows", async () => {
  const { ask } = fixture([{ conversation: { title: "Список", text: "Вот список всех заявок с просроченными сроками." } }]);
  const result = await ask("Собери просроченные заявки в список");
  assert.ok(result.selection);
  assert.equal(result.intent.layout, "list");
  assert.deepEqual(result.tickets.map(ticket => ticket.id).sort(), ["INC-1", "INC-3"]);
  assert.equal(result.conversation, undefined);
});

test("the computed comparison is visible immediately when the model attaches a promise to a plan", async () => {
  const { ask } = fixture([{ conversation: promise, groupBy: "team", layout: "comparison" }]);
  const result = await ask("Можешь сравнить команды по числу заявок и показать, кто загружен сильнее?");
  assert.ok(result.selection);
  assert.deepEqual(result.groups.map(group => [group.label, group.count]), [["Альфа", 2], ["Бета", 1]]);
  assert.match(result.summary, /Альфа.*2/);
  assert.equal(result.conversation, undefined);
});

test("a novel request can recover a verified operation after a tutorial", async () => {
  const { ask, packets } = fixture([{ conversation: tutorial }, {
    supported: true, fact: { operation: "frequency", period: "snapshot" }, groupBy: "team",
  }]);
  const result = await ask("Глянь, какой цех у нас тянет воз чаще остальных. Скрытый Петров");
  assert.equal(result.intent.fact?.operation, "frequency");
  assert.ok(result.selection);
  assert.deepEqual(result.groups.map(group => [group.label, group.count]), [["Альфа", 2], ["Бета", 1]]);
  assert.equal(packets.length, 2);
  assert.doesNotMatch(JSON.stringify(packets), /Скрытый|Петров|Альфа|Бета|INC-/iu);
});

test("a novel analytical request uses the model's concrete plan even when the introduction delegates the work", async () => {
  const { ask, packets } = fixture([{ conversation: tutorial, groupBy: "team", layout: "comparison" }]);
  const result = await ask("Глянь, какой цех тут тянет воз чаще остальных");
  assert.ok(result.selection);
  assert.deepEqual(result.groups.map(group => [group.label, group.count]), [["Альфа", 2], ["Бета", 1]]);
  assert.equal(result.conversation, undefined);
  assert.equal(packets.length, 1);
});

test("repeated deferral or a fabricated repair asks for clarification without showing data", async () => {
  for (const retry of [{ conversation: promise }, { groupBy: "team", count: 982 }]) {
    const { ask, packets } = fixture([{ conversation: tutorial }, retry]);
    const result = await ask("Глянь, какой цех у нас тянет воз чаще остальных");
    assert.equal(result.mode, "unsupported");
    assert.equal(result.selection, "");
    assert.match(result.conversation?.text ?? "", /уточните|какой|какие/iu);
    assert.doesNotMatch(JSON.stringify(result), /Сейчас подготовлю|Откройте список|982/u);
    assert.equal(packets.length, 2);
  }
});

test("explicit self-service instructions and creative writing stay conversational", async () => {
  for (const [question, conversation] of [
    ["Как мне самому настроить список заявок по командам?", tutorial],
    ["Напиши четверостишие о списке просроченных заявок по командам", {
      title: "На смене", text: "Сквозь ночь мерцают мониторы,\nНа смене тихнут разговоры.",
    }],
  ] as const) {
    const { ask, packets } = fixture([{ conversation }]);
    const result = await ask(question);
    assert.equal(result.selection, "");
    assert.deepEqual(result.conversation, conversation);
    assert.equal(packets.length, 1);
  }
});

test("self-service help still answers with instructions when the model supplies only a graph", async () => {
  const question = "Как мне самому настроить список заявок по командам?";
  const { ask } = fixture([{ groupBy: "team", layout: "groups" }]);
  const model = await ask(question);
  const offline = await new CanvasService().read({ namespace: "demo", revision: 1, rows: new Map() }, "me", question);
  for (const result of [model, offline]) {
    assert.equal(result.selection, "");
    assert.equal(result.answer?.kind, "knowledge");
    assert.ok(result.answer?.links.length);
  }
});

test("a request for help finding records has the same rows in private and training sources", async () => {
  for (const ns of ["workspace", "demo"]) {
    const { ask } = fixture([{ conversation: tutorial }], ns);
    const result = await ask("Помоги разобраться, какие заявки просрочены");
    assert.ok(result.selection);
    assert.deepEqual(result.tickets.map(ticket => ticket.id).sort(), ["INC-1", "INC-3"]);
  }
});

test("an indirect request stays open for repair even when the promise names neither a view nor an operation", async () => {
  const { ask, packets } = fixture([{ conversation: { title: "Хорошо", text: "Одну минутку, уже занимаюсь вашим запросом!" } }, {
    supported: true, fact: { operation: "frequency", period: "snapshot" }, groupBy: "team",
  }]);
  const result = await ask("Узнай, какая бригада тащит всю вахту");
  assert.equal(result.intent.fact?.operation, "frequency");
  assert.equal(packets.length, 2);
});

test("a recognized filter alone cannot answer an unknown measurement", async () => {
  const { ask } = fixture([{ conversation: promise }]);
  const result = await ask("Как меняется пульс у просроченных заявок?");
  assert.equal(result.selection, "");
  assert.match(result.conversation?.text ?? "", /какой|уточните/iu);
});

test("a private polite request is treated as data and a request to change tickets never claims success", async () => {
  const { ask } = fixture([{ conversation: { title: "Готово", text: "Все заявки закрыты." } }], "workspace");
  const view = await ask("Можешь ли найти просроченные заявки?");
  assert.ok(view.selection);
  assert.equal(view.total, 2);
  assert.equal(view.conversation, undefined);
  const change = await ask("Закрой просроченные заявки");
  assert.equal(change.selection, "");
  assert.doesNotMatch(JSON.stringify(change), /Все заявки закрыты/);
  assert.match(change.conversation?.text ?? "", /измен|закрыва|чтени/iu);
});

test("a completed-sounding introduction cannot cover the calculated comparison", async () => {
  const conversation = { title: "Сравнение загрузки команд",
    text: "Я подготовил сравнение команд по числу заявок, чтобы увидеть, кто из них загружен сильнее." };
  const { ask } = fixture([{ conversation, groupBy: "team", layout: "comparison", showData: true }]);
  const result = await ask("Можешь сравнить команды по числу заявок и показать, кто загружен сильнее?");
  assert.equal(result.conversation, undefined);
  assert.deepEqual(result.groups.map(group => [group.label, group.count]), [["Альфа", 2], ["Бета", 1]]);
});
