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

export function asksAboutResult(question: string) {
  const text = question.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[,.?!]+/gu, " ").trim().replace(/\s+/gu, " ").replace(/^(?:а |и )/u, "");
  return /^(?:откуда (?:взялись |взяты )?(?:эти |такие )?(?:цифры|числа|данные)|что (?:это|все это) (?:значит|означает)|как (?:ты |вы |это )?(?:посчитал[аи]?|посчитали|посчитано|получил[аи]?|получили)(?:сь)?(?: эти цифры| эти числа| такой результат)?|почему (?:столько|такая цифра))$/u.test(text)
    || /^(?:объясни|поясни|разбери|расшифруй|перескажи) (?:мне )?(?:(?:этот|эту|эти|текущий|текущую) )?(?:результат|ответ|цифры|срез|график|диаграмму|схему|выборку|рейтинг)(?: (?:простыми словами|коротко|вкратце))?$/u.test(text);
}

const share = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });

export function explainFact(result: CanvasResult): CanvasResult {
  const fact = result.fact!, operation = result.intent.fact!.operation;
  let text = fact.headline;
  if (operation === "frequency" && result.intent.rankFocus) {
    text += " Заявки с одинаковым значением объединены в группы. Равное число заявок даёт одно место в рейтинге.";
  } else if (operation === "frequency" && result.intent.fact?.limit && result.total) {
    const shown = result.groups.reduce((sum, group) => sum + group.count, 0);
    text += " Вместе показанные группы составляют " + shown + " из " + result.total + " заявок (" + share.format(shown / result.total) + ").";
  } else if (operation === "frequency" && result.total && result.groups.length) {
    const first = result.groups[0];
    text += " " + (result.groups.filter(g => g.count === first.count).length > 1 ? "На каждую из этих групп приходится " : "На эту группу приходится ")
      + share.format(first.count / result.total) + " заявок с указанным значением в выборке.";
  } else if (operation === "relations") {
    const edges = fact.edges ?? [];
    const reference = edges.find(e => e.kind === "reference");
    const common = edges.find(e => e.kind === "similarity");
    if (reference) text += " В карточке " + reference.from + " есть ссылка на " + reference.to + ".";
    if (common) {
      const traits = common.evidence.map(s => s.replace(/ \([^)]*\) · /u, " — "));
      text += " У " + common.from + " и " + common.to + " совпадают поля. " + traits.join(". ") + ". Причину сбоя по совпадению полей установить нельзя.";
    }
    const missing = fact.nodes?.filter(node => !node.found).map(node => node.id) ?? [];
    if (missing.length) text += " В выборке нет " + missing.join(", ") + ".";
  } else if (operation === "duration" && result.groups.length) {
    text += result.intent.fact?.durationMeasure === "mean"
      ? " В каждой группе сумму длительностей разделили на число завершённых заявок с обеими датами."
      : " Для каждой группы упорядочили длительности решения и взяли срединное значение. При чётном числе заявок взяли среднее двух центральных значений.";
  } else if (operation === "duration" && fact.durations?.length) {
    text += " Для каждой подходящей заявки посчитано время от регистрации до завершения. Учитывались завершённые и закрытые заявки с обеими датами.";
  } else if (operation === "distinct" && result.total) {
    text += " Каждое разное значение учтено один раз, даже если встречается в нескольких заявках.";
  } else if (operation === "count") {
    text += " Каждая заявка, прошедшая условия выборки, учтена один раз.";
    if (result.intent.fact?.dateField === "completionDate")
      text += " Период определён по дате завершения.";
  }
  return { ...result, summary: text, conversation: { title: "Как получился результат", text } };
}

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
