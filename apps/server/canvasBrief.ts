import type { CanvasConversation, CanvasIntent } from "../../packages/contracts/canvas.ts";
import { deadlineStatus, type Incident } from "../../packages/domain/index.ts";
import { recurringSymptoms } from "../../packages/domain/symptoms.ts";
import { withoutPoliteRequest } from "./canvasAction.ts";
import { periodIn, readFact } from "./canvasFactPlan.ts";
import { initialIntent, localReading, sourceMentions, validFilters, type planCanvas } from "./canvasPlan.ts";

type Decision = Awaited<ReturnType<typeof planCanvas>>;
const openStates = [0, 2, 20];

export function briefRequest(question: string): "write" | "guide" | undefined {
  const text = withoutPoliteRequest(question.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е"));
  const document = /(?<!\p{L})(?:сводк[ауи]|отчет(?:а|у)?|резюме)(?!\p{L})/u.test(text);
  const handover = /(?:передач[аиуе]|сдач[аиуе]|сдаю|передаю)\s+(?:дежурства|смен[уы])|следующ\p{L}*\s+(?:смен|дежурн)|дежурн(?:ому|ым)|сменщик/u.test(text);
  const queue = /заяв[ко]|инцидент|тикет|обращени|очеред|дежурств|смен[уеы]|команд|продукт|просроч|срез|по ним|по этим/u.test(text);
  const bare = /(?:^|\s)(?:сводку|сводка|отчет|резюме)\s*(?:пожалуйста)?[?!.,\s]*$/u.test(text);
  if (!(document && (queue || bare) || handover && /что (?:мне |нам |важно |нужно )*(?:сказать|сообщить|передать|написать)|сообщени|текст|записк/u.test(text))) return;
  if (/как (?:мне |нам |можно |правильно |лучше |самому |самой )*(?:состав|сделать|сформир|подготов|собрать|писать|написать|оформить)|шаблон|инструкци|образец|что (?:нужно |стоит )?(?:включить|указать)|пример (?:сводки|отчета)/u.test(text))
    return "guide";
  if (/^(?:а |и |теперь |тогда |пожалуйста[, ]+|можно |мне |нуж(?:ен|на|но) |быстро |коротко |кратко )*(?:сводк|отчет|резюме|коротк|кратк|оперативн|дежурн|итогов|что (?:мне |нам |важно |нужно )*(?:сказать|сообщить|передать|написать)|(?:можешь |можете |помоги )?(?:состав|подготов|сдела|сформир|соб[еир]|собрать|напиш|написать|дай|дайте|давай|вывед|покаж|нуж|хочу|оформ|сгенерир|сформулир))/u.test(text))
    return "write";
}

const clarification = (text: string): Decision => ({
  mode: "unsupported", provider: "Поля ITSM", intent: initialIntent, textOnly: true,
  conversation: { title: "Уточните условия сводки", text },
});

export function planBrief(question: string, kind: "write" | "guide", rows: Incident[], previous?: CanvasIntent): Decision {
  if (kind === "guide") return {
    intent: initialIntent, mode: "knowledge", provider: "Справка Среза", textOnly: true,
    conversation: { title: "Как составить сводку",
      text: "Укажите, по какой очереди и за какой период передаёте смену. Запишите число открытых заявок, сколько из них с прошедшим сроком и сколько с отметкой об устранении последствий. Если срок скоро наступит, добавьте номер заявки и время из её карточки." },
  };
  const source = sourceMentions(question, rows, previous);
  const unknownOwner = /(?:заявк\p{L}*|заявок|инцидент\p{L}*|тикет\p{L}*)\s+(?:команды|продукта|сервиса)\s+(?!E\d+\b)[\p{L}\d_-]+/u;
  if (source.unknownExcludedTeam || unknownOwner.test(source.shaped.trim().replace(/\s+/gu, " ")) ||
      /\b(?:inc|sim|demo)-[\p{L}\d-]+/iu.test(source.shaped))
    return clarification("Уточните название команды или номер заявки. Часть условий не удалось сопоставить с источником.");
  const shaped = source.shaped.replace(/(?:устранени\p{L}*\s+последств\p{L}*|(?<=с |без )последств\p{L}*)/gu, "доработка");
  // A requested measure is part of the text to deliver, not a filter on the queue.
  const scopeText = shaped.replace(/(?:сколько|число|количество)\s+(?:(?:из них|у них|заявок|уже|с|требуют|нуждаются в)\s+)*(?:просроч\p{L}*|доработ\p{L}*|прош[её]л срок)/gu, "");
  const local = localReading(scopeText, source.mentioned, previous);
  const prior = local.reset ? undefined : previous;
  const plan = readFact(question, shaped, source.mentioned, prior, undefined, "count");
  if (!plan || "problem" in plan) return clarification(plan?.problem ?? "Уточните, какие заявки включить в сводку.");
  const filters = { ...prior?.filters, ...local.filters };
  for (const key of local.clear) delete filters[key];
  const newPeriod = periodIn(shaped);
  // Keep the original cohort, including the source field used for its date window.
  const fact = newPeriod ? plan.fact : prior?.fact;
  if (newPeriod && plan.states) filters.states = plan.states;
  if (fact && !filters.states && !filters.ids && !prior?.fact) filters.states = openStates;
  if (!validFilters(filters)) return clarification("Укажите до десяти значений для каждого поля.");
  const view: CanvasIntent = newPeriod ? { groupBy: "ticket", layout: "list", filters } : prior ?? initialIntent;
  const briefRank = prior?.briefRank ?? (prior?.rankFocus ? {
    groupBy: prior.groupBy, layout: prior.layout, filters: prior.filters, rankFocus: prior.rankFocus,
    ...(prior.fact ? { fact: prior.fact } : {}),
  } : undefined);
  return {
    mode: "snapshot", provider: "Поля ITSM",
    intent: { brief: true, groupBy: view.groupBy, layout: view.layout, filters,
      ...(view.presentation ? { presentation: view.presentation } : {}),
      ...(view.weightBy ? { weightBy: view.weightBy } : {}),
      ...(view.exhibits ? { exhibits: view.exhibits } : {}),
      ...(view.blocks ? { blocks: view.blocks } : {}),
      ...(briefRank ? { briefRank } : {}),
      ...(fact ? { fact } : {}) },
  };
}

const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short" });
const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", timeStyle: "short" });

export function briefAnswer(rows: Incident[], now: number, scope: string, period: string | undefined,
  overdue: number, escalated: number): CanvasConversation {
  const parts = [];
  const sourceIds = new Set<string>();
  if (scope) parts.push("Выборка — " + scope + ".");
  if (period) parts.push(period);
  if (!rows.length) parts.push("В этой выборке заявок нет.");
  else {
    const open = rows.filter(r => openStates.includes(r.stateId!));
    parts.push((open.length === rows.length ? "Открытых заявок — " : "Всего заявок — ") + rows.length + ".");
    parts.push("Указанный срок решения прошёл у " + overdue + ". Устранение последствий требуется у " + escalated + ".");
    const next = open.filter(r => deadlineStatus(r.dates.deadline, now) === "soon")
      .sort((a, b) => Date.parse(a.dates.deadline!) - Date.parse(b.dates.deadline!) || a.id.localeCompare(b.id, "ru"))[0];
    if (next) {
      sourceIds.add(next.id);
      const due = Date.parse(next.dates.deadline!);
      parts.push("Ближайший срок у " + next.id + " — " + time.format(due) + " МСК (" + date.format(due) + ").");
    }
    const themes = recurringSymptoms(rows);
    for (const { label, count, examples } of themes) {
      examples.forEach(e => sourceIds.add(e.id));
      parts.push("«" + label + "» — " + count + " из " + rows.length + ". Примеры — " + examples.map(e => e.id).join(" и ") + ".");
    }
    if (themes.length) parts.push(themes[0].check);
  }
  return { title: "Сводка для передачи смены", text: parts.join(" "), ...(sourceIds.size ? { sourceIds: [...sourceIds] } : {}) };
}
