import { screenLink } from "./routes";

export function TicketMentions({
  text,
  ids,
  ns,
  open,
  className,
}: {
  text: string;
  ids: string[];
  ns: string;
  open: (id: string) => void;
  className?: string;
}) {
  const sources = [...new Set(ids.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!sources.length) return <>{text}</>;
  const alternatives = sources.map((id) =>
    id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(
    "(?<![\\p{L}\\p{N}_])(" + alternatives.join("|") + ")(?![\\p{L}\\p{N}_])",
    "gu",
  );
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 ? (
          <a
            key={index}
            className={className}
            href={screenLink("/incident/" + encodeURIComponent(part), ns)}
            onClick={(event) => {
              if (
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              open(part);
            }}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

const fields: Record<string, string> = {
  header: "Тема",
  description: "Описание",
  priorityId: "Приоритет",
  deadline: "Срок решения",
  sourcePresent: "Есть в выгрузке",
  isNeedUp: "Устранение последствий",
  assignedGroupName: "Команда назначения",
  assignedEmployee: "Исполнитель",
  productName: "Продукт",
  solution: "Решение",
  stateId: "Статус",
  "history.changed": "История",
};
export function fieldName(field: string) {
  if (field.startsWith("description:")) return fields.description;
  return fields[field] ?? field;
}
