import type { FactDisplay, FactOperation } from "../../packages/contracts/canvasFacts.ts";
import type { CanvasIntent, CanvasView } from "../../packages/contracts/canvas.ts";
import { readVisual } from "./canvasVisuals.ts";

export function supportsFactDisplay(operation: unknown, display: unknown): display is FactDisplay {
  if (operation === "duration") return display === "list" || display === "table" || display === "bars";
  return (operation === "frequency" || operation === "distinct") &&
    (display === "list" || display === "table" || display === "bars" || display === "ring" || display === "cards" || display === "diagram");
}

export function requestedFactDisplay(question: string): FactDisplay | undefined {
  const normalized = question.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");
  const s = normalized.includes(", а ") ? normalized.split(", а ").at(-1)! : normalized;
  // An explicit output format takes priority over a measure such as the share of each group.
  if (/таблиц|таблич/u.test(s)) return "table";
  if (/спис(?:ком|ка|ке|ку)|перечнем/u.test(s)) return "list";
  if (/карточками|плитками/u.test(s)) return "cards";
  if (/кольц|кругов\p{L}*\s+диаграмм|в (?:виде|форме) круга|в процентах|процентное соотношение/u.test(s)) return "ring";
  switch (readVisual(s).presentation) {
    case "flow": return "diagram";
    case "orbit": return "ring";
    case "bars": return "bars";
    case "cards": return "cards";
    case "register": return "list";
    case "compare": return "table";
  }
}

// A change of medium is allowed to reuse a pinned result only if no subject,
// date, state, entity, or new condition remains in the user's request.
const filler = new Set((
  "а и но же это эти те их его тот ту такую самую то самое самый самого теперь затем уже можно можешь ли лучше давай пожалуйста " +
  "в во с на как виде форме по для из этого этот той этой " +
  "сделай сделайте сделаешь сделаем покажи покажите покажешь показать дай выведи отобрази нарисуй построй представь оформи перерисуй преобразуй переключи"
).split(" "));
const formatWord = /^(?:сравнительн|процент|соотношени|круг|результат|данны|выборк|срез|визуализац|формат|таблиц|таблич|спис|перечн|кольц|кругов|диаграмм|схем|дерев|столб|гистограмм|график|полос|карточ|плитк|понч|сектор)\p{L}*$/u;

export function formatOnly(question: string, display: FactDisplay | undefined) {
  if (!display) return false;
  const words = question.toLocaleLowerCase("ru").replaceAll("ё", "е").match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return words.length > 0 && words.every(word => filler.has(word) || formatWord.test(word));
}

const groupFormats = {
  ring: "orbit", table: "compare", list: "register", bars: "bars", cards: "cards", diagram: "flow",
} as const;

export function canRedrawGroups(intent: CanvasIntent) {
  return !intent.fact && !intent.topic && !intent.insightIds?.length &&
    (!intent.weightBy || intent.weightBy === "count") && intent.groupBy !== "ticket" &&
    (intent.layout === "comparison" || intent.layout === "groups");
}

export function groupDisplay(display: FactDisplay): Pick<CanvasView, "layout" | "presentation"> {
  return {
    layout: display === "table" || display === "list" ? "comparison" : "groups",
    presentation: groupFormats[display],
  };
}
