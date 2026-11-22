import type { FactPeriod, FactPlan } from "../../packages/contracts/canvasFacts.ts";

type CalendarRange = [string, string];
type Window = Pick<Partial<FactPlan>, "period" | "dateRange" | "clockRange" | "lookbackHours"> & {
  rest: string;
  invalid?: true;
};
const months = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split(" ");
const monthName = months.join("|");
const partialRange = new RegExp("(?<![\\p{L}\\d_-])(?:с\\s+)?(\\d{1,2})\\s*(?:по|[–—-])\\s*(\\d{1,2}\\s+(?:" + monthName + ")(?:\\s+\\d{4})?)(?![\\p{L}\\d])", "gu");
const rolling = /(?<![\p{L}\d])(?:за\s+(?:(?:последн|прошедш|минувш)\p{L}*\s+)?|(?:последн|прошедш|минувш)\p{L}*\s+)(?:(\d{1,5}|один|одни|семь)\s+(час(?:а|ов)?|день|дня|дней|сутки|суток)|(час|день|сутки))(?![\p{L}\d])/gu;
const namedPeriods: [RegExp, FactPeriod][] = [
  [/(?:на (?:этой|текущей)|за (?:эту|текущую)) (?:календарн\p{L}* )?недел\p{L}*|с начала (?:(?:этой|текущей) )?недели/gu, "thisWeek"],
  [/(?:на (?:прошлой|предыдущей)|за (?:прошлую|предыдущую)) (?:календарн\p{L}* )?недел\p{L}*/gu, "previousWeek"],
  [/(?:в (?:этом|текущем)|за (?:этот|текущий)) (?:календарн\p{L}* )?месяц\p{L}*|с начала (?:(?:этого|текущего) )?месяца/gu, "thisMonth"],
  [/(?:в (?:прошлом|предыдущем)|за (?:прошлый|предыдущий)) (?:календарн\p{L}* )?месяц\p{L}*/gu, "previousMonth"],
  [/(?:в (?:этом|текущем)|за (?:этот|текущий)) (?:календарн\p{L}* )?год\p{L}*|с начала (?:(?:этого|текущего) )?года/gu, "thisYear"],
  [/(?:в (?:прошлом|предыдущем)|за (?:прошлый|предыдущий)) (?:календарн\p{L}* )?год\p{L}*/gu, "previousYear"],
  [/(?<!\p{L})сегодня(?:шн\p{L}*)?(?!\p{L})/gu, "today"],
  [/(?<!\p{L})вчера(?:шн\p{L}*)?(?!\p{L})/gu, "yesterday"],
  [/(?:(?:за |в течение )?(?:последн|прошедш|минувш)\p{L}* недел\p{L}*|за неделю)(?!\p{L})/gu, "week"],
  [/(?:(?:за |в течение )?(?:последн|прошедш|минувш)\p{L}* месяц\p{L}*|за месяц)(?!\p{L})/gu, "month"],
  [/(?:(?:за |в течение )?(?:последн|прошедш|минувш)\p{L}* год\p{L}*|за год)(?!\p{L})|(?:за )?(?:(?:последн|прошедш|минувш)\p{L}* )?(?:12|двенадцать) месяцев/gu, "year"],
];
const clock = /(?<!\p{L})с\s+(\d{1,2})(?::(\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?::(\d{2}))?(?![\d:./-]|\s+\d)/gu;
const dateWord = new RegExp("(?<![\\p{L}\\d_-])(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}([./])\\d{1,2}\\1\\d{4}|\\d{1,2}\\s+(?:" + monthName + ")(?:\\s+\\d{4})?)(?![\\p{L}\\d_-])", "gu");

function isoDay(literal: string, year: number) {
  const numeric = literal.split(/[./]/u);
  const [day, month, y] = literal.split(/\s+/u);
  const iso = literal.includes("-") ? literal : numeric.length === 3 ?
    [numeric[2], numeric[1].padStart(2, "0"), numeric[0].padStart(2, "0")].join("-") :
    [y ?? year, String(months.indexOf(month) + 1).padStart(2, "0"), day.padStart(2, "0")].join("-");
  const at = Date.parse(iso + "T00:00:00Z");
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === iso ? iso : undefined;
}

export function validDateRange(range: unknown): range is CalendarRange {
  return Array.isArray(range) && range.length === 2 && range.every(v =>
    typeof v === "string" && /^\d{4}-\d\d-\d\d$/u.test(v) && isoDay(v, 0) === v) && range[0] <= range[1];
}

export function validClockRange(v: unknown, period: unknown, range: unknown) {
  return (period === "today" || period === "yesterday" || period === "dates" && validDateRange(range) && range[0] === range[1]) &&
    Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] >= 0 && v[0] < v[1] && v[1] <= 1440;
}

