import type {
  CanvasDimension,
  CanvasFilters,
  CanvasIntent,
} from "../../packages/contracts/canvas.ts";
import {
  factOperations,
  factPeriods,
  isDurationGroup,
  type FactPeriod,
  type FactPlan,
} from "../../packages/contracts/canvasFacts.ts";

import { supportsFactDisplay } from "./factDisplay.ts";
import { calendarWindow, rollingWindow, validDateRange } from "./canvasCalendar.ts";

export function validFact(fact: unknown): fact is FactPlan {
  if (!fact || typeof fact !== "object") return false;
  const f = fact as Record<string, unknown>;
  return (
    Object.keys(f).every((k) =>
      ["operation", "period", "dateRange", "lookbackHours", "ascending", "dateField", "display", "limit", "durationMeasure", "intervalMeasure", "durationCohort", "sourceSelection"].includes(k),
    ) &&
    factOperations.some((v) => v === f.operation) &&
    (f.intervalMeasure === undefined || f.operation === "statusInterval" && f.intervalMeasure === "median") &&
    (f.sourceSelection === undefined || typeof f.sourceSelection === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/u.test(f.sourceSelection)) &&
    (f.operation !== "recent" || f.limit !== undefined || f.period !== "snapshot") &&
    (f.durationCohort === undefined || (f.operation === "count" && f.durationCohort === true && f.dateField === undefined)) &&
    (f.durationMeasure === undefined || (f.operation === "duration" &&
      ["individual", "median", "mean"].some(m => m === f.durationMeasure))) &&
    (f.limit === undefined || ((f.operation === "frequency" || f.operation === "recent") && typeof f.limit === "number" &&
      Number.isSafeInteger(f.limit) && f.limit > 0 && f.limit <= 999999)) &&
    (f.display === undefined || supportsFactDisplay(f.operation, f.display)) &&
    factPeriods.some((v) => v === f.period) &&
    (f.period === "dates" ? validDateRange(f.dateRange) : f.dateRange === undefined) &&
    (f.period === "rolling" ? typeof f.lookbackHours === "number" && Number.isSafeInteger(f.lookbackHours) && f.lookbackHours > 0 && f.lookbackHours <= 24 * 99999 : f.lookbackHours === undefined) &&
    (f.dateField === undefined ||
      (f.dateField === "completionDate" &&
        f.operation === "count" &&
        f.period !== "snapshot")) &&
    (f.ascending === undefined || f.ascending === true)
  );
}

const dimensions: [RegExp, CanvasDimension][] = [
  [/статус|состоян/u, "status"],
  [/команд|групп\p{L}*\s+(?:назначения|поддержки|исполнител)/u, "team"],
  [/продукт/u, "product"],
  [/приоритет/u, "priority"],
  [/симптом/u, "symptom"],
];
const quantity = /ск[оo]ль?к[оo]|подсчита[йть]|количеств|число/u;
const list =
  /перечисл|перечень|список|назови|какие|каков\p{L}* состав|как\p{L}* называ/u;
const frequency =
  /сам\p{L}*\s+(?:часто\s+)?встреча|чаще|часты[йемх]|частая|частом|наиболее част|распростран|преоблада|превалир|доминиру|лидиру|больше всего|большинств|популярн|реже|редк(?:ий|ая|ое)|меньше всего/u;
const workloadRank =
  /(?:сам\p{L}*|более всего|(?:сильнее|больше|меньше) всего|наиболее|наименее)\s+(?:загруж|нагруж)|(?:наибольш|наименьш|максимальн|минимальн)\p{L}*\s+(?:количеств|числ|нагрузк)|(?:больше|меньше) (?:всех|остальных)|(?:максимум|минимум)\s+(?:заяв|инцидент|тикет|обращен)/u;
const backlog = /(?:^|\s)(?:завал|затор|перегруж|скопил|накопил)\p{L}*/u;
const asksBacklog = (text: string) => backlog.test(text) && /како|кака|каки|у кого|где/u.test(text) && /команд|заяв|инцидент|обращени|тикет/u.test(text);
const cardinals: Record<string, number> = { один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };
const recentNumbers: Record<string, number> = {
  ...cardinals, одном: 1, одной: 1, одну: 1, двух: 2, двум: 2, трех: 3, трем: 3, четырех: 4, четырем: 4,
  пяти: 5, шести: 6, семи: 7, восьми: 8, девяти: 9, десяти: 10,
};
const recentN = "(\\d{1,6}|" + Object.keys(recentNumbers).join("|") + ")(?:-[хм])?";
const recentAdjective = "(?:(?:последн|свеж|новейш)\\p{L}*|сам\\p{L}*\\s+нов\\p{L}*)";
const incidentNoun = "(?:инц[ие]дент|заяв(?:к|ок)|тикет|обращени)\\p{L}*";
const recentPhrase = new RegExp("(?<![\\p{L}\\d])(?:" + recentAdjective + "\\s+" + recentN + "|" + recentN +
  "\\s+(?:сам\\p{L}*\\s+)?" + recentAdjective + "|(" + recentAdjective + "))\\s+" + incidentNoun, "u");
