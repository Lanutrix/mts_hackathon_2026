import { createHash } from "node:crypto";

import { FIELDS, STATES, PRIORITIES } from "./incidentFields.ts";
export { FIELDS, STATES, PRIORITIES } from "./incidentFields.ts";
export const TEAM = "КЦ ИТ Координаторы Массовых Инцидентов";
export const GROUPS = ["critical", "coordinators", "high", "research"] as const;
export type Group = (typeof GROUPS)[number];
export type Raw = Record<string, unknown>;
export interface Issue {
  field: string;
  code: string;
  message: string;
  severity: "warning" | "error";
}
export interface Incident {
  key: string;
  id: string;
  raw: Raw;
  hash: string;
  stateId: number | null;
  stateLabel: string;
  priorityId: number | null;
  priorityLabel: string;
  team: string;
  dates: Record<string, string | null>;
  issues: Issue[];
  quarantined: boolean;
  groups: Group[];
  sourcePresent: boolean;
  revision: number;
  updatedAt: string;
}
export interface Snapshot {
  rows: Incident[];
  hash: string;
  issues: Issue[];
}
export class ValidationError extends Error {
  constructor(public issues: Issue[]) {
    super(issues.map((i) => i.message).join("; "));
  }
}
export const canonical = (x: unknown): string =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b, "en")),
        )
      : v,
  );
export const hash = (x: unknown) =>
  createHash("sha256").update(canonical(x)).digest("hex");
export const spaces = (s: unknown) =>
  typeof s === "string" ? s.trim().replace(/\s+/gu, " ") : "";
