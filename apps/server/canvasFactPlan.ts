import type {
  CanvasDimension,
  CanvasFilters,
  CanvasIntent,
} from "../../packages/contracts/canvas.ts";
import {
  factOperations,
  factPeriods,
  type FactPeriod,
  type FactPlan,
} from "../../packages/contracts/canvasFacts.ts";

import { supportsFactDisplay } from "./factDisplay.ts";

export function validFact(fact: unknown): fact is FactPlan {
  if (!fact || typeof fact !== "object") return false;
  const f = fact as Record<string, unknown>;
  return (
    Object.keys(f).every((k) =>
      ["operation", "period", "ascending", "dateField", "display", "limit"].includes(k),
    ) &&
    factOperations.some((v) => v === f.operation) &&
    (f.limit === undefined || (f.operation === "frequency" && typeof f.limit === "number" &&
      Number.isSafeInteger(f.limit) && f.limit > 0 && f.limit <= 999999)) &&
    (f.display === undefined || supportsFactDisplay(f.operation, f.display)) &&
    factPeriods.some((v) => v === f.period) &&
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
const cardinals: Record<string, number> = { один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10 };
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
const follow =
  /^(?:а |и |теперь |тогда )*(?:только|среди|из них|для |в продукте|по продукту|за |вчера|сегодня|без |кроме|исключ|не счи|оставь|огранич|ск[оo]ль?к[оo] (?:таких|из них))|^(?:а |и |теперь )ск[оo]ль?к[оo]\s+(?:уже\s+)?(?:закры|заверш|решен)/u;
const namedId =
  /(?<![\p{L}\p{N}_])(?:[a-zа-я][a-zа-я0-9]*(?:-[a-zа-я0-9]+)+|(?:inc|инц)\d+|\d{5,})(?![\p{L}\p{N}_-])/giu;
const normalized = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");

export function onlyTicketIds(shaped: string, idAliases: string[]) {
  const remainder = shaped
    .replace(/\bE\d+\b/gu, ref => idAliases.includes(ref) ? " " : ref)
    .replace(namedId, id => /\d/u.test(id) ? " " : id);
  return remainder !== shaped && /^[\s,;.№#]*(?:и[\s,;.№#]+)*$/u.test(remainder);
}

export function periodIn(s: string): FactPeriod | undefined {
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
  if (fact.operation === "duration" || fact.operation === "count")
    return (
      dimension === "ticket" &&
      (fact.operation === "duration" || !fact.ascending)
    );
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
    frequency.test(s) || workloadRank.test(s) || requestedLimit(s) !== undefined || commonality.test(s) || ticketCount.test(s) ||
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
    .sort((a, b) => a.at - b.at)[0]?.dimension;
  const limit = requestedLimit(measure);
  if (limit === 0) return { problem: "Укажите, сколько групп показать в рейтинге: нужно положительное число." };
  if (limit && dim && [...measure.matchAll(/(?:^|\s)по\s+(\p{L}+)/gu)].some(([, field]) =>
    !/^(?:числ|количеств|нагрузк|частот|заявк|обращени|инцидент|тикет|просроч|продукт|команд|статус|приоритет|симптом|состоян)/u.test(field)))
    return { problem: "Уточните показатель для рейтинга. По этим полям можно сравнить группы по количеству заявок." };
  const continuation =
    !!previous?.fact &&
    (follow.test(shaped) || /(?:из|среди) них/u.test(shaped));
  const namedStatus = /(?:со\s+статус(?:ом|ами)|в\s+статус(?:е|ах))/u.test(shaped);
  const hasClosed = closed.test(shaped);
  const actionStates = finished.test(shaped)
    ? (namedStatus && !hasClosed ? [7] : [7, 10])
    : hasClosed ? [10] : undefined;
  const period =
    periodIn(shaped) ?? (continuation ? previous!.fact!.period : "snapshot");
  let operation: FactPlan["operation"] | undefined;
  let dimension: CanvasDimension = dim ?? "ticket";
  let ids: string[] | undefined;
  if (
    pendingRelationIds !== undefined || (graph.test(shaped) || commonality.test(shaped)) &&
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
  } else if (dim && (frequency.test(measure) || workloadRank.test(measure) || limit !== undefined) &&
    !/(?:времени|по времени|длительност)/u.test(measure)) {
    operation = "frequency";
  } else if (
    extremum.test(shaped) &&
    resolution.test(shaped) &&
    (ticketTerm.test(shaped) ||
      /котор|како|какая|какие|кто|топ|рейтинг|рекорд/u.test(shaped))
  ) {
    operation = "duration";
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
    (ticketTerm.test(shaped) || actionStates || continuation) &&
    (timeQuestion.test(shaped) || continuation || (namedStatus && actionStates) ||
      (ticketCount.test(shaped) && !dim && !/(?:по|между)\s+\p{L}/u.test(measure)))
  ) {
    operation = "count";
    dimension = "ticket";
  } else if (continuation) {
    operation = previous!.fact!.operation;
    dimension = previous!.groupBy;
  } else return;
  if (
    operation !== "relations" &&
    /\d{1,4}[./-]\d{1,2}|\b(?:19|20)\d{2}\b|прошл\p{L}* (год|месяц|недел)|эт(?:ом|от) (?:год|месяц)|календарн|квартал|позавчера|\d+\s+(?:дн|день|дня|недел|месяц|год|лет|час|сут)|за сутки/u.test(
      shaped.replace(
        /12\s+месяц\p{L}*|365\s+(?:дней|суток)|7\s+дн\p{L}*/gu,
        "",
      ),
    )
  ) {
    return {
      problem:
        "Уточните период. Доступны сегодня, вчера, последние неделя, месяц и 12 месяцев.",
    };
  }
  if (
    /изменял|менял|переход|поменял|побывал|перешл|денег|выручк|ущерб|клиент(?:ов|ам)|пользователей|эскал|географ|регион|геолокац|первопричин|прогноз|(?:кроме|исключая|не считать|не считая|без учета|за исключением)\s|(?:не |без )просроч/u.test(
      shaped,
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
  const ascending =
    /реже|редк(?:ий|ая|ое)|меньше (?:всего|всех|остальных)|быстр|коротк|миним(?:ум|альн)|наимен(?:ьш|ее)/u.test(
      shaped,
    ) ||
    (continuation &&
      previous!.fact!.operation === operation &&
      previous!.fact!.ascending);
  // «Из них» refers to the previous cohort. Its date field stays in effect
  // unless the question explicitly introduces a new event period.
  const pinnedPeriod = continuation && !periodIn(shaped);
  const completionWindow =
    operation === "count" &&
    period !== "snapshot" &&
    (pinnedPeriod
      ? previous!.fact!.dateField || previous!.fact!.operation === "duration"
      : actionStates &&
        !intake.test(shaped) &&
        !/(?:со |в )статусе|со статусом/u.test(shaped));
  const states = operation === "count" ? actionStates : undefined;
  return {
    fact: {
      operation,
      period,
      ...(operation === "frequency" && limit !== undefined ? { limit } : {}),
      ...(completionWindow ? { dateField: "completionDate" } : {}),
      ...(ascending ? { ascending: true } : {}),
    },
    dimension,
    ids,
    states,
    continuation,
  };
}
