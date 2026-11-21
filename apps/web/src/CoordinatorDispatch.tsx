import { useEffect, useRef, useState } from "react";
import type { Incident } from "../../../packages/domain/index";
import type { DispatchDecision, DispatchView } from "../../server/dispatch";
import "./dispatch.css";

type Draft = {
  team: string;
  member: string | null;
  note: string;
  snapshot: string;
  expectedVersion: number;
  requestId: string;
};
type Props = {
  incident: Incident;
  ns: string;
  sourceRevision: number;
  csrf?: string;
  zone: string;
  itsmHref: string;
  itsmMock: boolean;
  navigate: (path: string) => void;
};

function newRequestId() {
  // getRandomValues also works on the HTTP preview of the demo.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
function formattedTime(date: string, zone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(date));
}

function DecisionHandoff({
  decision,
  props,
}: {
  decision: DispatchDecision;
  props: Props;
}) {
  const [copied, setCopied] = useState("");
  const [showText, setShowText] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const lines = [
    props.incident.id +
      " · " +
      String(props.incident.raw.header || "Обращение"),
    "Команда назначения: " + decision.team,
    decision.member && "Исполнитель: " + decision.member,
    decision.note && "Комментарий: " + decision.note,
    "Решение координатора: " +
      decision.actor +
      ", " +
      formattedTime(decision.at, props.zone),
  ]
    .filter(Boolean)
    .join("\n");
  useEffect(() => {
    if (showText) {
      field.current?.focus();
      field.current?.select();
    }
  }, [showText]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines);
      setCopied("Текст скопирован.");
    } catch {
      setShowText(true);
      setCopied("Текст выделен для копирования.");
    }
  };
  return (
    <div className="dispatch-handoff">
      <p>
        {props.itsmMock
          ? "Для передачи команде скопируйте решение. Здесь доступен макет карточки ITSM."
          : "Откройте карточку ITSM и перенесите выбранное назначение."}
      </p>
      <div className="dispatch-actions">
        <button
          type="button"
          className="dispatch-inline"
          onClick={() => void copy()}
        >
          Скопировать для передачи
        </button>
        <a
          href={props.itsmHref}
          rel="noopener noreferrer"
          onClick={
            props.itsmMock
              ? (e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault();
                    props.navigate(props.itsmHref);
                  }
                }
              : undefined
          }
        >
          {props.itsmMock
            ? "Посмотреть макет ITSM"
            : "Перейти к назначению в ITSM"}{" "}
          ↗
        </a>
      </div>
      {!!copied && <p role="status">{copied}</p>}
      {showText && (
        <textarea
          ref={field}
          aria-label="Текст для передачи"
          rows={4}
          value={lines}
          readOnly
        />
      )}
    </div>
  );
}

