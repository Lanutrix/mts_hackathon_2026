import { deadlineStatus, spaces, type Incident } from "../../packages/domain/index.ts";
import { liveChecks, type LiveReason, type LiveStep } from "../../packages/domain/liveStep.ts";
import type { TriageCase } from "../../packages/domain/triage.ts";
import type { VseLlm } from "./vsellm.ts";

const version = "live-next-check-3";
const instruction = `Сформулируй по-русски одну короткую ручную проверку для координатора с опорой на evidenceField текущей заявки.
Учитывай её состояние, приоритет (4 — наивысший), назначение и риски группы. Начинай с одного глагола из starts.
Фразы checks служат примерами. Сформулируй действие естественно и по существу, используя только words. Не сообщай новых фактов, имён, чисел и сроков. Ничего не меняй в ITSM. Максимум 16 слов.
Дополнительно выбери ближайшее к ситуации действие из checks: A — первое, B — второе.
Верни только JSON {"action":"одно предложение","ref":"точное имя evidenceField","preferredCheck":"A или B"}.`;

const starts = ["Уточните", "Спросите", "Узнайте", "Проверьте", "Сверьте", "Запросите", "Подтвердите"];
const common = "у в по с со на к до из и о за для ли кто что когда как какой какая какие кто сейчас уже ещё еще можно сможет может готовы готова будет будет ли карточке карточку заявке заявку заявки инцидента инцидент по команде командой команды команда исполнителя исполнитель исполнителем исполнителю ответственного ответственный координатора координатор сообщит подтвердит назовёт назовет назвать сообщить уточнить ожидаемый ожидаемое ожидается следующего следующий ближайший время";
const vocabulary: Record<LiveReason, [RegExp, string]> = {
  overdue: [/срок|задерж|решени|восстановлен/u, "новый обновлённый обновленный актуальный срок срока сроку сроки сроков сроком решения решение решению восстановления восстановление работ работы завершения завершение задерживает задержку задержки задержала задерживают причину причины мешает завершить переноса перенос прогноз прогнозируемый"],
  soon: [/срок|успе|оста|заверш|готовност/u, "срок срока сроку готовность успевает успеет успевают завершить завершения решение решения оставшиеся осталось остаётся остается работы работу работ объём объем выполнения выполнению восстановление восстановления"],
  missingSource: [/выгрузк|источник|itsm|наличие/u, "актуальность наличие наличии последней последнюю актуальной текущей выгрузке выгрузку выгрузки источнике источника системе itsm есть присутствует"],
  followUp: [/последств|устран/u, "последствия последствий устранить устранение устранения устранению план после решения нужны нужно требуется меры дополнительных дополнительных работ работам"],
  missingDeadline: [/срок|оценк/u, "срок сроке сроки решения оценки оценку нужна потребуется подготовки работ завершения ориентир дать согласовать"],
  coordinator: [/прин|приня|шаг|план|вед[её]т|работ/u, "принял приняла принята приняты принял ли принята ли принятие работу работе работ ведёт ведет взял взяла шаг план действий подтвердил подтвердила"],
  research: [/исследован|гипотез|проверк|наблюдени/u, "исследования исследование гипотезу гипотезы проверяет проверяются проверяли проверки проверку наблюдения результаты результат промежуточный выводы этап"],
  missingTeam: [/команд|прин|ответствен/u, "ответственную ответственна отвечает назначение принять должна должен отвечает команду команда работу сопровождение"],
  progress: [/ход|обновлен|обновлён|статус|работ|этап/u, "ход работ ходом работы работа работу этапе этап текущий текущего обновления обновление статуса статус обновит обновится сообщить промежуточный результат готовность сообщит"],
};

function checkWording(value: unknown, words: Set<string>, subject: RegExp): value is string {
  if (typeof value !== "string" || value.length > 130 ||
    !/^[а-яёa-z]+(?:,? [а-яёa-z]+){2,15}[.?]?$/iu.test(value) || !subject.test(value.toLowerCase())) return false;
  const [first, ...rest] = value.replace(/[.,?]/gu, "").toLowerCase().split(" ");
  return starts.some((verb) => verb.toLowerCase() === first) && rest.every((word) => words.has(word));
}

export async function refineLiveStep(
  client: VseLlm | undefined, step: LiveStep, row: Incident, group: TriageCase, now: number,
) {
  const local = { key: step.key, action: step.action, mode: "local" as const };
  if (!client) return local;
  const checks = liveChecks[step.reason];
  const [subject, specific] = vocabulary[step.reason];
  const words = new Set((common + " " + specific).split(" "));
  const packet = {
    evidenceField: step.evidence.field, reason: step.reason, starts, checks, words: [...words],
    priority: row.priorityId, state: row.stateId, sourcePresent: row.sourcePresent,
    deadline: deadlineStatus(row.dates.deadline, now), followUp: row.raw.isNeedUp === true,
    hasTeam: !!row.team, hasAssignee: !!spaces(row.raw.assignedEmployee),
    group: { tickets: group.count, overdue: group.overdue, soon: group.soon },
  };
  const response = await client.json(version, instruction, packet, 6000, "background");
  if ("error" in response) return { ...local, retryAfterMs: 12_000 };
  const reply = response.json as {
    action?: unknown; ref?: unknown; choice?: unknown; preferredCheck?: unknown;
  } | null;
  let action: string | undefined;
  if (reply?.ref === step.evidence.field) {
    if (checkWording(reply.action, words, subject)) action = reply.action.trim();
    else if (reply.preferredCheck === "A" || reply.preferredCheck === "B")
      action = checks[reply.preferredCheck === "A" ? 0 : 1];
  } else if (reply?.ref === undefined && reply?.action === undefined &&
             (reply?.choice === 1 || reply?.choice === 2)) {
    action = checks[reply.choice - 1];
  }
  if (action) return { key: step.key, action, mode: "model" as const, model: client.model };
  client.rejectJson(version, packet);
  return local;
}
