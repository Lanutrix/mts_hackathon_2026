import {
  answerExhibits,
  answerPresentations,
  type AnswerExhibitId,
  type AnswerPresentation,
} from "../../packages/contracts/answerCatalog.ts";
import type { CanvasView } from "../../packages/contracts/canvas.ts";
const formWords: [AnswerPresentation, RegExp][] = [
  ["matrix", /(?:теплов\p{L}*\s+карт|матриц)/u],
  [
    "orbit",
    /кольц|кругов\p{L}*|сектор|пончик/u,
  ],
  ["flow", /схем|иерарх|дерев|ветв|поток|разветв/u],
  [
    "bars",
    /рейтин|ранжир|столб|гистограмм|полос(?:к|ам|ами)|топ(?:[-\s]?\d+|\s+команд)|рейтинг/u,
  ],
  [
    "cards",
    /(?:карточк|карточек)\p{L}* (?:групп|команд|продукт|приоритет|симптом)|(?:групп|команд|продукт|приоритет|симптом)\p{L}* карточк|(?:в виде|в форме|формат\p{L}*) (?:карточек|карточк)|карточками|плитк/u,
  ],
  ["squares", /квадрат|treemap|тр[ие]мап/u],
  [
    "compare",
    /(?:сравнительн\p{L}* таблиц|таблиц\p{L}* сравн|сравни .*таблиц)/u,
  ],
  ["deadline", /(?:шкал\p{L}*\s+(?:срок|времен)|лент\p{L}*\s+срок|таймлайн)/u],
  [
    "spotlight",
    /(?:отдельн\p{L}* карточк|портрет заявки|разбери заявку|одн\p{L}*\s+(?:конкретн\p{L}*\s+)?(?:тикет|заявк)|главн\p{L}* тикет|сам(?:ое|ая|ый)\s+срочн|(?:что|какую заявку|какой тикет)\s+(?:(?:мне|нам|нужно|стоит)\s+)*(?:проверить|открыть|взять|посмотреть)\s+(?:сначала|перв\p{L}*|в первую очередь))/u,
  ],
  ["register", /реестр|перечисл|спис(?:ок|ком|ке)/u],
  [
    "brief",
    /кратк|коротк\p{L}* (?:сводк|итог|вывод)|главн\p{L}* вывод|текстом|резюме|в двух словах/u,
  ],
];
const exhibitWords: [AnswerExhibitId, RegExp][] = [
  ["median-overdue", /медиан\p{L}*\s+(?:числ\p{L}*\s+)?просроч/u],
  ["median-load", /медиан(?!\p{L}*\s+(?:числ\p{L}*\s+)?просроч)/u],
  ["mean-load", /средн\p{L}* (?:нагрузк|числ|количеств|размер)/u],
  ["load-range", /разброс|диапазон.*нагруз|минимум и максимум/u],
  [
    "top-two",
    /дв[ае]\s+(?:крупнейш|главн|сам\p{L}* загруж|лидирующ)|дол\p{L}* двух|топ[ -]?2/u,
  ],
  ["pareto", /парето|80\s*%|80 процент/u],
  ["leader-gap", /отрыв|разрыв между|насколько опереж/u],
  [
    "tied-leaders",
    /делят (?:перв|лидер)|лидер\p{L}* поровну|лидер\p{L}* с равн/u,
  ],
  ["singletons", /по одной заявке|единственн\p{L}* заявк/u],
  ["clean-groups", /без (?:просрочек|просрочки) и доработ/u],
  ["groups-overdue", /сколько (?:групп|команд) с просроч/u],
  ["groups-escalated", /сколько (?:групп|команд) с доработ/u],
  ["highest-late-rate", /(?:максимальн|наибольш)\p{L}* дол\p{L}* просроч/u],
  ["late-leader", /(?:где|у кого).*больше всего просроч/u],
  ["escalation-leader", /(?:где|у кого).*больше всего доработ/u],
  ["on-time", /сколько (?:заявок |обращений )?без просроч/u],
  ["overdue-rate", /(?:процент|дол\p{L}*) просроч/u],
  [
    "escalation-rate",
    /(?:процент|дол\p{L}*) (?:заявок )?(?:с |к |на )?доработ/u,
  ],
  ["soon-rate", /(?:процент|дол\p{L}*) .*15 минут/u],
  ["scope-share", /дол\p{L}* выборки|дол\p{L}* (?:от |в )?источник/u],
  ["group-count", /сколько (?:групп|команд|продуктов)|число групп/u],
  ["concentration", /концентрац|сосредоточен/u],
  ["first-group", /кто лидирует|крупнейш\p{L}* групп|самая нагруженная/u],
];
export function validVisual(view: Record<string, unknown>) {
  return (
    (view.presentation === undefined ||
      answerPresentations.includes(view.presentation as AnswerPresentation)) &&
    (view.exhibits === undefined ||
      (Array.isArray(view.exhibits) &&
        view.exhibits.length <= 3 &&
        view.exhibits.every((id) => answerExhibits.includes(id)) &&
        new Set(view.exhibits).size === view.exhibits.length))
  );
}
export function explicitPresentation(question: string) {
  return formWords.find(([, pattern]) => pattern.test(question))?.[0];
}

export function readVisual(question: string): Partial<CanvasView> {
  const exhibits = exhibitWords
    .filter(([, pattern]) => pattern.test(question))
    .map(([id]) => id)
    .slice(0, 3);
  const presentation =
    explicitPresentation(question) ??
    (exhibits.length ? "brief" : inferredPresentation(question));
  return {
    ...(presentation ? { presentation } : {}),
    ...(exhibits.length ? { exhibits } : {}),
  };
}

export function inferredPresentation(question: string): AnswerPresentation | undefined {
  if (
    /дол[яию]\s+(?:кажд|команд|продукт|групп)|структур\p{L}*\s+дол|распредел\p{L}*.*(?:между|по)\s+(?:разн\p{L}*\s+)?(?:команд|продукт|приоритет|статус|симптом)|(?:часть|дол[яиюе]|процент)\p{L}*.*(?:приходится|приходятся|у кажд|на кажд|по команд|по продукт)/u.test(question)
  ) return "orbit";
  if (
    /(?:какие|которые|назови)\s+(?:(?:сейчас|открытые|активные|просроченные|критичные|закрытые)\s+)*(?:заявки|тикеты|обращения|инциденты)(?!\p{L})/u.test(question)
  ) return "register";
}
export function withVisual<T extends CanvasView>(
  view: T,
  visual: Partial<CanvasView>,
): T {
  const presentation = visual.presentation ?? view.presentation;
  const exhibits = visual.exhibits ?? view.exhibits;
  if (!presentation && !exhibits) return view;
  const result = {
    ...view,
    ...(presentation ? { presentation } : {}),
    ...(exhibits ? { exhibits } : {}),
  };
  if (presentation === "register" || presentation === "spotlight")
    result.layout = "list";
  else if (presentation === "compare") result.layout = "comparison";
  else if (presentation) {
    result.layout = "groups";
    if (presentation === "deadline") result.groupBy = "deadline";
  }
  // Group evidence must be calculated on partitions, which registers do not carry.
  if (result.layout === "list") delete result.exhibits;
  return result;
}
