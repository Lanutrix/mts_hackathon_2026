import {serviceFilterId,sourceServiceTypeId} from "../contracts/serviceType.ts";
import { liveStep, type LiveStep } from "./liveStep.ts";
import { knownSymptom, recurringSymptoms, type SymptomEvidence, type SymptomTheme } from "./symptoms.ts";
import { compareResponse, responseBands, responseRank } from "./responseOrder.ts";
import { compareTickets } from "./ticketOrder.ts";
import type { PlatformIcon } from "./platformIcons.ts";
export { knownSymptom } from "./symptoms.ts";
import {
  deadlineStatus,
  GROUPS,
  hash,
  PRIORITIES,
  spaces,
  type Group,
  type Incident,
} from "./index.ts";

export const GROUP_BY = ["semantic", "response", "symptom", "symptomProduct", "priority", "product", "team"] as const;
export type GroupBy = (typeof GROUP_BY)[number];
export type Signal = Group | "all";
export type CaseEvidence = SymptomEvidence;
export interface TriageCase {
  id: string;
  label: string;
  origin?: "model" | "local";
  icon?: PlatformIcon;
  count: number;
  hash: string;
  revision: number;
  lead: { id: string; header: string; groups: Group[]; revision: number };
  topId: string;
  highestPriorityId: number | null;
  highestPriorityLabel: string;
  priorities: Record<string, number>;
  overdue: number;
  soon: number;
  deadlineMissing: number;
  earliestDeadline: string | null;
  escalations: number;
  escalationUnknown: number;
  unverified: number;
  team: string | null;
  product: string | null;
  responseRank?: number;
  recommendation: string;
  recommendationId: string;
  step: LiveStep;
  evidence: CaseEvidence[];
  themes: SymptomTheme[];
}
export interface Triage {
  groupBy: GroupBy;
  unique: number;
  overdue: number;
  escalations: number;
  cases: TriageCase[];
  tracking?: TriageCase["lead"] | null;
  nextChangeAt: number | null;
  liveFocus?: { caseId: string; step: LiveStep } | null;
  modelGuidance?: boolean;
}
export type DashboardFacets = { product: string[]; team: string[]; symptom: string[] };
export function dashboardFacets(rows: Incident[]): DashboardFacets {
  const visible = rows.filter(r => r.groups.length);
  const values = (field: (r: Incident) => string) =>
    [...new Set(visible.map(field).filter(Boolean))].sort(compareText);
  return {product: values(r => spaces(r.raw.productName)), team: values(r => spaces(r.raw.assignedGroupName)),
    symptom: values(r => knownSymptom(r)?.label ?? "")};
}
export interface CaseAnalysis {
  semantic?: { sampled: number; themes: SymptomTheme[] };
  mode: "model" | "fallback";
  summary: string[];
  evidence: CaseEvidence[];
  uncertainties: string[];
  model: string;
  provider: string;
  inputRevision: number;
  inputHash: string;
  stale: boolean;
  error?: string;
  sampled: number;
}
export function grouping(q: Record<string, string>) {
  const groupBy = q.groupBy ?? (q.register === "1" ? "semantic" : "symptom");
  const signal = q.signal ?? "all";
  if (
    !GROUP_BY.includes(groupBy as GroupBy) ||
    (signal !== "all" && !GROUPS.includes(signal as Group))
  )
    throw new Error("Неизвестная группировка или выборка");
  return { groupBy: groupBy as GroupBy, signal: signal as Signal };
}

export function filterDashboard(
  rows: Incident[],
  q: Record<string, string>,
  now = Date.now(),
): Incident[] {
  const search = (q.q ?? "").toLocaleLowerCase("ru").slice(0, 300);
  return rows.filter(
    (r) =>
      (!q.band || responseBands[responseRank(r, now)].key === q.band) &&
      (!q.product || spaces(r.raw.productName) === q.product) &&
      (!q.team || spaces(r.raw.assignedGroupName) === q.team) &&
      (!q.priority || String(r.priorityId) === q.priority) &&
      (!q.symptom || knownSymptom(r)?.label === q.symptom) &&
      (!search ||
        [r.id, r.raw.header, r.raw.productName, r.team, r.raw.assignedEmployee]
          .join(" ")
          .toLocaleLowerCase("ru")
          .includes(search)) &&
      (!q.service ||
        sourceServiceTypeId(r.raw.serviceTypeId, r.raw.serviceType) === serviceFilterId(q.service)) &&
      (!q.up || r.raw.isNeedUp === true),
  );
}

