import { canRedrawGroups, formatOnly, groupDisplay, requestedFactDisplay, supportsFactDisplay } from "./factDisplay.ts";
import { randomUUID } from "node:crypto";
import { isGroupRanking, rankedGroups, rankingIntent, readRankRequest, type RankFocus, type RankRequest } from "./canvasRanking.ts";
import type {
  CanvasBlock,
  CanvasDimension,
  CanvasFilters,
  CanvasGroup,
  CanvasIntent,
  CanvasPage,
  CanvasResult,
  CanvasTicket,
  CanvasView,
} from "../../packages/contracts/canvas.ts";
import {
  deadlineStatus,
  hash,
  PRIORITIES,
  spaces,
  STATES,
  type Incident,
} from "../../packages/domain/index.ts";
import { facet, urgent } from "../../packages/domain/triage.ts";
import { groupObservations } from "./semanticGroups.ts";
import { recurringSymptoms } from "../../packages/domain/symptoms.ts";
import { commentText, type CommentTopic } from "./dispatchSuggestions.ts";
import { initialIntent, planCanvas } from "./canvasPlan.ts";
import { buildAnswerInsights } from "./answerInsights.ts";
import { shiftAnswer, shiftIntent, shiftQuestion } from "./canvasShift.ts";
import { briefAnswer, briefRequest, planBrief } from "./canvasBrief.ts";
import { describeFact, prepareFact } from "./canvasFacts.ts";
import { makeAnswer } from "./canvasGuide.ts";
import {
  asksAboutResult,
  asksForScopeExplanation,
  explainFact,
  explainScope,
  type DialogueTurn,
} from "./canvasDialogue.ts";
import type { VseLlm } from "./vsellm.ts";

export interface CanvasSource {
  namespace: string;
  revision: number;
  rows: Map<string, Incident>;
  simulation?: { runId: string };
}
const titles: Record<CanvasDimension, string> = {
  symptom: "Похожие симптомы",
  team: "Нагрузка по командам",
  product: "Инциденты по продуктам",
  priority: "Приоритеты инцидентов",
  deadline: "Сроки решения",
  status: "Статусы инцидентов",
  escalation: "Устранение последствий",
  ticket: "Заявки",
};
const deadlineLabels = {
  overdue: "Срок прошёл",
  soon: "В ближайшие 15 минут",
  normal: "Позже 15 минут",
  unset: "Без срока",
};
const escalationLabels = {
  yes: "Требуется устранение последствий",
  no: "Не требуется",
  unknown: "Нет отметки",
};
const collator = new Intl.Collator("ru", { numeric: true });
const suggestions = [
  "Сгруппируй заявки по похожим симптомам",
  "Сравни нагрузку по командам",
  "Покажи просроченные заявки списком",
];
const escalation = (row: Incident) =>
  row.raw.isNeedUp === true
    ? "yes"
    : row.raw.isNeedUp === false
      ? "no"
      : "unknown";

const openStates = [0, 2, 20];

function includesLabel(values: string[] | undefined, label: string, canonical: boolean) {
  if (!values || values.includes(label)) return true;
  if (!canonical) return false;
  const folded = label.normalize("NFKC").toLocaleLowerCase("ru");
  return values.some(v => v.normalize("NFKC").toLocaleLowerCase("ru") === folded);
}

function selected(row: Incident, f: CanvasFilters, now: number, allStates = false) {
  // Explicit IDs can also resolve a closed source ticket. Generic reads
  // start with the open queue including research, irrespective of priority.
  if (
    f.states
      ? !f.states.includes(row.stateId!)
      : !allStates && !f.ids && !openStates.includes(row.stateId!)
  )
    return false;
  return (
    (!f.ids || f.ids.includes(row.id)) &&
    includesLabel(f.teams, row.team, allStates) &&
    (!f.excludedTeams || !includesLabel(f.excludedTeams, row.team, true)) &&
    includesLabel(f.products, spaces(row.raw.productName), allStates) &&
    (!f.priorities || f.priorities.includes(row.priorityId!)) &&
    (!f.deadline || deadlineStatus(row.dates.deadline, now) === f.deadline) &&
    (!f.escalation || escalation(row) === f.escalation) &&
    (!f.symptoms || f.symptoms.includes(facet(row, "symptom").label))
  );
}

