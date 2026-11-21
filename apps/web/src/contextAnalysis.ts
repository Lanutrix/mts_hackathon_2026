import type { Incident } from "../../../packages/domain/index.ts";
import type { Analysis } from "../../server/analysis.ts";
import type { WorkspaceAnalysis } from "./Workspace";

export async function analyzeContext(
  selected: string[],
  question: string,
  zone: string,
  read: (id: string) => Promise<Incident>,
  analyze: (id: string) => Promise<Analysis>,
): Promise<WorkspaceAnalysis> {
  const ids = [...new Set(selected)],
    query = question.trim().toLowerCase();
  if (!ids.length || ids.length > 6)
    throw new Error("Выберите от одного до шести инцидентов.");
  const deadlines = /срок|дедлайн|просроч|успе|ближайш/u.test(query);
  const ownership = /ответствен|исполнител|назнач|команд|кто/u.test(query);
  const items: WorkspaceAnalysis["items"] = [];
  const overview: string[] = [];
  if (deadlines || ownership) {
    const records = await Promise.all(ids.map(read));
    if (deadlines) {
      const format = new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        dateStyle: "medium",
        timeStyle: "short",
      });
      for (const row of [...records].sort((a, b) =>
        (a.dates.deadline || "9999").localeCompare(b.dates.deadline || "9999"),
      )) {
        const d = row.dates.deadline;
        overview.push(
          row.id +
            " · " +
            (d
              ? (Date.parse(d) < Date.now() ? "Срок прошёл " : "Срок ") +
                format.format(Date.parse(d)) +
                " (" +
                zone +
                ")"
              : "Срок не задан"),
        );
      }
    }
    if (ownership)
      for (const row of records) {
        overview.push(
          row.id +
            " · " +
            (row.team || "Команда не указана") +
            " · " +
            (row.raw.assignedEmployee || "Исполнитель не указан"),
        );
      }
  }
  // The local inference service accepts one request at a time. Keep evidence and fallback marks per ticket.
  const needsSummary =
    !overview.length || /симптом|сводк|причин|описан/u.test(query);
  if (needsSummary)
    for (const id of ids) {
      try {
        items.push({ id, analysis: await analyze(id) });
      } catch (error) {
        overview.push(
          id +
            " · Сводка недоступна. " +
            (error instanceof Error
              ? error.message
              : "Повторите запрос позже."),
        );
      }
    }
  if (
    !overview.length &&
    query &&
    !/сводк|симптом|происхо|описан|общ|риск|что|почему|причин/u.test(query)
  ) {
    const terms = query.match(/[а-яёa-z0-9]{4,}/gu) ?? [];
    for (const item of items) {
      const matched = item.analysis.summary.filter((line) =>
        terms.some((term) => line.toLowerCase().includes(term)),
      );
      if (matched.length) overview.push(item.id + " · " + matched[0]);
    }
    if (!overview.length)
      overview.push(
        "В выбранных карточках не нашлось сведений по этому вопросу. Ниже приведена сводка по каждой записи.",
      );
  }
  return { items, overview };
}
