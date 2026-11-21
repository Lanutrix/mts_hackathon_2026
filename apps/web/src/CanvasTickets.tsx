import { useEffect, useRef, useState } from "react";
import type {
  CanvasGroup,
  CanvasPage,
  CanvasResult,
  CanvasTicket,
} from "../../../packages/contracts/canvas";
import { screenLink } from "./routes";

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
  const due =
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
      className="cx-ticket-link"
      href={screenLink("/incident/" + encodeURIComponent(ticket.id), ns)}
      onClick={(event) => {
        if (event.ctrlKey || event.shiftKey || event.metaKey || event.altKey)
          return;
        event.preventDefault();
        open(ticket.id);
      }}
    >
      <span className="cx-ticket-id">
        {ticket.id}
        <span aria-hidden="true">↗</span>
      </span>
      <strong>{ticket.header || "Без заголовка"}</strong>
      <span className="cx-ticket-details">
        {[ticket.team, ticket.priority].filter(Boolean).join(" · ")}
      </span>
      {due && (
        <time
          className={ticket.overdue ? "cx-past" : ""}
          dateTime={ticket.deadline!}
        >
          {ticket.overdue ? "Просрочен" : "Срок"} · {due}
        </time>
      )}
    </a>
  );
}

export function CanvasDrawer({
  result,
  group,
  close,
  refresh,
  open,
  ns,
  zone,
}: {
  result: CanvasResult;
  group: CanvasGroup | null;
  close: () => void;
  refresh: () => void;
  open: (id: string) => void;
  ns: string;
  zone: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<CanvasTicket[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [request, setRequest] = useState({ offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const groupKey = group?.key;
  useEffect(() => {
    const el = dialog.current!;
    const previous = document.activeElement;
    el.showModal();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      ns,
      selection: result.selection,
      offset: String(request.offset),
    });
    if (groupKey !== undefined) params.set("group", groupKey);
    setLoading(true);
    setError(null);
    canvasJson<CanvasPage>("/api/canvas/tickets?" + params, {
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((previous) =>
          request.offset ? [...previous, ...page.items] : page.items,
        );
        setNext(page.nextOffset);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ns, result.selection, groupKey, request]);

  return (
    <dialog
      ref={dialog}
      className="cx-drawer"
      aria-labelledby="cx-drawer-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="cx-drawer-inner">
        <header>
          <div>
            <span className="cx-caption">Инциденты в срезе</span>
            <h2 id="cx-drawer-title">{group?.label || "Вся выборка"}</h2>
            <p>
              Всего {group?.count ?? result.total} · Версия {result.revision}
            </p>
          </div>
          <button
            className="cx-icon-button"
            type="button"
            aria-label="Закрыть выборку"
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="cx-drawer-list">
          {items.map((ticket) => (
            <CanvasTicketLink key={ticket.id} {...{ ticket, ns, open, zone }} />
          ))}
          {loading && (
            <p role="status" className="cx-note">
              Загружаем инциденты…
            </p>
          )}
          {error && (
            <div role="alert" className="cx-note">
              {error.message}{" "}
              {error instanceof CanvasRequestError &&
              [409, 410].includes(error.status) ? (
                <button className="cx-link-button" onClick={refresh}>
                  Обновить срез
                </button>
              ) : (
                <button
                  className="cx-link-button"
                  onClick={() => setRequest({ ...request })}
                >
                  Повторить
                </button>
              )}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <p className="cx-note">В этой выборке нет инцидентов.</p>
          )}
          {!loading && !error && next !== null && (
            <button
              className="cx-more"
              type="button"
              onClick={() => setRequest({ offset: next })}
            >
              Показать ещё
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
