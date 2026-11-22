import type {
  CanvasAnswer,
  GuideFocus,
  GuideTopic,
} from "../domain/assistantGuide.ts";
import type { AnswerInsight, AnswerInsightId } from "./answerInsights.ts";
import type { AnswerExhibitId, AnswerPresentation } from "./answerCatalog.ts";
export type { CanvasAnswer } from "../domain/assistantGuide.ts";

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
  excludedTeams?: string[];
  products?: string[];
  ids?: string[];
  symptoms?: string[];
  priorities?: number[];
  states?: number[];
  deadline?: CanvasDeadline;
  escalation?: "yes" | "no" | "unknown";
}
export interface CanvasView {
  presentation?: AnswerPresentation;
  exhibits?: AnswerExhibitId[];
  groupBy: CanvasDimension;
  layout: CanvasLayout;
  weightBy?: CanvasWeight;
}
export interface CanvasIntent extends CanvasView {
  brief?: true;
  briefRank?: CanvasIntent;
  commentDraft?: "deadline" | "progress" | "impact";
  shiftAdvice?: true;
  rankFocus?: { place: number | "last" | "shown"; output: "position" | "count" | "share" | "tickets" };
  fact?: import("./canvasFacts.ts").FactPlan;
  insightIds?: AnswerInsightId[];
  automaticStates?: true;
  topic?: GuideTopic;
  related?: GuideTopic[];
  focus?: GuideFocus;
  guideOnly?: boolean;
  filters: CanvasFilters;
  blocks?: CanvasView[];
}
export interface CanvasTicket {
  duration?: import("./canvasFacts.ts").DurationEvidence;
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
  durationMs?: number;
  key: string;
  label: string;
  count: number;
  overdue: number;
  escalated: number;
}
export interface CanvasBlock extends CanvasView {
  insights?: AnswerInsight[];
  title: string;
  groups: CanvasGroup[];
  tickets: CanvasTicket[];
  selection: string;
}
export interface CanvasConversation {
  title: string;
  text: string;
  sourceIds?: string[];
  followUp?: string;
}
export interface CanvasResult {
  fact?: import("./canvasFacts.ts").CanvasFact;
  conversation?: CanvasConversation;
  turnToken?: string;
  insights?: AnswerInsight[];
  namespace: string;
  revision: number;
  asOf: string;
  answer?: CanvasAnswer;
  mode: "knowledge" | "snapshot" | "model" | "fallback" | "unsupported";
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
