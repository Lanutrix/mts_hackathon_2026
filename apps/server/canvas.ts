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
import { initialIntent, planCanvas } from "./canvasPlan.ts";
import { buildAnswerInsights } from "./answerInsights.ts";
import { shiftAnswer, shiftIntent, shiftQuestion } from "./canvasShift.ts";
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
export class CanvasService {
  private readonly pinned = new Map<string, PinnedSelection>();
  private readonly turns = new Map<
    string,
    {
      namespace: string;
      actor: string;
      run?: string;
      expires: number;
      history: DialogueTurn[];
      displaySelection?: string;
      rankingSelection?: string;
      rankPlace?: RankFocus["place"];
      pendingRelationIds?: string[];
    }
  >();
  constructor(private readonly client?: VseLlm) {}
  private remember(
    source: CanvasSource,
    actor: string,
    history: DialogueTurn[],
    turn?: DialogueTurn,
    state: { displaySelection?: string; pendingRelationIds?: string[]; rankingSelection?: string; rankPlace?: RankFocus["place"] } = {},
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
  ): CanvasBlock {
    const members = new Map<string, CanvasTicket[]>();
    const groups: CanvasGroup[] = [];
    if (view.layout !== "list") {
      const buckets = new Map<
        string,
        { label: string; items: CanvasTicket[] }
      >();
      for (let i = 0; i < rows.length; i++) {
        const { key, label } = partition(rows[i], view.groupBy, now);
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
        groups.push({
          key,
          label,
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
  async read(
    source: CanvasSource,
    actor: string,
    question?: string,
    context?: CanvasIntent,
    turnToken?: string,
  ): Promise<CanvasResult> {
    const { namespace, revision } = source;
    const now = Date.now();
    const prior = turnToken && this.turns.get(turnToken);
    const activeTurn = prior && prior.namespace === namespace && prior.actor === actor &&
      prior.run === source.simulation?.runId && prior.expires > now ? prior : undefined;
    const history = activeTurn?.history ?? [];
    const displayed = activeTurn?.displaySelection ? this.pinned.get(activeTurn.displaySelection) : undefined;
    const focused = displayed && displayed.expires > now ? displayed : undefined;
    const advice = focused?.shift;
    const shift = question ? shiftQuestion(question, !!advice) : context?.shiftAdvice ? "recommend" : undefined;
    const rankedSelection = activeTurn?.rankingSelection ?? activeTurn?.displaySelection;
    const rankedProjection = rankedSelection ? this.pinned.get(rankedSelection) : undefined;
    const ranking = rankedProjection && rankedProjection.expires > now && isGroupRanking(rankedProjection.displayResult?.intent)
      ? rankedProjection.displayResult : undefined;
    let rankMemberIds: Set<string> | undefined;
    if (shift === "recommend" && context?.rankFocus) {
      const { shiftAdvice: _advice, ...rankContext } = context;
      const members = focused &&
        (focused.displayResult?.intent.rankFocus || focused.shift?.result.intent.rankFocus)
        ? focused : this.pinned.get((await this.read(source, actor, undefined, rankContext)).selection);
      rankMemberIds = new Set(members?.all.map(ticket => ticket.id));
    }
    if (!question && context?.rankFocus && !shift) {
      const base = await this.read(source, actor, undefined, rankingIntent(context));
      const projection = this.pinned.get(base.selection);
      if (projection) projection.displayResult = base;
      return this.rankReply(source, actor, history, context.rankFocus, base);
    }
    const rankRequest = question && readRankRequest(question, !!activeTurn?.rankPlace);
    if (rankRequest && (ranking || rankRequest.place || isGroupRanking(context) || context?.rankFocus || !context))
      return this.rankReply(source, actor, history, rankRequest, ranking, activeTurn?.rankPlace);
    if (context?.rankFocus && !shift) context = ranking?.intent ?? rankingIntent(context);
    if (question && context?.shiftAdvice) {
      context = { ...context };
      delete context.shiftAdvice;
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
    const matches = prepared?.rows ?? scoped.sort(urgent);
    const tickets = matches.map((r) => ticket(r, now));
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
    );
    if (intent.fact && prepared) {
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
    const result: CanvasResult = {
      ...base,
      ...(question
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
      summary,
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
    if (pinned && result.turnToken && !result.conversation && canRedrawGroups(intent)) pinned.displayResult = result;
    return result;
  }
}
