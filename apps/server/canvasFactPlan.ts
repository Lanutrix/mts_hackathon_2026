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

export function validFact(fact: unknown): fact is FactPlan {
  if (!fact || typeof fact !== "object") return false;
  const f = fact as Record<string, unknown>;
  return (
    Object.keys(f).every((k) =>
      ["operation", "period", "ascending"].includes(k),
    ) &&
    factOperations.some((v) => v === f.operation) &&
    factPeriods.some((v) => v === f.period) &&
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
const quantity = /сколько|подсчита[йть]|количеств|число/u;
const list =
  /перечисл|перечень|список|назови|какие|каков\p{L}* состав|как\p{L}* называ/u;
const frequency =
  /сам\p{L}*\s+(?:часто\s+)?встреча|чаще|часты[йемх]|частая|частом|наиболее част|распростран|преоблада|превалир|доминиру|лидиру|больше всего|большинств|популярн|реже|редк(?:ий|ая|ое)|меньше всего/u;
const extremum =
  /дольш|долг|длительн|медлен|быстр|коротк|минимальн|максимальн|больше всего|меньше всего|наибольш|наименьш|сам\p{L}* много/u;
const resolution =
  /долгореша|реш(?:ени|али|ал[ио]?|ен|ил|а[лт]с)|устран|закры[тв]|закрыли|закрывал|заверш|чинил|почин|восстанов/u;
const timeQuestion =
  /сегодня|сегодняш|вчера|недел|месяц|год(?:а|у|ом)?(?!\p{L})|сутки/u;
const graph =
  /связ[ьиьяеи]|связан|связыва|зависимост|отношени|граф(?!ик)|схем|диаграмм/u;
const relation = /связ[ьиьяеи]|связан|связыва|зависимост|отношени/u;
const ticketTerm = /заяв[ко]|инцидент|тикет|обращени|сбо[яией]|проблем/u;
const follow =
  /^(?:а |и |теперь |тогда )*(?:только|среди|из них|для |в продукте|по продукту|за |вчера|сегодня|без |оставь|огранич|сколько (?:таких|из них))/u;
const namedId =
  /(?<![\p{L}\p{N}_])(?:[a-zа-я][a-zа-я0-9]*(?:-[a-zа-я0-9]+)+|(?:inc|инц)\d+|\d{5,})(?![\p{L}\p{N}_-])/giu;
const normalized = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");
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
    frequency.test(s) ||
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
      continuation: boolean;
    }
  | { problem: string };
export function readFact(
  question: string,
  shaped: string,
  mentioned: CanvasFilters,
  previous?: CanvasIntent,
): Reading | undefined {
  const original = normalized(question);
  if (/что такое|что означает|что значит|объясни понятие/u.test(original))
    return;
  // A named scope can precede the measured dimension ("для команды E1 какой статус...").
  const measure = shaped.replace(
    /(?:для|из|в|у|по|от|к)\s+(?:команд|продукт|сервис|статус|приоритет)\p{L}*\s+E\d+/gu,
    " ",
  );
  const dim = dimensions
    .map(([pattern, dimension]) => ({ at: measure.search(pattern), dimension }))
    .filter((d) => d.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.dimension;
  const continuation = !!previous?.fact && follow.test(shaped);
  const period =
    periodIn(shaped) ?? (continuation ? previous!.fact!.period : "snapshot");
  let operation: FactPlan["operation"] | undefined;
  let dimension: CanvasDimension = dim ?? "ticket";
  let ids: string[] | undefined;
  if (
    graph.test(shaped) &&
    (mentioned.ids?.length ||
      (relation.test(shaped) && ticketTerm.test(shaped)) ||
      /(?:inc|demo|sim)[-\d]/iu.test(shaped))
  ) {
    const cited = [...(mentioned.ids ?? [])];
    for (const match of question.matchAll(namedId)) {
      const id = match[0];
      if (
        /\d/u.test(id) &&
        !cited.some((v) => normalized(v) === normalized(id))
      )
        cited.push(id);
    }
    ids = cited.length ? cited : previous?.filters.ids;
    if (!ids || ids.length < 2)
      return {
        problem:
          "Укажите номера как минимум двух заявок, чтобы построить схему связей.",
      };
    operation = "relations";
    dimension = "ticket";
  } else if (
    extremum.test(shaped) &&
    resolution.test(shaped) &&
    (ticketTerm.test(shaped) ||
      /котор|како|какая|какие|кто|топ|рейтинг/u.test(shaped))
  ) {
    operation = "duration";
    dimension = "ticket";
  } else if (dim && frequency.test(shaped)) {
    operation = "frequency";
  } else if (
    dim &&
    (quantity.test(shaped) || list.test(shaped)) &&
    !/(?:список|перечисли|какие|назови)\s+(?:заяв|инцидент|тикет|обращен)/u.test(
      shaped,
    ) &&
    !/диаграмм|рейтинг|график|карточк|матриц|таблиц|схем|сравн|сгрупп|группиру/u.test(
      shaped,
    ) &&
    !/(?:сколько|число|количеств\p{L}*)\s+(?:всего\s+)?(?:заяв|инцидент|тикет|обращен)/u.test(
      shaped,
    )
  ) {
    operation = "distinct";
  } else if (
    quantity.test(shaped) &&
    ticketTerm.test(shaped) &&
    timeQuestion.test(shaped)
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
    /изменял|менял|переход|поменял|побывал|перешл|денег|выручк|ущерб|клиент(?:ов|ам)|пользователей|эскалаци|первопричин|прогноз|(?:кроме|исключая)\s|(?:не |без )просроч/u.test(
      shaped,
    ) ||
    /(?:по|для|из|в|у|к)\s+(?:команд[ыеу]|продукт[аеу]|сервис[аеу])\s+(?!E\d+(?!\d)|(?:с|без|и|где)\s)[\p{L}\d_-]+/u.test(
      shaped.trim().replace(/\s+/gu, " "),
    ) ||
    /[«"][^»"]*[\p{L}\d][^»"]*[»"]/u.test(shaped.replace(/\bE\d+\b/gu, ""))
  ) {
    return {
      problem:
        "Условия вопроса не удалось сопоставить с полями текущего источника. Уточните показатель или точное название команды и продукта.",
    };
  }
  const ascending =
    /реже|редк(?:ий|ая|ое)|меньше всего|быстр|коротк|минимальн|наименьш/u.test(
      shaped,
    ) ||
    (continuation && previous!.fact!.ascending);
  return {
    fact: { operation, period, ...(ascending ? { ascending: true } : {}) },
    dimension,
    ids,
    continuation,
  };
}
