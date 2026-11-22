import { platformIcons, iconNames, type PlatformIcon } from "../../packages/domain/platformIcons.ts";
import {
  guidePages,
  guideTopics,
  type CanvasAnswer,
  type GuideFocus,
  type GuidePage,
  type GuideTopic,
} from "../../packages/domain/assistantGuide.ts";
import type { CanvasIntent } from "../../packages/contracts/canvas.ts";

export function isGuideTopic(value: unknown): value is GuideTopic {
  return typeof value === "string" && guideTopics.includes(value as GuideTopic);
}
export const guideFocuses = [
  "overview",
  "example",
  "steps",
  "distinction",
] as const;
export function makeAnswer(
  topic: GuideTopic,
  focus: GuideFocus = "overview",
  kind: CanvasAnswer["kind"] = "knowledge",
  related: GuideTopic[] = [],
): CanvasAnswer {
  const page: GuidePage = guidePages[topic];
  const focused = page.sections.filter((section) => section.role === focus);
  const other = [...new Set(related)]
    .filter((key) => key !== topic)
    .map((key) => guidePages[key]);
  const links = [...page.links, ...other.flatMap((entry) => entry.links)];
  return {
    ...page,
    links: links.filter(
      (link, i) =>
        links.findIndex((candidate) => candidate.anchor === link.anchor) === i,
    ),
    topic,
    kind,
    sections: other.length
      ? [
          ...other.map((entry) => ({
            role: "distinction" as const,
            heading: entry.title,
            body: entry.lead,
          })),
          ...(focused.length
            ? focused
            : page.sections
                .filter((section) => section.role === "example")
                .slice(0, 1)),
        ]
      : focused.length
        ? focused
        : page.sections,
  };
}
const iconAliases: Partial<Record<PlatformIcon, RegExp>> = {
  critical: /треугольник|восклицательн|критическ/iu, high: /шеврон|высок.{0,9}приоритет/iu,
  clock: /час(?:ы|ик|ов)|срок/iu, duration: /секундомер|длительност|врем.{0,8}решени/iu,
  escalation: /поворот|изогнут.{0,12}стрелк|последств/iu, research: /луп[ауы]|увеличительн|исследован/iu,
  bell: /колокол|уведомлен/iu, layers: /слои|сло[её]в|помощник/iu,
  ranking: /столбц|рейтинг/iu, relation: /связ[ие]|узл/iu, symptom: /пульс|симптом/iu,
};
export function iconGuide(question: string, previous?: CanvasIntent): CanvasAnswer | undefined {
  const q = question.toLocaleLowerCase("ru").trim();
  const isGlossary = /(?:знач(?:ок|к[аиоуе]|ков)|иконк|пиктограмм|условные обозначения|легенд[ау] знач)/u.test(q);
  if (!isGlossary && !(previous?.topic === "icons" && q.length < 65)) return;
  if (/сгруппируй|отфильтруй|построй|по командам|сколько заяв|диаграмм[ау] со знач|нарисуй|придумай|сочини/u.test(q)) return;
  const chosen = iconNames.filter(key => q.includes(platformIcons[key].label.toLocaleLowerCase("ru")) || iconAliases[key]?.test(q));
  if (!isGlossary && !chosen.length) return;
  const answer = makeAnswer("icons");
  if (!chosen.length) return answer;
  const sections = answer.sections.filter(section => section.icon && chosen.includes(section.icon));
  return { ...answer, title: sections.map(section => section.heading).join(" · "),
    lead: sections.map(section => section.body).join(" "), sections };
}

