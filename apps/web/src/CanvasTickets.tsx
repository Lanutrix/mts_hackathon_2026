import { answerElement as elPart } from "../../../packages/contracts/answerCatalog";
import { useEffect, useRef, useState } from "react";
import type {
  CanvasGroup,
  CanvasPage,
  CanvasResult,
  CanvasTicket,
} from "../../../packages/contracts/canvas";
import { formatCount, PageControls, useBox } from "./CanvasControls";
import { screenLink } from "./routes";
import { formatFactDuration } from "../../../packages/contracts/canvasFacts";

export class CanvasRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function canvasJson<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  const response = await fetch(path, { ...options, cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401) {
      const next = location.pathname + location.search + location.hash;
      location.replace("/login?" + new URLSearchParams({ next }));
    }
    const messages: Record<number, string> = {
      401: "Сессия закончилась. Войдите снова.",
      403: "Для этого источника требуется доступ координатора.",
      409: "Срок хранения выборки истёк. Обновите срез.",
      410: "Выборка устарела. Откройте свежий срез.",
      429: "Слишком много запросов. Повторите чуть позже.",
    };
    throw new CanvasRequestError(
      response.status,
      messages[response.status] ||
        "Не удалось получить данные. Проверьте соединение.",
    );
  }
  return response.json();
}

export function CanvasTicketLink({
  ticket,
  ns,
  open,
  zone,
}: {
  ticket: CanvasTicket;
  ns: string;
  open: (id: string) => void;
  zone: string;
}) {
  const date =
    ticket.deadline &&
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ticket.deadline));
  return (
    <a
      {...elPart("ticket-reference")}
      className="cx-ticket-link"
      title={ticket.header}
      href={screenLink("/incident/" + encodeURIComponent(ticket.id), ns)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        open(ticket.id);
      }}
    >
      <span {...elPart("ticket-id")} className="cx-ticket-id">
        {ticket.id}
      </span>
      <strong {...elPart("subject")}>{ticket.header || "Без заголовка"}</strong>
      <span {...elPart("owner-priority")} className="cx-ticket-facts">
        {ticket.team} · {ticket.priority}
      </span>
      <span
        {...elPart("deadline-stamp")}
        className="cx-ticket-date"
        data-overdue={!ticket.duration && ticket.overdue}
      >
        {ticket.duration ? "Время решения · " + formatFactDuration(ticket.duration.ms) :
          date ? (ticket.overdue ? "Просрочен · " : "") + date : "Без срока"}
      </span>
    </a>
  );
}

export function CanvasDrawer({
  result,
  group,
  offset,
  setOffset,
  close,
  refresh,
  open,
  ns,
  zone,
}: {
  result: CanvasResult;
  group: CanvasGroup | null;
  offset: number;
  setOffset: (n: number) => void;
  close: () => void;
  refresh: () => void;
  open: (id: string) => void;
  ns: string;
  zone: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { ref, height } = useBox();
  const [chunk, setChunk] = useState<{
    offset: number;
    items: CanvasTicket[];
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const groupKey = group?.key,
    total = group?.count ?? result.total;
  const perPage = Math.max(1, Math.min(12, Math.floor(height / 55)));
  const pages = Math.ceil(total / perPage),
    page = Math.max(0, Math.min(Math.floor(offset / perPage), pages - 1));
  const start = page * perPage;
  useEffect(() => {
    const el = dialog.current!,
      previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!height) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      ns,
      selection: result.selection,
      offset: String(start),
    });
    if (groupKey !== undefined) params.set("group", groupKey);
    setError(null);
    canvasJson<CanvasPage>("/api/canvas/tickets?" + params, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted)
          setChunk({ offset: start, items: data.items });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [ns, result.selection, groupKey, start, !!height, retry]);
  const ready = chunk?.offset === start;
  return (
    <dialog
      ref={dialog}
      {...elPart("selection-drawer")}
      className="cx-drawer"
      aria-labelledby="cx-drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="cx-drawer-inner">
        <header>
          <div>
            <h2 id="cx-drawer-title">{group?.label || "Все заявки"}</h2>
            <p {...elPart("selection-size")}>{formatCount(total)} заявок</p>
          </div>
          <button
            type="button"
            className="cx-icon-button"
            aria-label="Закрыть выборку"
            data-hint="Закрыть выборку"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="cx-drawer-list" ref={ref}>
          {error ? (
            <div
              {...elPart("failed-selection")}
              className="cx-note"
              role="alert"
            >
              {error.message}{" "}
              {error instanceof CanvasRequestError &&
              [409, 410].includes(error.status) ? (
                <button {...elPart("refresh-selection")} onClick={refresh}>
                  Обновить срез
                </button>
              ) : (
                <button onClick={() => setRetry((r) => r + 1)}>
                  Повторить
                </button>
              )}
            </div>
          ) : ready ? (
            chunk.items
              .slice(0, perPage)
              .map((ticket) => (
                <CanvasTicketLink
                  key={ticket.id}
                  {...{ ticket, ns, zone, open }}
                />
              ))
          ) : (
            <p role="status">Загружаем заявки…</p>
          )}
        </div>
        <PageControls
          page={page}
          pages={pages}
          goto={(p) => setOffset(p * perPage)}
          label="Страницы заявок"
        />
      </div>
    </dialog>
  );
}
