import { canRedrawGroups, formatOnly, groupDisplay, requestedFactDisplay, supportsFactDisplay } from "./factDisplay.ts";
import { randomUUID } from "node:crypto";
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
import { describeFact, prepareFact } from "./canvasFacts.ts";
import { makeAnswer } from "./canvasGuide.ts";
import {
  asksForScopeExplanation,
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
      pendingRelationIds?: string[];
    }
  >();
  constructor(private readonly client?: VseLlm) {}
  private remember(
    source: CanvasSource,
    actor: string,
    history: DialogueTurn[],
    turn?: DialogueTurn,
    state: { displaySelection?: string; pendingRelationIds?: string[] } = {},
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
    namespace: string,
    actor: string,
    all: CanvasTicket[],
    members: Map<string, CanvasTicket[]>,
  ) {
    const now = Date.now();
    // Compound views share a single projection array. Keep their page tokens
    // together even when one source has tens of thousands of tickets.
    const projections = new Set<CanvasTicket[]>([all]);
    let used = all.length;
    for (const [id, entry] of [...this.pinned].reverse()) {
      if (entry.expires <= now) {
        this.pinned.delete(id);
        continue;
      }
      if (projections.has(entry.all)) continue;
      if (used + entry.all.length > 50_000) {
        this.pinned.delete(id);
        continue;
      }
      used += entry.all.length;
      projections.add(entry.all);
    }
    while (this.pinned.size >= 72)
      this.pinned.delete(this.pinned.keys().next().value!);
    const id = randomUUID();
    this.pinned.set(id, {
      namespace,
      actor,
      all,
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
  ): CanvasPage | undefined {
    const source = this.pinned.get(id);
    if (
      !source ||
      source.namespace !== namespace ||
      source.actor !== actor ||
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
    namespace: string,
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
      selection: this.pin(namespace, actor, tickets, members),
    };
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
    if (question && activeTurn?.displaySelection) {
      const pinned = this.pinned.get(activeTurn.displaySelection);
      const result = pinned?.displayResult;
      const display = requestedFactDisplay(question);
      if (pinned && pinned.expires > now && result && display && formatOnly(question, display)) {
        if (result.intent.fact && supportsFactDisplay(result.intent.fact.operation, display))
          return { ...result, intent: { ...result.intent, fact: { ...result.intent.fact, display } } };
        if (canRedrawGroups(result.intent))
          return { ...result, intent: { ...result.intent, ...groupDisplay(display) } };
      }
    }
    if (question && asksForScopeExplanation(question)) {
      const active = { ...(context ?? initialIntent) };
      delete active.topic;
      delete active.related;
      delete active.focus;
      delete active.guideOnly;
      const snapshot = await this.read(source, actor, undefined, active);
      if (snapshot.fact) return snapshot;
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
    const decision: Awaited<ReturnType<typeof planCanvas>> = question
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
    const matches = prepared?.rows ?? scoped.sort(urgent);
    const tickets = matches.map((r) => ticket(r, now));
    const primary = this.block(
      namespace,
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
      const answer = describeFact(intent, prepared, primary.groups, describe(intent.filters));
      const result: CanvasResult = { ...base, ...answer, total: tickets.length, metrics: [], groups: primary.groups,
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
      this.block(namespace, actor, v, matches, tickets, now),
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
