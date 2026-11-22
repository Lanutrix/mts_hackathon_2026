type CalendarRange = [string, string];
const months = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split(" ");
const monthName = months.join("|");
const partialRange = new RegExp("(?<![\\p{L}\\d_-])(?:с\\s+)?(\\d{1,2})\\s*(?:по|[–—-])\\s*(\\d{1,2}\\s+(?:" + monthName + ")(?:\\s+\\d{4})?)(?![\\p{L}\\d])", "gu");
const rolling = /(?:^|\s)(?:за|за последние|последние|за прошедшие|за минувшие)\s+(\d{1,5})\s+(час\p{L}*|день|дн\p{L}*|сут\p{L}*)(?!\p{L})/u;
export function rollingWindow(text: string) {
  const match = rolling.exec(text);
  if (!match) return;
  return { hours: Number(match[1]) * (match[2].startsWith("час") ? 1 : 24), rest: text.replace(match[0], " ") };
}
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

export function calendarWindow(text: string, now = Date.now()): { range?: CalendarRange; rest: string; invalid?: true } {
  text = text.replace(partialRange, (_, from: string, to: string) => "с " + to.replace(/^\d+/u, from) + " по " + to);
  const dates = [...text.matchAll(dateWord)];
  if (!dates.length) {
    if (text.includes("позавчера")) {
      const date = new Date(now + 3 * 3_600_000 - 2 * 86_400_000).toISOString().slice(0, 10);
      return { range: [date, date], rest: text.replace("позавчера", " ") };
    }
    return { rest: text };
  }
  const first = dates[0], last = dates.at(-1)!;
  const prefix = text.slice(0, first.index);
  const join = text.slice(first.index + first[0].length, last.index).trim();
  const year = new Date(now + 3 * 3_600_000).getUTCFullYear();
  const range = [isoDay(first[0], year), isoDay(last[0], year)];
  // Separate listed days, open-ended and reversed intervals cannot be silently narrowed.
  if (!validDateRange(range) || dates.length > 2 ||
      /сегодня|вчера|по состоянию на|на (?:конец|начало)|\d{1,2}:\d{2}/u.test(text) || rollingWindow(text) ||
      dates.length === 2 && !/^(?:по|до|[–—-])$/u.test(join) ||
      dates.length === 1 && /(?:^|\s)(?:с|от|до|после|раньше|перед)\s*$/u.test(prefix))
    return { invalid: true, rest: text };
  return { range, rest: prefix + " " + text.slice(last.index + last[0].length) };
}