export function sortTickets(rows: Incident[], sort?: string, now = Date.now()) {
  if (sort === "response") return rows.sort((a, b) => compareResponse(a, b, now));
  return rows.sort((a, b) => compareTickets(a, b, sort));
}

const norm = (s: string) => s.toLocaleLowerCase("ru").normalize("NFKC");
export type Facet = { key: string; label: string; field: string; icon?: PlatformIcon; origin?: "model" | "local" };
export function facet(r: Incident, groupBy: GroupBy, now = Date.now()): Facet {
  if (groupBy === "response") return responseBands[responseRank(r, now)];
  if (groupBy === "symptomProduct") {
    const symptom = facet(r, "symptom"), product = facet(r, "product");
    return { key: JSON.stringify([symptom.key, product.key]), label: symptom.label + " · " + product.label, field: symptom.field };
  }
  if (groupBy === "priority")
    return {
      key: String(r.priorityId),
      label: r.priorityLabel,
      field: "priorityId",
    };
  if (groupBy === "product" || groupBy === "team") {
    const field = groupBy === "team" ? "assignedGroupName" : "productName";
    const value = spaces(r.raw[field]);
    return {
      key: norm(value),
      label:
        value ||
        (groupBy === "team" ? "Команда не указана" : "Продукт не указан"),
      field,
    };
  }
  // Prefer the reporter's headline. A stock description can mention a second
  // symptom (or merely a check) that is not the subject of this ticket.
  const symptom = knownSymptom(r);
  if (symptom) return { key: "signal:" + symptom.label, label: symptom.label, field: symptom.field };
  const header = spaces(r.raw.header);
  return {
    key: header ? "header:" + norm(header) : "unknown",
    label: header || "Признак не определён",
    field: "header",
  };
}

const collator = new Intl.Collator("ru", { numeric: true });
const compareText = (a: string, b: string) =>
  collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const byTime = (r: Incident) => r.dates.deadline ?? "\uffff";
// Within a priority: first the earliest deadline, then flagged follow-up work.
// Absolute deadlines give the same ticket order on every page of a revision.
export function urgent(a: Incident, b: Incident) {
  return (
    (b.priorityId ?? 0) - (a.priorityId ?? 0) ||
    compareText(byTime(a), byTime(b)) ||
    Number(b.raw.isNeedUp === true) - Number(a.raw.isNeedUp === true) ||
    compareText(a.id, b.id) ||
    compareText(a.key, b.key)
  );
}

function mostCommon(rows: Incident[], field: string) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const value = spaces(r.raw[field]);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return (
    [...counts.keys()].sort(
      (a, b) => counts.get(b)! - counts.get(a)! || compareText(a, b),
    )[0] ?? null
  );
}

