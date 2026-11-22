import { canonical, type Raw } from "./index.ts";
import { FIXED_CLOCK, generate } from "./generator.ts";
import { trainingRows } from "./trainingShift.ts";

function roster(row: Raw) {
  return JSON.stringify([row.assignedGroupName, row.assignedEmployee, row.assignedEmployeeLogin]);
}

export function upgradeTraining(rows: Raw[], protectedIds: string[] = [], addedClock?: string): Raw[] {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const keys = new Set(rows.map(row => String(row.sysId)));
  const reference = generate(600, 42).rows;
  if (rows.some(row => /^DEMO-42-\d{5}$/.test(String(row.id)) && String(row.scenarioName).startsWith("Учебная смена · ")))
    return rows; // Already upgraded. Deliberately removed cases stay absent.
  const offsets = new Map<number, number>();
  for (const old of reference) {
    const row = byId.get(String(old.id));
    if (!row || row.sysId !== old.sysId)
      throw new Error("Исходный набор из 600 записей неполон или содержит заменённые идентификаторы.");
    const offset = Date.parse(String(row.submitDate)) - Date.parse(String(old.submitDate));
    if (Number.isFinite(offset)) offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
  }
  const anchor = [...offsets].sort((a, b) => b[1] - a[1])[0];
  if (!anchor || anchor[1] <= reference.length / 2)
    throw new Error("Не удалось подтвердить время исходного учебного набора.");
  const clock = new Date(Date.parse(FIXED_CLOCK) + anchor[0]).toISOString();
  const oldRows = generate(600, 42, clock).rows;
  const editable = new Map<string, Raw>();
  const protectedSet = new Set(protectedIds);
  for (const [index, old] of oldRows.entries()) {
    const id = String(old.id);
    const row = byId.get(id)!;
    const v1 = { ...old, serviceTypeId: index % 3 + 1, serviceType: ["Технический", "Клиентский", "Внутренний"][index % 3] };
    if (!protectedSet.has(id) && (canonical(row) === canonical(old) || canonical(row) === canonical(v1)))
      editable.set(id, row);
  }
  if (!editable.size) throw new Error("В источнике нет неизменённых записей исходного генератора.");
  const fresh = trainingRows(addedClock ?? clock, editable);
  const replacements = new Map(fresh.map(row => [String(row.id), row]));
  const additions = fresh.slice(600);
  if (additions.some(row => byId.has(String(row.id)) || protectedSet.has(String(row.id)) || keys.has(String(row.sysId))))
    throw new Error("Новый номер или sysId уже занят. Исходный файл сохранён.");
  const retainedRoster = new Set(rows.filter(row => !editable.has(String(row.id))).map(roster));
  const result = rows.map(row => {
    const id = String(row.id);
    if (!editable.has(id)) return row;
    const next = replacements.get(id)!;
    // Dispatch uses the current source as its roster. Keep one occurrence of
    // each historical team+person alongside the newly introduced specialists.
    const member = roster(row);
    if (!retainedRoster.has(member)) {
      retainedRoster.add(member);
      next.assignedGroupName = row.assignedGroupName;
      next.assignedEmployee = row.assignedEmployee;
      next.assignedEmployeeLogin = row.assignedEmployeeLogin;
    }
    return next;
  });
  return [...result, ...additions];
}