const earliest = /(?<!\p{L})(?:перв(?:ый|ым|ой|ая|ую|ого|ые|ых|ыми)|ранн\p{L}*|раньше (?:всех|всего|остальн\p{L}*)|сам\p{L}*\s+стар\p{L}*)(?!\p{L})/u;
const latest = /(?<!\p{L})(?:последн\p{L}*|свеж\p{L}*|новейш\p{L}*|сам\p{L}*\s+нов\p{L}*|позже всех)(?!\p{L})/u;
const incidentWord = new RegExp(incidentNoun, "u");
const requestedNumber = new RegExp("(?<![\\p{L}\\d_-])" + recentN + "(?![\\p{L}\\d_.:/-])", "u");
export function registrationOrder(question: string, previous?: CanvasIntent) {
  const text = normalized(question);
  const match = recentPhrase.exec(text);
  if (match) {
    const n = match[1] ?? match[2];
    return { limit: n ? recentNumbers[n] ?? Number(n) : /(?:ие|их|им|ими|ые|ых)$/u.test(match[3]) ? 3 : 1, ascending: false };
  }
  // Strip calendar/priority modifiers before reading an ordinal and a count.
  const subject = (rollingWindow(text)?.rest ?? calendarWindow(text).rest)
    .replace(/(?:последн|перв)\p{L}*\s+(?:(?:\d+|семь)\s+)?(?:день|дн\p{L}*|сут\p{L}*|час\p{L}*|недел\p{L}*|месяц\p{L}*|год\p{L}*)|приоритет\p{L}*\s+\d+|\b[pe]\d+\b/gu, " ");
  if (/в первую очередь|первым делом|перв\p{L}* (?:мест|лини|смен|статус|ответ|назнач|реакц)|по (?:срочности|важности|приоритету)|закрыли|решили|завершили|по сроку|дедлайн|ранн\p{L}* срок/u.test(subject)) return;
  if (incidentWord.test(subject) &&
      /с (?:какого|какой) (?:инц[ие]дента|заявки|обращения|тикета) (?:у нас |вообще |все )?(?:начал[ао]сь|начинал[ао]сь)(?: история| учет| очередь)?[.!?\s]*$/u.test(subject))
    return { ascending: true, limit: 1 };
  const direction = earliest.exec(subject) ?? latest.exec(subject);
  if (!direction) return;
  const prior = previous?.fact?.operation === "recent";
  const intake = /регистрац|зарегистр|пришл|поступ|завели|созда/u.test(subject);
  const anaphora = /сам\p{L}*\s+(?:перв|ранн|последн)|из них|среди них/u.test(subject);
  if (!incidentWord.test(subject) && !intake && !prior && !anaphora) return;
  const n = requestedNumber.exec(subject)?.[1];
  return { ascending: earliest.test(direction[0]), limit: n ? recentNumbers[n] ?? Number(n) :
    /(?:ие|их|ими|ые|ых|ыми)$/u.test(direction[0]) ? 3 : 1 };
}
export function recentLimit(question: string) {
  return registrationOrder(question)?.limit;
}
const shortAggregate = /^(?:(?:а|и|ну|тогда|теперь|покажи|посчитай|какое|какая|какую|пожалуйста)\s+)*(среднее(?:\s+(?:время|значение))?|время (?:в среднем|среднее)|в среднем|медиан[ауы])[\s?!.,]*$/iu;
export function aggregateFollowup(text: string) {
  const term = shortAggregate.exec(text.trim())?.[1];
  return term ? (/^медиан/iu.test(term) ? "median" : "mean") : undefined;
}
function asksStatusInterval(text: string, previous?: CanvasIntent) {
  if (previous?.fact?.operation === "statusInterval" && aggregateFollowup(text)) return true;
  const followup = previous?.fact?.operation === "statusInterval" || previous?.fact?.durationMeasure === "mean";
  return /статус|состоян/u.test(text) && /смен|меня|измен|переход|между (?:статус|состоян)/u.test(text) &&
    (followup && /между/u.test(text) ||
    /средн|медиан/u.test(text) && /врем|долго|часто|частот|интервал|длительност|сколько (?:минут|часов|дней)/u.test(text));
}
export function asksOverdueCount(text: string) {
  return /ск[оo]ль?к|количеств|число|подсчита/u.test(text) &&
    /просроч|ист[её]к|срок\p{L}* (?:уже )?(?:прош[её]л|нарушен)|нарушен\p{L}* срок/u.test(text) &&
    !/(?:на|за)\s+сколько|(?:сколько|число|количество)\s+(?:команд|продукт|времен|час|минут|процент|дней)|дол[яю]|больше всего|по командам|по продуктам/u.test(text);
}
const nGroups = "(\\d{1,6}|" + Object.keys(cardinals).join("|") + ")(?![\\p{L}\\d])";
const leading = new RegExp("(?:^|\\s)топ[-\\s]*" + nGroups, "u");
const leadingWords = new RegExp("(?:^|\\s)" + nGroups + "\\s+(?:сам\\p{L}*\\s+(?:загруж|нагруж|част)|(?:крупнейш|ведущ|лидирующ))", "u");
const leadingGroups = new RegExp("(?:^|\\s)" + nGroups + "\\s+(?:команд|продукт|статус|приоритет|симптом)\\p{L}*\\s+с\\s+(?:наи(?:больш|меньш)|м(?:аксим|иним)альн)", "u");
export function requestedLimit(text: string) {
  const literal = leading.exec(text)?.[1] ?? leadingWords.exec(text)?.[1] ?? leadingGroups.exec(text)?.[1];
  return literal === undefined ? undefined : cardinals[literal] ?? Number(literal);
}
const extremum =
  /рекорд|дольш|долг|длительн|медлен|быстр|коротк|минимальн|максимальн|больше всего|меньше всего|наибольш|наименьш|сам\p{L}* много/u;
