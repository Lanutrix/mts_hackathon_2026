import { useEffect, useRef, useState } from "react";
import type {
  JuryEvent,
  JuryIncident,
  JurySnapshot,
} from "../../server/jurySimulation";
import { Mark, Icon } from "./Brand";
import {
  IncidentNotice,
  signalTitle,
  type IncidentSignal,
} from "./IncidentNotice";
import MelonScene from "./MelonScene";
import { mergeSignals } from "./signalQueue";
import "./jury.css";

const clock = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Moscow",
});
const time = (iso: string) => clock.format(new Date(iso));
const groupNames: Record<string, string> = {
  critical: "Критический",
  coordinators: "У координаторов",
  high: "Высокий приоритет",
  research: "Исследование",
};
type Selection = { record: JuryIncident | JuryEvent; live: boolean };
type Receipts = { runId: string; keys: Record<string, number> };
const receiptKey = "watermelon:jury:receipts";
function readReceipts(runId: string): Receipts {
  try {
    const saved = JSON.parse(sessionStorage.getItem(receiptKey) || "null");
    if (saved?.runId === runId && saved.keys && typeof saved.keys === "object")
      return saved;
  } catch {
    /* Storage is optional in private browsing. */
  }
  return { runId, keys: {} };
}

function nextCheck(row: JuryIncident) {
  if (row.state === "Завершён")
    return "Сверить результат восстановления с описанием решения в источнике.";
  if (row.groups.includes("coordinators"))
    return "Сверить исполнителя и ближайший срок ответа.";
  if (row.groups.includes("critical"))
    return "Уточнить масштаб сбоя у указанной команды и проверить срок восстановления.";
  return "Проверить описание инцидента и текущего исполнителя.";
}

