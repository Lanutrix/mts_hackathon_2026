import type { Incident } from "../../packages/domain/index.ts";
import { deadlineStatus, spaces, TEAM } from "../../packages/domain/index.ts";
import type { DispatchTeam } from "./dispatch.ts";
import type { VseLlm } from "./vsellm.ts";

export interface DispatchSuggestions {
  snapshot: string;
  mode: "model" | "local";
  model?: string;
  teams: { name: string; reason: string }[];
  comments: { label: string; text: string }[];
}

const planVersion = "assignment-guidance-1";
const instruction = `Ты помогаешь дежурному предложить команду назначения и черновики комментария для существующего инцидента. Вход содержит коды команд и число других инцидентов того же продукта, симптома, обоих. Предпочитай совпадение обоих признаков. currentTeam — текущее назначение, chosenTeam — выбор координатора для комментария. Сигнал followUp означает устранение последствий после решения. Дай JSON {"teams":["T1"],"comments":["scope","progress"]}. Выбери до трёх разных кодов из candidates и два разных уместных действия из actions. Если кандидатов нет, teams пуст. Не назначай команду, не называй людей и не добавляй полей.`;

function commentOptions(incident: Incident, now: number) {
  const due = deadlineStatus(incident.dates.deadline, now);
  const investigating = incident.stateId === 20;
  const product = spaces(incident.raw.productName);
  const subject = product ? " по продукту «" + product.slice(0, 85) + "»" : "";
  const options = {
    scope: {
      label: "Зона ответственности",
      text:
        "Проверьте, относится ли инцидент" +
        subject +
        " к зоне ответственности вашей команды. Если потребуется передача, уточните подходящую группу.",
    },
    progress: {
      label: "Ход решения",
      text:
        "Уточните, что уже проверили" +
        subject +
        ", какой следующий шаг планируется и когда будет следующее обновление.",
    },
    deadline: {
      label: "Срок решения",
      text: investigating
        ? "Уточните срок завершения разбора причин и следующего обновления карточки."
        : due === "overdue"
          ? "Срок решения прошёл. Подскажите, что препятствует восстановлению и когда ожидается решение."
          : "Сверьте срок решения с ходом работ. Если он под угрозой, сообщите причину и ближайший шаг.",
    },
    clarify: {
      label: "Уточнить срок",
      text: investigating
        ? "Уточните плановый срок завершения исследования и ответственного за обновление."
        : "В карточке не указан срок решения. Уточните ожидаемое время восстановления и ответственного за обновление.",
    },
    impact: {
      label: "Влияние сбоя",
      text:
        "Уточните, какие операции затронуты" +
        subject +
        " и что сейчас доступно пользователям.",
    },
    aftermath: {
      label: "Устранение последствий",
      text: "В карточке отмечено устранение последствий. Уточните, какие действия потребуются после восстановления и кто их проверит.",
    },
    research: {
      label: "Исследование ситуации",
      text: "Уточните результат исследования причин и какие наблюдения следует добавить в карточку инцидента.",
    },
  };
  return { options, due, investigating };
}

export type CommentTopic = NonNullable<import("../../packages/contracts/canvas.ts").CanvasIntent["commentDraft"]>;

export function commentText(incident: Incident, topic: CommentTopic, now: number) {
  if (incident.stateId === 7 || incident.stateId === 10) {
    const followUp = {
      deadline: "Просьба подтвердить фактическое время решения и соблюдение срока.",
      impact: "Просьба подтвердить, какие операции были затронуты и восстановлены.",
      progress: "Просьба зафиксировать результат работ и подтвердить восстановление.",
    };
    return "Статус заявки — «" + incident.stateLabel + "». " + followUp[topic];
  }
  const { options, due } = commentOptions(incident, now);
  return options[topic === "deadline" && due === "unset" ? "clarify" : topic].text;
}

export async function dispatchSuggestions(
  incident: Incident,
  catalog: { teams: DispatchTeam[] },
  snapshot: string,
  chosen: string | undefined,
  client?: VseLlm,
  now = Date.now(),
): Promise<DispatchSuggestions> {
  const matches = catalog.teams.filter((t) => t.both || t.product || t.symptom);
  const specialists = matches.filter((t) => t.name !== TEAM);
  const candidates = (specialists.length ? specialists : matches).slice(0, 6);
  const { options, due, investigating } = commentOptions(incident, now);
  type Action = keyof typeof options;
  const available: Action[] = [
    ...(investigating ? ["research" as const] : []),
    ...(due === "overdue" || due === "soon" ? ["deadline" as const] : []),
    ...(incident.raw.isNeedUp === true ? ["aftermath" as const] : []),
    ...(due === "unset" ? ["clarify" as const] : []),
    "scope",
    "progress",
    "impact",
    ...(due === "normal" ? ["deadline" as const] : []),
  ];
  const reason = (t: DispatchTeam) =>
    t.both
      ? "Совпали продукт и симптом в других инцидентах команды: " + t.both + "."
      : t.symptom
        ? "Такой же симптом в других инцидентах команды: " + t.symptom + "."
        : "Другие инциденты этого продукта у команды: " + t.product + ".";
  const teamRef = (name: string | undefined) => {
    const i = candidates.findIndex((t) => t.name === name);
    return i < 0 ? null : "T" + (i + 1);
  };
  const groups = candidates.map((t, i) => ({
    id: "T" + (i + 1),
    sameProduct: t.product,
    sameSymptom: t.symptom,
    both: t.both,
  }));
  const packet = {
    candidates: groups,
    currentTeam: teamRef(incident.team),
    chosenTeam: teamRef(chosen),
    state: incident.stateId,
    priority: incident.priorityId,
    deadline: due,
    followUp:
      incident.raw.isNeedUp === true
        ? true
        : incident.raw.isNeedUp === false
          ? false
          : null,
    actions: available,
  };
  let teams = candidates.slice(0, 3),
    actions: Action[] = available.slice(0, 2),
    usedModel = false;
  if (client) {
    const response = await client.json(planVersion, instruction, packet, 8000);
    if ("json" in response) {
      const p = response.json as { teams?: unknown; comments?: unknown } | null;
      if (
        p &&
        Array.isArray(p.teams) &&
        p.teams.length <= 3 &&
        (p.teams.length > 0 || !groups.length) &&
        p.teams.every((id) => groups.some((g) => g.id === id)) &&
        new Set(p.teams).size === p.teams.length &&
        Array.isArray(p.comments) &&
        p.comments.length >= 1 &&
        p.comments.length <= 3 &&
        p.comments.every((id) => available.includes(id)) &&
        new Set(p.comments).size === p.comments.length
      ) {
        teams = p.teams.map(
          (id) => candidates[groups.findIndex((g) => g.id === id)],
        );
        actions = p.comments as Action[];
        usedModel = true;
      } else client.rejectJson(planVersion, packet);
    }
  }
  return {
    snapshot,
    mode: usedModel ? "model" : "local",
    ...(usedModel ? { model: client!.model } : {}),
    teams: teams.map((t) => ({ name: t.name, reason: reason(t) })),
    comments: actions.map((id) => options[id]),
  };
}