const resolution =
  /долгореша|реш(?:ени|али|ал[ио]?|ен|ил|а[лт]с)|устран|закры[тв]|закрыли|закрывал|заверш|чинил|почин|восстанов/u;
const timeQuestion =
  /сегодня|сегодняш|вчера|недел|месяц|год(?:а|у|ом)?(?!\p{L})|сутки/u;
const graph =
  /связ[ьиьяеи]|связан|связыва|зависимост|отношени|цепочк|граф(?!ик)|схем|диаграмм/u;
const relation = /связ[ьиьяеи]|связан|связыва|зависимост|отношени|цепочк/u;
const commonality =
  /что (?:у них )?общего|чем (?:они )?(?:похож|схож)|что (?:их )?объединяет|общие (?:черт|признак|пол[яе])|(?:сходств|совпадени|пересечени)/u;
const referredTickets = /эти[хм]|между ними|у них|они (?:похож|схож)|их объединяет/u;
const closed = /(?<!\p{L})закры(?:ли|т)/u;
const finished = /(?<!\p{L})(?:заверш(?:или|ен)|реш(?:или|ен)|устранили)/u;
const intake = /регистрац|зарегистр|поступ|создан|создали|завели|пода(?:ли|н)/u;
const ticketTerm = /заяв[ко]|инцидент|тикет|обращени|сбо[яией]|проблем/u;
// A count of tickets has a ticket noun as its object. A count of clients,
// hours, or distinct teams needs a different measure even when tickets are mentioned.
const ticketCount =
  /(?<!\p{L})(?:ск[оo]ль?к[оo]|подсчита[йть]|количеств\p{L}*|число)\s+(?:(?:всего|сейчас|тут|у нас|таких|этих|было|есть|еще|уже|открыт\p{L}*|активн\p{L}*|просроченн\p{L}*|закрыт\p{L}*|критич\p{L}*|новых|завершенн\p{L}*)\s+)*(?:заяв[ко]|инцидент|тикет|обращени)/u;
export const queueCount =
  /^(?:(?:а|и|теперь)\s+)*сколько\s+(?:(?:всего|сейчас|таких|тут|у нас)\s+)*(?:заявок|обращений|тикетов|инцидентов)(?:\s+(?:в очереди|сейчас|всего))?[?!.\s]*$/iu;
export const overallCount = /общ(?:ее|его|ем)\s+(?:число|количеств)|сколько\s+всего|сколько\s+(?:заявок|инцидентов|обращений|тикетов)\s+всего|во всех статусах|всех статус|во всей выгрузке|во вс[её]м источнике/iu;
const follow =
  /^(?:а |и |теперь |тогда )*(?:только|среди|из них|для |в продукте|по продукту|за |вчера|сегодня|без |кроме|исключ|не счи|оставь|огранич|ск[оo]ль?к[оo] (?:таких|из них))|^(?:а |и |теперь )ск[оo]ль?к[оo]\s+(?:уже\s+)?(?:закры|заверш|решен)/u;