function ticket(row: Incident, now: number): CanvasTicket {
  return {
    id: row.id,
    header: spaces(row.raw.header) || "Без заголовка",
    team: row.team || "Команда не указана",
    product: spaces(row.raw.productName) || "Продукт не указан",
    priority: row.priorityLabel,
    state: row.stateLabel,
    deadline: row.dates.deadline ?? null,
    overdue: deadlineStatus(row.dates.deadline, now) === "overdue",
    escalated: row.raw.isNeedUp === true,
  };
}
function partition(row: Incident, dim: CanvasDimension, now: number) {
  if (dim === "deadline") {
    const key = deadlineStatus(row.dates.deadline, now);
    return { key, label: deadlineLabels[key] };
  }
  if (dim === "escalation") {
    const key = escalation(row);
    return { key, label: escalationLabels[key] };
  }
  if (dim === "status")
    return { key: String(row.stateId), label: row.stateLabel };
  if (dim === "ticket") return { key: row.id, label: row.id };
  return facet(row, dim);
}
function describe(filters: CanvasFilters) {
  const terms = [
    ...(filters.ids ?? []),
    ...(filters.teams ?? []),
    ...(filters.excludedTeams?.map(team => "кроме команды «" + team + "»") ?? []),
    ...(filters.products ?? []),
    ...(filters.symptoms ?? []),
    ...(filters.priorities?.map((p) => "приоритет «" + PRIORITIES[p] + "»") ??
      []),
    ...(filters.states?.map((s) => STATES[s].label) ?? []),
    ...(filters.states?.length === 0 ? ["нет общих статусов с предыдущей выборкой"] : []),
    ...(filters.deadline
      ? [deadlineLabels[filters.deadline].toLocaleLowerCase("ru")]
      : []),
    ...(filters.escalation
      ? [escalationLabels[filters.escalation].toLocaleLowerCase("ru")]
      : []),
  ];
  return terms.join(" · ");
}
interface PinnedSelection {
  projection: CanvasTicket[];
  run?: string;
  shift?: { result: CanvasResult; explanation: string };
  displayResult?: CanvasResult;
  namespace: string;
  actor: string;
  expires: number;
  all: CanvasTicket[];
  members: Map<string, CanvasTicket[]>;
}
interface TurnState {
  displaySelection?: string;
  rankingSelection?: string;
  rankPlace?: RankFocus["place"];
  pendingRelationIds?: string[];
  offered?: { question: string; context: CanvasIntent };
  pendingComment?: CommentTopic;
}
interface StoredTurn extends TurnState {
  namespace: string;
  actor: string;
  run?: string;
  expires: number;
  history: DialogueTurn[];
}
function acceptsOffer(question: string) {
  const text = question.toLocaleLowerCase("ru").replace(/[,.!?…]/gu, " ").replace(/\s+/gu, " ").trim();
  return /^(?:(?:да|ок(?:ей)?|конечно|хорошо|согласен|согласна)(?: (?:сделай(?: это)?|давай|покажи|продолжай))?|давай|сделай это)(?: пожалуйста)?$/u.test(text);
}
function commentTopic(question: string): CommentTopic | undefined {
  if (/(?:^|[,\s])как (?:мне |нам |самому |самой )?(?:написать|составить|подготовить|отправить|добавить|оставить)/iu.test(question) ||
      /(?:не (?:пиши|составляй)|стихотворени|четверостиши|сочини шутку)/iu.test(question) ||
      !/комментари|коммент(?:\s|$)|черновик.{0,20}(?:сообщени|ответа)/iu.test(question) ||
      !/напиш|написать|состав|подготов|сформулир|придум|наброс|черновик|сгенерир|предложи/iu.test(question)) return;
  return /срок|просроч|дедлайн/iu.test(question) ? "deadline" :
    /влияни|затронут|масштаб/iu.test(question) ? "impact" : "progress";
}

