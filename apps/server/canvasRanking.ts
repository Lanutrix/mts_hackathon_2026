import type { CanvasGroup, CanvasIntent } from "../../packages/contracts/canvas.ts";
import { canRedrawGroups } from "./factDisplay.ts";

export type RankFocus = NonNullable<CanvasIntent["rankFocus"]>;
export type RankRequest = {
  place?: RankFocus["place"];
  dimension?: "team" | "product" | "status";
  output: RankFocus["output"] | "clarify";
};

const order = ["перв", "втор", "трет", "четверт", "пят", "шест", "седьм", "восьм", "девят", "десят"];
const ordinal = /^(перв|втор|трет|четверт|пят|шест|седьм|восьм|девят|десят|последн)(?:ый|ой|ий|ая|яя|ое|ее|ем|ом|ей|ье|ья|ьей|ьем|ым|ую|юю)$/u;
const numericPlace = /^([1-9]\d{0,5})(?:-?(?:м|е|й|ом|ое|ый))?$/u;
const pronoun = "(?:у (?:них|нее|него)|на (?:них|нее|него))";
const tickets = "(?:заяв(?:ки|ок)|обращени[йя]|инцидент(?:ы|ов)|тикет(?:ы|ов))";
const count = new RegExp("^(?:сколько " + pronoun + "(?: " + tickets + ")?|сколько " + tickets + " " + pronoun + ")$", "u");
const share = /^(?:(?:какая|какова) (?:у (?:них|нее|него) доля|(?:их|ее|его) доля|доля у (?:них|нее|него))|какой (?:это|у них) процент|сколько это в процентах)$/u;
const register = new RegExp("^(?:(?:покажи|выведи|открой|перечисли|дай) )?(?:(?:их|ее|его) " + tickets + "|(?:заявки|обращения|инциденты|тикеты) " + pronoun + ")(?: списком)?$", "u");

export function readRankRequest(question: string, focused: boolean): RankRequest | undefined {
  const text = question.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[.,!?]+/gu, " ").trim().replace(/\s+/gu, " ").replace(/^(?:(?:а|и|тогда|теперь|пожалуйста) )+/u, "");
  const listAtPlace = /^(?:покажи|выведи|открой|перечисли) (?:заявки|тикеты|обращения|инциденты) (.+)$/u.exec(text)?.[1];
  const position = (listAtPlace ?? text)
    .replace(/^(?:кто|что|какая команда|какой продукт|какой статус|покажи|назови) /u, "")
    .replace(/^(?:идет|занимает|оказался|оказалась) /u, "")
    .replace(/^(?:у )?(?:команды |группы )?на /u, "")
    .replace(/ (?:в рейтинге|мест[ое]|команды|группы)$/u, "");
  const word = ordinal.exec(position)?.[1];
  const numeric = numericPlace.exec(position)?.[1];
  if (word || (numeric && position !== text)) return {
    place: word === "последн" ? "last" : word ? order.indexOf(word) + 1 : Number(numeric),
    dimension: text.includes("команд") ? "team" : text.includes("продукт") ? "product" : text.includes("статус") ? "status" : undefined,
    output: listAtPlace ? "tickets" : "position",
  };
  if (count.test(text)) return { output: "count" };
  if (share.test(text) || focused && text === "в процентах") return { output: "share" };
  if (register.test(text) || focused && /^(?:покажи )?(?:заявки )?списком$/u.test(text)) return { output: "tickets" };
  if (focused && /^(?:сколько|покажи|выведи|открой|какая доля)\s/u.test(text) &&
      /(?:^|\s)(?:у (?:них|нее|него)|их|его|ее)(?:\s|$)/u.test(text))
    return { output: "clarify" };
}

export function isGroupRanking(intent?: CanvasIntent) {
  return !!intent && (intent.fact?.operation === "frequency" || canRedrawGroups(intent));
}

export function rankingIntent(context: CanvasIntent): CanvasIntent {
  const { rankFocus, ...base } = context;
  return rankFocus ? { ...base, layout: "comparison", presentation: "bars" } : base;
}

const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
export function rankedGroups(groups: CanvasGroup[], total: number, focus: RankFocus) {
  if (focus.place === "shown" && groups.length) {
    const size = groups.reduce((sum, group) => sum + group.count, 0);
    const labels = groups.map(group => group.label).join(", ");
    return { chosen: groups, labels, position: "Группы", headline:
      labels + ". Вместе заявок: " + size + " из " + total + " (" + percent.format(size / total) + ")." };
  }
  // The server already ordered the original groups, including ascending frequency.
  // Each distinct count occupies one place and every group at that count belongs to it.
  const counts = [...new Set(groups.map(group => group.count))];
  const place = typeof focus.place === "number" ? focus.place : counts.length;
  const count = counts[place - 1];
  if (count === undefined) return { problem: counts.length
    ? "В этом рейтинге различных мест — " + counts.length + ". Укажите одно из них."
    : "В этом рейтинге нет групп с заявками." };
  const chosen = groups.filter(group => group.count === count);
  const size = count * chosen.length;
  const labels = chosen.map(group => group.label).join(", ");
  const position = place + "-е место";
  const headline = (chosen.length > 1
    ? position + " делят " + labels + ". У каждой группы по " + count + ", вместе " + size
    : position + " занимает " + labels + ". Заявок: " + size) +
    " из " + total + " (" + percent.format(size / total) + ").";
  return { chosen, headline, labels, position };
}
