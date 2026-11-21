export const canvasDimensions = [
  "symptom",
  "team",
  "product",
  "priority",
  "deadline",
  "status",
  "escalation",
  "ticket",
] as const;
export type CanvasDimension = (typeof canvasDimensions)[number];
export type CanvasLayout = "groups" | "list" | "comparison";
export const canvasWeights = ["count", "overdue", "escalated"] as const;
export type CanvasWeight = (typeof canvasWeights)[number];
export type CanvasDeadline = "overdue" | "soon" | "normal" | "unset";
export interface CanvasFilters {
  teams?: string[];
  products?: string[];
  ids?: string[];
  symptoms?: string[];
  priorities?: number[];
  states?: number[];
  deadline?: CanvasDeadline;
  escalation?: "yes" | "no" | "unknown";
}
export interface CanvasView {
  groupBy: CanvasDimension;
  layout: CanvasLayout;
  weightBy?: CanvasWeight;
}
export interface CanvasIntent extends CanvasView {
  filters: CanvasFilters;
  blocks?: CanvasView[];
}
export interface CanvasTicket {
  id: string;
  header: string;
  team: string;
  product: string;
  priority: string;
  state: string;
  deadline: string | null;
  overdue: boolean;
  escalated: boolean;
}
export interface CanvasGroup {
  key: string;
  label: string;
  count: number;
  overdue: number;
  escalated: number;
}
export interface CanvasBlock extends CanvasView {
  title: string;
  groups: CanvasGroup[];
  tickets: CanvasTicket[];
  selection: string;
}
export interface CanvasResult {
  namespace: string;
  revision: number;
  asOf: string;
  mode: "snapshot" | "model" | "fallback" | "unsupported";
  provider: string;
  model?: string;
  notice?: string;
  title: string;
  summary: string;
  intent: CanvasIntent;
  metrics: { key: string; label: string; value: number }[];
  groups: CanvasGroup[];
  blocks: CanvasBlock[];
  tickets: CanvasTicket[];
  selection: string;
  total: number;
  sourceTotal: number;
  suggestions: string[];
}
export interface CanvasPage {
  items: CanvasTicket[];
  total: number;
  nextOffset: number | null;
}
