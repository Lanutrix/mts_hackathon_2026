import { useCallback, useEffect, useRef, useState } from "react";
import type { ShiftTab, ShiftTicket, ShiftView } from "../../../packages/contracts/shift";
import { Icon } from "./Brand";
import Select from "./Select";
import "./shift.css";

const tabs: Record<ShiftTab, string> = {
  suggested: "Предложены мне",
  mine: "В работе у меня",
  team: "У коллег",
};
type Props = {
  ns: string;
  csrf: string;
  username: string;
  isAdmin: boolean;
  ticket?: string;
  open: (id: string) => void;
};
export default function ShiftDesk({ ns, csrf, username, isAdmin, ticket, open }: Props) {
  const [view, setView] = useState<ShiftView | null>(null);
  const [tab, setTab] = useState<ShiftTab>("suggested"),
    [offset, setOffset] = useState(0);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [recipient, setRecipient] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const read = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    try {
      const query = new URLSearchParams({ ns, tab, offset: String(offset) });
      if (ticket) query.set("ticket", ticket);
      const res = await fetch("/api/shift?" + query, { signal: controller.signal, cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Смена недоступна.");
      if (!controller.signal.aborted) {
        setError("");
        setView(data);
        if (offset && data.total <= offset) setOffset(Math.max(0, offset - 12));
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Смена недоступна.");
    }
  }, [ns, ticket, tab, offset]);
  useEffect(() => {
    void refresh();
    const update = () => {
      if (!document.hidden) void refresh();
    };
    const interval = window.setInterval(update, 5000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      read.current?.abort();
      clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);
  useEffect(() => {
    if (opened) dialog.current?.showModal();
  }, [opened]);
  async function assign(row: ShiftTicket, owner: string | null) {
    if (!view || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(
        "/api/shift/" + encodeURIComponent(row.id) + "/owner?ns=" + encodeURIComponent(ns),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ runId: view.runId, version: row.version, owner }),
        },
      );
      const data = await res.json();
      setNotice(
        !res.ok
          ? data.message || "Назначение не сохранено."
          : owner === username
            ? "Взято в работу: " + row.id
            : owner
              ? "Передано: " + owner
              : "Заявка возвращена в очередь.",
      );
      setRecipient("");
    } catch {
      setNotice("Не удалось подтвердить назначение. Проверьте состояние очереди.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  const mine = view?.members.find((m) => m.name === username);
  const entry = view?.ticket;
  function take(row: ShiftTicket) {
    return (
      <button className="shift-take" type="button" disabled={busy} onClick={() => void assign(row, username)}>
        Взять в работу
      </button>
    );
  }
  if (ticket)
    return (
      <section className="shift-owner" aria-label="Координатор заявки">
        {entry && (
          <>
            <h3>
              <Icon name="profile" size={18} />
              {entry.owner ? "Координатор · " + entry.owner : "Координатор заявки"}
            </h3>
            {!entry.owner && (
              <>
                {entry.suggested && <p>Предложено: {entry.suggested}</p>}
                {take(entry)}
              </>
            )}
            {entry.owner &&
              entry.owner !== username &&
              !view!.members.some((m) => m.name === entry.owner && m.active) && (
                <button type="button" disabled={busy} onClick={() => void assign(entry, username)}>
                  Подхватить у отсутствующего коллеги
                </button>
              )}
            {entry.owner && (entry.owner === username || isAdmin) && (
              <div className="shift-actions">
                {view!.members.some((m) => m.active && m.name !== entry.owner) && (
                  <>
                    <label>
                      Передать координатору
                      <Select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                        <option value="">Выберите коллегу</option>
                        {view!.members
                          .filter((m) => m.active && m.name !== entry.owner)
                          .map((m) => (
                            <option key={m.name}>{m.name}</option>
                          ))}
                      </Select>
                    </label>
                    <button
                      type="button"
                      disabled={!recipient || busy}
                      onClick={() => void assign(entry, recipient)}
                    >
                      Передать коллеге
                    </button>
                  </>
                )}
                <button type="button" disabled={busy} onClick={() => void assign(entry, null)}>
                  Вернуть в очередь
                </button>
              </div>
            )}
          </>
        )}
        {(notice || error) && <p role="status">{notice || error}</p>}
      </section>
    );
  return (
    <div className="shift-entry">
      <button
        type="button"
        className="shift-trigger"
        aria-haspopup="dialog"
        onClick={() => {
          setOpened(true);
          void refresh();
        }}
      >
        <Icon name="team" size={18} />
        Моя смена{mine && <b>{mine.taken}</b>}
      </button>
      {opened && (
        <dialog
          className="shift-dialog"
          aria-labelledby="shift-title"
          ref={dialog}
          onClose={() => setOpened(false)}
        >
          <header>
            <div>
              <small>Координаторы на связи · {view?.members.filter((m) => m.active).length ?? 0}</small>
              <h2 id="shift-title">Моя смена</h2>
            </div>
            <button
              type="button"
              className="shift-close"
              aria-label="Закрыть смену"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </header>
          {view && (
            <details className="shift-roster">
              <summary>Нагрузка смены</summary>
              <ul>
                {view.members.map((m) => (
                  <li key={m.name}>
                    <strong>{m.name}</strong>
                    <span>
                      {m.active ? "На связи" : "Вне смены"} · в работе {m.taken} · предложено {m.suggested}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="shift-tabs" role="group" aria-label="Выбор очереди">
            {(Object.keys(tabs) as ShiftTab[]).map((k) => (
              <button
                aria-pressed={k === tab}
                key={k}
                onClick={() => {
                  if (k !== tab) {
                    setTab(k);
                    setOffset(0);
                    setView(null);
                    setNotice("");
                  }
                }}
              >
                {tabs[k]}
                {k === "suggested" && mine
                  ? " · " + mine.suggested
                  : k === "mine" && mine
                    ? " · " + mine.taken
                    : ""}
              </button>
            ))}
          </div>
          {(error || notice) && <p role="status">{error || notice}</p>}
          {!view ? (
            !error && <p role="status">Загружаем смену…</p>
          ) : (
            <>
              {!view.total && (
                <p>
                  {tab === "mine"
                    ? "Вы пока не взяли заявки в работу."
                    : tab === "team"
                      ? "У коллег пока нет закреплённых заявок."
                      : "Сейчас для вас нет свободных заявок."}
                </p>
              )}
              <ol>
                {view.rows.map((row) => (
                  <li key={row.id}>
                    <div>
                      <small>
                        {row.id}
                        {row.owner ? " · " + row.owner : ""}
                      </small>
                      <button
                        className="shift-ticket-link"
                        onClick={() => {
                          dialog.current?.close();
                          open(row.id);
                        }}
                      >
                        {row.header}
                      </button>
                      <p>{row.basis}</p>
                      {row.cluster && (
                        <small>
                          {row.model ? "Группа ИИ" : "Группа"} · {row.cluster}
                        </small>
                      )}
                    </div>
                    {!row.owner && take(row)}
                  </li>
                ))}
              </ol>
              {view.total > 12 && (
                <div className="shift-pager">
                  <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 12))}>
                    Назад
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 12, view.total)} из {view.total}
                  </span>
                  <button disabled={offset + 12 >= view.total} onClick={() => setOffset(offset + 12)}>
                    Дальше
                  </button>
                </div>
              )}
            </>
          )}
        </dialog>
      )}
    </div>
  );
}