export function calendarWindow(text: string, now = Date.now()): Window {
  text = text.replace(partialRange, (_, from: string, to: string) => "с " + to.replace(/^\d+/u, from) + " по " + to);
  const parsed: Window = { rest: text };
  const invalid = { invalid: true, rest: text } as const;
  const year = new Date(now + 3 * 3_600_000).getUTCFullYear();
  const dates = [...text.matchAll(dateWord)];
  if (dates.length) {
    const first = dates[0], last = dates.at(-1)!;
    const prefix = text.slice(0, first.index);
    const join = text.slice(first.index + first[0].length, last.index).trim();
    const range = [isoDay(first[0], year), isoDay(last[0], year)];
    if (!validDateRange(range) || dates.length > 2 ||
        dates.length === 2 && !/^(?:по|до|[–—-])$/u.test(join) ||
        dates.length === 1 && /(?:^|\s)(?:с|от|до|после|раньше|перед)\s*$/u.test(prefix)) return invalid;
    parsed.period = "dates";
    parsed.dateRange = range;
    parsed.rest = prefix + " " + text.slice(last.index + last[0].length);
  }
  if (parsed.rest.includes("позавчера")) {
    if (parsed.period) return invalid;
    const date = new Date(now + 3 * 3_600_000 - 2 * 86_400_000).toISOString().slice(0, 10);
    parsed.period = "dates";
    parsed.dateRange = [date, date];
    parsed.rest = parsed.rest.replace("позавчера", " ");
  }
  for (const match of parsed.rest.matchAll(rolling)) {
    if (parsed.period) return invalid;
    const count = match[1] === "семь" ? 7 : !match[1] || /^од/u.test(match[1]) ? 1 : Number(match[1]);
    if (!count) return invalid;
    parsed.period = "rolling";
    parsed.lookbackHours = count * ((match[2] ?? match[3]).startsWith("час") ? 1 : 24);
    parsed.rest = parsed.rest.replace(match[0], " ");
  }
  for (const [regex, period] of namedPeriods) {
    for (const match of parsed.rest.matchAll(regex)) {
      if (parsed.period) return invalid;
      parsed.period = period;
      parsed.rest = parsed.rest.replace(match[0], " ");
    }
  }
  for (const match of parsed.rest.matchAll(clock)) {
    const startMinute = Number(match[2] ?? 0), endMinute = Number(match[4] ?? 0);
    const range: [number, number] = [Number(match[1]) * 60 + startMinute, Number(match[3]) * 60 + endMinute];
    if (parsed.clockRange || startMinute > 59 || endMinute > 59 || !validClockRange(range, parsed.period, parsed.dateRange)) return invalid;
    parsed.clockRange = range;
    parsed.rest = parsed.rest.replace(match[0], " ");
  }
  // Leftover clock expressions and partial constraints must never turn into a whole-day count.
  if (/\d{1,2}:\d{1,2}|(?:^|\s)(?:с|до|после|раньше|позже|в)\s+\d+(?=\s*(?:[?!.,]|$|утра|вечера|ночи|час))|по состоянию на|на (?:конец|начало) (?:дня|недели|месяца|года)|завтра|следующ\p{L}* (?:недел|месяц|год)/u.test(parsed.rest) ||
      parsed.period && /(?<!\p{L})(?:утром|вечером|ночью|днем|utc|gmt)(?!\p{L})/iu.test(parsed.rest)) return invalid;
  return parsed;
}