const topicPatterns: [GuideTopic, RegExp][] = [
  [
    "recommendation",
    /автоматич|автоматизац|(?:ии|систем\p{L}*|помощник|ты|срез)\s+(?:сам\p{L}*|закрыва\p{L}*|назнача\p{L}*|меня\p{L}*|реша\p{L}*|исправл\p{L}*)|рекомендац|вмешива\p{L}* в/u,
  ],
  [
    "massIncident",
    /массов\p{L}*\s+(?:сбо|инцидент|обращен)|(?:много|нескольк\p{L}*|множество)\s+(?:обращен|пользовател|заявок).*од(?:ин|ного)\s+сбо/u,
  ],
  ["serviceRequest", /запрос\p{L}* (?:на )?обслуживан/u],
  ["triage", /триаж|триажировать|triage/u],
  ["sla", /(?:^|[^a-z])sla(?:$|[^a-z])|соглашени\p{L}* об уровне сервис/u],
  [
    "lifecycle",
    /(?:как|что) (?:мне |нам )?(?:делать|действовать|обработать|реагировать|поступить)(?: при| с| если| на| в случае).*?(?:сбо|инцидент)|жизненн\p{L}* цикл/u,
  ],
  ["problem", /проблем\p{L}*|первопричин/u],
  [
    "assignment",
    /маршрутиз|назнач\p{L}*.*(?:команд|исполнител|сотрудник)|кому\s+(?:назнач|переда)|передать\s+(?:заявк|тикет)/u,
  ],
  ["signals", /уведомлен|пуш|сигнал\p{L}*\s+(?:эфир|об инцидент)/u],
  [
    "monitor",
    /(?:общ\p{L}*\s+экран|экран\s+наблюдения|телевизор|воллборд|wallboard)/u,
  ],
  [
    "devices",
    /темн\p{L}*\s+тем|светл\p{L}*\s+тем|установ\p{L}*\s+приложен|веб.?приложен|pwa/u,
  ],
  ["icons", /иконк|значок|значки|пиктограмм/u],
  ["escalation", /эскалац|эскалир/u],
  ["deadline", /просроч|срок|дедлайн|sla|сла(?:\s|$)/u],
  ["priority", /приоритет|критичност|критическ\p{L}* заявк/u],
  [
    "symptom",
    /симптом|похож\p{L}*\s+(?:заяв|проявлен|обращен)|схож\p{L}*\s+(?:заяв|проявлен|обращен)/u,
  ],
  ["status", /статус|состояни\p{L}*\s+заяв/u],
  [
    "assistant",
    /помощник|холст|что (?:ты |вы )?(?:умееш|можеш|можно)|чем (?:ты |вы )?мож/u,
  ],
  ["shift", /(?:экран|дашборд|панел)\p{L}*\s+эфир|эфир|смен[ауые]/u],
  [
    "incident",
    /инц[иеэ]дент|инциднент|инциндент|инцент|сбо[йяиею]|авари[яиюей]|отказ\p{L}* (?:сервис|услуг)|(?:нарушени|перерыв)\p{L}* (?:в )?работ\p{L}* сервис/u,
  ],
  ["ticket", /тикет|заявк|обращен|карточк|запис\p{L}*\s+itsm/u],
];
function topicIn(text: string) {
  return topicPatterns.find(([, pattern]) => pattern.test(text))?.[0];
}
function focusIn(text: string): GuideFocus {
  if (/с чего (?:мне |нам )?нач(?:ать|инать)/u.test(text)) return "steps";
  if (/пример|иллюстр|ситуаци\p{L}* из практик/u.test(text)) return "example";
  if (/разниц|отлич|чем .* от |одно и то же/u.test(text)) return "distinction";
  if (
    /как (?:мне |нам |можно )?(?:назнач|начать|настро|переда|провер|действов)|порядок|пошагов|что делать|(?:что|какие).*(?:провер|свер|уточн|сдела|предприн|шаги)|перед (?:тем |эскалац|передач|назначен)/u.test(
      text,
    )
  )
    return "steps";
  return "overview";
}
type Reading = {
  topic: GuideTopic;
  focus: GuideFocus;
  related?: GuideTopic[];
  data?: string;
};
function singleGuide(
  text: string,
  previous?: CanvasIntent,
): Reading | undefined {
  // A specific source record or an actual queue should be looked up, not replaced with a definition.
  if (
    /\b(?:inc|demo|sim)-[\w-]+|(?:№|номер[ау]?)\s*\d|сколько|статистик|по командам|по продуктам|на (?:моем|нашем) (?:холсте|эфире)|у нас (?:с|по) /iu.test(
      text,
    )
  )
    return;
  if (
    /почему.*(?:вырос|упал|произош|накопил|сломал|перестал|столько|возник|увеличил)|откуда взял|кто виноват/u.test(
      text,
    )
  )
    return;
  const topic = topicIn(text);
  const focus = focusIn(text);
  if (topic === "shift" && focus === "steps") return { topic, focus };
  const speech =
    /что (?:же )?(?:такое|такой|означа|значит|понима|представля|счита|за )|кто так|чем (?:отлич|разн|мож)|в чем|зачем|для чего|почему|можно ли|как(?:ая|ой|ие)? (?:действов|реагиров|обработ|следу|устро|пони|определ|работа|назнач|чита|посмотр|польз|увид|понят|включ|настро|установ|переда|откры|найти|найду|провер|прийти|отлич|получ|мне|появ|узна|происход|выбра|эт|координатор|помощник|система)|объясни|поясни|расскажи|определен|расшифр|имеетс?я в виду|простыми словами|помоги (?:разобр|понять)|чем .{1,80}отлич|какие (?:шаги|действи|провер)|что (?:именно |сначала )?(?:(?:я|мы|мне|нам) )?(?:долж|надо |нужно |стоит |провер|следует)|что дела|как начать|как с ним|что умееш|можешь ли/u.test(
      text,
    );
  const bareDefinition =
    /^(?:а\s+)?(?:инц[иеэ]дент|инциндент|тикет|эскалация|приоритет|просрочка|симптом|триаж|sla|статус|массовый инцидент)\s*[?!.]*$/u.test(
      text,
    );
  const systemAction =
    topic === "recommendation" &&
    /назнач|закры|меня|измен|отправля|реша|устраня|исправл/u.test(text);
  if (
    topic &&
    (speech ||
      systemAction ||
      bareDefinition ||
      /(?:^|\s)(?:это что|пример|разниц|одно и то же)(?:\s|$|[?!.,])/u.test(
        text,
      ) ||
      /^[\p{L}-]+\s*[?]$/u.test(text))
  )
    return { topic, focus };
  if (
    previous?.topic &&
    /(?:на |дай |приведи |есть |покажи |можно |а )?пример|поподробнее|подробнее|проще|повтори|поясни|простыми словами|что (?:это |дальше)|расскажи ещ|как с (?:ним|этим)|по шагам/u.test(
      text,
    )
  )
    return { topic: previous.topic, focus };
  if (
    /^(?:(?:ну |а )?(?:привет|здравствуй\p{L}*|добрый (?:день|вечер)|спасибо|помог[иите]+|что (?:ты |вы )?(?:умеешь|умеете|можешь|можете)|чем (?:ты |вы )?можешь помочь|\/help|справка))[!?.,\s]*$/u.test(
      text,
    )
  )
    return { topic: "assistant", focus: "overview" };
}
export function readGuide(
  question: string,
  previous?: CanvasIntent,
): Reading | undefined {
  const text = question
    .toLocaleLowerCase("ru")
    .normalize("NFKC")
    .replaceAll("ё", "е")
    .trim();
  // Separate the explanation from its requested data view, in either order.
  // Keep the original spelling of the data clause so its source aliases still match.
  const divider =
    /\s*(?:[;.!?]\s*|,?\s+(?:и |а |затем |потом |а затем |и затем ))(?=(?:покажи|сгруппируй|сравни|сколько|выведи|найди|отбери|построй|объясни|поясни|расскажи|что такое|что значит|чем отличается|какие|у каких|у кого))/giu;
  const clauses = question
    .split(divider)
    .map((part) => part.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    const reads = clauses.map((part) =>
      singleGuide(part.toLocaleLowerCase("ru").replaceAll("ё", "е"), previous),
    );
    const i = reads.findIndex(Boolean);
    if (i !== -1) {
      const data = clauses.filter((_, j) => !reads[j]).join(" и ");
      const main = reads[i]!;
      const related = [
        ...new Set(
          reads.flatMap((r) => (r && r.topic !== main.topic ? [r.topic] : [])),
        ),
      ].slice(0, 2);
      return {
        ...main,
        ...(related.length ? { related } : {}),
        ...(data ? { data } : {}),
      };
    }
  }
  return singleGuide(text, previous);
}
