import assert from "node:assert/strict";
import test from "node:test";
import { normalize, type Incident } from "../packages/domain/index.ts";
import { buildTriage, knownSymptom } from "../packages/domain/triage.ts";
import { briefAnswer } from "../apps/server/canvasBrief.ts";
import { analyzeCase } from "../apps/server/caseAnalysis.ts";
import { localReading } from "../apps/server/canvasPlan.ts";
import { CanvasService } from "../apps/server/canvas.ts";
import { VseLlm } from "../apps/server/vsellm.ts";
import { AnalysisService } from "../apps/server/analysis.ts";

const now = Date.parse("2026-11-22T09:00:00Z");
function incident(n: number, header: string, description = "", productName = "Кабинет") {
  return normalize({ id: "INC-" + n, sysId: String(n), header, description, productName,
    stateId: 2, state: "Выполняется", stateEnum: "WorkInProgress", priorityId: 3, priority: "Высокий" }, "workspace");
}
const queue = [
  incident(1, "После подтверждения кода снова вижу экран входа"),
  incident(2, "Форма снова запрашивает пароль"),
  incident(3, "Обращение из приложения", "Не удаётся войти в кабинет.", "Приложение"),
  incident(4, "Не приходит код подтверждения"),
  incident(5, "SMS с кодом не доставлено"),
  incident(6, "После входа платёж отклонён"),
  incident(7, "Ошибок авторизации нет"),
];

test("paraphrases cite their own source fields, distinguish failure stages and avoid negative and hypothetical observations", () => {
  assert.deepEqual(queue.map(row => knownSymptom(row)?.label), [
    "Ошибки авторизации", "Ошибки авторизации", "Ошибки авторизации",
    "Не доставлено уведомление", "Не доставлено уведомление", "Ошибки оплаты", undefined,
  ]);
  for (const text of ["Проверить, есть ли ошибки при оплате", "Тайм-аутов не зафиксировано",
    "Ошибка при оплате устранена", "Авторизация работает", "Ранее наблюдались ошибки авторизации",
    "Инструкция при ошибке входа", "Ошибки авторизации?", "Нет ошибок при оплате"]) {
    assert.equal(knownSymptom(incident(10, text)), undefined, text);
  }
  const mixed = incident(8, "Ошибок авторизации нет, но платёж отклонён");
  assert.equal(knownSymptom(mixed)?.label, "Ошибки оплаты");
  const long = incident(9, "Коллеги пишут про ошибку в отчёте. " + "Контекст ".repeat(65) + "ошибка    при оплате.");
  assert.match(knownSymptom(long)?.value ?? "", /ошибка    при оплате/);
});

test("cross-product scope, count and witnesses follow the selected case and are stable across input order", async () => {
  const groups = (rows: Incident[]) => buildTriage(rows, "symptomProduct", 5, now).cases;
  const cases = groups(queue);
  const byProduct = cases.find(group => group.label.includes("Ошибки авторизации") && group.label.includes("Кабинет"));
  assert.equal(byProduct?.count, 2);
  assert.deepEqual(groups([...queue].reverse()), cases);
  const all = buildTriage(queue, "priority", 5, now);
  const detail = all.cases[0];
  assert.deepEqual(detail.themes.map(theme => [theme.label, theme.count]), [
    ["Ошибки авторизации", 3], ["Не доставлено уведомление", 2],
  ]);
  for (const theme of detail.themes) {
    assert.equal(new Set(theme.examples.map(e => e.id)).size, 2);
    for (const e of theme.examples) {
      const row = queue.find(row => row.id === e.id)!;
      assert.equal(knownSymptom(row)?.label, theme.label);
      assert.ok(String(row.raw[e.field]).includes(e.value));
    }
    assert.match(theme.check, /сверьте|сопоставьте/iu);
  }
  const fallback = await analyzeCase(detail, all.members.get(detail.id)!, undefined, "workspace", "Уточни симптомы");
  assert.equal(fallback.mode, "fallback");
  assert.match(fallback.summary.join(" "), /Ошибки авторизации.*3 из 7/);
  assert.match(fallback.summary.join(" "), /Сверьте|Сопоставьте/);
  const spread = [incident(10, "Ошибка входа", "", "Кошелёк"), incident(11, "Форма снова запрашивает пароль", "", "Кабинет"),
    incident(12, "Не удаётся войти", "", "Портал")];
  const recurring = buildTriage(spread, "symptom", 1, now).cases[0];
  const local = await analyzeCase(recurring, spread);
  assert.match(local.summary.join(" "), /Разных продуктов — 3/);
});

