import { useLayoutEffect, useMemo, useRef } from "react";
import type { Triage } from "../../../packages/domain/triage";
import ShiftSlice from "./ShiftSlice";
import "./liveIndicators.css";

const integer = new Intl.NumberFormat("ru-RU");

function ShiftCount({ value, testId }: { value: number; testId: string }) {
  const label = integer.format(value);
  const root = useRef<HTMLElement>(null);
  const previous = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const old = previous.current;
    previous.current = value;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || !element.animate || value === old) return;
    const prior = old === null ? [] : Array.from(integer.format(old)).reverse();
    const direction = old !== null && value < old ? -1 : 1;
    const reels = Array.from(element.querySelectorAll<HTMLElement>("[data-glyph]")).reverse();
    const animations: Animation[] = [];
    for (const [place, reel] of reels.entries()) {
      const glyph = reel.dataset.glyph!;
      if (!/\d/.test(glyph) || (glyph === prior[place] && reels.length === prior.length)) continue;
      reel.dataset.prior = prior[place] ?? "";
      animations.push(reel.animate([
        { transform: `translateY(${direction * 100}%)` }, { transform: "translateY(0)" },
      ], {
        duration: 330, delay: Math.min(place, 4) * 16, easing: "cubic-bezier(.2,.76,.22,1)", fill: "backwards",
      }));
    }
    if (!animations.length) return;
    element.dataset.rolling = direction > 0 ? "up" : "down";
    let settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      delete element.dataset.rolling;
      for (const animation of animations) animation.cancel();
      preference.removeEventListener("change", settle);
    }
    preference.addEventListener("change", settle);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(settle);
    return settle;
  }, [value]);

  return <strong ref={root} className="shift-counter" data-testid={testId}>
    <span className="shift-counter-value">{label}</span>
    <span className="shift-counter-reels" aria-hidden="true">
      {Array.from(label, (glyph, i) => <span key={label.length - i}>
        <span data-glyph={glyph} />
      </span>)}
    </span>
  </strong>;
}

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
  showSlice = false,
  loading = false,
}: {
  triage: Pick<Triage, "unique" | "overdue" | "escalations">;
  hints?: boolean;
  showSlice?: boolean;
  loading?: boolean;
}) {
  const metrics = [
    {
      name: "Под наблюдением",
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
      definition: "Срок решения инцидента прошёл",
    },
    {
      name: "Устранение последствий",
      count: triage.escalations,
      testId: "escalation-count",
      definition: "После решения потребуются дополнительные работы (isNeedUp = true)",
    },
  ];
  return (
    <dl className="shift-metrics" aria-label="Показатели инцидентов под наблюдением">
      {metrics.map((m) => (
        <div
          key={m.testId}
          className={"metric-" + m.testId}
          data-hint={hints ? m.detail || m.definition : undefined}
        >
          <dt>{m.name}</dt>
          <dd>
            <div className="metric-reading">
              {loading ? <strong aria-label="Загрузка" data-testid={m.testId}>—</strong> :
                <ShiftCount value={m.count} testId={m.testId} />}
              {m.testId === "live-count" && showSlice && (
                <ShiftSlice total={triage.unique} overdue={triage.overdue}
                  consequences={triage.escalations} loading={loading} />
              )}
            </div>
            {!hints && <span>{m.definition}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
