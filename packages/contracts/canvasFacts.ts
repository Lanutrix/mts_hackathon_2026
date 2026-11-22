export const factPeriods = [
  "snapshot",
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "thisWeek",
  "previousWeek",
  "thisMonth",
  "previousMonth",
  "thisYear",
  "previousYear",
  "dates",
  "rolling",
] as const;
export type FactPeriod = (typeof factPeriods)[number];
export const factOperations = [
  "frequency",
  "distinct",
  "count",
  "duration",
  "recent",
  "statusInterval",
  "relations",
] as const;
export type FactOperation = (typeof factOperations)[number];

export const durationGroups = {
  team: { axis: "Команда", by: "по командам", source: "команда в снимке (assignedGroupName)" },
  symptom: { axis: "Симптом", by: "по симптомам", source: "симптом в тексте заявки или её заголовок" },
  product: { axis: "Продукт", by: "по продуктам", source: "продукт в снимке (productName)" },
  status: { axis: "Статус", by: "по статусам", source: "текущий статус заявки в снимке" },
  priority: { axis: "Приоритет", by: "по приоритетам", source: "приоритет заявки в снимке" },
} as const;
export function isDurationGroup(value: string): value is keyof typeof durationGroups {
  return Object.hasOwn(durationGroups, value);
}

export type FactDisplay = "ring" | "table" | "bars" | "list" | "cards" | "diagram";

export interface FactPlan {
  intervalMeasure?: "median";
  sourceSelection?: string;
  durationCohort?: true;
  durationMeasure?: "individual" | "median" | "mean";
  limit?: number;
  display?: FactDisplay;
  operation: FactOperation;
  period: FactPeriod;
  /** Inclusive calendar days in Europe/Moscow. */
  dateRange?: [string, string];
  /** Minutes since Moscow midnight on one day, start inclusive, end exclusive. */
  clockRange?: [number, number];
  lookbackHours?: number;
  dateField?: "completionDate" | "submitDate";
  ascending?: true;
}
export interface DurationEvidence {
  id: string;
  header: string | null;
  start: string;
  end: string;
  ms: number;
}
export interface RelationNode {
  id: string;
  found: boolean;
  label?: string;
}
export interface RelationEdge {
  from: string;
  to: string;
  kind: "reference" | "similarity";
  evidence: string[];
}
export interface CanvasFact {
  durationSummary?: { measure: "mean" | "median"; valueMs: number | null; measuredCount: number; scopeCount: number };
  statusIntervals?: { meanMs: number | null; medianMs?: number | null; intervalCount: number; ticketCount: number; scopeCount: number };
  statusCounts?: { label: string; count: number; state: number | null }[];
  headline: string;
  method: string;
  notes: string[];
  durations?: DurationEvidence[];
  maxDurationMs?: number;
  nodes?: RelationNode[];
  edges?: RelationEdge[];
}

export function formatFactDuration(ms: number) {
  const rounded = Math.round(ms);
  const minutes = Math.floor(rounded / 60_000);
  const seconds = (rounded % 60_000) / 1000;
  if (minutes === 0) return seconds.toLocaleString("ru-RU") + " с";
  const days = Math.floor(minutes / 1440),
    hours = Math.floor(minutes / 60) % 24;
  return [
    days && days + " д",
    hours && hours + " ч",
    minutes % 60 && (minutes % 60) + " мин",
    seconds && seconds.toLocaleString("ru-RU") + " с",
  ]
    .filter(Boolean)
    .join(" ");
}
