import { deadlineStatus, hash, PRIORITIES, spaces, STATES, type Incident } from "./index.ts";
import type { CaseEvidence, TriageCase } from "./triage.ts";

const localChecks = {
  missingSource: "Сверьте наличие заявки в ITSM.",
  overdue: "Запросите новый срок решения.",
  soon: "Уточните, успевает ли команда к сроку.",
  followUp: "Уточните, какие последствия нужно устранить.",
  missingDeadline: "Запросите срок решения.",
  coordinator: "Проверьте, кто принял заявку в работу.",
  research: "Запросите результат исследования.",
  missingTeam: "Уточните ответственную команду.",
  progress: "Уточните ход работ у команды.",
} as const;

export type LiveReason = keyof typeof localChecks;
export interface LiveStep {
  key: string;
  ticketId: string;
  reason: LiveReason;
  action: string;
  basis: string;
  evidence: CaseEvidence;
}

function reasonFor(row: Incident, deadline: ReturnType<typeof deadlineStatus>): LiveReason {
  if (!row.sourcePresent) return "missingSource";
  if (deadline === "overdue" || deadline === "soon") return deadline;
  if (row.raw.isNeedUp === true) return "followUp";
  if (deadline === "unset") return "missingDeadline";
  if (row.groups.includes("coordinators")) return "coordinator";
  if (row.stateId === 20) return "research";
  return row.team ? "progress" : "missingTeam";
}

type GroupLoad = Pick<TriageCase, "count" | "soon" | "overdue">;

function volume(count: number) {
  if (count < 10) return count;
  for (const [low, high] of [[10, 29], [30, 99], [100, 299], [300, 799]])
    if (count <= high) return low + "–" + high;
  return "800+";
}

// Only source-independent labels and aggregates may leave the process. Keep the
// decision key and the provider input on the same set of observable facts.
export function liveFacts(row: Incident, now: number, group: GroupLoad) {
  const deadline = deadlineStatus(row.dates.deadline, now);
  const timing = {
    overdue: "Срок решения уже прошёл", soon: "До срока решения не более 15 минут",
    normal: "До срока решения больше 15 минут", unset: "Срок решения не указан",
  };
  const signals = { critical: "наивысший приоритет", high: "высокий приоритет", coordinators: "у координаторов", research: "на исследовании" };
  return {
    deadline: deadline === "unset" && row.raw.deadline ? "Срок решения указан некорректно" : timing[deadline],
    priorityId: PRIORITIES[row.priorityId!] ?? "Приоритет неизвестен",
    stateId: STATES[row.stateId!]?.label ?? "Статус неизвестен",
    sourcePresent: row.sourcePresent,
    assignedGroupName: row.groups.includes("coordinators") ? "Группа координаторов" : row.team ? "Команда указана" : "Команда не указана",
    assignedEmployee: !!spaces(row.raw.assignedEmployee),
    isNeedUp: typeof row.raw.isNeedUp === "boolean" ? row.raw.isNeedUp : null,
    signals: row.groups.map(g => signals[g]).sort().join(", "),
    "group.count": volume(group.count), "group.soon": volume(group.soon), "group.overdue": volume(group.overdue),
    "group.allOverdue": group.count > 0 && group.overdue === group.count,
  };
}

export function liveStep(row: Incident, now: number, group: GroupLoad): LiveStep {
  const deadline = deadlineStatus(row.dates.deadline, now);
  const reason = reasonFor(row, deadline);
  const facts: Record<LiveReason, [string, string]> = {
    missingSource: ["sourcePresent", "Заявка отсутствует в последней выгрузке."],
    overdue: ["deadline", "Срок решения уже прошёл."],
    soon: ["deadline", "До срока решения осталось не более 15 минут."],
    followUp: ["isNeedUp", "В заявке отмечено устранение последствий."],
    missingDeadline: ["deadline", row.raw.deadline
      ? "В карточке указан некорректный срок решения."
      : "В карточке не указан срок решения."],
    coordinator: ["assignedGroupName", "Заявка назначена группе координаторов."],
    research: ["stateId", "Заявка находится на исследовании."],
    missingTeam: ["assignedGroupName", "В карточке не указана команда."],
    progress: ["assignedGroupName", row.team.length <= 54
      ? "Назначена команда «" + row.team + "»."
      : "В карточке указана ответственная команда."],
  };
  const [field, basis] = facts[reason];
  const raw = field === "sourcePresent" ? row.sourcePresent : row.raw[field];
  const value = raw == null || raw === "" ? "Не указано" : String(raw);
  const key = hash([row.id, reason, liveFacts(row, now, group)]);
  return { key, ticketId: row.id, reason, action: localChecks[reason], basis,
    evidence: { id: row.id, field, value: value.slice(0, 360) } };
}
