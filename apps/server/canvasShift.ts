import type { CanvasConversation, CanvasIntent } from "../../packages/contracts/canvas.ts";
import { deadlineStatus, type Incident } from "../../packages/domain/index.ts";
import { liveStep } from "../../packages/domain/liveStep.ts";

export function shiftQuestion(question: string, hasAdvice: boolean) {
  const text = question.toLocaleLowerCase("ru").replaceAll("ё", "е").trim()
    .replace(/^(?:(?:а|и|тогда|теперь|подскажите|подскажи|скажите|скажи|пожалуйста)[,\s]+)+/u, "")
    .replace(/[?!.\s]+$/u, "").replace(/\s+/gu, " ");
  if (/^почему (?:именно )?(?:эта заявка|эту заявку|этот (?:тикет|инцидент))(?: (?:первая|первой|выбрана))?$/u.test(text) ||
      hasAdvice && /^почему (?:именно )?(?:она|ее|он|его)(?: (?:первая|первая в очереди|первым))?$/u.test(text)) return "why";
  if (/^с чего (?:мне )?начать (?:смену|дежурство|работу на смене)$/u.test(text) ||
      /^с (?:какой (?:заявки|из этих заявок)|какого (?:инцидента|тикета|из этих (?:инцидентов|тикетов))) (?:мне )?начать(?: (?:смену|разбор|работу))?$/u.test(text) ||
      /^(?:на какую заявку|на какой (?:инцидент|тикет)) (?:мне )?(?:посмотреть|обратить внимание) (?:в первую очередь|сначала|прежде всего)$/u.test(text) ||
      /^(?:какую заявку|какой (?:инцидент|тикет)|что) (?:мне )?(?:проверить|посмотреть|разобрать|открыть) (?:первой|первым|сначала|в первую очередь|первым делом)$/u.test(text))
    return "recommend";
}

export function shiftIntent(scope?: CanvasIntent): CanvasIntent {
  // Keep the original fact dimension and period for the same source cohort on refresh.
  return { groupBy: scope?.fact || scope?.rankFocus ? scope.groupBy : "ticket", layout: "list", presentation: "spotlight",
    shiftAdvice: true, filters: scope?.filters ?? {}, ...(scope?.fact ? { fact: scope.fact } : {}),
    ...(scope?.rankFocus ? { rankFocus: scope.rankFocus } : {}) };
}

function rankReason(first: Incident, next?: Incident) {
  if (!next) return "Это единственная открытая заявка в выбранном срезе.";
  if (first.priorityId !== next.priorityId) return "У неё приоритет выше, чем у остальных открытых заявок в срезе.";
  if (first.dates.deadline !== next.dates.deadline) return next.dates.deadline
    ? "Среди заявок с тем же приоритетом у неё самый ранний срок решения."
    : "При том же приоритете она стоит раньше заявок без указанного срока решения.";
  if ((first.raw.isNeedUp === true) !== (next.raw.isNeedUp === true))
    return "При равных приоритете и сроке первой проверяется заявка с отметкой об устранении последствий.";
  return "У первых заявок совпадают приоритет, срок и отметка об устранении последствий. Порядок определил номер заявки.";
}

export function shiftAnswer(ranked: Incident[], now: number, hasSource: boolean): {
  conversation: CanvasConversation; explanation?: string;
} {
  const first = ranked[0];
  if (!first) return { conversation: { title: "С чего начать смену", text: hasSource
    ? "В выбранном срезе нет открытых заявок. Проверьте условия отбора или откройте всю очередь."
    : "В источнике пока нет заявок. Выбрать карточку для проверки можно после загрузки данных." } };
  const status = deadlineStatus(first.dates.deadline, now);
  const step = liveStep(first, now, { count: 1, overdue: Number(status === "overdue"), soon: Number(status === "soon") });
  const basis = step.reason === "progress" ? "В карточке указана ответственная команда." : step.basis;
  return {
    conversation: { title: "Первая заявка для проверки",
      text: "Начните с " + first.id + ". Приоритет «" + first.priorityLabel + "». " + basis + " " + step.action,
      followUp: "Почему именно эта заявка?" },
    explanation: "На момент выбора у " + first.id + " был приоритет «" + first.priorityLabel + "». " + basis + " " +
      rankReason(first, ranked[1]),
  };
}
