import { formatFactDuration } from "../../packages/contracts/canvasFacts.ts";
import { spaces, type Incident } from "../../packages/domain/index.ts";
import { knownSymptom } from "../../packages/domain/triage.ts";
import type {
  CanvasGroup,
  CanvasIntent,
} from "../../packages/contracts/canvas.ts";
import type {
  CanvasFact,
  FactPeriod,
  RelationEdge,
} from "../../packages/contracts/canvasFacts.ts";

const day = 86_400_000,
  moscow = 3 * 3_600_000;
const dateLabel = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
});
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "medium",
});
const fields = {
  team: "assignedGroupName",
  product: "productName",
  status: "stateId",
  priority: "priorityId",
  symptom: "header / shortDescription / description",
  ticket: "id",
  deadline: "deadline",
  escalation: "isNeedUp",
};
const dimensionLabels = {
  team: "Команды",
  product: "Продукты",
  status: "Статусы",
  priority: "Приоритеты",
  symptom: "Симптомы",
  ticket: "Заявки",
  deadline: "Сроки",
  escalation: "Устранение последствий",
};
const number = new Intl.NumberFormat("ru-RU");
const norm = (v: string) => v.normalize("NFKC").toLocaleLowerCase("ru");
function bounds(period: FactPeriod, now: number) {
  const midnight = Math.floor((now + moscow) / day) * day - moscow;
  if (period === "snapshot")
    return {
      start: -Infinity,
      end: now,
      label: "Снимок на " + dateTime.format(now) + " МСК.",
    };
  if (period === "today" || period === "yesterday") {
    const start = period === "today" ? midnight : midnight - day;
    return {
      start,
      end: period === "today" ? now : midnight - 1,
      label:
        dateLabel.format(start) +
        " МСК, с 00:00 до " +
        (period === "today"
          ? dateTime.format(now).split(", ").pop()
          : "23:59:59") +
        ".",
    };
  }
  const date = new Date(now + moscow);
  // Clip an anniversary such as 29 February or 31 March to the last day of the target month.
  const localDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - (period === "year" ? 12 : 1));
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(localDay, last));
  const start = period === "week" ? now - 7 * day : date.valueOf() - moscow;
  return {
    start,
    end: now,
    label: dateTime.format(start) + " — " + dateTime.format(now) + " МСК.",
  };
}
export function prepareFact(
  intent: CanvasIntent,
  source: Incident[],
  now: number,
) {
  const plan = intent.fact!;
  const range = bounds(plan.period, now);
  const notes: string[] = [];
  let rows = source;
  const durations = [];
  if (plan.operation === "duration") {
    let missingCompletion = 0,
      invalidStart = 0;
    for (const r of source) {
      if (r.stateId !== 7 && r.stateId !== 10) continue;
      const start = r.dates.submitDate,
        end = r.dates.completionDate;
      if (!end) {
        missingCompletion++;
        continue;
      }
      const finish = Date.parse(end);
      if (finish < range.start || finish > range.end) continue;
      const ms = finish - Date.parse(start ?? "");
      if (!start || !Number.isFinite(ms) || ms < 0) {
        invalidStart++;
        continue;
      }
      durations.push({
        row: r,
        value: {
          id: r.id,
          header: spaces(r.raw.header) || null,
          start,
          end,
          ms,
        },
      });
    }
    durations.sort(
      (a, b) =>
        (plan.ascending ? a.value.ms - b.value.ms : b.value.ms - a.value.ms) ||
        a.row.id.localeCompare(b.row.id, "ru", { numeric: true }),
    );
    rows = durations.map((e) => e.row);
    if (missingCompletion)
      notes.push(
        "Без даты завершения в исходной выборке: " +
          missingCompletion +
          ". Их принадлежность периоду неизвестна.",
      );
    if (invalidStart)
      notes.push("Без корректной пары дат в периоде: " + invalidStart + ".");
  } else if (plan.period !== "snapshot") {
    const missing = rows.filter((r) => !r.dates.submitDate).length;
    if (missing)
      notes.push("Без даты регистрации в исходной выборке: " + missing + ".");
    rows = rows.filter((r) => {
      const t = Date.parse(r.dates.submitDate ?? "");
      return t >= range.start && t <= range.end;
    });
  }
  if (plan.operation === "distinct" || plan.operation === "frequency") {
    const field = fields[intent.groupBy];
    if (
      ["assignedGroupName", "productName", "stateId", "priorityId"].includes(
        field,
      )
    ) {
      const known = rows.filter(
        (r) => typeof r.raw[field] === "number" || !!spaces(r.raw[field]),
      );
      if (known.length !== rows.length)
        notes.push(
          "Без значения поля " +
            field +
            ": " +
            (rows.length - known.length) +
            ".",
        );
      rows = known;
    }
  }
  return {
    rows,
    notes,
    range: range.label,
    durations: durations.map((e) => e.value),
  };
}

