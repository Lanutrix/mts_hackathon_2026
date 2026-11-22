import { deadlineStatus, hash, spaces, type Incident } from "./index.ts";
import type { CaseEvidence, TriageCase } from "./triage.ts";

// Each pair contains manual checks justified by the same source field.
export const liveChecks = {
  missingSource: ["Сверьте наличие заявки в ITSM.", "Проверьте заявку в последней выгрузке ITSM."],
  overdue: ["Запросите новый срок решения.", "Уточните, что задерживает решение."],
  soon: ["Уточните, успевает ли команда к сроку.", "Спросите, какая работа осталась до срока."],
  followUp: ["Уточните, какие последствия нужно устранить.", "Запросите план устранения последствий."],
  missingDeadline: ["Запросите срок решения.", "Уточните, когда команда сможет назвать срок."],
  coordinator: ["Проверьте, кто принял заявку в работу.", "Уточните у координатора следующий шаг по заявке."],
  research: ["Запросите результат исследования.", "Уточните, какую гипотезу сейчас проверяют."],
  missingTeam: ["Уточните ответственную команду.", "Проверьте, кто должен принять заявку в работу."],
  progress: ["Уточните ход работ у команды.", "Запросите время следующего обновления."],
} as const;

export type LiveReason = keyof typeof liveChecks;
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

export function liveStep(row: Incident, now: number, group: Pick<TriageCase, "count" | "soon" | "overdue">): LiveStep {
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
  const key = hash([row.id, reason, value, row.priorityId, row.stateId,
    !!spaces(row.raw.assignedEmployee), !!row.team, deadline, row.raw.isNeedUp === true,
    group.count, group.soon, group.overdue]);
  return { key, ticketId: row.id, reason, action: liveChecks[reason][0], basis,
    evidence: { id: row.id, field, value: value.slice(0, 360) } };
}