test("handover includes only recurring observed symptoms and links witnesses outside the first six preview rows", () => {
  const padding = Array.from({ length: 6 }, (_, n) => incident(20 + n, "Прочее " + n));
  const handover = briefAnswer([...padding, ...queue], now, "", undefined, 0, 0);
  assert.match(handover.text, /Ошибки авторизации.*3 из 13/);
  assert.match(handover.text, /Не доставлено уведомление.*2 из 13/);
  assert.ok(handover.sourceIds?.includes("INC-1"));
  assert.ok(handover.sourceIds?.includes("INC-4"));
  assert.doesNotMatch(handover.text, /INC-7|Прочее|первопричин[аы] (?:в |установлена)/);
  const scoped = briefAnswer(queue.slice(3, 5), now, "", undefined, 0, 0);
  assert.doesNotMatch(scoped.text, /авторизац|INC-1/);
  assert.deepEqual(localReading("покажи заявки где не приходит код", {}).filters.symptoms, ["Не доставлено уведомление"]);
});

test("a first-turn model grouping resolves paraphrases with no shared words, pins source members, and rejects incompatible citations", async () => {
  const rows = [incident(1, "Скачанный отчёт пустой PRIVATE_NAME"), incident(2, "В выгрузке нет строк PRIVATE_ACCOUNT"),
    incident(3, "Выгрузка зависает"), incident(4, "Ошибка входа"), incident(5, "В выгрузке больше нет ошибки"),
    incident(6, "Скачанный отчёт не пустой"), incident(7, "Выгрузка не зависает")];
  const source = { namespace: "workspace", revision: 4, rows: new Map(rows.map(row => [row.key, row])) };
  const question = "Сгруппируй заявки по похожим симптомам";
  for (const refs of [["T1.header", "T2.header"], ["T1.header", "T3.header"], ["T1.header", "T99.header"]]) {
    const packets: string[] = [];
    const client = new VseLlm("test", "test", async (_, options) => {
      const wire = JSON.parse(String(options?.body));
      packets.push(wire.messages[1].content);
      const input = JSON.parse(wire.messages[1].content);
      const reply = input.observations ? { groups: [{ area: "export", effect: "empty", refs }] }
        : input.facts ? { answer: "У заявок высокий приоритет.", nextCheck: "Сверьте сведения.", refs: ["T1.priorityId"] }
        : { supported: true, groupBy: "symptom", layout: "groups" };
      return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
    });
    const canvas = new CanvasService(client);
    const result = await canvas.read(source, "me", question);
    const group = result.groups.find(group => group.label === "Экспорт данных · Пустой результат");
    assert.equal(result.groups.reduce((n, g) => n + g.count, 0), rows.length);
    assert.equal(!!group, refs[1] === "T2.header");
    if (group) {
      assert.equal(group.count, 2);
      assert.deepEqual(canvas.page("workspace", "me", result.selection, group.key, 0)?.items.map(t => t.id), ["INC-1", "INC-2"]);
      assert.match(result.summary, /Сверьте|Сопоставьте/);
    }
    const current = buildTriage(rows, "priority", 4, now);
    const service = new AnalysisService({ query: async () => ({ rows: [] }), transaction: async () => { throw Error(); }, close: async () => {} }, undefined, 500, undefined, client);
    const detail = await analyzeCase(current.cases[0], rows, service, "workspace");
    assert.equal(detail.semantic?.themes.length ?? 0, refs[1] === "T2.header" ? 1 : 0);
    assert.ok(packets.some(p => p.includes('"observations"')));
    const request = JSON.parse(packets.find(p => p.includes('"observations"'))!);
    assert.equal(request.observations.length, 3);
    assert.doesNotMatch(packets.join(" "), /PRIVATE_|INC-[1-5]|скачанный|Кабинет|Выгрузка зависает/iu);
    await service.close();
  }
  const offline = new CanvasService();
  const local = await offline.read(source, "me", question);
  assert.equal(local.total, rows.length);
  assert.equal(local.groups.length, rows.length);
});

test("group analysis does not present an unsupported model diagnosis as a source observation", async () => {
  const current = buildTriage(queue, "priority", 4, now);
  const client = new VseLlm("test", "test", async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    answer: "Общая причина заявок — сбой базы данных.", nextCheck: "Сверьте журнал.", refs: ["T1.priorityId"],
  }) } }] }));
  const service = new AnalysisService({ query: async () => ({ rows: [] }), transaction: async () => { throw Error(); }, close: async () => {} }, undefined, 500, undefined, client);
  const detail = await analyzeCase(current.cases[0], queue, service, "workspace");
  assert.equal(detail.mode, "fallback");
  assert.doesNotMatch(detail.summary.join(" "), /сбой базы данных/);
  assert.match(detail.summary.join(" "), /Ошибки авторизации/);
  await service.close();
});
