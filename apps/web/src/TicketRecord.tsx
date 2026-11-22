import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Incident, Raw } from "../../../packages/domain/index";
import { duration } from "./liveFeed";

export function ItsmLink({ href, mock, navigate, children, className }: {
  href: string;
  mock: boolean;
  navigate: (path: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return <a href={href} className={className}
    target={mock ? undefined : "_blank"} rel="noopener noreferrer"
    title={mock ? "Демонстрационная карточка SimpleOne" : "Открыть ITSM в новой вкладке"}
    onClick={(event) => {
      if (!mock || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(href);
    }}>
    {children}<span aria-hidden="true">{mock ? " →" : " ↗"}</span>
  </a>;
}

export function TicketDeadline({ incident, now, stamp }: {
  incident: Incident; now: number; stamp: string;
}) {
  const deadline = incident.dates.deadline;
  if (!deadline) return <dd>Срок не задан</dd>;
  const open = incident.sourcePresent && !incident.quarantined &&
    (incident.stateId === 0 || incident.stateId === 2 || incident.stateId === 20);
  if (!open) return <dd><time dateTime={deadline}>{stamp}</time></dd>;
  const difference = Date.parse(deadline) - now;
  const absolute = Math.abs(difference);
  const remaining = absolute >= 3600000 ? duration(absolute) :
    Math.floor(absolute / 60000) + " мин " + Math.floor(absolute % 60000 / 1000) + " с";
  return <dd data-urgency={difference < 0 ? "overdue" : difference <= 900000 ? "soon" : undefined}>
    <strong>{difference < 0 ? "Просрочен на " : "Осталось "}<span className="ticket-duration">{remaining}</span></strong>
    <time dateTime={deadline}>{stamp}</time>
  </dd>;
}

function JsonContents({ raw }: { raw: Raw }) {
  const json = useMemo(() => JSON.stringify(raw, null, 2), [raw]);
  const field = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setMessage("JSON скопирован.");
    } catch {
      field.current?.focus();
      field.current?.select();
      setMessage("JSON выделен. Скопируйте текст сочетанием клавиш.");
    }
  }
  return <div className="ticket-raw">
    <div className="ticket-raw-tools">
      <span>{Object.keys(raw).length} полей в источнике</span>
      <button className="ticket-text-action" type="button" onClick={() => void copy()}>Скопировать JSON</button>
    </div>
    <textarea ref={field} aria-label="Исходный JSON инцидента" spellCheck={false} readOnly value={json} rows={14} />
    {message && <small role="status">{message}</small>}
  </div>;
}

export function TicketSource({ incident }: { incident: Incident }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="ticket-fold" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Исходная запись JSON</summary>
    {expanded && <JsonContents key={incident.revision} raw={incident.raw} />}
  </details>;
}