const namedId =
  /(?<![\p{L}\p{N}_])(?:[a-zа-я][a-zа-я0-9]*(?:-[a-zа-я0-9]+)+|(?:inc|инц)\d+|\d{5,})(?![\p{L}\p{N}_-])/giu;
const normalized = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");

// Default the bare measure to resolution only when the remaining words describe
// the request, its source cohort, or its calendar window. A named external
// process (such as page loading) has its own timestamps.
function unqualifiedDuration(text: string) {
  const rest = rollingWindow(text)?.rest ?? calendarWindow(text).rest;
  return (rest.match(/[\p{L}\p{N}]+/gu) ?? []).every(word =>
    /^(?:а|и|ну|нам|мне|у|нас|в|во|по|из|за|с|для|только|тут|там|же|ли|бы|какое|какая|оно|сейчас|тогда|теперь|пожалуйста|сколько|обычно|mttr|E\d+)$/u.test(word) ||
    /^(?:посчита|рассчита|подсчита|покаж|вывед|подскаж|скажи|давай|можеш|средн|врем|длительност|продолжительност|инц[ие]дент|тикет|заявк|заявок|обращени|сутк|год|дн[ея]|месяц|недел|сегодня|вчера|последн|период|выборк|источник|очеред)/u.test(word));
}

function durationRequest(text: string, previous?: CanvasIntent) {
  // These measures have their own source fields and should not fall back to resolution time.
  if (ticketCount.test(text) || /до назначени|между|смен\p{L}* статус|ожидани|реакци|отклик|просроч|(?:пер|про)центил|врем(?:я|ени) (?:до |ответа|(?:последнего )?назначения|регистрации|создания|поступления|суток)/u.test(text) &&
      !/между командами/u.test(text)) return;
  const prior = previous?.fact?.operation === "duration" && !/за все время|новый (?:срез|вопрос)|заново/u.test(text);
  const aggregate = aggregateFollowup(text);
  if (aggregate && previous?.insightIds?.includes("resolve-median") && !previous.fact)
    return { dimension: "ticket", measure: aggregate, continuation: true } as const;
  if (aggregate && (prior || previous?.fact?.operation === "recent")) {
    return { dimension: prior ? previous.groupBy : "ticket", measure: aggregate, continuation: true } as const;
  }
  const regroup = prior && /^(?:(?:а|и|теперь|покажи|сравни|разбей|сгруппируй)\s+)*(?:по|между)\s+(?:отдельн\p{L}*\s+)?(?:команд|симптом|продукт|статус|приоритет|инцидент|заявк|тикет)/u.test(text);
  const groups = /команд(?:ам|ами|ы)(?!\p{L})|какая команда|какой команды|между командами/u.test(text) ? "team" :
    /симптом/u.test(text) ? "symptom" : /по продуктам/u.test(text) ? "product" :
    /по приоритетам/u.test(text) ? "priority" : /по статусам/u.test(text) ? "status" : undefined;
  const ticket = ticketTerm.test(text) || /\bE\d+\b|(?:inc|demo|sim)-\d/iu.test(text);
  const time = /врем(?:я|ени)|длительност|продолжительност|скорост[ьи]|mttr/u.test(text.replace(/за (?:все|это|какое|последнее) время/gu, ""));
  const compare = /сравн|сопостав|анализ|разбер|у кажд|для кажд|по кажд|отсортируй|ранжируй/u.test(text) ||
    /(?:покажи|выведи|перечисли).*по (?:времени|длительности|продолжительности)/u.test(text);
  if (frequency.test(text) && !time && !/дольш|долг|быстр|медлен/u.test(text)) return;
  const extreme = /сам\p{L}*\s+(?:затяжн|продолжительн)/u.test(text) || extremum.test(text) && (resolution.test(text) ||
    /долг(?:ий|ая|ое|ие|ую|ого)|длительн(?:ый|ая|ое|ые|ую)|длил|продлил|(?:быстр|коротк)(?:ая|ий|ый|ое|ие|ую)/u.test(text));
  if (groups && (regroup || time || resolution.test(text) && /дольш|быстр|медлен/u.test(text))) {
    const mean = /средн\p{L}*\s+(?:время|длительность|продолжительность)|в среднем|mttr/u.test(text) ||
      (regroup && previous?.fact?.durationMeasure === "mean");
    return { dimension: groups, measure: mean ? "mean" : "median", continuation: prior } as const;
  }
  const average = /(?<!\p{L})средн\p{L}*(?!\p{L})(?!\s+приоритет)|\bmttr\b/u.test(text);
  const resolutionAction = resolution.test(text) || /чини|чинят|ремонт|закрыва|реша(?:ют|ем|ется|ть)|разрулива/u.test(text);
  // The adjective form names the existing «Медианное время решения» insight.
  const median = /медиан[ауы](?!\p{L})/u.test(text);
  if ((average || median) && (resolutionAction || time && unqualifiedDuration(text)) && !/статус|по (?:продуктам|сервисам|приоритетам)|возраст|нагрузк|срок\p{L}* (?:реакци|назначени)/u.test(text)) {
    return { dimension: "ticket", measure: median ? "median" : "mean", continuation: prior } as const;
  }
  if (/(?:средн\p{L}*|медиан\p{L}*)\s+(?:время|времени|длительность)|по (?:продуктам|сервисам|приоритетам|статусам)/u.test(text)) return;
  if ((ticket || prior) && (regroup || time && compare)) {
    return { dimension: "ticket", measure: "individual", continuation: prior } as const;
  }
  if (extreme && (ticket || prior || /котор|како|какая|какие|кто|топ|рейтинг|рекорд/u.test(text))) {
    return { dimension: "ticket", measure: undefined, continuation: prior } as const;
  }
}

