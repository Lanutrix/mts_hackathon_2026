import type {
  CanvasConversation,
  CanvasResult,
} from "../../packages/contracts/canvas.ts";
import type { Incident } from "../../packages/domain/index.ts";
import { scrubRehearsalQuestion } from "./operationalAnalysis.ts";
import type { VseLlm } from "./vsellm.ts";

export type DialogueTurn = { question: string; answer: string };
export const trainingCanvas = (ns: string) =>
  ns === "demo" || ns === "simulation";

export function asksForScopeExplanation(question: string) {
  const text = question.toLowerCase().replaceAll("ё", "е").trim();
  return (
    /^(?:(?:и|а|ну|так|итак|расскажи|объясни|поясни)[,\s]+)*(?:что\s+(?:(?:у нас|сейчас|тут|теперь|вообще)\s+)*(?:происходит|горит)(?:\s+(?:прямо сейчас|сейчас|в очереди|с заявками|с инцидентами|на смене))?|как (?:у нас )?дела (?:с заявками|с инцидентами|в очереди))(?:[,\s]+(?:простыми словами|вкратце|коротко|если коротко))?[?!.\s]*$/u.test(
      text,
    ) ||
    /(?:объясни|поясни|опиши|перескажи|резюмируй|суммируй)\s+(?:(?:мне|этот|эту|текущую|текущий|показанный|показанную|весь|всю)\s+)*(?:срез|холст|диаграмму|график|выборку|очередь)(?:\s+(?:словами|простыми словами|вкратце|коротко))?[?!.\s]*$/u.test(
      text,
    )
  );
}

export async function explainScope(
  snapshot: CanvasResult,
  client?: VseLlm,
): Promise<CanvasResult> {
  const counts = Object.fromEntries(
    snapshot.metrics.map((metric) => [metric.key, metric.value]),
  );
  const facts = {
    overdue: "Срок уже прошёл у " + counts.overdue + ".",
    soon: "В ближайшие 15 минут срок наступит у " + counts.soon + ".",
    escalated:
      "Отметку о необходимости устранить последствия имеют " +
      counts.escalated +
      ".",
  };
  type Highlight = keyof typeof facts;
  const fallback: Highlight[] = ["overdue", "soon"];
  let highlight = fallback;
  let model: string | undefined;
  if (client && snapshot.total) {
    const packet = { counts, groupBy: snapshot.intent.groupBy };
    const reply = await client.json(
      "canvas-scope-explanation-1",
      'Ты составляешь краткий разбор уже рассчитанной выборки инцидентов. Из counts выбери два наиболее существенных показателя, предпочтительно с ненулевыми значениями. overdue — просрочены, soon — срок до 15 минут, escalated — нужно устранить последствия после решения. В ответ только JSON {"highlight":["overdue","soon"]}. Не возвращай числа или новые поля.',
      packet,
      6500,
    );
    if ("json" in reply && reply.json && typeof reply.json === "object") {
      const value = reply.json as { highlight?: unknown };
      if (
        Object.keys(value).length === 1 &&
        Array.isArray(value.highlight) &&
        value.highlight.length >= 1 &&
        value.highlight.length <= 2 &&
        value.highlight.every(
          (k): k is Highlight =>
            typeof k === "string" && Object.hasOwn(facts, k),
        )
      ) {
        highlight = [...new Set(value.highlight)];
        model = client.model;
      } else client.rejectJson("canvas-scope-explanation-1", packet);
    }
  }
  const text = snapshot.total
    ? [
        "В этом срезе заявок: " + snapshot.total + ".",
        ...highlight.map((k) => facts[k]),
      ].join(" ")
    : snapshot.sourceTotal
      ? "По текущим условиям не нашлось ни одной заявки."
      : "Источник пока не содержит заявок.";
  return {
    ...snapshot,
    mode: model ? "model" : "fallback",
    provider: model ? "VseLLM" : "Поля ITSM",
    ...(model ? { model } : {}),
    conversation: {
      title: "Что показывает срез",
      text,
      ...(snapshot.total ? { followUp: "Покажи эти заявки списком" } : {}),
    },
  };
}

