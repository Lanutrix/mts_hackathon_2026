import { spaces, type Incident } from "../../packages/domain/index.ts";
import type {
  CaseAnalysis,
  CaseEvidence,
  TriageCase,
} from "../../packages/domain/triage.ts";
import { MODEL, type AnalysisService } from "./analysis.ts";

const stop = new Set(
  "без был была были для или как над нет она они под при про уже что это эта этот после время через которой которое также чем".split(
    " ",
  ),
);
const terms = (text: string) =>
  (
    text
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .match(/[\p{L}\p{N}]{3,}/gu) ?? []
  )
    .filter((t) => !stop.has(t))
    .map((t) =>
      t.length > 5
        ? t.replace(
            /(?:ами|ями|ого|ому|ой|ей|ов|ам|ям|ах|ях|ые|ая|ую|ом|ем|ы|и|а|я|у|ю|е)$/u,
            "",
          )
        : t,
    );

// An extractive TextRank model. TF-IDF cosine similarity defines the graph
// edges. Personalized PageRank favors sentences close to the case label.
function rank(candidates: CaseEvidence[], label: string) {
  const docs = candidates.map((c) => terms(c.value));
  const frequencies = new Map<string, number>();
  for (const doc of docs)
    for (const term of new Set(doc))
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  function vector(doc: string[]) {
    const result = new Map<string, number>();
    for (const t of doc) result.set(t, (result.get(t) ?? 0) + 1);
    let norm = 0;
    for (const [term, count] of result) {
      const weight =
        (1 + Math.log(count)) *
        (1 + Math.log((docs.length + 1) / ((frequencies.get(term) ?? 0) + 1)));
      result.set(term, weight);
      norm += weight * weight;
    }
    for (const [term, weight] of result)
      result.set(term, weight / Math.sqrt(norm));
    return result;
  }
  const vectors = docs.map(vector);
  const query = vector(terms(label));
  const dot = (a: Map<string, number>, b: Map<string, number>) => {
    let sum = 0;
    for (const [t, w] of a) sum += w * (b.get(t) ?? 0);
    return sum;
  };
  const prior = vectors.map((v) => 1 + dot(v, query));
  const sumPrior = prior.reduce((a, b) => a + b, 0);
  const bias = prior.map((p) => p / sumPrior);
  const graph = vectors.map((v, i) =>
    vectors.map((u, j) => (i === j ? 0 : dot(v, u))),
  );
  const out = graph.map((edges) => edges.reduce((a, b) => a + b, 0));
  let scores = [...bias];
  for (let step = 0; step < 20; step++) {
    const next = bias.map((p) => 0.15 * p);
    for (let i = 0; i < scores.length; i++) {
      for (let j = 0; j < scores.length; j++)
        next[j] += 0.85 * scores[i] * (out[i] ? graph[i][j] / out[i] : bias[j]);
    }
    scores = next;
  }
  return scores
    .map((score, i) => ({ score, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.i);
}

function passages(rows: Incident[]) {
  const candidates: CaseEvidence[] = [];
  // Spread coverage across the queue, always including the two endpoints.
  const sampleSize = Math.min(rows.length, 20);
  for (let i = 0; i < sampleSize; i++) {
    const r =
      rows[
        sampleSize === 1
          ? 0
          : Math.floor((i * (rows.length - 1)) / (sampleSize - 1))
      ];
    for (const field of ["description", "header"]) {
      const before = candidates.length;
      const raw = r.raw[field];
      if (typeof raw !== "string") continue;
      const sentences =
        raw
          .slice(0, 3000)
          .replace(/<[^>]*>/gu, " ")
          .match(/[^.!?\n]+[.!?]?/gu) ?? [];
      for (const sentence of sentences.slice(0, 4)) {
        const value = sentence.trim().slice(0, 350);
        if (
          terms(value).length < 2 ||
          /^Синтетический инцидент \d+\.?$/iu.test(value)
        )
          continue;
        candidates.push({ id: r.id, field, value });
      }
      if (candidates.length !== before) break;
    }
  }
  return { candidates, sampleSize };
}

export async function analyzeCase(
  c: TriageCase,
  rows: Incident[],
  service?: AnalysisService,
): Promise<CaseAnalysis> {
  const { candidates, sampleSize } = passages(rows);
  const base: CaseAnalysis = {
    mode: "fallback",
    summary: [],
    evidence: [],
    model: "",
    provider: "Локальная обработка",
    inputRevision: c.revision,
    inputHash: c.hash,
    sampled: sampleSize,
    stale: false,
    uncertainties: [
      "Общая причина и число затронутых пользователей требуют подтверждения.",
    ],
  };
  if (sampleSize < c.count)
    base.uncertainties.push(
      "Текстовый разбор охватывает " +
        sampleSize +
        " из " +
        c.count +
        " заявок из разных частей очереди.",
    );
  if (!candidates.length)
    return {
      ...base,
      summary: [c.recommendation],
      evidence: c.evidence,
      error: "Недостаточно текста для выделения признаков.",
    };
  const ranked = rank(candidates, c.label);
  // Keep the neural shortlist diverse across tickets and repeated boilerplate.
  const shortlist: CaseEvidence[] = [];
  const seenText = new Set<string>();
  const seenTickets = new Set<string>();
  for (const i of ranked) {
    const e = candidates[i];
    if (seenTickets.has(e.id) || seenText.has(e.value)) continue;
    shortlist.push(e);
    seenText.add(e.value);
    seenTickets.add(e.id);
    if (shortlist.length === 12) break;
  }
  if (shortlist.length === 1) {
    const other = ranked
      .map((i) => candidates[i])
      .find((e) => !seenText.has(e.value));
    if (other) shortlist.push(other);
  }
  let evidence = shortlist.slice(0, 2);
  let model = "TF-IDF · TextRank";
  let provider = "Локальный экстрактивный анализ";
  if (service) {
    const selected = await service.rankCase(
      shortlist.map((e) => e.value),
      "Какие общие признаки наблюдаются в группе " + c.label + "?",
    );
    if (selected) {
      evidence = selected.map((i) => shortlist[i]);
      model = MODEL;
      provider = "Локальный ONNX Runtime (CPU)";
    }
  }
  return {
    ...base,
    mode: "model",
    model,
    provider,
    evidence,
    summary: [
      { field: "productName", name: c.product, label: "Продукт" },
      { field: "assignedGroupName", name: c.team, label: "Исполняющая группа" },
    ].flatMap(({ field, name, label }) => {
      if (!name || name === c.label) return [];
      const count = rows.filter(
        (row) => spaces(row.raw[field]) === name,
      ).length;
      return count > 1 && count * 2 >= rows.length
        ? [
            label +
              " «" +
              name +
              "» указан" +
              (field === "productName" ? "" : "а") +
              " в " +
              count +
              " из " +
              rows.length +
              " тикетов.",
          ]
        : [];
    }),
  };
}