function summarizeCase(
  id: string,
  signal: Facet,
  groupBy: GroupBy,
  rows: Incident[],
  revision: number,
  now: number,
): TriageCase {
  const lead = rows[0];
  const priorities: Record<string, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    unknown: 0,
  };
  let overdue = 0,
    soon = 0,
    deadlineMissing = 0,
    escalations = 0,
    escalationUnknown = 0,
    unverified = 0;
  let earliest: Incident | undefined;
  let firstEscalation: Incident | undefined;
  for (const r of rows) {
    priorities[r.priorityId ?? "unknown"]++;
    const deadline = deadlineStatus(r.dates.deadline, now);
    if (deadline === "overdue") overdue++;
    if (deadline === "soon") soon++;
    if (deadline === "unset") deadlineMissing++;
    if (
      r.dates.deadline &&
      (!earliest || r.dates.deadline < earliest.dates.deadline!)
    )
      earliest = r;
    if (r.raw.isNeedUp === true) {
      escalations++;
      firstEscalation ??= r;
    }
    if (r.raw.isNeedUp == null) escalationUnknown++;
    if (!r.sourcePresent) unverified++;
  }
  const evidence: CaseEvidence[] = [];
  function cite(r: Incident, field: string) {
    if (evidence.some((e) => e.id === r.id && e.field === field)) return;
    const value = field === "sourcePresent" ? r.sourcePresent : r.raw[field];
    evidence.push({
      id: r.id,
      field,
      value: value == null ? "Не указано" : String(value).slice(0, 360),
    });
  }
  cite(lead, signal.field);
  if (groupBy === "symptomProduct") cite(lead, "productName");
  cite(lead, "priorityId");
  const target = groupBy === "response" || groupBy === "semantic" ? lead : (overdue || soon ? earliest : undefined) ?? firstEscalation
    ?? (deadlineMissing ? rows.find((row) => !row.dates.deadline) : undefined) ?? lead;
  const step = liveStep(target, now, { count: rows.length, overdue, soon });
  cite(target, step.evidence.field);
  return {
    id,
    label: signal.label,
    ...(signal.icon ? { icon: signal.icon, origin: signal.origin } : {}),
    ...(groupBy === "response" ? { responseRank: responseRank(lead, now) } : {}),
    count: rows.length,
    hash: hash([...(signal.origin ? [signal.label, signal.icon, signal.origin] : []), ...rows.map((r) => [r.key, r.hash, r.sourcePresent])]),
    revision,
    lead: {
      id: lead.id,
      header: spaces(lead.raw.header),
      groups: lead.groups,
      revision: lead.revision,
    },
    topId: lead.id,
    highestPriorityId: lead.priorityId,
    highestPriorityLabel:
      lead.priorityId === null ? "Неизвестен" : PRIORITIES[lead.priorityId],
    priorities,
    overdue,
    soon,
    deadlineMissing,
    earliestDeadline: earliest?.dates.deadline ?? null,
    escalations,
    escalationUnknown,
    unverified,
    team: mostCommon(rows, "assignedGroupName"),
    product: mostCommon(rows, "productName"),
    recommendation: target.id + " · " + step.action + " " + step.basis,
    recommendationId: target.id,
    step,
    evidence,
    themes: recurringSymptoms(rows),
  };
}

export function buildTriage(
  rows: Incident[],
  groupBy: GroupBy,
  revision: number,
  now: number,
  signal: Signal = "all",
  classify: (row: Incident) => Facet = row => facet(row, groupBy, now),
) {
  const seen = new Set<string>();
  const buckets = new Map<string, Incident[]>();
  let nextChangeAt: number | null = null;
  for (const r of rows) {
    if (
      !r.groups.length ||
      (signal !== "all" && !r.groups.includes(signal)) ||
      seen.has(r.key)
    )
      continue;
    seen.add(r.key);
    if (r.dates.deadline) {
      const end = Date.parse(r.dates.deadline);
      const soon = end - 15 * 60_000;
      const boundary = soon > now ? soon : end + 1;
      if (boundary > now && (nextChangeAt === null || boundary < nextChangeAt))
        nextChangeAt = boundary;
    }
    const key = classify(r).key;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }
  const members = new Map<string, Incident[]>();
  const cases: TriageCase[] = [];
  for (const [key, rows] of buckets) {
    if (groupBy === "response" || groupBy === "semantic") sortTickets(rows, "response", now);
    else rows.sort(urgent);
    const id = hash([groupBy, key]).slice(0, 24);
    cases.push(summarizeCase(id, classify(rows[0]), groupBy, rows, revision, now));
    members.set(id, rows);
  }
  cases.sort(
    (a, b) =>
      (a.responseRank ?? 0) - (b.responseRank ?? 0) ||
      (b.highestPriorityId ?? 0) - (a.highestPriorityId ?? 0) ||
      b.overdue - a.overdue ||
      b.soon - a.soon ||
      b.escalations - a.escalations ||
      compareText(
        a.earliestDeadline ?? "\uffff",
        b.earliestDeadline ?? "\uffff",
      ) ||
      b.count - a.count ||
      compareText(a.label, b.label) ||
      compareText(a.id, b.id),
  );
  return {
    groupBy,
    nextChangeAt,
    unique: seen.size,
    overdue: cases.reduce((n, c) => n + c.overdue, 0),
    escalations: cases.reduce((n, c) => n + c.escalations, 0),
    cases,
    members,
  };
}
