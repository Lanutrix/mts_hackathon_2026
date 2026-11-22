import type { CanvasResult } from "../../packages/contracts/canvas.ts";
import { STATES } from "../../packages/domain/index.ts";

const prompts = {
  start: "С какой заявки начать?",
  scopedStart: "С какой из этих заявок начать?",
  scopedBrief: "Составь сводку по ним",
  overdueInSelection: "Сколько из них просрочено?",
  priorityBreakdown: "Какой приоритет встречается чаще всего среди них?",
  recent: "Покажи последние три инцидента",
  overdueNow: "Сколько сейчас просроченных заявок?",
  queue: "Покажи всю очередь",
  why: "Почему именно эта заявка?",
  comment: "Напиши комментарий о ходе работ",
  teams: "Сравни нагрузку по командам",
  brief: "Составь сводку для передачи смены",
  list: "Покажи эти заявки списком",
  haiku: "Перепиши это как хокку",
  priority: "Что означает приоритет заявки?",
  deadline: "Что означает срок решения?",
  assignment: "Что такое маршрутизация?",
  massIncident: "Что такое массовый инцидент?",
  status: "Что означает статус заявки?",
  escalation: "Что такое эскалация?",
} as const;
type Prompt = keyof typeof prompts;
const guideTopics = ["priority", "deadline", "assignment", "massIncident", "status", "escalation"] as const;
export const suggestionInstruction = "В conversation.suggestions выбери три разных уместных продолжения из списка: " +
  JSON.stringify(Object.values(prompts)) + ". Не предлагай повтор вопроса или уже показанный результат.";
const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru")
  .replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function withCanvasSuggestions(result: CanvasResult, question = ""): CanvasResult {
  const { intent, conversation, turnToken, total, tickets } = result;
  const eligible: Prompt[] = [];
  const availableView = total > 0 && !!result.selection;
  const views = [intent, ...result.blocks];
  const shown = (dimension: string) => availableView &&
    views.some(view => view.groupBy === dimension && view.layout !== "list");
  const openTicket = tickets.some(t => [0, 2, 20].some(s => STATES[s].label === t.state));
  const operation = intent.fact?.operation;
  const subset = operation === "recent" || operation === "statusInterval" || !!intent.fact?.sourceSelection;
  const hasFocus = !!turnToken && availableView && (total === 1 || !!intent.shiftAdvice);
  if (intent.shiftAdvice && hasFocus && conversation?.followUp === prompts.why) eligible.push("why");
  if (availableView && !intent.brief && !intent.shiftAdvice) {
    if (subset && openTicket && !intent.filters.deadline) eligible.push("overdueInSelection");
    if (operation === "count" && intent.filters.deadline === "overdue") eligible.push("priorityBreakdown");
  }
  if (hasFocus && !intent.commentDraft) eligible.push("comment");
  if (openTicket && !intent.shiftAdvice && !intent.commentDraft && intent.presentation !== "spotlight")
    eligible.push(subset ? "scopedStart" : "start");
  if (availableView && !intent.brief) eligible.push(subset ? "scopedBrief" : "brief");
  if (availableView && total > 1 && !shown("team") && !intent.filters.teams &&
      !intent.rankFocus && !intent.fact) eligible.push("teams");
  if (availableView && !intent.fact && intent.layout !== "list" &&
      !result.blocks.some(block => block.layout === "list") && conversation?.followUp === prompts.list) eligible.push("list");
  if (conversation && result.mode === "model" && turnToken &&
      /стих|двустиши|хокку|хайку|сочини|сказк|поэм/iu.test(question) && !/хокку|хайку/iu.test(question))
    eligible.push("haiku");
  if (availableView && subset && !shown("priority") && !intent.filters.priorities) eligible.push("priorityBreakdown");
  if (result.sourceTotal && !result.answer?.topic && !availableView) {
    if (operation !== "recent") eligible.push("recent");
    if (intent.filters.deadline !== "overdue") eligible.push("overdueNow");
    eligible.push("queue");
  }
  for (const topic of guideTopics) {
    if (intent.topic !== topic && !intent.related?.includes(topic)) eligible.push(topic);
  }

  const covered = new Set([question, result.title, result.summary, ...result.blocks.map(b => b.title)].map(normalize));
  const allowed = eligible.map(id => prompts[id]).filter(q => !covered.has(normalize(q)));
  // Model wording can only select a supported action that still applies to this turn.
  const match = (candidate?: string) => candidate ? allowed.find(q => normalize(q) === normalize(candidate)) : undefined;
  const primary = match(conversation?.followUp);
  const preferred = (conversation?.suggestions ?? []).map(match);
  const suggestions = [...new Set([primary, ...preferred, ...allowed].filter(q => q !== undefined))].slice(0, 3);
  if (!conversation) return { ...result, suggestions };
  const { followUp: _offer, suggestions: _hints, ...prose } = conversation;
  return { ...result, suggestions, conversation: primary ? { ...prose, followUp: primary } : prose };
}
