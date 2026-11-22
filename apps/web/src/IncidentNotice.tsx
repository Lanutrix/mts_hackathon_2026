import { useLayoutEffect, useRef } from "react";
import "./incidentNotice.css";

export type IncidentSignal = {
  id: string;
  key: string;
  revision: number;
  reasons: string[];
  at: string;
  header?: string;
  product?: string;
  deadline?: string | null;
};

const transitions = [
  {
    reason: "critical-reopened",
    title: "Возврат в работу",
    severity: "critical",
  },
  {
    reason: "critical",
    title: "Новый критический инцидент",
    severity: "critical",
  },
  {
    reason: "critical-resolved",
    title: "Критический инцидент завершён",
    severity: "resolved",
  },
  {
    reason: "assigned-coordinators",
    title: "Назначен группе координаторов",
    severity: "assigned",
  },
] as const;

const primary = (signal: Pick<IncidentSignal, "reasons">) =>
  transitions.find((item) => signal.reasons.includes(item.reason));

export const signalTitle = (signal: Pick<IncidentSignal, "reasons">) =>
  primary(signal)?.title ?? "Событие по инциденту";

export const signalSeverity = (signal: Pick<IncidentSignal, "reasons">) =>
  primary(signal)?.severity ?? "update";

const day = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
});
const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  timeStyle: "short",
});
function deadlineToday(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return "";
  const deadline = Date.parse(value);
  if (
    !Number.isFinite(deadline) ||
    day.format(deadline) !== day.format(Date.now())
  )
    return "";
  return "Срок " + time.format(deadline) + " МСК";
}

type NoticeProps = {
  signal: IncidentSignal | null;
  /** Includes the incident currently displayed. */
  pendingCount: number;
  wave?: { label: string; count: number };
  onOpen: () => void;
  onJournal: () => void;
  onDismiss: () => void;
};

export function IncidentNotice({
  signal,
  pendingCount,
  wave,
  onOpen,
  onJournal,
  onDismiss,
}: NoticeProps) {
  const banner = useRef<HTMLElement>(null);
  const visible = signal !== null;
  useLayoutEffect(() => {
    const element = banner.current;
    if (!visible || !element) return;
    const root = document.documentElement.style;
    const measure = () =>
      root.setProperty("--incident-notice-height", element.offsetHeight + "px");
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty("--incident-notice-height");
    };
  }, [visible]);

  const labels = signal
    ? transitions.filter((item) => signal.reasons.includes(item.reason))
    : [];
  const title = wave ? wave.label + " · " + wave.count : signal ? signalTitle(signal) : "";
  const secondary = labels
    .slice(1)
    .map((item) => item.title)
    .join(" · ");
  const severity = signal && signalSeverity(signal);
  const identity = wave ? wave.label : signal ? JSON.stringify([signal.revision, signal.key]) : "";
  const subject = signal?.header?.trim() || signal?.product?.trim();
  const deadline = severity !== "resolved" && deadlineToday(signal?.deadline);
  const announcement = signal && (
    <span key={identity}>
      {wave ? "Первыми к разбору. " + title : [title, subject, secondary, signal.id].filter(Boolean).join(". ")}
    </span>
  );
  const remaining = Math.max(0, pendingCount - 1);

  return (
    <>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {severity === "critical" && announcement}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {severity !== "critical" && announcement}
      </div>
      {signal && (
        <section
          ref={banner}
          className="incident-notice"
          data-severity={severity}
          aria-label="Уведомление об инциденте"
        >
          <div className="in-focus" aria-hidden="true">
            <i key={identity} className="in-brackets" />
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {severity === "critical" ? (
                <path d="M12 5v9m0 4v.4" />
              ) : severity === "resolved" ? (
                <path d="m5 12 4.5 4.5L19 7" />
              ) : severity === "assigned" ? (
                <>
                  <circle cx="12" cy="8" r="2.7" />
                  <path d="M6 19a6 6 0 0 1 12 0" />
                </>
              ) : (
                <path d="M12 10v8m0-12v.4" />
              )}
            </svg>
          </div>
          <div className="in-copy">
            <div className="in-meta">
              <span className="in-id">{wave ? "Несколько сигналов · первыми к разбору" : signal.id}</span>
              {!wave && subject && (
                <span className="in-subject" title={subject}>
                  {subject}
                </span>
              )}
              {!wave && deadline && (
                <time
                  className="in-deadline"
                  dateTime={signal.deadline ?? undefined}
                >
                  {deadline}
                </time>
              )}
            </div>
            <strong className="in-title">{title}</strong>
            {!wave && secondary && <span className="in-secondary">{secondary}</span>}
          </div>
          <div className="in-actions">
            <button
              type="button"
              className="in-open"
              onClick={onOpen}
              aria-label={wave ? "Открыть подборку" : "Открыть инцидент " + signal.id}
            >
              {wave ? "Открыть подборку" : "Открыть инцидент"} <span aria-hidden="true">→</span>
            </button>
            <button type="button" className="in-journal" onClick={onJournal}>
              Журнал{" "}
              {!wave && remaining > 0 && (
                <span className="in-count">
                  ещё {remaining.toLocaleString("ru-RU")}
                </span>
              )}
            </button>
          </div>
          <button
            type="button"
            className="in-dismiss"
            onClick={onDismiss}
            aria-label={wave ? "Скрыть сводное уведомление" : "Скрыть это уведомление"}
            title="Скрыть это уведомление"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </section>
      )}
    </>
  );
}
