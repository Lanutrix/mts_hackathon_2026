import Select from "./Select";
import { useEffect, useRef, useState } from "react";
import type { Incident } from "../../../packages/domain/index";
import type { DispatchDecision, DispatchMember, DispatchTeam, DispatchView } from "../../server/dispatch";
import { Icon } from "./Brand";
import DispatchHints from "./DispatchHints";
import { ItsmLink } from "./TicketRecord";
import { rememberHandoff } from "./DispatchReturn";
import { liveReturnHref } from "./routes";
import "./dispatch.css";

type Draft = {
  team: string;
  member: string | null;
  memberLabel: string;
  note: string;
  snapshot: string;
  expectedVersion: number;
  requestId: string;
};
type Props = {
  incident: Incident;
  username: string;
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

const normalizeSearch = (s: string) =>
  s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").trim();

function initials(member: DispatchMember) {
  const words = (member.name || member.login).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase("ru");
}

const pageSize = 6;

function PersonPicker({
  team, value, choose,
}: {
  team: DispatchTeam;
  value: string | null;
  choose: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(pageSize);
  const nextOption = useRef<HTMLInputElement>(null);
  const focusNext = useRef(false);
  const tokens = normalizeSearch(query).split(/\s+/u).filter(Boolean);
  const matches = team.members.filter((m) => {
    const name = normalizeSearch(m.label);
    return tokens.every((token) => name.includes(token));
  });
  useEffect(() => {
    if (focusNext.current) {
      nextOption.current?.focus();
      focusNext.current = false;
    }
  }, [limit]);
  return (
    <fieldset className="dispatch-picker">
      <legend>Исполнитель</legend>
      <label className="dispatch-option dispatch-team-option">
        <span className="dispatch-avatar"><Icon name="coordinators" size={18} /></span>
        <span className="dispatch-person">
          <strong>Вся команда</strong>
          <small>Команда выберет сотрудника</small>
        </span>
        <input type="radio" name="recipient" checked={value === ""} onChange={() => choose("")} />
      </label>
      {team.members.length === 0 ? (
        <p className="dispatch-basis dispatch-empty">В выгрузке нет сотрудников этой команды.</p>
      ) : (
        <details className="dispatch-people" open={value ? true : undefined}>
          <summary>Выбрать сотрудника</summary>
        <div className="dispatch-search">
          <Icon name="research" size={17} />
          <input
            type="search"
            aria-label="Найти исполнителя"
            placeholder="Имя или логин"
            value={query}
            onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
            onChange={(event) => { setQuery(event.target.value); setLimit(pageSize); }}
          />
        </div>
          <div className="dispatch-list-head">
            <span aria-live="polite">Сотрудники · {tokens.length ? matches.length + " из " : ""}{team.members.length}</span>
            <span aria-hidden="true">Похожие</span>
            <span aria-hidden="true">Открытые</span>
          </div>
          {matches.length === 0 && <p className="dispatch-empty">Исполнители не найдены</p>}
          {matches.slice(0, limit).map((m, index) => (
            <label className="dispatch-option" key={m.id}>
              <span className="dispatch-avatar" aria-hidden="true">{initials(m)}</span>
              <span className="dispatch-person">
                <strong>{m.name || m.login}</strong>
                {m.name && m.login && <small>{m.login}</small>}
              </span>
              <span className="dispatch-count"><span>Похожие </span>{m.similar}</span>
              <span className="dispatch-count"><span>Открытые </span>{m.open}</span>
              <input
                ref={index === limit - pageSize ? nextOption : undefined}
                type="radio" name="recipient" checked={value === m.id}
                onChange={() => choose(m.id)}
              />
            </label>
          ))}
          {matches.length > limit && (
            <button type="button" className="dispatch-more" onClick={() => {
              focusNext.current = true;
              setLimit(limit + pageSize);
            }}>Показать ещё {Math.min(pageSize, matches.length - limit)}</button>
          )}
        </details>
      )}
    </fieldset>
  );
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
      String(props.incident.raw.header || "Инцидент"),
    "Команда назначения: " + decision.team,
    "Исполнитель: " + (decision.member || "Вся команда"),
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
          ? "Передайте сохранённое решение команде. Для этого инцидента доступен макет ITSM."
          : "Перенесите назначение в карточку ITSM вручную."}
      </p>
      <div className="dispatch-actions">
        <button
          type="button"
          className="dispatch-inline"
          onClick={() => void copy()}
        >
          Скопировать для передачи
        </button>
        <ItsmLink href={props.itsmHref} mock={props.itsmMock} navigate={props.navigate}>
          {props.itsmMock ? "Посмотреть макет ITSM" : "Перейти к назначению в ITSM"}
        </ItsmLink>
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
  const hintsUrl = "/api/incident/" + encodeURIComponent(incident.id) +
    "/dispatch/suggestions?ns=" + encodeURIComponent(ns);
  const [view, setView] = useState<DispatchView | null>(null);
  const [team, setTeam] = useState("");
  const [member, setMember] = useState<string | null>("");
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Draft | null>(null);
  const [loadingFault, setLoadingFault] = useState("");
  const [fault, setFault] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const teamSelect = useRef<HTMLSelectElement>(null);
  const lastDecisionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);
  useEffect(() => {
    if (notice) lastDecisionHeading.current?.focus();
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingFault("");
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.message || "Не удалось загрузить маршрут.");
        if (!controller.signal.aborted) {
          setView(body);

        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadingFault(error.message);
      });
    return () => controller.abort();
  }, [url, sourceRevision, csrf, attempt]);
  const best = view?.teams.find((t) => t.name === view.recommended);
  const selected = view?.teams.find((t) => t.name === team);
  const selectedMember = selected?.members.find((m) => m.id === member);
  const hasRecipient = member === "" || !!selectedMember;
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
  function chooseTeam(name: string) {
    setTeam(name);
    setMember("");
    setNotice("");
    setFault("");
  }
  const review = () => {
    if (!view || !selected || !hasRecipient || !currentSnapshot) return;
    setNotice("");
    setFault("");
    setConflict(false);
    setPreview({
      requestId: newRequestId(),
      snapshot: view.snapshot,
      expectedVersion: currentVersion,
      team: selected.name,
      member: selectedMember?.id ?? null,
      memberLabel: selectedMember?.label ?? "Вся команда",
      note: note.trim(),
    });
  };
  const refresh = () => {
    setPreview(null);
    setConflict(false);
    setFault("");
    setView(null);
    setMember("");
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
        body: JSON.stringify({
          requestId: preview.requestId,
          expectedVersion: preview.expectedVersion,
          snapshot: preview.snapshot,
          team: preview.team,
          member: preview.member,
          note: preview.note,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(body.message || "Не удалось сохранить решение.");
      }
      const decision: DispatchDecision = body.decision;
      rememberHandoff(props.username, ns, incident.id, decision.team);
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
      setEditing(false);
      setTeam(decision.team);
      setMember(null);
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
      <div className="dispatch-heading">
        <h2 id="dispatch-heading">Маршрутизация</h2>
        {view?.canSave && <span>Журнал координатора</span>}
      </div>
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
          {view.canSave && (!view.history.length || editing || preview) ? (
            !preview ? (
              <form className="dispatch-form" onSubmit={(event) => {
                event.preventDefault();
                review();
              }}>
                <div className={"dispatch-layout" + (!selected && !best ? " dispatch-layout-alone" : "")}>
                  <div className="dispatch-team">
                    <label>
                      Команда назначения
                      <Select aria-label="Команда назначения"
                        ref={teamSelect}
                        required
                        value={selected?.name || ""}
                        onChange={(event) => chooseTeam(event.target.value)}
                      >
                        <option value="">Выберите команду</option>
                        {[...view.teams].sort((a, b) =>
                          Number(b.name === best?.name) - Number(a.name === best?.name),
                        ).map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </Select>
                    </label>
                    {csrf && currentSnapshot && !loadingFault && <DispatchHints key={view.snapshot + "/teams"}
                      kind="teams" csrf={csrf} endpoint={hintsUrl} snapshot={view.snapshot}
                      chooseTeam={(name) => {
                        if (!view.teams.some((candidate) => candidate.name === name)) return;
                        chooseTeam(name);
                        teamSelect.current?.focus();
                      }} />}
                    <div className="dispatch-evidence">
                      {selected && (
                        <details className="dispatch-reasons">
                          <summary>Основания для выбора команды</summary>
                          <dl>
                            <div><dt>Продукт «{view.product}»</dt><dd>{selected.product}</dd></div>
                            <div><dt>Симптом «{view.symptom}»</dt><dd>{selected.symptom}</dd></div>
                            <div><dt>Оба признака</dt><dd>{selected.both}</dd></div>
                          </dl>
                          {!!selected.members.length && <p className="dispatch-basis">
                            Числа относятся к другим инцидентам этой команды в выгрузке.
                            У сотрудника «Похожие» совпадают по продукту и симптому,
                            а «Открытые» включают назначенные, выполняемые и инциденты на исследовании.
                          </p>}
                        </details>
                      )}
                    </div>
                  </div>
                  {selected ? (
                    <PersonPicker key={selected.name} team={selected} value={member} choose={setMember} />
                  ) : best ? <div className="dispatch-quick-team">
                    <small>По похожим инцидентам</small>
                    <strong>{best.name}</strong>
                    <p>{best.both ? "Совпали продукт и симптом" : best.product ? "Совпал продукт" : "Совпал симптом"}
                      {" · " + (best.both || best.product || best.symptom)}</p>
                    <button type="button" className="dispatch-inline" onClick={() => chooseTeam(best.name)}>Подставить команду</button>
                  </div> : null}
                </div>
                <div className="dispatch-footer">
                  <div className="dispatch-note">
                    <label htmlFor="dispatch-comment">Комментарий</label>
                    <textarea
                      id="dispatch-comment"
                      rows={2}
                      maxLength={500}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Что передать исполнителю?"
                    />
                    {csrf && currentSnapshot && !loadingFault && <DispatchHints
                      key={JSON.stringify([view.snapshot, selected?.name])} kind="comments" csrf={csrf}
                      endpoint={hintsUrl} snapshot={view.snapshot} team={selected?.name}
                      hasNote={note.length > 0} insert={(text) => {
                        setNote(text);
                        document.getElementById("dispatch-comment")?.focus();
                      }} />}
                  </div>
                  <div className="dispatch-submit">
                    {selected && hasRecipient && (
                      <p className="dispatch-target"><small>Получатель</small>
                        <strong>{selectedMember?.label ?? selected.name}</strong>
                      </p>
                    )}
                    <button className="dispatch-review" disabled={!selected || !hasRecipient || !!loadingFault || !currentSnapshot}>
                      Проверить решение <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <section className="dispatch-preview" aria-labelledby="dispatch-preview-title">
                <h3 id="dispatch-preview-title" tabIndex={-1} ref={previewHeading}>Проверка перед сохранением</h3>
                <dl className="dispatch-summary">
                  <div><dt>Инцидент</dt><dd>{incident.id}</dd></div>
                  <div><dt>Команда назначения</dt><dd>{preview.team}</dd></div>
                  <div><dt>Исполнитель</dt><dd>{preview.memberLabel}</dd></div>
                  {preview.note && <div><dt>Комментарий</dt><dd>{preview.note}</dd></div>}
                </dl>
                <p className="dispatch-basis">Решение попадёт в журнал координатора. Назначение в ITSM выполняется вручную.</p>
                {stale && <p role="alert">Обновите маршрут и проверьте данные ещё раз.</p>}
                <div className="dispatch-actions">
                  {stale ? (
                    <button type="button" onClick={refresh}>Обновить маршрут</button>
                  ) : (
                    <button type="button" disabled={busy || !!loadingFault} onClick={() => void save()}>
                      {busy ? "Сохраняем…" : "Сохранить решение"}
                    </button>
                  )}
                  <button
                    type="button" className="dispatch-inline" disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setFault("");
                      setConflict(false);
                      requestAnimationFrame(() => teamSelect.current?.focus());
                    }}
                  >Изменить выбор</button>
                </div>
              </section>
            )
          ) : !view.canSave && (
            incident.sourcePresent && !incident.quarantined && incident.stateId !== 7 && incident.stateId !== 10 ?
            <div className="dispatch-evidence">
              <span className="dispatch-recommend"><Icon name="layers" size={15} />Рекомендация координатору</span>
              <strong>{best?.name ?? "Совпадений по другим инцидентам нет"}</strong>
              {best && <p className="dispatch-basis">Другие инциденты с продуктом «{view.product}» — {best.product},
                с симптомом «{view.symptom}» — {best.symptom}. Оба признака — {best.both}.</p>}
              <p className="dispatch-basis">{view.readOnlyReason}</p>
            </div> : <p className="dispatch-basis">{view.readOnlyReason}</p>
          )}
          {fault && <p role="alert">{fault}</p>}
          {notice && <p role="status">{notice}</p>}
          {view.history.length > 0 && (
            <section className="dispatch-history" aria-label="Журнал решений">
              <h3 ref={lastDecisionHeading} tabIndex={-1}>Последнее решение</h3>
              <p>
                <strong>{view.history[0].member ?? "Вся команда"}</strong>
                {" · " + view.history[0].team}
              </p>
              {view.history[0].note && <p>{view.history[0].note}</p>}
              <small>
                {view.history[0].actor} ·{" "}
                {formattedTime(view.history[0].at, zone)}
              </small>
              <DecisionHandoff
                key={view.history[0].version}
                decision={view.history[0]}
                props={props}
              />
              <a className="dispatch-return-link" href={liveReturnHref(ns)} onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                props.navigate(liveReturnHref(ns));
              }}><Icon name="live" size={17} />Вернуться в эфир</a>
              {view.history.length > 1 && (
                <details>
                  <summary>
                    Предыдущие решения ({view.history.length - 1})
                  </summary>
                  <ol>
                    {view.history.slice(1).map((d) => (
                      <li key={d.version}>
                        <strong>{d.team}</strong>
                        {" · " + (d.member ?? "Вся команда")}
                        {d.note && <p>{d.note}</p>}
                        <small>
                          {d.actor} · {formattedTime(d.at, zone)}
                        </small>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {view.canSave && !editing && !preview && (
                <button type="button" className="dispatch-secondary" onClick={() => {
                  const saved = view.history[0];
                  const previousTeam = view.teams.find((t) => t.name === saved.team);
                  setTeam(previousTeam?.name ?? "");
                  setMember(saved.member ? previousTeam?.members.find((m) => m.label === saved.member)?.id ?? null : "");
                  setNote(saved.note);
                  setNotice("");
                  setEditing(true);
                  requestAnimationFrame(() => teamSelect.current?.focus());
                }}>Изменить назначение</button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