export function onlyTicketIds(shaped: string, idAliases: string[]) {
  const remainder = shaped
    .replace(/\bE\d+\b/gu, ref => idAliases.includes(ref) ? " " : ref)
    .replace(namedId, id => /\d/u.test(id) ? " " : id);
  return remainder !== shaped && /^[\s,;.№#]*(?:и[\s,;.№#]+)*$/u.test(remainder);
}

export function periodIn(s: string): FactPeriod | undefined {
  if (calendarWindow(s).range) return "dates";
  if (rollingWindow(s)) return "rolling";
  if (/сегодня|сегодняш/u.test(s)) return "today";
  if (/вчера/u.test(s)) return "yesterday";
  if (
    /12\s+месяц|двенадцать месяц|(?:последн|прошедш|минувш)\p{L}*\s+год|за год(?!\p{L})|последн\p{L}* 365 (?:дней|суток)/u.test(
      s,
    )
  )
    return "year";
  if (/(?:последн|прошедш|минувш)\p{L}*\s+месяц|за месяц(?!\p{L})/u.test(s))
    return "month";
  if (
    /последн\p{L}* (?:7|семь) дн|(?:последн|прошедш|минувш)\p{L}*\s+недел|за неделю/u.test(
      s,
    )
  )
    return "week";
}
export function validFactView(
  fact: FactPlan,
  dimension: CanvasDimension,
  filters: CanvasFilters,
) {
  if (
    fact.dateField &&
    (!filters.states ||
      !filters.states.every((state) => state === 7 || state === 10))
  )
    return false;
  if (fact.operation === "relations")
    return (
      dimension === "ticket" &&
      fact.period === "snapshot" &&
      !fact.ascending &&
      (filters.ids?.length ?? 0) >= 2
    );
  if (fact.operation === "duration")
    return fact.durationMeasure === "median" || fact.durationMeasure === "mean"
      ? dimension === "ticket" || isDurationGroup(dimension)
      : dimension === "ticket";
  if (fact.operation === "count") return dimension === "ticket" && !fact.ascending;
  if (fact.operation === "recent") return dimension === "ticket";
  if (fact.operation === "statusInterval") return dimension === "ticket" && !fact.ascending;
  return (
    [
      "team",
      "status",
      "product",
      "priority",
      "symptom",
      "deadline",
      "escalation",
    ].includes(dimension) &&
    (fact.operation === "frequency" || !fact.ascending)
  );
}
export function periodQuestion(s: string) {
  return (
    periodIn(s) &&
    /инцидент|тикет|заяв[ко]|обращени|разброс|распредел|стади|статус|состоян|команд|продукт|сколько|срок|решени|нагруз/u.test(
      s,
    ) &&
    !/стих|хокку|поэм|рассказ|сочини/u.test(s)
  );
}
export function mightAskFact(question: string, previous?: CanvasIntent) {
  const s = normalized(question);
  return (
    ((ticketTerm.test(s) || intake.test(s)) && (!!periodIn(s) || calendarWindow(s).invalid)) ||
    !!registrationOrder(s, previous) || asksOverdueCount(s) || !!aggregateFollowup(s) || asksStatusInterval(s, previous) || !!durationRequest(s, previous) ||
    /средн/u.test(s) && /регистр|поступле|создани/u.test(s) ||
    frequency.test(s) || workloadRank.test(s) || asksBacklog(s) || requestedLimit(s) !== undefined || commonality.test(s) || ticketCount.test(s) ||
    (resolution.test(s) && extremum.test(s)) ||
    ((list.test(s) || quantity.test(s)) &&
      (dimensions.some(([re]) => re.test(s)) || timeQuestion.test(s))) ||
    (graph.test(s) &&
      (relation.test(s) ||
        ticketTerm.test(s) ||
        /(?:inc|demo|sim)[-\d]/iu.test(s))) ||
    (!!previous?.fact && follow.test(s))
  );
}
type Reading =
  | {
      fact: FactPlan;
      dimension: CanvasDimension;
      ids?: string[];
      states?: number[];
      continuation: boolean;
    }
  | { problem: string; pendingRelationIds?: string[] };
export function readFact(
  question: string,
  shaped: string,
  mentioned: CanvasFilters,
  previous?: CanvasIntent,
  pendingRelationIds?: string[],
  requestedOperation?: "count",
): Reading | undefined {
  const original = normalized(question);
  if (/что такое|что означает|что значит|объясни понятие|почему|зачем/u.test(original))
    return;
  if (/(?<!\p{L})не\s+(?:были?\s+|было\s+)?(?:закры(?:ли|т)|заверш(?:или|ен)|реш(?:или|ен))\p{L}*(?!\p{L})/u.test(shaped))
    return {
      problem:
        "Уточните, нужны ли заявки, которые сейчас открыты, или число переходов статуса за период. В снимке видны текущие статусы и даты завершения.",
    };
  // A named scope can precede the measured dimension ("для команды E1 какой статус...").
  const measure = shaped.replace(
    /(?:для|из|в|у|по|от|к|исключить)\s+(?:команд|продукт|сервис|статус|приоритет)\p{L}*\s+E\d+/gu,
    " ",
  );
  const dim = dimensions
    .map(([pattern, dimension]) => ({ at: measure.search(pattern), dimension }))
    .filter((d) => d.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.dimension ?? (asksBacklog(measure) ? "team" : undefined);
  const limit = requestedLimit(measure);
  const order = registrationOrder(measure, previous);
  const recent = order?.limit;
  const statusInterval = asksStatusInterval(measure, previous);
  const overdue = asksOverdueCount(measure);
  const duration = !statusInterval && durationRequest(measure, previous) || undefined;
  const aggregate = aggregateFollowup(measure);
  if (aggregate && !duration && !statusInterval)
    return { problem: "Какой показатель посчитать по заявкам: время решения или интервал между сменами статуса?" };
  if (!requestedOperation && !statusInterval && !order && /средн/u.test(measure) &&
      /врем|долго|длительност|интервал/u.test(measure) && /регистрац|поступлен|создани/u.test(measure) &&
      !/решени|закрыти|завершени|от регистраци.*до/u.test(measure))
    return { problem: "Уточните, какое время регистрации вы имеете в виду. В карточке есть момент регистрации (submitDate). Для длительности самой регистрации нужно также знать время её начала. По заявкам можно рассчитать время от регистрации до решения." };
  if (recent === 0) return { problem: "Укажите положительное число последних заявок." };
  if (limit === 0) return { problem: "Укажите, сколько групп показать в рейтинге: нужно положительное число." };
  if (limit && dim && [...measure.matchAll(/(?:^|\s)по\s+(\p{L}+)/gu)].some(([, field]) =>
    !/^(?:числ|количеств|нагрузк|частот|заявк|обращени|инцидент|тикет|просроч|продукт|команд|статус|приоритет|симптом|состоян)/u.test(field)))
    return { problem: "Уточните показатель для рейтинга. По этим полям можно сравнить группы по количеству заявок." };
  const continuation =
    !!previous?.fact &&
    (duration?.continuation || follow.test(shaped) || /(?:из|среди) них/u.test(shaped) ||
      !!aggregate || previous.fact.operation === "recent" && !!order && /^(?:а|и|теперь)\s/u.test(shaped.trim()));
  const namedStatus = /(?:со\s+статус(?:ом|ами)|в\s+статус(?:е|ах))/u.test(shaped);
  const hasClosed = closed.test(shaped);
  const actionStates = finished.test(shaped)
    ? (namedStatus && !hasClosed ? [7] : [7, 10])
    : hasClosed ? [10] : undefined;
  const calendar = calendarWindow(shaped);
  if (calendar.invalid) return { problem: "Укажите существующую дату или диапазон от более ранней до более поздней даты, например с 20.11.2026 по 22.11.2026." };
  const askedPeriod = periodIn(shaped);
  const period = askedPeriod ?? (continuation ? previous!.fact!.period : "snapshot");
  const dateRange = period === "dates" ? calendar.range ?? previous?.fact?.dateRange : undefined;
  const rolling = rollingWindow(shaped);
  if (rolling?.hours === 0) return { problem: "Укажите положительную длительность периода." };
  const lookbackHours = period === "rolling" ? rolling?.hours ?? previous?.fact?.lookbackHours : undefined;
  const datedList = !order && !!askedPeriod && ticketTerm.test(measure) && !quantity.test(measure) && !dim && !duration &&
    !/часто|динамик|график|распредел|по дням|по часам|когда/u.test(measure) &&
    /покаж|вывед|перечисл|каки[ех]|список|найди|пришл|поступил/u.test(measure);
  let operation: FactPlan["operation"] | undefined;
  let dimension: CanvasDimension = dim ?? "ticket";
  let ids: string[] | undefined;
  if (!requestedOperation && (recent !== undefined || datedList || statusInterval || overdue)) {
    operation = statusInterval ? "statusInterval" : overdue ? "count" : "recent";
    dimension = "ticket";
  } else if (requestedOperation === "count") {
    operation = "count";
    dimension = "ticket";
  } else if (
    pendingRelationIds !== undefined || (graph.test(shaped) || commonality.test(shaped)) &&
    (!duration || relation.test(shaped) || commonality.test(shaped)) &&
    (mentioned.ids?.length ||
      ((relation.test(shaped) || commonality.test(shaped)) && (ticketTerm.test(shaped) || referredTickets.test(shaped))) ||
      /(?:inc|demo|sim)[-\d]/iu.test(shaped))
  ) {
    const cited = [...new Set([...(pendingRelationIds ?? []), ...(mentioned.ids ?? [])])];
    for (const match of question.matchAll(namedId)) {
      const id = match[0];
      if (
        /\d/u.test(id) &&
        !cited.some((v) => normalized(v) === normalized(id))
      )
        cited.push(id);
    }
    ids = cited.length ? cited : referredTickets.test(shaped) ? previous?.filters.ids : undefined;
    if (!ids || ids.length < 2)
      return {
        problem:
          ids?.length ? "Укажите номер второй заявки, чтобы построить схему связей двух инцидентов." :
            "Укажите номера как минимум двух заявок, чтобы построить схему связей.",
        pendingRelationIds: ids ?? [],
      };
    operation = "relations";
    dimension = "ticket";
  } else if (duration) {
    if (/(?<![\p{L}\p{N}])(?:inc|инц|demo|sim)[-\d][\p{L}\p{N}-]*/iu.test(shaped))
      return { problem: "Часть номеров инцидентов не найдена в этом источнике. Уточните номера для сравнения." };
    operation = "duration";
    dimension = duration.dimension;
  } else if (dim && (frequency.test(measure) || workloadRank.test(measure) || asksBacklog(measure) || limit !== undefined) &&
    !/(?:времени|по времени|длительност)/u.test(measure)) {
    operation = "frequency";
  } else if (ticketCount.test(shaped) && overallCount.test(shaped) && !/(?:по|между)\s+(?:команд|симптом|статус|приоритет|продукт)/u.test(measure)) {
    operation = "count";
    dimension = "ticket";
  } else if (
    dim &&
    (quantity.test(shaped) || list.test(shaped)) &&
    !/(?:список|перечисли|какие|назови)\s+(?:заяв|инцидент|тикет|обращен)/u.test(
      shaped,
    ) &&
    (quantity.test(shaped) || !/диаграмм|рейтинг|график|карточк|матриц|таблиц|схем|сравн|сгрупп|группиру/u.test(
      shaped,
    )) &&
    !/(?:сколько|число|количеств\p{L}*)\s+(?:всего\s+)?(?:заяв|инцидент|тикет|обращен)/u.test(
      shaped,
    )
  ) {
    operation = "distinct";
  } else if (
    quantity.test(shaped) &&
    (ticketTerm.test(shaped) || actionStates || continuation || intake.test(shaped)) &&
    (askedPeriod || timeQuestion.test(shaped) || continuation || (namedStatus && actionStates) ||
      (ticketCount.test(shaped) && !dim && !/(?:по|между)\s+\p{L}/u.test(measure)))
  ) {
    operation = "count";
    dimension = "ticket";
  } else if (continuation) {
    operation = previous!.fact!.operation;
    dimension = previous!.groupBy;
  } else return;
  if (operation !== "relations" && (/\b(?:inc|demo|sim)-[\p{L}\d-]*\d|(?<!\p{L})инц-?\d/iu.test(shaped) ||
      /(?:инц[еи]дент\p{L}*|тикет\p{L}*|заявк\p{L}*|заявок|обращени\p{L}*)\s+(?:команды|продукта|сервиса)\s+(?!E\d+\b)[\p{L}\d_-]+/u.test(shaped.trim().replace(/\s+/gu, " "))))
    return { problem: "Часть номеров заявок или названий команд и продуктов не найдена в источнике. Уточните номер или название." };
  if (
    operation !== "relations" &&
    /\d{1,4}[./-]\d{1,2}|\b(?:19|20)\d{2}\b|прошл\p{L}* (год|месяц|недел)|эт(?:ом|от) (?:год|месяц)|календарн|квартал|позавчера|\d+\s+(?:дн|день|дня|недел|месяц|год|лет|час|сут)|за сутки/u.test(
      (rolling?.rest ?? calendar.rest).replace(
        /12\s+месяц\p{L}*|365\s+(?:дней|суток)|7\s+дн\p{L}*/gu,
        "",
      ),
    )
  ) {
    return {
      problem:
        "Уточните период. Укажите дату, диапазон «с … по …», последние часы или дни, неделю, месяц либо год.",
    };
  }
  if (
    /изменял|менял|переход|поменял|побывал|перешл|денег|выручк|ущерб|клиент(?:ов|ам)|пользователей|эскал|географ|регион|геолокац|первопричин|прогноз|(?:кроме|исключая|не считать|не считая|без учета|за исключением)\s|(?:не |без )просроч/u.test(
      statusInterval ? shaped.replace(/(?:изменял|менял|переход|поменял|перешл)\p{L}*/gu, "") : shaped,
    ) ||
    /(?:по|для|из|в|у|к)\s+(?:команд[ыеу]|продукт[аеу]|сервис[аеу])\s+(?!E\d+(?!\d)|(?:с|без|и|где)\s)[\p{L}\d_-]+/u.test(
      shaped.trim().replace(/\s+/gu, " "),
    ) ||
    /[«"][^»"]*[\p{L}\d][^»"]*[»"]/u.test(
      shaped.replace(/\bE\d+\b|[«"](?:закрыт|завершен)[»"]/gu, ""),
    )
  ) {
    return {
      problem:
        "Условия вопроса не удалось сопоставить с полями текущего источника. Уточните показатель или точное название команды и продукта.",
    };
  }
  const ascending = order ? order.ascending :
    /реже|редк(?:ий|ая|ое)|меньше (?:всего|всех|остальных)|быстр|коротк|миним(?:ум|альн)|наимен(?:ьш|ее)/u.test(
      shaped,
    ) ||
    (continuation && !/дольш|долг|медлен|максим|наибольш|больше всего/u.test(shaped) &&
      previous!.fact!.operation === operation &&
      previous!.fact!.ascending);
  // «Из них» refers to the previous cohort. Its date field stays in effect
  // unless the question explicitly introduces a new event period.
  const pinnedPeriod = continuation && !askedPeriod;
  const durationCohort = operation === "count" && continuation &&
    (previous?.fact?.operation === "duration" || previous?.fact?.durationCohort) && !intake.test(shaped);
  const completionWindow =
    operation === "count" &&
    !durationCohort &&
    period !== "snapshot" &&
    (pinnedPeriod
      ? previous!.fact!.dateField || previous!.fact!.operation === "duration"
      : actionStates &&
        !intake.test(shaped) &&
        !/(?:со |в )статусе|со статусом/u.test(shaped));
  const states = operation === "count" ? actionStates : operation === "frequency" && asksBacklog(measure) ? [0, 2, 20] : undefined;
  const durationMeasure = duration ? duration.measure : continuation ? previous?.fact?.durationMeasure : undefined;
  const medianInterval = operation === "statusInterval" && (/медиан/u.test(measure) ||
    continuation && !/средн/u.test(measure) && previous?.fact?.intervalMeasure === "median");
  return {
    fact: {
      operation,
      period,
      ...(medianInterval ? { intervalMeasure: "median" as const } : {}),
      ...(dateRange ? { dateRange } : {}),
      ...(lookbackHours ? { lookbackHours } : {}),
      ...(durationCohort ? { durationCohort: true } : {}),
      ...(operation === "duration" && durationMeasure ? { durationMeasure } : {}),
      ...(operation === "frequency" && limit !== undefined ? { limit } : {}),
      ...(operation === "recent" && !datedList && (order || previous?.fact?.limit) ? { limit: recent ?? previous?.fact?.limit } : {}),
      ...(completionWindow ? { dateField: "completionDate" } : {}),
      ...(ascending ? { ascending: true } : {}),
    },
    dimension,
    ids,
    states,
    continuation,
  };
}
