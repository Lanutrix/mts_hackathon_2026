import { formatFactDuration } from "../../packages/contracts/canvasFacts.ts";
import { spaces, STATES, type Incident } from "../../packages/domain/index.ts";
import { knownSymptom } from "../../packages/domain/triage.ts";
import { measuredStatusIntervals, type StatusChange } from "./statusIntervals.ts";
import type {
  CanvasGroup,
  CanvasIntent,
} from "../../packages/contracts/canvas.ts";
import type {
  CanvasFact,
  FactPlan,
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
function bounds(plan: FactPlan, now: number) {
  const { period } = plan;
  const midnight = Math.floor((now + moscow) / day) * day - moscow;
  if (period === "rolling") {
    const start = now - plan.lookbackHours! * 3_600_000;
    return { start, end: now, label: dateTime.format(start) + " — " + dateTime.format(now) + " МСК." };
  }
  if (period === "dates") {
    const [from, to] = plan.dateRange!;
    const start = Date.parse(from + "T00:00:00+03:00");
    const end = Date.parse(to + "T23:59:59.999+03:00");
    return { start, end: Math.min(now, end), label: dateLabel.format(start) + " — " + dateLabel.format(end) + " МСК (включительно, по момент среза)." };
  }
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
  changes: StatusChange[] = [],
) {
  const plan = intent.fact!;
  const range = bounds(plan, now);
  const notes: string[] = [];
  let rows = source;
  const durations = [];
  const statusIntervals = plan.operation === "statusInterval"
    ? measuredStatusIntervals(changes, rows, range.start, range.end) : undefined;
  if (statusIntervals) {
    rows = rows.filter(r => statusIntervals.tickets.has(r.key)).sort((a, b) => a.id.localeCompare(b.id, "ru", { numeric: true }));
    const skipped = source.length - rows.length;
    if (skipped) notes.push("Заявок без пары наблюдаемых смен статуса за выбранный период — " + number.format(skipped) + ".");
  } else if (plan.operation === "recent") {
    const undated = rows.filter(r => !r.dates.submitDate).length;
    if (undated) notes.push("Заявок без даты регистрации — " + number.format(undated) + ". Они исключены из списка.");
    rows = rows.filter(r => {
      const at = Date.parse(r.dates.submitDate ?? "");
      return at >= range.start && at <= range.end;
    }).sort((a, b) => (plan.ascending ? 1 : -1) * a.dates.submitDate!.localeCompare(b.dates.submitDate!) || a.id.localeCompare(b.id, "ru", { numeric: true }) || a.id.localeCompare(b.id))
      .slice(0, plan.limit);
  } else if (plan.operation === "duration" || plan.durationCohort) {
    let missingCompletion = 0,
      invalidStart = 0, unfinished = 0, outside = 0;
    for (const r of source) {
      if (r.stateId !== 7 && r.stateId !== 10) {
        unfinished++;
        continue;
      }
      const start = r.dates.submitDate,
        end = r.dates.completionDate;
      if (!end) {
        missingCompletion++;
        continue;
      }
      const finish = Date.parse(end);
      if (finish < range.start || finish > range.end) {
        outside++;
        continue;
      }
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
    if (unfinished) notes.push("Исключены незавершённые заявки: " + number.format(unfinished) + ".");
    if (outside) notes.push("Вне периода по дате завершения: " + number.format(outside) + ".");
    if (missingCompletion)
      notes.push(
        "Без даты завершения в исходной выборке: " +
          missingCompletion +
          ". Их принадлежность периоду неизвестна.",
      );
    if (invalidStart)
      notes.push("Без корректной пары дат в периоде: " + invalidStart + ".");
  } else if (plan.period !== "snapshot") {
    const field = plan.dateField ?? "submitDate";
    const missing = rows.filter((r) => !r.dates[field]).length;
    if (missing)
      notes.push(
        "Без даты " +
          (field === "completionDate" ? "завершения" : "регистрации") +
          " в исходной выборке: " +
          missing +
          ".",
      );
    rows = rows.filter((r) => {
      const t = Date.parse(r.dates[field] ?? "");
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
    scopeCount: source.length,
    notes,
    range: range.label,
    statusIntervals,
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
  } else if (operation === "recent") {
    title = intent.fact!.limit ? (ascending ? "Первые" : "Последние") + " зарегистрированные инциденты" : "Зарегистрированные инциденты";
    headline = !rows.length ? "Нет заявок с датой регистрации в выбранном периоде." : rows.length === 1 ?
      (ascending ? "Первым" : "Последним") + " зарегистрирован " + rows[0].id + "." :
      (intent.fact!.limit ? (ascending ? "Первые инциденты" : "Последние инциденты") : "Инциденты") + " по дате регистрации · " + n;
    method = "По дате регистрации (submitDate), " + (ascending ? "от старых к новым" : "от новых к старым") +
      ". При совпадении времени — по номеру заявки. " + range;
  } else if (operation === "statusInterval") {
    title = "Среднее время между сменами статуса";
    const measure = prepared.statusIntervals!.summary;
    fact.statusIntervals = measure;
    headline = measure.meanMs === null ? "Недостаточно истории для расчёта среднего времени между сменами статуса." :
      "Среднее время между сменами статуса — " + formatFactDuration(measure.meanMs) + ".";
    method = "Интервал отсчитывается между двумя последовательными наблюдаемыми изменениями статуса одной заявки. " +
      "Сумму интервалов делим на их число. Первая запись и разрывы в наблюдении исключены. " +
      (period === "snapshot" ? "" : "Период определяется по второй смене статуса. ") + range;
  } else if (operation === "duration") {
    const { durationMeasure } = intent.fact!;
    const lead = durations[0];
    headline = "Нет завершённых заявок с подходящими датами для расчёта.";
    method =
      "По дате завершения (completionDate). " +
      range +
      " От регистрации (submitDate) до завершения (completionDate). Учтены статусы «Завершён» и «Закрыт».";
    if (intent.groupBy !== "ticket") {
      const metric = durationMeasure === "mean" ? "Среднее время решения" : "Медиана времени решения";
      title = metric + (intent.groupBy === "team" ? " по командам" : " по симптомам");
      const first = groups[0];
      if (first) {
        const leaders = groups.filter(g => g.durationMs === first.durationMs);
        headline = (ascending ? "Быстрее всего" : "Дольше всего") + " по " +
          (durationMeasure === "mean" ? "среднему" : "медиане") + " — " +
          leaders.map(g => g.label).join(", ") + " · " + formatFactDuration(first.durationMs!) + ".";
      }
      method += " По каждой группе рассчитан показатель «" + metric + "». " +
        (intent.groupBy === "team" ? "Группа определяется по команде в снимке (assignedGroupName)." :
          "Группа определяется по симптому в тексте заявки, при отсутствии совпадения — по заголовку.") +
        " Всего заявок с измеренной длительностью: " + n + ".";
    } else if (durationMeasure === "mean" || durationMeasure === "median") {
      title = durationMeasure === "mean" ? "Среднее время решения" : "Медиана времени решения";
      const count = durations.length;
      const valueMs = !count ? null : durationMeasure === "mean" ? durations.reduce((sum, item) => sum + item.ms, 0) / count :
        (durations[Math.floor((count - 1) / 2)].ms + durations[Math.floor(count / 2)].ms) / 2;
      fact.durationSummary = { measure: durationMeasure, valueMs, measuredCount: count, scopeCount: prepared.scopeCount };
      if (valueMs !== null) headline = title + " — " + formatFactDuration(valueMs) + ".";
      method += (durationMeasure === "mean" ? " Сумму длительностей делим на число измеренных заявок. " : " Берём медиану измеренных длительностей. ") +
        "Подходящих пар дат — " + n + " из " + number.format(prepared.scopeCount) + " заявок исходной выборки.";
    } else if (durationMeasure === "individual") {
      title = "Сравнение инцидентов по времени решения";
      if (lead) {
        const lastMs = durations[durations.length - 1].ms;
        fact.maxDurationMs = Math.max(lead.ms, lastMs);
        headline = "Завершённых инцидентов: " + n + ". Время решения — от " +
          formatFactDuration(Math.min(lead.ms, lastMs)) + " до " + formatFactDuration(fact.maxDurationMs) + ".";
      }
      fact.durations = durations.slice(0, 10);
    } else {
      title = ascending ? "Быстрее всего решены" : "Дольше всего решались";
      const ties = lead ? durations.filter(v => v.ms === lead.ms) : [];
      if (lead) {
        const leaders = ties.length <= 3 ? ties : [lead];
        headline = leaders.map(item => (item.header ?? "Тема не указана") + " (" + item.id + ")").join(", ") +
          " · " + formatFactDuration(lead.ms) + (ties.length > 1 ? " · одинаковый результат у " + ties.length + " заявок." : ".");
      }
      fact.durations = durations.slice(0, Math.max(10, ties.length));
      fact.notes.push("Подходящих пар дат: " + n + ". Полная выборка упорядочена по длительности.");
    }
  } else if (operation === "count") {
    const counts = new Map<number | null, number>();
    for (const row of rows) {
      const state = row.stateId !== null && STATES[row.stateId] ? row.stateId : null;
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    fact.statusCounts = [0, 2, 20, 7, 10, null].flatMap(state => {
      const count = counts.get(state);
      return count ? [{ state, count, label: state === null ? "Не указан" : STATES[state].label }] : [];
    });
    title = "Количество заявок";
    headline = "Заявок в выборке: " + n + ".";
    if (intent.filters.deadline === "overdue") {
      title = "Просроченные заявки";
      headline = "Просроченных заявок — " + n + ".";
      method += " Учитываются открытые заявки, включая исследование, с указанным сроком решения (deadline) раньше времени среза.";
    }
    if (intent.fact!.durationCohort) {
      headline = "Заявок с измеренной длительностью решения: " + n + ".";
      method = "Учтены завершённые и закрытые заявки с корректной парой дат регистрации и завершения. " +
        (period === "snapshot" ? range : "По дате завершения (completionDate). " + range);
    } else if (intent.fact!.dateField === "completionDate") {
      method = "По дате завершения (completionDate). " + range;
      if (
        intent.filters.states?.length === 1 &&
        intent.filters.states[0] === 10
      ) {
        headline =
          "Сейчас закрыты и имеют дату завершения в периоде: " + n + ".";
        method += " Дата перехода в статус «Закрыт» в снимке отсутствует.";
      } else {
        headline =
          "Заявок с подтверждённой датой завершения в периоде: " + n + ".";
      }
    }
  } else {
    const field = fields[intent.groupBy];
    if (operation === "frequency" && intent.fact!.limit && groups.length) {
      const limit = intent.fact!.limit;
      title = "Топ-" + limit + " · " + dimension.toLocaleLowerCase("ru");
      headline = groups.map(g => g.label + " — " + g.count).join(", ") + ".";
      method += " Группы упорядочены по числу заявок. Заявок во всём срезе: " + n + ".";
      if (groups.length > limit)
        method += " Группы с одинаковым числом заявок на границе рейтинга включены вместе.";
    } else if (operation === "frequency") {
      title =
        (ascending ? "Реже всего" : "Чаще всего") +
        " · " +
        dimension.toLocaleLowerCase("ru");
      const first = groups[0],
        ties = first ? groups.filter((g) => g.count === first.count) : [];
      headline = first
        ? ties.map((g) => g.label)
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
    !intent.fact!.durationCohort &&
    operation !== "duration" &&
    operation !== "relations"
  )
    method += " Учтены все статусы.";
  fact.headline = headline;
  fact.method = method;
  return { title, summary: headline + " " + method, fact };
}