export class CanvasService {
  private readonly pinned = new Map<string, PinnedSelection>();
  private readonly turns = new Map<string, StoredTurn>();
  constructor(private readonly client?: VseLlm) {}
  private remember(
    source: CanvasSource,
    actor: string,
    history: DialogueTurn[],
    turn?: DialogueTurn,
    state: TurnState = {},
  ) {
    const now = Date.now();
    for (const [key, entry] of this.turns)
      if (entry.expires <= now) this.turns.delete(key);
    while (this.turns.size >= 256)
      this.turns.delete(this.turns.keys().next().value!);
    const token = randomUUID();
    this.turns.set(token, {
      namespace: source.namespace,
      actor,
      run: source.simulation?.runId,
      expires: now + 15 * 60_000,
      history: turn ? [...history.slice(-2), turn] : history,
      ...state,
    });
    return token;
  }
  // Store small source projections only. Paging uses the same membership and
  // time as the result, even if the source or a deadline changes meanwhile.
  private pin(
    source: CanvasSource,
    actor: string,
    all: CanvasTicket[],
    members: Map<string, CanvasTicket[]>,
    projection = all,
  ) {
    const now = Date.now();
    // Compound views share a single projection array. Keep their page tokens
    // together even when one source has tens of thousands of tickets.
    const projections = new Set([projection]);
    let used = projection.length;
    for (const [id, entry] of [...this.pinned].reverse()) {
      if (entry.expires <= now) {
        this.pinned.delete(id);
        continue;
      }
      if (projections.has(entry.projection)) continue;
      if (used + entry.projection.length > 50_000) {
        this.pinned.delete(id);
        continue;
      }
      used += entry.projection.length;
      projections.add(entry.projection);
    }
    while (this.pinned.size >= 72)
      this.pinned.delete(this.pinned.keys().next().value!);
    const id = randomUUID();
    this.pinned.set(id, {
      namespace: source.namespace,
      run: source.simulation?.runId,
      actor,
      all,
      projection,
      members,
      expires: now + 15 * 60_000,
    });
    return id;
  }
  page(
    namespace: string,
    actor: string,
    id: string,
    group: string | undefined,
    offset: number,
    run?: string,
  ): CanvasPage | undefined {
    const source = this.pinned.get(id);
    if (
      !source ||
      source.namespace !== namespace ||
      source.actor !== actor ||
      source.run !== run ||
      source.expires <= Date.now()
    )
      return;
    const list = group === undefined ? source.all : source.members.get(group);
    if (!list) return;
    const items = list.slice(offset, offset + 30);
    return {
      total: list.length,
      items,
      nextOffset:
        offset + items.length < list.length ? offset + items.length : null,
    };
  }
  private block(
    source: CanvasSource,
    actor: string,
    view: CanvasView,
    rows: Incident[],
    tickets: CanvasTicket[],
    now: number,
    durationMeasure?: "median" | "mean",
    semantic?: ReadonlyMap<string, { key: string; label: string }>,
  ): CanvasBlock {
    const members = new Map<string, CanvasTicket[]>();
    const groups: CanvasGroup[] = [];
    if (view.layout !== "list") {
      const buckets = new Map<
        string,
        { label: string; items: CanvasTicket[] }
      >();
      for (let i = 0; i < rows.length; i++) {
        const inferred = view.groupBy === "symptom" ? semantic?.get(rows[i].id) : undefined;
        const { key, label } = inferred ?? partition(rows[i], view.groupBy, now);
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { label, items: [] };
          buckets.set(key, bucket);
        }
        bucket.items.push(tickets[i]);
      }
      for (const [rawKey, { label, items }] of buckets) {
        const key =
          view.groupBy === "deadline"
            ? rawKey
            : hash([view.groupBy, rawKey]).slice(0, 24);
        members.set(key, items);
        // A duration selection and each of its buckets retain elapsed-time order.
        const mid = Math.floor(items.length / 2);
        const durationMs = durationMeasure === "median"
          ? (items[mid].duration!.ms + items[Math.floor((items.length - 1) / 2)].duration!.ms) / 2
          : durationMeasure === "mean" ? items.reduce((sum, t) => sum + t.duration!.ms, 0) / items.length : undefined;
        groups.push({
          key,
          label,
          ...(durationMs === undefined ? {} : { durationMs }),
          count: items.length,
          overdue: items.filter((t) => t.overdue).length,
          escalated: items.filter((t) => t.escalated).length,
        });
      }
      groups.sort(
        (a, b) =>
          b[view.weightBy ?? "count"] - a[view.weightBy ?? "count"] ||
          b.count - a.count ||
          collator.compare(a.label, b.label) ||
          a.key.localeCompare(b.key),
      );
    }
    return {
      ...view,
      title: view.layout === "list" ? "Список заявок" : titles[view.groupBy],
      groups,
      tickets: tickets.slice(0, 6),
      selection: this.pin(source, actor, tickets, members),
    };
  }
  private rankReply(
    source: CanvasSource, actor: string, history: DialogueTurn[], request: RankRequest,
    ranking?: CanvasResult, priorPlace?: RankFocus["place"],
  ): CanvasResult {
    const place = request.place ?? priorPlace ?? (ranking?.intent.fact?.limit ? "shown" :
      ranking?.intent.fact?.operation === "frequency" ? 1 : undefined);
    const pinned = ranking && this.pinned.get(ranking.selection);
    const mismatch = request.dimension && ranking && request.dimension !== ranking.intent.groupBy;
    const focus = place && request.output !== "clarify" && !mismatch ? { place, output: request.output } : undefined;
    const found = ranking && focus ? rankedGroups(ranking.groups, ranking.total, focus) : undefined;
    if (!ranking || !pinned || !focus || !found?.chosen) {
      const text = mismatch
        ? "Предыдущий рейтинг использует другое поле. Запросите рейтинг по полю «" + titles[request.dimension!] + "»."
        : request.output === "clarify"
        ? "Уточните дополнительное условие для выбранных групп. Можно запросить их число заявок, долю или список карточек."
        : found?.problem ?? (ranking
        ? "Какое место в рейтинге вас интересует?"
        : "Нужен предыдущий рейтинг по числу заявок. Например, спросите: «У какой команды больше всего заявок?»");
      return {
        namespace: source.namespace, revision: ranking?.revision ?? source.revision,
        asOf: ranking?.asOf ?? new Date().toISOString(), sourceTotal: ranking?.sourceTotal ?? 0,
        provider: "Поля ITSM", mode: "unsupported", title: "Уточните место", summary: text,
        conversation: { title: "Уточните место", text }, intent: ranking?.intent ?? initialIntent,
        metrics: [], blocks: [], groups: [], tickets: [], selection: "", total: 0, suggestions,
        ...(ranking ? { turnToken: this.remember(source, actor, history, undefined, {
          displaySelection: ranking.selection, rankPlace: priorPlace,
        }) } : {}),
      };
    }
    const groups = new Map(found.chosen.map(group => [group.key, pinned.members.get(group.key)!]));
    const members = new Set([...groups.values()].flat());
    const items = groups.size === 1 ? groups.values().next().value! : pinned.all.filter(item => members.has(item));
    const selection = this.pin(source, actor, items, groups, pinned.projection);
    const turnToken = this.remember(source, actor, history, undefined, {
      displaySelection: selection, rankingSelection: ranking.selection, rankPlace: focus.place,
    });
    const list = focus.output === "tickets";
    const title = list ? "Заявки · " + found.labels : found.position + " в рейтинге";
    const method = "Место определяется по числу заявок. Группы с одинаковым числом занимают одно место.";
    const { fact, ...base } = ranking;
    const result: CanvasResult = {
      ...base, mode: "snapshot", provider: "Поля ITSM", notice: undefined, title, summary: found.headline,
      intent: { ...ranking.intent, rankFocus: focus, ...(list || !fact ? { layout: "list", presentation: "register" } : {}) },
      ...(list ? {} : fact ? { fact: { ...fact, headline: found.headline, method: method + " " + fact.method } }
        : { conversation: { title, text: found.headline + " " + method } }),
      selection, turnToken, tickets: items.slice(0, 6), total: items.length,
      groups: !list && fact && found.chosen.length > 1 ? found.chosen : [], metrics: [], blocks: [],
    };
    this.pinned.get(selection)!.displayResult = result;
    return result;
  }
  private currentTurn(source: CanvasSource, actor: string, token?: string) {
    const turn = token ? this.turns.get(token) : undefined;
    return turn && turn.actor === actor && turn.namespace === source.namespace &&
      turn.run === source.simulation?.runId && turn.expires > Date.now() ? turn : undefined;
  }
  private textResult(source: CanvasSource, title: string, text: string): CanvasResult {
    return { namespace: source.namespace, revision: source.revision, asOf: new Date().toISOString(),
      sourceTotal: 0, provider: "Поля ITSM", mode: "unsupported", title, summary: text,
      intent: initialIntent, conversation: { title, text }, selection: "", total: 0,
      metrics: [], blocks: [], groups: [], tickets: [], suggestions };
  }
  async read(
    source: CanvasSource, actor: string, question?: string, context?: CanvasIntent, turnToken?: string,
  ): Promise<CanvasResult> {
    if (question && acceptsOffer(question)) {
      const offer = this.currentTurn(source, actor, turnToken)?.offered;
      if (!offer) return this.textResult(source, "Уточните запрос",
        "Какой результат нужен? Например, список просроченных заявок или сравнение команд.");
      question = offer.question;
      context = offer.context;
    }
    const result = await this.evaluate(source, actor, question, context, turnToken);
    const next = result.conversation?.followUp;
    const stored = this.currentTurn(source, actor, result.turnToken);
    if (next || stored?.offered) {
      // A historic reply stays clickable even after newer branches of the conversation.
      return { ...result, turnToken: this.remember(source, actor, stored?.history ?? [], undefined, {
        displaySelection: stored?.displaySelection, rankingSelection: stored?.rankingSelection,
        rankPlace: stored?.rankPlace, pendingRelationIds: stored?.pendingRelationIds, pendingComment: stored?.pendingComment,
        offered: next ? { question: next, context: result.intent } : undefined,
      }) };
    }
    return result;
  }
  private async evaluate(
    source: CanvasSource, actor: string, question?: string, context?: CanvasIntent, turnToken?: string,
  ): Promise<CanvasResult> {
    const { namespace, revision } = source;
    const now = Date.now();
    const activeTurn = this.currentTurn(source, actor, turnToken);
    const history = activeTurn?.history ?? [];
    const displayed = activeTurn?.displaySelection ? this.pinned.get(activeTurn.displaySelection) : undefined;
    const focused = displayed && displayed.expires > now ? displayed : undefined;
    const advice = focused?.shift;
    const brief = question ? briefRequest(question) : context?.brief ? "write" : undefined;
    const shift = question ? shiftQuestion(question, !!advice) : context?.shiftAdvice ? "recommend" : undefined;
    const rankedSelection = activeTurn?.rankingSelection ?? activeTurn?.displaySelection;
    const rankedProjection = rankedSelection ? this.pinned.get(rankedSelection) : undefined;
    const ranking = rankedProjection && rankedProjection.expires > now && isGroupRanking(rankedProjection.displayResult?.intent)
      ? rankedProjection.displayResult : undefined;
    let rankMemberIds: Set<string> | undefined;
    const rankScope = brief === "write" && context?.briefRank ? context.briefRank : context;
    if ((shift === "recommend" || brief === "write") && rankScope?.rankFocus) {
      const { shiftAdvice: _advice, brief: _brief, briefRank: _scope, ...rankContext } = rankScope;
      const members = !context?.briefRank && focused &&
        (focused.displayResult?.intent.rankFocus || focused.shift?.result.intent.rankFocus)
        ? focused : this.pinned.get((await this.read(source, actor, undefined, rankContext)).selection);
      rankMemberIds = new Set(members?.all.map(ticket => ticket.id));
    }
    if (!question && context?.rankFocus && !shift && !brief) {
      const base = await this.read(source, actor, undefined, rankingIntent(context));
      const projection = this.pinned.get(base.selection);
      if (projection) projection.displayResult = base;
      return this.rankReply(source, actor, history, context.rankFocus, base);
    }
    const rankRequest = question && readRankRequest(question, !!activeTurn?.rankPlace);
    if (rankRequest && (ranking || rankRequest.place || isGroupRanking(context) || context?.rankFocus || !context))
      return this.rankReply(source, actor, history, rankRequest, ranking, activeTurn?.rankPlace);
    if (context?.rankFocus && !shift && !brief) context = ranking?.intent ?? rankingIntent(context);
    if (question && (context?.shiftAdvice || context?.brief || context?.commentDraft)) {
      context = { ...context };
      delete context.shiftAdvice;
      delete context.commentDraft;
      delete context.brief;
      if (!brief) delete context.briefRank;
    }
    if (question && activeTurn?.displaySelection) {
      const pinned = this.pinned.get(activeTurn.displaySelection);
      const result = pinned?.displayResult;
      if (pinned && pinned.expires > now && result && asksAboutResult(question)) {
        if (result.fact) return explainFact(result);
        if (result.metrics.length) return explainScope(result, this.client);
      }
      const display = requestedFactDisplay(question);
      if (pinned && pinned.expires > now && result && display && formatOnly(question, display)) {
        if (result.intent.fact && supportsFactDisplay(result.intent.fact.operation, display))
          return { ...result, intent: { ...result.intent, fact: { ...result.intent.fact, display } } };
        if (canRedrawGroups(result.intent))
          return { ...result, intent: { ...result.intent, ...groupDisplay(display) } };
      }
    }
    if (question && (asksForScopeExplanation(question) || (context?.fact && asksAboutResult(question)))) {
      const active = { ...(context ?? initialIntent) };
      delete active.topic;
      delete active.related;
      delete active.focus;
      delete active.guideOnly;
      const snapshot = await this.read(source, actor, undefined, active);
      if (snapshot.fact) return explainFact(snapshot);
      const explanation = await explainScope(snapshot, this.client);
      return {
        ...explanation,
        turnToken: this.remember(source, actor, history, {
          question: "Объясни текущий срез",
          answer: explanation.conversation!.text,
        }),
      };
    }
    const byId = new Map<string, Incident>();
    for (const r of source.rows.values()) {
      if (r.quarantined || !r.sourcePresent || byId.has(r.id)) continue;
      byId.set(r.id, r);
    }
    const rows = [...byId.values()];
    const pendingComment = activeTurn?.pendingComment;
    const idReply = question?.trim().match(/^(?:(?:номер|заявка|инцидент)\s+)?#?([\p{L}\p{N}_-]*\d[\p{L}\p{N}_-]*)[.!]?$/iu);
    const topic = question ? commentTopic(question) ?? (idReply && pendingComment) : context?.commentDraft;
    if (topic) {
      const words = question?.toLocaleLowerCase("ru").match(/[\p{L}\p{N}_-]+/gu) ?? [];
      const ids = new Set(words.filter(word => /\d/u.test(word)));
      const matches = rows.filter(row => ids.has(row.id.toLocaleLowerCase("ru")));
      const explicitId = !!idReply || [...ids].some(word => /[a-zа-я_-]/iu.test(word) || /^\d{4,}$/u.test(word));
      const focusedId = focused?.all.length === 1 ? focused.all[0].id : advice?.result.tickets[0]?.id;
      const row = !question ? byId.get(context?.filters.ids?.[0] ?? "") : matches.length === 1 ? matches[0] :
        !explicitId && !matches.length && focusedId ? byId.get(focusedId) : undefined;
      if (!row) {
        const text = matches.length > 1 ? "Для какой заявки нужен комментарий? Пришлите один номер." :
          explicitId || !question ? "Такой заявки нет в текущем источнике. Уточните номер." : "Пришлите номер заявки для черновика комментария.";
        return { ...this.textResult(source, "Номер заявки", text), sourceTotal: rows.length,
          turnToken: this.remember(source, actor, history, undefined, { pendingComment: topic }) };
      }
      const message = commentText(row, topic, now);
      const items = [ticket(row, now)];
      const selection = this.pin(source, actor, items, new Map());
      return { ...this.textResult(source, "Черновик комментария", row.id + ". " + message),
        mode: "snapshot", sourceTotal: rows.length, selection, tickets: items, total: 1,
        intent: { groupBy: "ticket", layout: "list", presentation: "spotlight", filters: { ids: [row.id] }, commentDraft: topic },
        turnToken: this.remember(source, actor, history, undefined, { displaySelection: selection }),
      };
    }

    let missingAdvice: string | undefined;
    if (shift === "why") {
      const lead = advice && byId.get(advice.result.tickets[0].id);
      if (advice && lead && openStates.includes(lead.stateId!)) {
        const title = "Почему эта заявка первая";
        return { ...advice.result, title, summary: advice.explanation,
          conversation: { title, text: advice.explanation } };
      }
      missingAdvice = advice
        ? "Рекомендованной заявки больше нет в открытой очереди. Запросите новый совет по текущему срезу."
        : "Выберите заявку для проверки вопросом «С какой заявки начать?», и я поясню выбор.";
    }
    const starter: CanvasIntent =
      !question && !context && rows.some((r) => openStates.includes(r.stateId!))
        ? {
            ...initialIntent,
            blocks: [
              {
                groupBy: "deadline",
                layout: "groups",
                presentation: "deadline",
              },
            ],
          }
        : initialIntent;
    const decision: Awaited<ReturnType<typeof planCanvas>> = missingAdvice
      ? { intent: context ?? initialIntent, mode: "unsupported", provider: "Поля ITSM", textOnly: true,
          conversation: { title: "Нужна рекомендация", text: missingAdvice, followUp: "С какой заявки начать?" } }
      : shift === "recommend"
      ? { intent: shiftIntent(context), mode: "snapshot", provider: "Поля ITSM" }
      : question && brief
      ? planBrief(question, brief, rows, context)
      : question
      ? await planCanvas(
          question,
          rows,
          namespace,
          context,
          this.client,
          history,
          activeTurn?.pendingRelationIds,
        )
      : {
          intent: context ?? starter,
          mode: context?.guideOnly
            ? ("knowledge" as const)
            : ("snapshot" as const),
          provider: context?.guideOnly ? "Справка Среза" : "Поля ITSM",
          answer: context?.topic
            ? makeAnswer(
                context.topic,
                context.focus,
                context.guideOnly ? "knowledge" : "mixed",
                context.related,
              )
            : undefined,
        };
    const { intent } = decision;
    const { textOnly, memoryQuestion, pendingRelationIds, ...publicDecision } = decision;
    const sourceTotal = rows.length;
    const base = {
      namespace,
      revision,
      asOf: new Date(now).toISOString(),
      ...publicDecision,
      sourceTotal,
      suggestions,
    };
    if (
      textOnly ||
      decision.mode === "unsupported" ||
      decision.answer?.kind === "knowledge"
    )
      return {
        ...base,
        ...(pendingRelationIds ? {
          turnToken: this.remember(source, actor, history, undefined, { pendingRelationIds }),
        } : {}),
        ...(memoryQuestion && decision.conversation
          ? {
              turnToken: this.remember(source, actor, history, {
                question: memoryQuestion,
                answer: decision.conversation.text,
              }),
            }
          : {}),
        title:
          decision.conversation?.title ??
          decision.answer?.title ??
          "Нужно уточнение",
        summary:
          decision.conversation?.text ??
          decision.answer?.lead ??
          decision.notice ??
          "",
        metrics: [],
        groups: [],
        blocks: [],
        tickets: [],
        selection: "",
        total: 0,
      };
    const scoped = rows.filter(r => selected(r, intent.filters, now, !!intent.fact));
    const prepared = intent.fact ? prepareFact(intent, scoped, now) : undefined;
    if (intent.shiftAdvice) {
      const ranked = (prepared?.rows ?? scoped)
        .filter(r => openStates.includes(r.stateId!) && (!rankMemberIds || rankMemberIds.has(r.id))).sort(urgent);
      const { conversation, explanation } = shiftAnswer(ranked, now, !!sourceTotal);
      const tickets = ranked.map(r => ticket(r, now));
      const selection = tickets.length ? this.pin(source, actor, tickets, new Map()) : "";
      const result: CanvasResult = { ...base, title: conversation.title, summary: conversation.text, conversation,
        total: ranked.length, tickets: tickets.slice(0, 1), selection, groups: [], blocks: [], metrics: [],
        turnToken: this.remember(source, actor, history, undefined, { displaySelection: selection }) };
      const pinned = this.pinned.get(selection);
      if (pinned && explanation) pinned.shift = { result, explanation };
      return result;
    }
    let matches = prepared?.rows ?? scoped.sort(urgent);
    if (intent.briefRank && rankMemberIds) matches = matches.filter(row => rankMemberIds!.has(row.id));
    const measuringDuration = intent.fact?.operation === "duration" && !intent.brief;
    const tickets = matches.map((r, i) => ({
      ...ticket(r, now),
      ...(measuringDuration ? { duration: prepared!.durations[i] } : {}),
    }));
    const durationMeasure = measuringDuration ? intent.fact?.durationMeasure : undefined;
    const showSymptoms = intent.groupBy === "symptom" && intent.layout !== "list" && !intent.fact && !intent.brief;
    const semantic = showSymptoms && (question || context) ? await groupObservations(matches, this.client) : undefined;
    const primary = this.block(
      source,
      actor,
      {
        groupBy: intent.groupBy,
        layout: intent.layout,
        weightBy: intent.weightBy,
        presentation: intent.presentation,
        exhibits: intent.exhibits,
      },
      matches,
      tickets,
      now,
      durationMeasure === "median" || durationMeasure === "mean" ? durationMeasure : undefined,
      semantic?.assigned,
    );
    if (intent.fact && prepared && !intent.brief) {
      if (durationMeasure === "median" || durationMeasure === "mean") {
        const direction = intent.fact.ascending ? 1 : -1;
        primary.groups.sort((a, b) => direction * (a.durationMs! - b.durationMs!) || collator.compare(a.label, b.label));
      }
      if (intent.fact.ascending && intent.fact.operation === "frequency")
        primary.groups.sort((a,b) => a.count - b.count || collator.compare(a.label,b.label));
      const limit = intent.fact.limit;
      const boundary = limit && primary.groups[limit - 1]?.count;
      const groups = boundary ? primary.groups.filter((group, index) => index < limit! || group.count === boundary) : primary.groups;
      const answer = describeFact(intent, prepared, groups, describe(intent.filters));
      const result: CanvasResult = { ...base, ...answer, total: tickets.length, metrics: [], groups,
        tickets: primary.tickets, selection: primary.selection, blocks: [],
        turnToken: this.remember(source, actor, history, {
          question: "Расчёт по полям ITSM", answer: "Результат доступен в предыдущем срезе."
        }, { displaySelection: primary.selection }) };
      const pinned = this.pinned.get(primary.selection);
      if (pinned) pinned.displayResult = result;
      return result;
    }
    const insights = intent.insightIds?.length
      ? buildAnswerInsights("", matches, now, intent.insightIds)
      : [];
    if (insights.length) primary.insights = insights;
    const blocks = (intent.blocks ?? []).map((v) =>
      this.block(source, actor, v, matches, tickets, now),
    );
    const total = tickets.length;
    const overdue = tickets.filter((t) => t.overdue).length;
    const escalated = tickets.filter((t) => t.escalated).length;
    const soon = tickets.filter(
      (t) => deadlineStatus(t.deadline, now) === "soon",
    ).length;
    const scope = describe(intent.filters);
    const briefText = intent.brief ? briefAnswer(matches, now, describe({
      ...intent.filters,
      states: openStates.every(s => intent.filters.states?.includes(s)) && intent.filters.states?.length === openStates.length
        ? undefined : intent.filters.states,
    }), prepared && intent.fact?.period !== "snapshot"
      ? (intent.fact?.dateField || intent.fact?.operation === "duration" ? "По дате завершения — " : "По дате регистрации — ") + prepared.range
      : undefined, overdue, escalated) : undefined;
    const title =
      scope && intent.layout === "list" ? "Заявки · " + scope : primary.title;
    let summary = scope
      ? "Условия отбора: " + scope + ". "
      : "В срезе открытые заявки, включая исследование. ";
    if (!total)
      summary += sourceTotal ? "Совпадений нет." : "Источник пока пуст.";
    else if (intent.layout === "comparison" && primary.groups.length) {
      const [lead, next] = primary.groups;
      summary +=
        lead.label +
        " — " +
        lead.count +
        (next ? ", " + next.label + " — " + next.count : "") +
        ". Всего заявок: " +
        total +
        ".";
    } else
      summary +=
        "Заявок: " +
        total +
        ". Срок прошёл у " +
        overdue +
        ", устранение последствий требуется у " +
        escalated +
        ".";
    if (showSymptoms && total) {
      const themes = [...(semantic?.themes ?? []), ...recurringSymptoms(matches)]
        .sort((a, b) => b.count - a.count || collator.compare(a.label, b.label)).slice(0, 2);
      if (themes.length) {
        summary += " Повторяющиеся проявления — " + themes.map(t => "«" + t.label + "» (" + t.count + " из " + total + ")").join(" и ") +
          ". " + themes[0].check + " Общую причину нужно подтвердить отдельно.";
      } else if (question) summary += " Проверьте исходные формулировки в группах перед объединением заявок.";
      if (semantic) summary += " ИИ сопоставил дополнительные описания в выборке из " + semantic.sampled + " заявок.";
    }
    const result: CanvasResult = {
      ...base,
      ...(semantic && this.client ? { mode: "model", provider: "VseLLM", model: this.client.model } : {}),
      ...(question || briefText
        ? {
            turnToken: this.remember(source, actor, history, {
              question: memoryQuestion ?? "Покажи срез заявок",
              answer: [
                decision.conversation?.text,
                "В предыдущем срезе заявок: " +
                  total +
                  ". Срок прошёл у " +
                  overdue +
                  ", наступал в ближайшие 15 минут у " +
                  soon +
                  ".",
              ]
                .filter(Boolean)
                .join(" "),
            }, { displaySelection: primary.selection }),
          }
        : {}),
      title,
      summary: briefText?.text ?? summary,
      ...(briefText ? { conversation: briefText } : {}),
      total,
      metrics: [
        { key: "total", label: "Заявки", value: total },
        { key: "overdue", label: "Срок прошёл", value: overdue },
        { key: "soon", label: "До 15 минут", value: soon },
        { key: "escalated", label: "Устранение последствий", value: escalated },
      ],
      ...(primary.insights ? { insights: primary.insights } : {}),
      groups: primary.groups,
      tickets: primary.tickets,
      selection: primary.selection,
      blocks,
    };
    const pinned = this.pinned.get(primary.selection);
    if (pinned && result.turnToken && (intent.brief || !result.conversation && canRedrawGroups(intent))) pinned.displayResult = result;
    return result;
  }
}
