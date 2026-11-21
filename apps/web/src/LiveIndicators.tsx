import { useMemo } from "react";
import type { Triage } from "../../../packages/domain/triage";
import "./liveIndicators.css";

export function ShiftClock({ now, zone }: { now: number; zone: string }) {
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    [zone],
  );
  return (
    <div className="shift-timepiece">
      <time dateTime={new Date(now).toISOString()} data-testid="shift-clock">
        {format.format(now)}
      </time>
      <span>{zone === "Europe/Moscow" ? "МСК" : zone}</span>
    </div>
  );
}

export function ShiftMetrics({
  triage,
  hints = false,
}: {
  triage: Pick<Triage, "unique" | "overdue" | "escalations">;
  hints?: boolean;
}) {
  const metrics = [
    {
      name: "Активные заявки",
      count: triage.unique,
      testId: "live-count",
      definition: "В выбранных очередях, без повторов",
      detail:
        "Заявки в состояниях «Назначен», «Выполняется» или «Исследование ситуации» из выбранных очередей. Каждая заявка учтена один раз.",
    },
    {
      name: "Просрочены",
      count: triage.overdue,
      testId: "overdue-count",
      definition: "Срок активной заявки уже прошёл",
    },
    {
      name: "К эскалации",
      count: triage.escalations,
      testId: "escalation-count",
      definition: "У активной заявки есть отметка эскалации",
    },
  ];
  return (
    <dl className="shift-metrics" aria-label="Показатели активных заявок">
      {metrics.map((m) => (
        <div
          key={m.testId}
          className={"metric-" + m.testId}
          data-hint={hints ? m.detail || m.definition : undefined}
        >
          <dt>{m.name}</dt>
          <dd>
            <strong data-testid={m.testId}>
              {m.count.toLocaleString("ru-RU")}
            </strong>
            <span>{m.definition}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
