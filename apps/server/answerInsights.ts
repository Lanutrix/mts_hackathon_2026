import type { Incident } from "../../packages/domain/index.ts";
import {
  answerInsightIds,
  insightDefinitions,
  type AnswerInsight,
  type AnswerInsightId,
  type InsightPoint,
} from "../../packages/contracts/answerInsights.ts";
import { insightPhrases } from "./insightPhrases.ts";

const minute = 60_000,
  hour = 60 * minute,
  day = 24 * hour;
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
function words(text: string) {
  return text
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
// Match whole Russian words with case endings removed. Keep the original
// unmatched words because the planner still needs product names and filters.
function stem(token: string) {
  if (token.length < 4) return token;
  const base = token.replace(
    /(?:иями|ами|ями|ого|его|ому|ему|ыми|ими|ая|яя|ую|юю|ые|ие|ый|ий|ой|ых|их|ым|им|ом|ем|ах|ях|ов|ев|ам|ям|а|я|у|ю|е|ы|и|о)$/u,
    "",
  );
  return base.length >= 3 ? base : token;
}
const queries = answerInsightIds
  .flatMap((id) =>
    [insightDefinitions[id].title, ...insightPhrases[id]].map((phrase) => ({
      id,
      tokens: words(phrase).split(" ").map(stem),
      length: phrase.length,
    })),
  )
  .sort((a, b) => b.tokens.length - a.tokens.length || b.length - a.length);
export function readAnswerInsightRequest(question: string): {
  ids: AnswerInsightId[];
  rest: string;
} {
  const raw = words(question).split(" "),
    tokens = raw.map(stem),
    used = new Set<number>();
  const found: { id: AnswerInsightId; at: number }[] = [];
  for (const query of queries) {
    for (let i = 0; i <= tokens.length - query.tokens.length; i++) {
      if (
        !query.tokens.every(
          (word, k) => !used.has(i + k) && tokens[i + k] === word,
        )
      )
        continue;
      if (!found.some((f) => f.id === query.id))
        found.push({ id: query.id, at: i });
      for (let k = 0; k < query.tokens.length; k++) used.add(i + k);
    }
  }
  return {
    ids: found
      .sort((a, b) => a.at - b.at)
      .slice(0, 3)
      .map((r) => r.id),
    rest: raw.filter((_, i) => !used.has(i)).join(" "),
  };
}
export function selectAnswerInsightIds(question: string): AnswerInsightId[] {
  return readAnswerInsightRequest(question).ids;
}
const normalized = (i: Incident, field: string) =>
  typeof i.raw[field] === "string" ? String(i.raw[field]).trim() : "";
const date = (i: Incident, field: string) => Date.parse(i.dates[field] ?? "");
const open = (r: Incident) =>
  r.stateId === 0 || r.stateId === 2 || r.stateId === 20;
const finished = (r: Incident) => r.stateId === 7 || r.stateId === 10;
const overdue = (r: Incident, now: number) =>
  open(r) && date(r, "deadline") < now;
function elapsed(ms: number) {
  if (ms < minute) return "< 1 мин";
  const minutes = Math.floor(ms / minute);
  if (minutes < 60) return minutes + " мин";
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return Math.floor(hours / 24) + " д " + (hours % 24) + " ч";
  return hours + " ч" + (minutes % 60 ? " " + (minutes % 60) + " мин" : "");
}
const durations: Record<string, (r: Incident, t: number) => number> = {
  age: (r, t) => (open(r) ? t - date(r, "submitDate") : NaN),
  late: (r, t) => (overdue(r, t) ? t - date(r, "deadline") : NaN),
  remaining: (r, t) => (open(r) ? date(r, "deadline") - t : NaN),
  assignmentLag: (r) =>
    date(r, "lastAssignmentToTeamDateTime") - date(r, "submitDate"),
  teamAge: (r, t) =>
    open(r) ? t - date(r, "lastAssignmentToTeamDateTime") : NaN,
  resolution: (r) =>
    finished(r) ? date(r, "completionDate") - date(r, "submitDate") : NaN,
  budget: (r) => date(r, "deadline") - date(r, "submitDate"),
  finishedLate: (r) =>
    finished(r) && date(r, "completionDate") > date(r, "deadline")
      ? date(r, "completionDate") - date(r, "deadline")
      : NaN,
  finishedEarly: (r) =>
    finished(r) ? date(r, "deadline") - date(r, "completionDate") : NaN,
  waiting: (r, t) => (open(r) ? date(r, "waitingExitDate") - t : NaN),
};
type Check = (r: Incident, t: number) => boolean;
const checks: Record<string, Check> = {
  unowned: (r) =>
    !normalized(r, "assignedEmployee") &&
    !normalized(r, "assignedEmployeeLogin"),
  unteamed: (r) => !normalized(r, "assignedGroupName"),
  noDeadline: (r) => open(r) && !Number.isFinite(date(r, "deadline")),
  noDescription: (r) =>
    !normalized(r, "description") && !normalized(r, "shortDescription"),
  noProduct: (r) => !normalized(r, "productName"),
  noService: (r) => !normalized(r, "service"),
  lowLate: (r, t) => r.priorityId === 1 && overdue(r, t),
  noChannel: (r) => !normalized(r, "receivingChannel"),
  noImpact: (r) => !normalized(r, "impact") && r.raw.impactId == null,
  noUrgency: (r) => !normalized(r, "urgency") && r.raw.urgencyId == null,
  noCompletion: (r) =>
    finished(r) && !Number.isFinite(date(r, "completionDate")),
  noSolution: (r) => finished(r) && !normalized(r, "solution"),
  issues: (r) => r.issues.length > 0,
  dateOrder: (r) =>
    date(r, "completionDate") < date(r, "submitDate") ||
    date(r, "deadline") < date(r, "submitDate") ||
    date(r, "lastAssignmentToTeamDateTime") < date(r, "submitDate"),
  unknownEscalation: (r) => r.raw.isNeedUp == null,
  lateEscalated: (r, t) => overdue(r, t) && r.raw.isNeedUp === true,
  criticalUnowned: (r, t) =>
    r.groups.includes("critical") && checks.unowned(r, t),
  lateUnowned: (r, t) => overdue(r, t) && checks.unowned(r, t),
  researchLate: (r, t) => r.stateId === 20 && overdue(r, t),
  assigned: (r) => r.stateId === 0,
  reusedSolution: (r) => open(r) && !!normalized(r, "solution"),
  finishedOnTime: (r) => date(r, "completionDate") <= date(r, "deadline"),
  hasOwner: (r, t) => !checks.unowned(r, t),
  hasDeadline: (r) => Number.isFinite(date(r, "deadline")),
  knownEscalation: (r) => typeof r.raw.isNeedUp === "boolean",
};
function tally(items: InsightPoint[], label: string, r: Incident) {
  const point = items.find((p) => p.label === label);
  if (point) {
    point.value++;
    point.ticket ??= r.id;
  }
}
function noMeasure(id: AnswerInsightId, note: string): AnswerInsight {
  return { id, value: "Нет данных", note, points: [] };
}
const bins = ["До 15 мин", "15 мин – 1 ч", "1–4 ч", "4–24 ч", "От суток"];
function intervalResult(
  id: AnswerInsightId,
  rows: Incident[],
  now: number,
): AnswerInsight {
  const { kind, source } = insightDefinitions[id];
  const series = rows
    .map((r) => ({ id: r.id, ms: durations[source](r, now) }))
    .filter((v) => Number.isFinite(v.ms) && v.ms >= 0)
    .sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
  const n = series.length;
  if (!n) return noMeasure(id, "В выборке нет заявок с подходящими датами.");
  const points: InsightPoint[] = bins.map((label) => ({ label, value: 0 }));
  for (const item of series) {
    const bucket =
      item.ms < 15 * minute
        ? 0
        : item.ms < hour
          ? 1
          : item.ms < 4 * hour
            ? 2
            : item.ms < day
              ? 3
              : 4;
    points[bucket].value++;
    points[bucket].ticket ??= item.id;
  }
  const sum = series.reduce((t, e) => t + e.ms, 0);
  const middle =
    (series[Math.floor((n - 1) / 2)].ms + series[Math.floor(n / 2)].ms) / 2;
  const statistic =
    kind === "max"
      ? series[n - 1].ms
      : kind === "minimum"
        ? series[0].ms
        : kind === "p90"
          ? series[Math.ceil(n * 0.9) - 1].ms
          : kind === "sum"
            ? sum
            : kind === "mean"
              ? sum / n
              : middle;
  const example = series.reduce((a, b) =>
    Math.abs(a.ms - statistic) <= Math.abs(b.ms - statistic) ? a : b,
  );
  return {
    id,
    value: kind === "bands" ? number.format(n) : elapsed(statistic),
    note:
      "Подходящие даты у " +
      number.format(n) +
      " из " +
      number.format(rows.length) +
      " заявок.",
    points,
    evidence: example.id,
  };
}
function partitionResult(
  id: AnswerInsightId,
  rows: Incident[],
  now: number,
): AnswerInsight {
  const { kind, source } = insightDefinitions[id];
  let population = rows;
  if (source === "finishedOnTime")
    population = rows.filter(
      (r) =>
        finished(r) &&
        Number.isFinite(date(r, "deadline")) &&
        Number.isFinite(date(r, "completionDate")),
    );
  if (!population.length)
    return noMeasure(
      id,
      source === "finishedOnTime"
        ? "Нет завершённых заявок с обеими датами."
        : "Выборка пуста.",
    );
  const check = checks[source] ?? ((r: Incident) => r.raw[source] === true);
  const yes = population.filter((r) => check(r, now)),
    other = population.find((r) => !check(r, now)),
    pct = (100 * yes.length) / population.length;
  const value =
    kind === "ratio" ? number.format(pct) + " %" : number.format(yes.length);
  return {
    id,
    value,
    note:
      kind === "ratio"
        ? number.format(yes.length) +
          " из " +
          number.format(population.length) +
          " заявок."
        : "В выборке " + number.format(population.length) + " заявок.",
    points: [
      { label: "Соответствуют", value: yes.length, ticket: yes[0]?.id },
      {
        label: "Остальные",
        value: population.length - yes.length,
        ticket: other?.id,
      },
    ],
    evidence: yes[0]?.id,
  };
}
function distributionResult(
  id: AnswerInsightId,
  rows: Incident[],
  now: number,
): AnswerInsight {
  const { source, kind } = insightDefinitions[id];
  let population = rows,
    fields: string[] = source.split(",");
  if (source === "lateTeams") {
    population = rows.filter((r) => overdue(r, now));
    fields = ["assignedGroupName"];
  }
  if (source === "raisedTeams" || source === "raisedProducts") {
    population = rows.filter((r) => r.raw.isNeedUp === true);
    fields = [source === "raisedTeams" ? "assignedGroupName" : "productName"];
  }
  if (source === "criticalOwners") {
    population = rows.filter((r) => r.groups.includes("critical"));
    fields = ["assignedEmployee"];
  }
  if (!population.length)
    return noMeasure(id, "В выбранной группе нет обращений.");
  const groups = new Map<string, InsightPoint>();
  for (const row of population) {
    const parts = fields.map(
      (f) =>
        normalized(row, f) ||
        (f === "assignedEmployee"
          ? normalized(row, "assignedEmployeeLogin")
          : "") ||
        "Не указано",
    );
    const key = JSON.stringify(parts),
      old = groups.get(key);
    if (old) old.value++;
    else
      groups.set(key, { label: parts.join(" → "), value: 1, ticket: row.id });
  }
  const ranked = [...groups.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label, "ru"),
  );
  const leading = ranked.slice(0, 5);
  if (ranked.length > 5)
    leading.push({
      label: "Остальные",
      value: ranked.slice(5).reduce((n, p) => n + p.value, 0),
    });
  return {
    id,
    value: number.format(ranked.length),
    note:
      kind === "relation"
        ? "Сочетания полей одной заявки · " +
          number.format(population.length) +
          " заявок."
        : "Группы по данным " + number.format(population.length) + " заявок.",
    points: leading,
    evidence: ranked[0]?.ticket,
  };
}
function timelineResult(
  id: AnswerInsightId,
  rows: Incident[],
  now: number,
): AnswerInsight {
  const { source } = insightDefinitions[id];
  const moscowDay = (t: number) => Math.floor((t + 3 * hour) / day);
  const today = moscowDay(now),
    future = source === "dueDays",
    days =
      source === "registrationDays" || source === "completionDays" || future;
  const field =
    source === "completionDays"
      ? "completionDate"
      : future
        ? "deadline"
        : "submitDate";
  const eligible = rows.filter((r) =>
    future ? open(r) : source === "completionDays" ? finished(r) : true,
  );
  if (eligible.length && !eligible.some((r) => Number.isFinite(date(r, field))))
    return noMeasure(
      id,
      "В подходящих заявках не заполнены даты для этого графика.",
    );
  const labels = days
    ? Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat("ru-RU", {
          timeZone: "UTC",
          day: "2-digit",
          month: "2-digit",
        }).format((today + (future ? i : i - 6)) * day),
      )
    : source === "weekdays"
      ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : source === "shifts"
        ? ["08–20", "20–08"]
        : ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];
  const points: InsightPoint[] = labels.map((label) => ({ label, value: 0 }));
  for (const r of rows) {
    const t = date(r, field);
    if (
      !Number.isFinite(t) ||
      (future && (!open(r) || t < now)) ||
      (source === "completionDays" && !finished(r)) ||
      (!future && t > now)
    )
      continue;
    const local = new Date(t + 3 * hour),
      h = local.getUTCHours();
    const k = days
      ? moscowDay(t) - today + (future ? 0 : 6)
      : source === "weekdays"
        ? (local.getUTCDay() + 6) % 7
        : source === "shifts"
          ? h >= 8 && h < 20
            ? 0
            : 1
          : Math.floor(h / 4);
    if (points[k]) tally(points, labels[k], r);
  }
  const n = points.reduce((a, b) => a + b.value, 0);
  return {
    id,
    value: number.format(n),
    note: future
      ? "По текущим срокам · МСК."
      : "По датам в текущей выборке · МСК.",
    points,
    evidence: points.find((p) => p.ticket)?.ticket,
  };
}
export function buildAnswerInsights(
  question: string,
  rows: Incident[],
  now: number,
  previous?: AnswerInsightId[],
): AnswerInsight[] {
  const asked = selectAnswerInsightIds(question);
  const ids = asked.length
    ? asked
    : [...new Set(previous ?? [])]
        .filter((id) => Object.hasOwn(insightDefinitions, id))
        .slice(0, 3);
  return ids.map((id) => {
    const { kind } = insightDefinitions[id];
    if (kind === "subset" || kind === "ratio")
      return partitionResult(id, rows, now);
    if (kind === "distribution" || kind === "relation")
      return distributionResult(id, rows, now);
    if (kind === "timeBuckets") return timelineResult(id, rows, now);
    return intervalResult(id, rows, now);
  });
}