// Only the user's current wording enters the training prompt. Source records
// are consulted locally to remove identifiers, names and pasted ticket text.
export function trainingQuestion(shaped: string, rows: Incident[]) {
  let text = scrubRehearsalQuestion(shaped)
    .replace(
      /(?:^|\s)@[\p{L}\p{N}_-]+|\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
      " [скрыто]",
    )
    .replace(/\b(?:inc|sim|demo)-[\w-]+\b/giu, "[скрыто]");
  const tokens = [...text.matchAll(/[\p{L}\p{N}_-]+/gu)];
  const hidden = new Set<number>();
  const protectedWords = new Set(tokens.map((m) => m[0]));
  for (const row of rows) {
    for (const key of [
      "sysId",
      "assignedEmployee",
      "assignedEmployeeLogin",
      "initiatorName",
      "initiatorLogin",
      "productId",
      "productMasterId",
      "serviceId",
    ]) {
      const value = row.raw[key];
      if (typeof value !== "string") continue;
      for (const word of value
        .toLowerCase()
        .normalize("NFKC")
        .replaceAll("ё", "е")
        .match(/[\p{L}\p{N}_-]+/gu) ?? []) {
        if (protectedWords.has(word))
          for (const [i, m] of tokens.entries())
            if (m[0] === word) hidden.add(i);
      }
    }
    for (const key of [
      "header",
      "shortDescription",
      "description",
      "solution",
      "scenarioName",
    ]) {
      const value = row.raw[key];
      if (typeof value !== "string" || !value.trim()) continue;
      const words =
        value
          .toLowerCase()
          .normalize("NFKC")
          .replaceAll("ё", "е")
          .match(/[\p{L}\p{N}_-]+/gu) ?? [];
      for (let k = 0; k < words.length; k++) {
        if (!protectedWords.has(words[k])) continue;
        for (const [i, m] of tokens.entries()) {
          if (m[0] !== words[k]) continue;
          let length = 1;
          while (
            i + length < tokens.length &&
            tokens[i + length][0] === words[k + length]
          )
            length++;
          if (
            words.length === 1 ||
            length >= 3 ||
            (k === 0 && length === words.length)
          )
            for (let n = 0; n < length; n++) hidden.add(i + n);
        }
      }
    }
  }
  for (const i of [...hidden].sort((a, b) => b - a)) {
    const token = tokens[i];
    text =
      text.slice(0, token.index) +
      "[скрыто]" +
      text.slice(token.index + token[0].length);
  }
  return text.replace(/(?:\[скрыто\][\s,]*){2,}/gu, "[скрыто] ").trim();
}

const safeProse = (
  value: unknown,
  max: number,
  multiline = false,
): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  (multiline || !/[\r\n]/u.test(value)) &&
  !/[<>\u0000-\u0009\u000b-\u001f]|https?:\/\/|www\.|\b(?:INC|SIM|DEMO)-[\w-]+|\b[ET]\d+\b/iu.test(
    value,
  );

export function readConversation(raw: unknown): CanvasConversation | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const c = raw as Record<string, unknown>;
  if (
    !Object.keys(c).every((k) => ["title", "text", "followUp"].includes(k)) ||
    !safeProse(c.title, 100) ||
    !safeProse(c.text, 1200, true) ||
    (c.followUp !== undefined && !safeProse(c.followUp, 200))
  )
    return;
  const followUp = c.followUp?.trim();
  return {
    title: c.title.trim(),
    text: c.text.replace(/\\n/gu, "\n").trim(),
    ...(followUp &&
    !/^(?:а )?(?:хочешь|хотите|хотел[аи]? бы|нуж(?:ен|на|но) ли тебе)/iu.test(
      followUp,
    )
      ? { followUp }
      : {}),
  };
}