export default function JuryBroadcast() {
  const [snapshot, setSnapshot] = useState<JurySnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockMs, setClockMs] = useState(Date.now);
  const [signals, setSignals] = useState<IncidentSignal[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fault, setFault] = useState("");
  const detail = useRef<HTMLElement>(null);
  const journal = useRef<HTMLElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const receipts = useRef<Receipts>({ runId: "", keys: {} });
  const offset = useRef(0);

  useEffect(() => {
    const stream = new EventSource("/api/simulation/stream");
    let lastRun = "",
      lastRevision = 0;
    let disposed = false;
    function accept(event: MessageEvent<string>) {
      if (disposed) return;
      let next: JurySnapshot;
      try {
        next = JSON.parse(event.data);
        if (
          !next.runId ||
          !Number.isSafeInteger(next.revision) ||
          !Array.isArray(next.events) ||
          !Array.isArray(next.incidents) ||
          !Number.isFinite(Date.parse(next.time))
        )
          throw new Error();
      } catch {
        setFault("Не удалось прочитать снимок учебного источника.");
        return;
      }
      setConnected(true);
      setFault("");
      const first = next.runId !== lastRun;
      offset.current = Date.parse(next.time) - Date.now();
      setClockMs(Date.now() + offset.current);
      if (!first && next.revision <= lastRevision) return;
      if (first) {
        receipts.current = readReceipts(next.runId);
        setSelection(null);
      }
      const visible = next.events
        .filter((signal) =>
          first
            ? next.step > 0 &&
              next.incidents.some((record) => record.id === signal.id)
            : signal.revision > lastRevision,
        )
        .filter(
          (signal) =>
            (receipts.current.keys[signal.key] ?? 0) < signal.revision,
        );
      const activeKeys = new Set(next.incidents.map((record) => record.key));
      setSignals((old) =>
        mergeSignals(
          first ? [] : old.filter((s) => activeKeys.has(s.key)),
          visible,
        ),
      );
      setSnapshot(next);
      lastRun = next.runId;
      lastRevision = next.revision;
    }
    stream.addEventListener("snapshot", accept);
    stream.onerror = () => {
      if (!disposed) {
        setConnected(false);
        setFault(
          stream.readyState === EventSource.CLOSED
            ? "Учебный эфир недоступен. Попробуйте открыть страницу позже."
            : "Связь прервана. Переподключаемся к учебному эфиру…",
        );
      }
    };
    const timer = window.setInterval(
      () => setClockMs(Date.now() + offset.current),
      1000,
    );
    return () => {
      disposed = true;
      stream.close();
      window.clearInterval(timer);
    };
  }, []);

  function remember(signal: IncidentSignal) {
    const history = receipts.current;
    const retained =
      snapshot?.events.slice(0, 24).map((event) => event.key) ?? [];
    history.keys = Object.fromEntries(
      Object.entries(history.keys).filter(([key]) => retained.includes(key)),
    );
    history.keys[signal.key] = Math.max(
      history.keys[signal.key] ?? 0,
      signal.revision,
    );
    try {
      sessionStorage.setItem(receiptKey, JSON.stringify(history));
    } catch {}
    setSignals((items) =>
      items.filter((s) => s.key !== signal.key || s.revision > signal.revision),
    );
  }
  function focusPanel(panel: HTMLElement | null) {
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "nearest" });
  }
  function inspect(record: JuryIncident | JuryEvent, live: boolean) {
    setSelection({ record, live });
    requestAnimationFrame(() => focusPanel(detail.current));
  }
  const current = snapshot?.incidents[0];
  const selectedLive = snapshot?.incidents.find(
    (r) => r.key === selection?.record.key,
  );
  const selected = selection?.live
    ? selectedLive || selection.record
    : selection?.record;
  const event =
    selection && !selection.live && "revision" in selection.record
      ? selection.record
      : null;
  const notice = signals[0] ?? null;
  const remaining =
    connected && snapshot?.nextAt
      ? Math.max(0, Math.ceil((Date.parse(snapshot.nextAt) - clockMs) / 1000))
      : null;
  return (
    <div className="app ops-shell jury">
      <a className="skip" href="#jury-main">
        К содержимому
      </a>
      <header className="ops-header jury-head">
        <a className="ops-brand" href="/">
          <Mark />
          <span>Watermelon</span>
          <small>МТС</small>
        </a>
        <a href="/live" className="jury-return">
          <Icon name="live" size={16} />
          Рабочий эфир
        </a>
      </header>
      <IncidentNotice
        signal={notice}
        pendingCount={signals.length}
        onDismiss={() => {
          if (notice) remember(notice);
        }}
        onOpen={() => {
          if (!notice) return;
          const record = snapshot?.incidents.find(
            (row) => row.key === notice.key,
          );
          const fact = snapshot?.events.find(
            (row) => row.key === notice.key && row.revision === notice.revision,
          );
          if (record || fact) inspect((record || fact)!, Boolean(record));
          remember(notice);
        }}
        onJournal={() => focusPanel(journal.current)}
      />
      <main id="jury-main">
        <section className="jury-stage" aria-labelledby="jury-title">
          <div>
            <h1 id="jury-title" tabIndex={-1} ref={headline}>
              Учебный эфир
            </h1>
            <p>
              События приходят из учебного JSON. Координатор выбирает следующий
              шаг.
            </p>
            <div className="jury-source" role="status">
              <i data-online={connected} />
              {connected ? "На связи" : fault ? "Нет связи" : "Подключение…"}
              {snapshot && <span>Версия {snapshot.revision}</span>}
            </div>
          </div>
          <div className="jury-optic">
            <MelonScene
              active={
                current?.groups.includes("coordinators")
                  ? "coordinators"
                  : current?.groups.includes("critical")
                    ? "critical"
                    : "all"
              }
              revision={snapshot?.revision}
            />
          </div>
        </section>
        {fault && (
          <p className="jury-fault" role="status">
            {fault}
          </p>
        )}
        <div className="jury-desk">
          <section className="jury-ticket" aria-label="Инцидент в эфире">
            <div className="jury-section-head">
              <h2>Инцидент в эфире</h2>
            </div>
            {current ? (
              <>
                <div className="jury-meta">
                  {current.id} · {current.product}
                </div>
                <button
                  className="jury-ticket-title"
                  onClick={() => inspect(current, true)}
                >
                  {current.header}
                  <span aria-hidden="true">↗</span>
                </button>
                <p className="jury-reasons">
                  {current.groups.map((g) => (
                    <span key={g}>
                      <i data-group={g} />
                      {groupNames[g] ?? g}
                    </span>
                  ))}
                </p>
                <dl className="jury-facts">
                  <div>
                    <dt>Статус</dt>
                    <dd>{current.state}</dd>
                  </div>
                  <div>
                    <dt>Команда</dt>
                    <dd>{current.team}</dd>
                  </div>
                  <div>
                    <dt>Срок · МСК</dt>
                    <dd>
                      {current.deadline ? time(current.deadline) : "Не задан"}
                    </dd>
                  </div>
                </dl>
                {remaining !== null && (
                  <p className="jury-next">
                    Обновление источника через <strong>{remaining} с</strong>
                  </p>
                )}
              </>
            ) : (
              <p className="jury-empty">Ожидаем первый снимок источника.</p>
            )}
          </section>
          <section
            className="jury-journal"
            aria-labelledby="jury-journal-name"
            tabIndex={-1}
            ref={journal}
          >
            <div className="jury-section-head">
              <h2 id="jury-journal-name">Журнал сигналов</h2>
              {!!snapshot?.events.length && (
                <span>{snapshot.events.length}</span>
              )}
            </div>
            {snapshot?.events.length ? (
              <ol>
                {snapshot.events.map((s) => (
                  <li key={snapshot.runId + ":" + s.revision + ":" + s.key}>
                    <button onClick={() => inspect(s, false)}>
                      <time dateTime={s.at}>{time(s.at)}</time>
                      <span>
                        <strong>{signalTitle(s)}</strong>
                        <small>
                          {s.id} · {s.header}
                        </small>
                      </span>
                      <span className="jury-journal-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="jury-empty">
                Пока сигналов нет. Здесь останутся критические события,
                назначения и решения.
              </p>
            )}
          </section>
        </div>
        {selected && (
          <section
            ref={detail}
            tabIndex={-1}
            aria-label="Сведения об инциденте"
            className="jury-detail"
          >
            <div className="jury-detail-head">
              <div>
                <p className="jury-meta">
                  {selected.id} ·{" "}
                  {event
                    ? "Снимок события, версия " + event.revision
                    : selectedLive
                      ? "Текущие данные источника"
                      : "Последний показанный снимок"}
                </p>
                <h2>{selected.header}</h2>
              </div>
              <button
                onClick={() => {
                  setSelection(null);
                  focusPanel(headline.current);
                }}
                aria-label="Закрыть сведения"
              >
                ×
              </button>
            </div>
            {event && (
              <p>
                <strong>{signalTitle(event)}</strong> · {time(event.at)} МСК
              </p>
            )}
            <p>{selected.description}</p>
            <p className="jury-guidance">
              <strong>Рекомендация координатору</strong> {nextCheck(selected)}
            </p>
            <dl className="jury-facts">
              <div>
                <dt>Продукт</dt>
                <dd>{selected.product}</dd>
              </div>
              <div>
                <dt>Статус</dt>
                <dd>{selected.state}</dd>
              </div>
              <div>
                <dt>Команда</dt>
                <dd>{selected.team}</dd>
              </div>
              <div>
                <dt>Исполнитель</dt>
                <dd>{selected.assignee || "Не указан"}</dd>
              </div>
              <div>
                <dt>Срок · МСК</dt>
                <dd>
                  {selected.deadline ? time(selected.deadline) : "Не задан"}
                </dd>
              </div>
            </dl>
            {event && selectedLive && (
              <button
                className="jury-detail-link"
                onClick={() => inspect(selectedLive, true)}
              >
                Текущие данные инцидента →
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
