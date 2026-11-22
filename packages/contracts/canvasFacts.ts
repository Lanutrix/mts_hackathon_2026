export const factPeriods = [
  "snapshot",
  "today",
  "yesterday",
  "week",
  "month",
  "year",
] as const;
export type FactPeriod = (typeof factPeriods)[number];
export const factOperations = [
  "frequency",
  "distinct",
  "count",
  "duration",
  "relations",
] as const;
export type FactOperation = (typeof factOperations)[number];

export type FactDisplay = "ring" | "table" | "bars" | "list" | "cards" | "diagram";

export interface FactPlan {
  durationCohort?: true;
  durationMeasure?: "individual" | "median" | "mean";
  limit?: number;
  display?: FactDisplay;
  operation: FactOperation;
  period: FactPeriod;
  dateField?: "completionDate";
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
