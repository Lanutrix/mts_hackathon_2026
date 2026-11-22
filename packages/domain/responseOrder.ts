import type { Incident } from "./index.ts";

// Each ticket has one next decision. Order is explicit so volume and arrival
// time cannot outweigh an individual incident that needs an earlier response.
export const responseBands = [
  { key: "criticalDeadline", label: "Срочные критические", basis: "Критический инцидент, срок уже прошёл или наступит в ближайшие 15 минут.", field: "deadline" },
  { key: "critical", label: "Проверить критические", basis: "Активный инцидент с наивысшим приоритетом в ITSM.", field: "priorityId" },
  { key: "overdue", label: "Запросить новый срок", basis: "Срок решения уже прошёл, заявка остаётся открытой.", field: "deadline" },
  { key: "soon", label: "Успеть к сроку", basis: "До срока решения осталось не более 15 минут.", field: "deadline" },
  { key: "followUp", label: "Уточнить последствия", basis: "В ITSM отмечена необходимость устранить последствия.", field: "isNeedUp" },
  { key: "handoff", label: "Определить ответственного", basis: "Заявка у координаторов или команда в карточке не указана.", field: "assignedGroupName" },
  { key: "research", label: "Сверить исследование", basis: "В ITSM идёт исследование ситуации.", field: "stateId" },
  { key: "monitor", label: "Проверить ход работ", basis: "Активная заявка у команды без более срочного сигнала.", field: "assignedGroupName" },
  { key: "verify", label: "Сверить с источником", basis: "Заявка отсутствует в последней выгрузке. Проверьте её состояние в ITSM.", field: "sourcePresent" },
] as const;

export function responseRank(row: Incident, now: number) {
  if (!row.sourcePresent) return 8;
  const remaining = row.dates.deadline ? Date.parse(row.dates.deadline) - now : Infinity;
  if (row.groups.includes("critical")) return remaining <= 900_000 ? 0 : 1;
  if (remaining < 0) return 2;
  if (remaining <= 900_000) return 3;
  if (row.raw.isNeedUp === true) return 4;
  if (!row.team || row.groups.includes("coordinators")) return 5;
  if (row.stateId === 20) return 6;
  return 7;
}

const byId = new Intl.Collator("ru", { numeric: true });
export function compareResponse(a: Incident, b: Incident, now: number) {
  return responseRank(a, now) - responseRank(b, now) ||
    (a.dates.deadline ?? "\uffff").localeCompare(b.dates.deadline ?? "\uffff") ||
    (b.priorityId ?? 0) - (a.priorityId ?? 0) ||
    byId.compare(a.id, b.id) || a.key.localeCompare(b.key);
}