export function membership(
  i: Pick<Incident, "stateId" | "priorityId" | "team" | "quarantined">,
): Group[] {
  if (i.quarantined) return [];
  const active = i.stateId === 0 || i.stateId === 2;
  return GROUPS.filter((g) =>
    g === "critical"
      ? active && i.priorityId === 4
      : g === "coordinators"
        ? [0, 2, 20].includes(i.stateId!) && i.team === TEAM
        : g === "high"
          ? active && i.priorityId === 3
          : i.stateId === 20,
  );
}
const dateFields = [
  "submitDate",
  "deadline",
  "completionDate",
  "lastAssignmentToTeamDateTime",
  "waitingExitDate",
];
const boolFields = [
  "isEffect",
  "isReason",
  "isDouble",
  "isMaster",
  "isRootIncident",
  "isNeedUp",
];
const numberFields = [
  "stateId",
  "priorityId",
  "serviceTypeId",
  "urgencyId",
  "impactId",
];
export function normalize(raw: Raw, namespace: string): Incident {
  const issues: Issue[] = [];
  const issue = (
    field: string,
    code: string,
    message: string,
    severity: Issue["severity"] = "warning",
  ) => issues.push({ field, code, message, severity });
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 200)
    throw new ValidationError([
      {
        field: "id",
        code: "identity",
        message: "id должен быть непустой строкой до 200 символов",
        severity: "error",
      },
    ]);
  if (
    raw.sysId != null &&
    (typeof raw.sysId !== "string" ||
      !raw.sysId.trim() ||
      raw.sysId.length > 200)
  )
    throw new ValidationError([
      {
        field: "sysId",
        code: "identity",
        message: "sysId должен оставаться точной непустой строкой",
        severity: "error",
      },
    ]);
  if (raw.sysId == null)
    issue("sysId", "fallback", "Нет sysId: используется строковый id");
  for (const f of FIELDS)
    if (!(f in raw)) issue(f, "missing", `Отсутствует поле ${f}`);
  for (const f of boolFields)
    if (raw[f] != null && typeof raw[f] !== "boolean")
      issue(f, "type", `${f}: ожидается boolean или null`, "error");
  for (const f of numberFields)
    if (
      raw[f] != null &&
      (!Number.isInteger(raw[f]) || typeof raw[f] !== "number")
    )
      issue(f, "type", `${f}: ожидается целое число`, "error");
  const stateId =
    typeof raw.stateId === "number" && STATES[raw.stateId] ? raw.stateId : null;
  if (stateId === null)
    issue(
      "stateId",
      "unknown-state",
      "Неизвестный статус: требуется сверка",
      "error",
    );
  else if (raw.stateEnum !== STATES[stateId].enum)
    issue(
      "stateEnum",
      "state-conflict",
      "Код и enum статуса не согласованы: требуется сверка",
      "error",
    );
  const priorityId =
    typeof raw.priorityId === "number" && PRIORITIES[raw.priorityId]
      ? raw.priorityId
      : null;
  if (priorityId === null)
    issue("priorityId", "unknown-priority", "Неизвестный приоритет", "error");
  else if (raw.priority !== PRIORITIES[priorityId])
    issue(
      "priority",
      "priority-label",
      "Подпись приоритета нормализована по priorityId",
    );
  const dates: Record<string, string | null> = {};
  for (const f of dateFields) {
    const v = raw[f];
    dates[f] = null;
    if (v == null || v === "") continue;
    if (f === "waitingExitDate" && v === "0001-01-01T00:00:00") {
      issue(f, "zero-date", "Нулевая дата представлена как «не задано»");
      continue;
    }
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        v,
      ) ||
      !Number.isFinite(Date.parse(v))
    ) {
      issue(
        f,
        "invalid-date",
        `${f}: нужна корректная дата с часовым поясом`,
        "error",
      );
      continue;
    }
    const day = Number(v.slice(8, 10)),
      month = Number(v.slice(5, 7)),
      year = Number(v.slice(0, 4));
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    ) {
      issue(f, "invalid-date", `${f}: невозможная календарная дата`, "error");
      continue;
    }
    dates[f] = new Date(v).toISOString();
  }
  if (
    dates.completionDate &&
    dates.submitDate &&
    dates.completionDate < dates.submitDate
  )
    issue(
      "completionDate",
      "chronology",
      "Завершение раньше регистрации",
      "error",
    );
  if ((stateId === 0 || stateId === 2) && spaces(raw.solution))
    issue(
      "solution",
      "active-solution",
      "Предыдущая попытка / несогласованные данные: инцидент остаётся активным",
    );
  const quarantined = issues.some((i) => i.severity === "error");
  const result: Incident = {
    key: `${namespace}:${raw.sysId == null ? "id" : "sysId"}:${raw.sysId ?? raw.id}`,
    id: raw.id,
    raw,
    hash: hash(raw),
    stateId,
    stateLabel: stateId === null ? "Неизвестен" : STATES[stateId].label,
    priorityId,
    priorityLabel: priorityId === null ? "Неизвестен" : PRIORITIES[priorityId],
    team: spaces(raw.assignedGroupName),
    dates,
    issues,
    quarantined,
    groups: [],
    sourcePresent: true,
    revision: 0,
    updatedAt: "",
  };
  result.groups = membership(result);
  return result;
}
export function parseSnapshot(
  text: string,
  namespace: string,
  maxBytes = 20 * 1024 * 1024,
): Snapshot {
  const fail = (message: string): never => {
    throw new ValidationError([
      { field: "$", code: "snapshot", message, severity: "error" },
    ]);
  };
  if (Buffer.byteLength(text) > maxBytes)
    fail("Файл превышает ограничение 20 МиБ");
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    fail("Некорректный JSON: последний принятый снимок сохранён");
  }
  if (!Array.isArray(data))
    return fail("Корень файла должен быть массивом исходного формата");
  if (data.length > 20000) fail("Не более 20 000 записей в одном снимке");
  const keys = new Set<string>(),
    ids = new Set<string>();
  const rows = data.map((r, n) => {
    if (!r || typeof r !== "object" || Array.isArray(r))
      fail(`Запись ${n + 1} должна быть объектом`);
    const item = normalize(r, namespace);
    if (keys.has(item.key) || ids.has(item.id))
      fail(`Повтор идентификатора в записи ${n + 1}`);
    keys.add(item.key);
    ids.add(item.id);
    return item;
  });
  return {
    rows,
    hash: hash(
      rows
        .map((r) => [r.key, r.hash])
        .sort(([a], [b]) => a.localeCompare(b, "en")),
    ),
    issues: rows.flatMap((r) => r.issues),
  };
}
export function transition(
  previous: Incident | undefined,
  next: Incident,
): { incident: Incident; reasons: string[] } {
  const incident = { ...next, issues: [...next.issues] };
  if (previous?.stateId === 10 && (next.stateId === 0 || next.stateId === 2)) {
    incident.issues.push({
      field: "stateId",
      code: "closed-reopened",
      message:
        "Закрытый инцидент вернулся в работу с тем же ID: требуется сверка",
      severity: "error",
    });
    incident.quarantined = true;
    incident.groups = [];
  }
  const reasons: string[] = [];
  if (!incident.quarantined) {
    if (
      incident.groups.includes("critical") &&
      !previous?.groups.includes("critical")
    )
      reasons.push(previous?.stateId === 7 ? "critical-reopened" : "critical");
    if (
      incident.groups.includes("coordinators") &&
      !previous?.groups.includes("coordinators")
    )
      reasons.push("assigned-coordinators");
    if (previous?.groups.includes("critical") && incident.stateId === 7)
      reasons.push("critical-resolved");
  }
  return { incident, reasons };
}
export function deadlineStatus(deadline: string | null, now: number) {
  if (!deadline) return "unset";
  const delta = Date.parse(deadline) - now;
  return delta < 0 ? "overdue" : delta <= 15 * 60_000 ? "soon" : "normal";
}
export const demoTransitions: Record<number, number[]> = {
  0: [2],
  2: [7],
  7: [0, 2, 20, 10],
  20: [2, 10],
  10: [],
};
export function safeItsm(id: string, base?: string) {
  if (!base) return `/itsm/${encodeURIComponent(id)}`;
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("ITSM_URL должен быть HTTPS URL без учётных данных");
  url.searchParams.set("incident", id);
  return url.href;
}