export default function CoordinatorDispatch(props: Props) {
  const { incident, ns, sourceRevision, csrf, zone } = props;
  const url =
    "/api/incident/" +
    encodeURIComponent(incident.id) +
    "/dispatch?ns=" +
    encodeURIComponent(ns);
  const [view, setView] = useState<DispatchView | null>(null);
  const [team, setTeam] = useState("");
  const [member, setMember] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Draft | null>(null);
  const [loadingFault, setLoadingFault] = useState("");
  const [fault, setFault] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingFault("");
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.message || "Не удалось загрузить маршрут.");
        if (!controller.signal.aborted) setView(body);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadingFault(error.message);
      });
    return () => controller.abort();
  }, [url, sourceRevision, csrf, attempt]);
  const best = view?.teams.find((t) => t.name === view.recommended);
  const selected = view?.teams.find((t) => t.name === team);
  const selectedMember = selected?.members.find((m) => m.id === member);
  const currentSnapshot =
    view?.sourceRevision === sourceRevision &&
    view.incidentRevision === incident.revision;
  const currentVersion = view?.history[0]?.version ?? 0;
  const stale =
    conflict ||
    (preview &&
      (preview.snapshot !== view?.snapshot ||
        preview.expectedVersion !== currentVersion ||
        !currentSnapshot));
  const review = () => {
    if (!view || !selected || !currentSnapshot) return;
    setNotice("");
    setFault("");
    setConflict(false);
    setPreview({
      requestId: newRequestId(),
      snapshot: view.snapshot,
      expectedVersion: currentVersion,
      team,
      member: selectedMember?.id ?? null,
      note: note.trim(),
    });
  };
  const refresh = () => {
    setPreview(null);
    setConflict(false);
    setFault("");
    setView(null);
    setAttempt((n) => n + 1);
  };
  const save = async () => {
    if (!preview || !csrf || saving.current || stale) return;
    saving.current = true;
    setBusy(true);
    setFault("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(preview),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(body.message || "Не удалось сохранить решение.");
      }
      const decision: DispatchDecision = body.decision;
      setView(
        (previous) =>
          previous && {
            ...previous,
            history: [
              decision,
              ...previous.history.filter(
                (item) => item.version !== decision.version,
              ),
            ]
              .sort((a, b) => b.version - a.version)
              .slice(0, 20),
          },
      );
      setNotice("Решение сохранено в журнале координатора.");
      setPreview(null);
      setTeam("");
      setMember("");
      setNote("");
      setAttempt((n) => n + 1);
    } catch (error) {
      setFault((error as Error).message);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="dispatch-panel"
      id="dispatch"
      aria-labelledby="dispatch-heading"
    >
      <h2 id="dispatch-heading">Маршрутизация</h2>
      {loadingFault && (
        <div role="alert">
          {loadingFault}{" "}
          <button type="button" className="dispatch-inline" onClick={refresh}>
            Повторить загрузку
          </button>
        </div>
      )}
      {!loadingFault && !view && <p role="status">Загружаем команды…</p>}
      {view && (
        <>
          <div className="dispatch-evidence detail-guidance">
            <p>
              Рекомендация координатору ·{" "}
              <strong>
                {best ? best.name : "Совпадений по другим обращениям нет"}
              </strong>
            </p>
            {best && (
              <p className="dispatch-basis">
                Другие обращения этой команды с продуктом «{view.product}» —{" "}
                {best.product}, с симптомом «{view.symptom}» — {best.symptom}.
                Оба признака — {best.both}.
              </p>
            )}
          </div>
          {view.canSave ? (
            <>
              {!preview ? (
                <form
                  className="dispatch-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    review();
                  }}
                >
                  <label>
                    Команда назначения
                    <select
                      required
                      value={selected?.name || ""}
                      onChange={(e) => {
                        setTeam(e.target.value);
                        setMember("");
                        setNotice("");
                      }}
                    >
                      <option value="">Выберите команду</option>
                      {[...view.teams]
                        .sort(
                          (a, b) =>
                            Number(b.name === best?.name) -
                            Number(a.name === best?.name),
                        )
                        .map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                            {t.name === best?.name ? " · рекомендация" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Исполнитель
                    <select
                      disabled={!selected?.members.length}
                      value={selectedMember?.id ?? ""}
                      onChange={(e) => setMember(e.target.value)}
                    >
                      <option value="">
                        {team && !selected?.members.length
                          ? "Нет исполнителей в выгрузке"
                          : "На команду"}
                      </option>
                      {selected?.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && selected.name !== best?.name && (
                    <p className="dispatch-alt dispatch-basis">
                      У выбранной команды совпадений по продукту —{" "}
                      {selected.product}, по симптому — {selected.symptom}, по
                      обоим признакам — {selected.both}.
                    </p>
                  )}
                  <label className="dispatch-note">
                    Комментарий
                    <input
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Что проверить или передать команде"
                    />
                  </label>
                  <button
                    className="dispatch-review"
                    disabled={!selected || !!loadingFault || !currentSnapshot}
                  >
                    Проверить решение
                  </button>
                </form>
              ) : (
                <div className="dispatch-preview">
                  <h3>Проверка перед сохранением</h3>
                  <p>
                    <strong>{incident.id}</strong> → {preview.team}
                    {selectedMember && " · " + selectedMember.label}
                  </p>
                  {preview.note && <p>{preview.note}</p>}
                  <p className="dispatch-basis">
                    Решение попадёт в журнал. Назначение в ITSM выполняется
                    вручную.
                  </p>
                  {stale && (
                    <p role="alert">
                      Обновите маршрут и проверьте данные ещё раз.
                    </p>
                  )}
                  <div className="dispatch-actions">
                    {stale ? (
                      <button onClick={refresh}>Обновить маршрут</button>
                    ) : (
                      <button
                        disabled={busy || !!loadingFault}
                        onClick={() => void save()}
                      >
                        {busy ? "Сохраняем…" : "Сохранить решение"}
                      </button>
                    )}
                    <button
                      className="dispatch-inline"
                      disabled={busy}
                      onClick={() => {
                        setPreview(null);
                        setFault("");
                        setConflict(false);
                      }}
                    >
                      Изменить выбор
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="dispatch-basis">{view.readOnlyReason}</p>
          )}
          {fault && <p role="alert">{fault}</p>}
          {notice && <p role="status">{notice}</p>}
          {view.history.length > 0 && (
            <section className="dispatch-history" aria-label="Журнал решений">
              <h3>Последнее решение</h3>
              <p>
                <strong>{view.history[0].team}</strong>
                {view.history[0].member && " · " + view.history[0].member}
              </p>
              {view.history[0].note && <p>{view.history[0].note}</p>}
              <small>
                {view.history[0].actor} ·{" "}
                {formattedTime(view.history[0].at, zone)} · версия обращения{" "}
                {view.history[0].incidentRevision}
              </small>
              <DecisionHandoff
                key={view.history[0].version}
                decision={view.history[0]}
                props={props}
              />
              {view.history.length > 1 && (
                <details>
                  <summary>
                    Предыдущие решения ({view.history.length - 1})
                  </summary>
                  <ol>
                    {view.history.slice(1).map((d) => (
                      <li key={d.version}>
                        <strong>{d.team}</strong>
                        {d.member && " · " + d.member}
                        {d.note && <p>{d.note}</p>}
                        <small>
                          {d.actor} · {formattedTime(d.at, zone)}
                        </small>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