// Optional ITSM export extensions can name the other incident. Role flags alone cannot.
const linkFields = [
  "relatedIncidentId",
  "relatedIncidentIds",
  "related_incident_ids",
  "parentIncidentId",
  "masterIncidentId",
  "duplicateOfIncidentId",
];
function references(from: Incident, to: Incident) {
  const evidence: string[] = [];
  for (const field of linkFields) {
    const v = from.raw[field];
    const values = Array.isArray(v) ? v : [v];
    if (
      values.some(
        (item) =>
          typeof item === "string" && (item === to.id || item === to.raw.sysId),
      )
    ) {
      evidence.push(
        from.id +
          " · " +
          field +
          " = " +
          (values.includes(to.id) ? to.id : to.raw.sysId),
      );
    }
  }
  const literal = to.id.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(
    "(?<![\\p{L}\\p{N}_-])" + literal + "(?![\\p{L}\\p{N}_-])",
    "iu",
  );
  for (const f of ["header", "shortDescription", "description", "solution"]) {
    if (exact.test(spaces(from.raw[f])))
      evidence.push(from.id + " · " + f + " упоминает " + to.id);
  }
  return evidence;
}
function relations(ids: string[], rows: Incident[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nodes = ids.map((id) => ({
    id,
    found: byId.has(id),
    ...(byId.has(id) ? { label: spaces(byId.get(id)!.raw.header) } : {}),
  }));
  const edges: RelationEdge[] = [];
  for (let i = 0; i < rows.length; i++)
    for (const b of rows.slice(i + 1)) {
      const a = rows[i];
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const evidence = references(from, to);
        if (evidence.length)
          edges.push({ from: from.id, to: to.id, kind: "reference", evidence });
      }
      const shared: string[] = [];
      for (const [f, label] of [
        ["productName", "Продукт"],
        ["service", "Сервис"],
        ["assignedGroupName", "Команда"],
      ]) {
        const v = spaces(a.raw[f]);
        if (v && norm(v) === norm(spaces(b.raw[f])))
          shared.push(label + " (" + f + ") · " + v);
      }
      const one = knownSymptom(a),
        two = knownSymptom(b);
      if (one && one.label === two?.label)
        shared.push(
          "Симптом (" + one.field + ", " + two.field + ") · " + one.label,
        );
      if (shared.length)
        edges.push({
          from: a.id,
          to: b.id,
          kind: "similarity",
          evidence: shared,
        });
    }
  return { nodes, edges };
}
export function describeFact(
  intent: CanvasIntent,
  prepared: ReturnType<typeof prepareFact>,
  groups: CanvasGroup[],
  filters: string,
) {
  const { rows, notes, range, durations } = prepared,
    { operation, period, ascending } = intent.fact!;
  const dimension = dimensionLabels[intent.groupBy];
  const n = number.format(rows.length);
  let title = dimension;
  let headline: string;
  let method =
    period === "snapshot"
      ? range
      : "По дате регистрации (submitDate). " + range;
  const fact: CanvasFact = { headline: "", method: "", notes: [...notes] };
  if (operation === "relations") {
    title = "Связи инцидентов";
    const graph = relations(intent.filters.ids ?? [], rows);
    Object.assign(fact, graph);
    const explicit = graph.edges.filter((e) => e.kind === "reference").length;
    const similar = graph.edges.filter((e) => e.kind === "similarity").length;
    headline =
      "Прямых ссылок: " +
      explicit +
      ". Пар с общими признаками: " +
      similar +
      ".";
    method += " Сверены номера в полях связей и тексте выбранных карточек.";
    fact.notes.push(
      "Общий продукт, сервис, команда или симптом дают основание для проверки. Флаги isMaster, isDouble, isEffect и isReason сами по себе не указывают вторую заявку или направление причины.",
    );
    if (graph.nodes.some((node) => !node.found))
      fact.notes.push(
        "Отсутствуют в выбранных данных: " +
          graph.nodes
            .filter((node) => !node.found)
            .map((node) => node.id)
            .join(", ") +
          ".",
      );
  } else if (operation === "duration") {
    title = ascending ? "Быстрее всего решены" : "Дольше всего решались";
    const lead = durations[0],
      ties = lead ? durations.filter((v) => v.ms === lead.ms) : [];
    headline = lead
      ? (lead.header ?? "Тема не указана") +
        " (" +
        lead.id +
        ")" +
        " · " +
        formatFactDuration(lead.ms) +
        (ties.length > 1
          ? " · одинаковый результат у " + ties.length + " заявок."
          : ".")
      : "Нет завершённых заявок с подходящими датами для расчёта.";
    method =
      "По дате завершения (completionDate). " +
      range +
      " Длительность от submitDate до completionDate, статусы «Завершён» и «Закрыт».";
    fact.durations = durations.slice(0, Math.max(10, ties.length));
    fact.notes.push(
      "Подходящих пар дат: " +
        n +
        ". Полная выборка упорядочена по длительности.",
    );
  } else if (operation === "count") {
    title = "Количество заявок";
    headline = "Заявок в выборке: " + n + ".";
  } else {
    const field = fields[intent.groupBy];
    if (operation === "frequency") {
      title =
        (ascending ? "Реже всего" : "Чаще всего") +
        " · " +
        dimension.toLocaleLowerCase("ru");
      const first = groups[0],
        ties = first ? groups.filter((g) => g.count === first.count) : [];
      headline = first
        ? ties
            .slice(0, 5)
            .map((g) => g.label)
            .join(", ") +
          " — " +
          first.count +
          " из " +
          n +
          "." +
          (ties.length > 1
            ? " Одинаковая частота у " + ties.length + " групп."
            : "")
        : "За выбранный период подходящих заявок нет.";
    } else {
      title = dimension + " в источнике";
      headline =
        dimension +
        ": " +
        groups.length +
        ". Заявок с указанным значением: " +
        n +
        ".";
    }
    method +=
      " " +
      (intent.groupBy === "status"
        ? "Текущий статус зарегистрированных заявок"
        : "Группировка по текущему значению") +
      " (" +
      field +
      ").";
  }
  if (filters && operation !== "relations")
    method += " Условия: " + filters + ".";
  if (
    !intent.filters.states &&
    operation !== "duration" &&
    operation !== "relations"
  )
    method += " Учтены все статусы.";
  fact.headline = headline;
  fact.method = method;
  return { title, summary: headline + " " + method, fact };
}
