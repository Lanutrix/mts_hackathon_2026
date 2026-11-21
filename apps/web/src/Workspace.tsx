import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Incident, Group } from "../../../packages/domain/index.ts";
import type { Analysis } from "../../server/analysis.ts";
import "./workspace.css";

export interface WorkspaceAnalysis {
  items: { id: string; analysis: Analysis }[];
  overview?: string[];
}
const groups: Group[] = ["critical", "coordinators", "high", "research"];

function QueueOptic({ count }: { count: number }) {
  const id = useId();
  const pane = "M-37-51H37Q51-51 51-37V37Q51 51 37 51H-37Q-51 51-51 37V-37Q-51-51-37-51ZM-20-27Q-27-27-27-20V20Q-27 27-20 27H20Q27 27 27 20V-20Q27-27 20-27Z";
  return (
    <svg className="wq-optic" viewBox="0 0 390 194" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id + "-glass"} x1="0" y1="0" x2="1" y2=".86" gradientUnits="objectBoundingBox">
          <stop stopColor="#fcfbff" />
          <stop offset=".44" stopColor="#dcd4ee" />
          <stop offset=".69" stopColor="#c4b0de" />
          <stop offset="1" stopColor="#9687ad" />
        </linearGradient>
        <radialGradient id={id + "-shadow"}>
          <stop stopColor="#5b456d" stopOpacity=".27" />
          <stop offset="1" stopColor="#5b456d" stopOpacity="0" />
        </radialGradient>
        <path id={id + "-pane"} d={pane} fillRule="evenodd" />
      </defs>
      <g className="wq-optic-motion">
        <ellipse cx="200" cy="149" rx="101" ry="13" fill={`url(#${id}-shadow)`} />
        <g transform="rotate(-14 195 100)" strokeWidth=".85">
          <ellipse cx="195" cy="100" rx="165" ry="53" stroke="#a99cba" />
          <path d="M85 60a165 53 0 0 1 109-13m155 72a165 53 0 0 1-58 26" stroke="white" />
          <path d="M25 100h10m320 0h10M195 43v9m0 97v9" stroke="#81738e" />
        </g>
        {[2, 1, 0].map((index) => (
          <g key={index} className="wq-lens" style={{ transform: `translate(${143 + index * (43 + count * .85)}px,${110 - index * (11 + count * .35)}px)` }}>
            <g transform="matrix(.72 -.35 .39 .82 0 0)">
              <use href={`#${id}-pane`} transform="translate(5 5)" fill="#a797bd" stroke="#9988ad" strokeWidth="1.4" />
              <use href={`#${id}-pane`} fill={`url(#${id}-glass)`} stroke="#f5f1fe" strokeWidth="1.2" />
              <path d="M-36-47H34M-47-33V22" stroke="white" strokeOpacity=".76" strokeWidth=".8" />
            </g>
          </g>
        ))}
        <g transform="translate(143 110)">
          <path d="M-11-5v-6h6M5 11h6V5" stroke="#786989" />
          <rect x="-3.3" y="-3.3" width="6.6" height="6.6" fill="#c50032" />
        </g>
      </g>
    </svg>
  );
}
const reasonLabels: Record<Group, string> = {
  critical: "Критический приоритет",
  coordinators: "У координаторов",
  high: "Высокий приоритет",
  research: "На исследовании",
};
const questions = [
  ["Сроки", "У каких инцидентов приближается срок решения?"],
  ["Ответственные", "Какие команды отвечают за выбранные инциденты?"],
  ["Симптомы", "Какие симптомы описаны в выбранных инцидентах?"],
] as const;
const contextLimit = 6;
const displayStep = 18;
type Grouping = "none" | "product" | "team";
type GroupPage = { count: number; offset: number; items: Incident[] };
type Dashboard = {
  namespace: string;
  revision: number;
  acceptedAt: string | null;
  unique: number;
  groups: Record<Group, GroupPage>;
};
type Snapshot = {
  page: Dashboard;
  query: string;
  items: Map<string, Incident>;
  hasMore: boolean;
};
type Selection = { id: string; incident?: Incident };
type Props = {
  data: Dashboard | null;
  ns: string;
  open: (id: string) => void;
  zone: string;
  write: boolean;
  userKey: string;
  analyze: (ids: string[], question: string) => Promise<WorkspaceAnalysis>;
};

function mergePage(
  page: Dashboard,
  query: string,
  previous?: Snapshot,
): Snapshot {
  const items = new Map(previous?.items);
  for (const group of groups)
    for (const row of page.groups[group].items) items.set(row.id, row);
  const hasMore = groups.some((group) => {
    const { offset, items, count } = page.groups[group];
    return offset + items.length < count;
  });
  return { page, query, items, hasMore };
}

function seedPage(data: Dashboard | null, ns: string, query: string) {
  const params = new URLSearchParams(location.search);
  if (
    query ||
    data?.namespace !== ns ||
    [...params.keys()].some((key) => key !== "ns")
  )
    return null;
  return groups.every((group) => data.groups[group].offset === 0) ? data : null;
}

function restoreSelection(key: string): Selection[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || "[]");
    if (Array.isArray(value)) {
      const ids = value.filter(
        (id): id is string =>
          typeof id === "string" && !!id && id.length <= 200,
      );
      return [...new Set(ids)].slice(0, contextLimit).map((id) => ({ id }));
    }
  } catch {
    /* Storage can be disabled in a private tab. */
  }
  return [];
}

function earliestDeadline(selected: Selection[], loaded?: Map<string, Incident>) {
  let earliest: number | null = null;
  for (const { id, incident } of selected) {
    const row = loaded?.get(id) ?? incident;
    if (!row) return null;
    if (!row.dates.deadline) continue;
    const time = Date.parse(row.dates.deadline);
    if (earliest === null || time < earliest) earliest = time;
  }
  return earliest;
}

function SeedTray({ count }: { count: number }) {
  return (
    <div className="wq-tray" aria-hidden="true">
      <div className="wq-slice">
        {Array.from({ length: contextLimit }, (_, index) => (
          <i key={index} className="wq-slot" data-filled={index < count} />
        ))}
      </div>
    </div>
  );
}

function transferSeed(
  from: HTMLElement,
  to: HTMLElement | null,
  seed: HTMLElement | null,
) {
  if (!seed || !to || matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  const start = from.getBoundingClientRect();
  const end = to.getBoundingClientRect();
  if (!end.width || end.top < 0 || end.bottom > window.innerHeight) return;
  const x = start.left + start.width / 2 - 4;
  const y = start.top + start.height / 2 - 7;
  const dx = end.left + end.width / 2 - 4 - x;
  const dy = end.top + end.height / 2 - 7 - y;
  const position = (ratio: number, lift: number, angle: number, scale: number) =>
    `translate(${x + dx * ratio}px, ${y + dy * ratio + lift}px) rotate(${angle}deg) scale(${scale})`;
  seed.getAnimations().forEach((flight) => flight.cancel());
  seed.animate(
    [
      { transform: position(0, 0, -32, 0.7), opacity: 0 },
      { transform: position(0.12, -24, -8, 1.2), opacity: 1, offset: 0.14 },
      { transform: position(0.66, -32, 55, 1), opacity: 1, offset: 0.55 },
      { transform: position(1, 0, 18, 0.75), opacity: 0 },
    ],
    { duration: 510, easing: "cubic-bezier(.2,.65,.25,1)" },
  );
}

function Arrow({ direction = "up" }: { direction?: "up" | "right" | "down" }) {
  return (
    <span aria-hidden="true" className={"wq-arrow wq-arrow-" + direction} />
  );
}

function SelectedTicket({
  id,
  incident,
  ns,
  open,
  remove,
}: {
  id: string;
  incident?: Incident;
  ns: string;
  open: () => void;
  remove: () => void;
}) {
  const [restored, setRestored] = useState<Incident>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (incident) return;
    const controller = new AbortController();
    fetch(
      "/api/incident/" +
        encodeURIComponent(id) +
        "?ns=" +
        encodeURIComponent(ns),
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) setRestored(result.incident);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      });
    return () => controller.abort();
  }, [id, ns, incident]);
  const row = incident ?? restored;
  return (
    <li className="wq-selected">
      <button className="wq-selected-ticket" type="button" onClick={open}>
        <span>{id}</span>
        <strong>
          {row
            ? String(row.raw.header || "Без заголовка")
            : unavailable
              ? "Карточка недоступна"
              : "Загрузка карточки…"}
        </strong>
      </button>
      <button
        className="wq-remove"
        type="button"
        onClick={remove}
        aria-label={"Убрать " + id}
      >
        ×
      </button>
    </li>
  );
}

function FieldEvidence({ analysis }: { analysis: Analysis }) {
  return (
    <div className="wq-evidence">
      {analysis.error && <p>{analysis.error}</p>}
      <ul>
        {analysis.summary.map((line, i) => (
          <li key={i}>
            {line}
            <small>
              {analysis.evidence
                .filter((item) => item.claim === i)
                .flatMap((item) => item.fields)
                .join(" · ")}
            </small>
          </li>
        ))}
      </ul>
      {analysis.uncertainties.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      <small>
        Версия карточки {analysis.inputRevision}
        {analysis.mode === "model"
          ? " · " +
            analysis.provider +
            " · " +
            analysis.model +
            " · " +
            analysis.promptVersion
          : ""}
      </small>
    </div>
  );
}

export default function Workspace(props: Props) {
  return (
    <WorkspaceScreen
      key={JSON.stringify([props.ns, props.userKey])}
      {...props}
    />
  );
}

function WorkspaceScreen({
  data,
  ns,
  open,
  zone,
  write,
  userKey,
  analyze,
}: Props) {
  const storageKey = "watermelon:workspace:" + JSON.stringify([ns, userKey]);
  const [selected, setSelected] = useState(() => restoreSelection(storageKey));
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("none");
  const [shown, setShown] = useState(displayStep);
  const [queue, setQueue] = useState<Snapshot | null>(() => {
    const seed = seedPage(data, ns, "");
    return seed ? mergePage(seed, "") : null;
  });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [revisionChanged, setRevisionChanged] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  const latestData = useRef(data);
  latestData.current = data;
  const query = search.trim();
  const queueVisible = queue?.query === query;
  const listReady = queue && queueVisible;
  const refreshAvailable =
    listReady &&
    (revisionChanged ||
      (data?.namespace === ns && data.revision > queue.page.revision));
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      }),
    [zone],
  );
  const selectedIds = useMemo(() => selected.map((s) => s.id), [selected]);
  const nextDeadline = earliestDeadline(selected, queue?.items);
  const tray = useRef<HTMLDivElement>(null);
  const flight = useRef<HTMLSpanElement>(null);
  const shortcut = useRef<HTMLAnchorElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
  const [inContext, setInContext] = useState(false);
  useEffect(() => {
    if (!contextPanel.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInContext(entry.isIntersecting),
      { rootMargin: "0px 0px -20% 0px" },
    );
    observer.observe(contextPanel.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(selectedIds));
    } catch {
      /* Selection remains in memory. */
    }
  }, [selectedIds, storageKey]);

  const load = useCallback(
    async (text: string, previous?: Snapshot, fresh = false) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      setLoading(true);
      setListError("");
      try {
        let page =
          previous || fresh ? null : seedPage(latestData.current, ns, text);
        if (!page) {
          const params = new URLSearchParams({ ns, q: text });
          if (previous)
            for (const name of groups) {
              const group = previous.page.groups[name];
              params.set(name, String(group.offset + group.items.length));
            }
          const response = await fetch("/api/dashboard?" + params, {
            signal: controller.signal,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.message || "Не удалось загрузить очередь.");
          page = body as Dashboard;
        }
        if (controller.signal.aborted) return;
        if (previous && page.revision !== previous.page.revision) {
          setRevisionChanged(true);
          setListError(
            "Появился новый срез. Обновите очередь, чтобы продолжить.",
          );
          return;
        }
        setQueue(mergePage(page, text, previous));
        setShown((count) => (previous ? count + displayStep : displayStep));
        setRevisionChanged(false);
      } catch (error) {
        if (!controller.signal.aborted) setListError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [ns],
  );

  useEffect(() => {
    setListError("");
    const timer = window.setTimeout(() => void load(query), query ? 220 : 0);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
    };
  }, [query, load]);

  const buckets = useMemo(() => {
    const result = new Map<string, Incident[]>();
    if (!queue || queue.query !== query) return result;
    for (const ticket of [...queue.items.values()].slice(0, shown)) {
      const key =
        grouping === "product"
          ? String(ticket.raw.productName || "Продукт не указан")
          : grouping === "team"
            ? ticket.team || "Команда не указана"
            : "";
      if (!result.has(key)) result.set(key, []);
      result.get(key)!.push(ticket);
    }
    return result;
  }, [queue, query, shown, grouping]);

  const [question, setQuestion] = useState<string>(questions[0][1]);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{
    signature: string;
    revision: number | undefined;
    result?: WorkspaceAnalysis;
    error?: string;
  } | null>(null);
  const signature = JSON.stringify([selectedIds, question.trim()]);
  const currentAnswer = answer?.signature === signature ? answer : null;
  const toggle = (incident: Incident, checkbox: HTMLInputElement) => {
    if (checkbox.checked && selectedIds.length < contextLimit) {
      const target = matchMedia("(max-width: 820px)").matches
        ? shortcut.current
        : tray.current?.querySelector<HTMLElement>(
            '.wq-slot[data-filled="false"]',
          );
      transferSeed(checkbox, target ?? null, flight.current);
    }
    setSelected((current) =>
      current.some((s) => s.id === incident.id)
        ? current.filter((s) => s.id !== incident.id)
        : current.length < contextLimit
          ? [...current, { id: incident.id, incident }]
          : current,
    );
  };
  const requestSummary = async () => {
    if (!write || busy || !selected.length || !question.trim()) return;
    setBusy(true);
    setAnswer(null);
    const revision = latestData.current?.revision;
    try {
      const result = await analyze([...selectedIds], question.trim());
      setAnswer({ signature, revision, result });
    } catch (error) {
      setAnswer({
        signature,
        revision,
        error: (error as Error).message || "Не удалось получить сводку.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wq">
      <span className="wq-flight" aria-hidden="true" ref={flight} />
      <header className="wq-intro">
        <h1>Рабочая очередь</h1>
        {listReady && queue.page.acceptedAt && (
          <time
            className="wq-snapshot"
            dateTime={queue.page.acceptedAt}
            title={"Время принятия среза · " + zone}
          >
            Срез {date.format(new Date(queue.page.acceptedAt))} ·{" "}
            {zone === "Europe/Moscow" ? "МСК" : zone}
          </time>
        )}
        <QueueOptic count={selectedIds.length} />
      </header>
      <a
        ref={shortcut}
        href={inContext ? "#workspace-incidents" : "#workspace-context"}
        className="wq-jump"
        aria-label={
          inContext
            ? "К списку инцидентов"
            : "К контексту, выбрано " + selectedIds.length
        }
      >
        {inContext ? "К очереди" : "К контексту"}{" "}
        <span>{selectedIds.length} / {contextLimit}</span>
        <Arrow direction={inContext ? "up" : "down"} />
      </a>
      <div className="wq-layout">
        <section
          className="wq-list"
          id="workspace-incidents"
          aria-label="Инциденты"
          tabIndex={-1}
        >
          <div className="wq-list-controls">
            <div className="wq-list-heading">
              <h2>Инциденты</h2>
              {listReady && (
                <span className="wq-count">{queue.page.unique}</span>
              )}
            </div>
            <label className="wq-search">
              <span className="wq-magnifier" aria-hidden="true" />
              <input
                type="search"
                aria-label="Поиск по очереди"
                placeholder="ID, заголовок, продукт или команда"
                maxLength={300}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div
              className="wq-segments"
              role="group"
              aria-label="Группировка инцидентов"
            >
              {(
                [
                  ["none", "Без групп"],
                  ["product", "По продукту"],
                  ["team", "По команде"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={grouping === value}
                  onClick={() => setGrouping(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {refreshAvailable && (
            <div className="wq-refresh">
              <span>Доступен новый срез</span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(query, undefined, true)}
              >
                Обновить очередь
              </button>
            </div>
          )}
          {listError && (
            <div className="wq-feedback" role="alert">
              {listError}
              {!refreshAvailable && (
                <button
                  type="button"
                  onClick={() => void load(query, undefined, true)}
                >
                  Загрузить заново
                </button>
              )}
            </div>
          )}
          {!listReady && !listError && (
            <p className="wq-message" role="status">
              Загрузка очереди…
            </p>
          )}
          {listReady && !queue.items.size && (
            <p className="wq-message">
              {query
                ? "По вашему запросу ничего не найдено."
                : "В этом источнике пока нет инцидентов для разбора."}
            </p>
          )}
          {[...buckets].map(([name, tickets]) => (
            <div key={grouping + name} className="wq-bucket">
              {name && <h3>{name}</h3>}
              <ul>
                {tickets.map((ticket) => {
                  const selected = selectedIds.includes(ticket.id);
                  return (
                    <li
                      className={"wq-row" + (selected ? " wq-row-picked" : "")}
                      key={ticket.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={
                          !selected && selectedIds.length >= contextLimit
                        }
                        aria-label={"Выбрать " + ticket.id}
                        onChange={(event) => toggle(ticket, event.currentTarget)}
                      />
                      <div className="wq-row-body">
                        <div className="wq-row-meta">
                          <span className="wq-id">{ticket.id}</span>
                          {ticket.groups.map((group) => (
                            <span
                              key={group}
                              className={"wq-reason wq-" + group}
                            >
                              {reasonLabels[group]}
                            </span>
                          ))}
                        </div>
                        <a
                          className="wq-ticket-link"
                          href={
                            "/incident/" +
                            encodeURIComponent(ticket.id) +
                            "?ns=" +
                            encodeURIComponent(ns)
                          }
                          onClick={(event) => {
                            if (
                              !event.ctrlKey &&
                              !event.metaKey &&
                              !event.shiftKey &&
                              !event.altKey
                            ) {
                              event.preventDefault();
                              open(ticket.id);
                            }
                          }}
                        >
                          {String(ticket.raw.header || "Без заголовка")}{" "}
                          <Arrow />
                        </a>
                        <div className="wq-row-facts">
                          <span>
                            {String(
                              ticket.raw.productName || "Продукт не указан",
                            )}
                          </span>
                          <span>{ticket.team || "Команда не указана"}</span>
                          <span>
                            {ticket.dates.deadline
                              ? "Срок " +
                                date.format(new Date(ticket.dates.deadline))
                              : "Срок не задан"}
                          </span>
                          {!ticket.sourcePresent && (
                            <span>Отсутствует в источнике</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {listReady && queue.items.size > 0 && (
            <div className="wq-pagination">
              <span role="status">
                Показано {Math.min(shown, queue.items.size)} из{" "}
                {queue.page.unique}
              </span>
              {(shown < queue.items.size || queue.hasMore) && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    shown < queue.items.size
                      ? setShown((count) => count + displayStep)
                      : void load(query, queue)
                  }
                >
                  Показать ещё <Arrow direction="down" />
                </button>
              )}
            </div>
          )}
        </section>
        <aside
          ref={contextPanel}
          className="wq-context"
          id="workspace-context"
          aria-labelledby="workspace-context-heading"
          tabIndex={-1}
        >
          <div className="wq-context-heading">
            <h2 id="workspace-context-heading">Контекст разбора</h2>
            <span
              role="status"
              aria-label={"Выбрано " + selected.length + " из " + contextLimit}
            >
              {selected.length} / {contextLimit}
            </span>
          </div>
          <div className="wq-tray-area" ref={tray}>
            <SeedTray count={selected.length} />
            {!selected.length && <p>Отметьте инциденты в очереди.</p>}
            {nextDeadline !== null && (
              <p className="wq-next-deadline">
                Самый ранний срок
                <time dateTime={new Date(nextDeadline).toISOString()}>
                  {date.format(nextDeadline)}
                </time>
              </p>
            )}
          </div>
          {selected.length > 0 && (
            <ul className="wq-selected-list">
              {selected.map((item) => (
                <SelectedTicket
                  key={item.id}
                  id={item.id}
                  ns={ns}
                  incident={queue?.items.get(item.id) ?? item.incident}
                  open={() => open(item.id)}
                  remove={() =>
                    setSelected((current) =>
                      current.filter((s) => s.id !== item.id),
                    )
                  }
                />
              ))}
            </ul>
          )}
          <form
            className="wq-question"
            onSubmit={(event) => {
              event.preventDefault();
              void requestSummary();
            }}
          >
            <label htmlFor="workspace-question">Вопрос по выборке</label>
            <div
              className="wq-prompts"
              role="group"
              aria-label="Быстрые вопросы"
            >
              {questions.map(([label, text]) => (
                <button
                  type="button"
                  key={label}
                  aria-pressed={question === text}
                  onClick={() => setQuestion(text)}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              id="workspace-question"
              maxLength={500}
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button
              className="wq-submit"
              type="submit"
              disabled={!write || busy || !selected.length || !question.trim()}
            >
              {busy ? "Готовим сводку…" : "Сформировать сводку"}{" "}
              <Arrow direction="right" />
            </button>
            {!write && (
              <p className="wq-role-note">
                Сводка доступна координаторам и администраторам демо.
              </p>
            )}
          </form>
          {currentAnswer && (
            <section
              className="wq-result"
              aria-label="Результат разбора"
              aria-live="polite"
            >
              <h3>Результат разбора</h3>
              {currentAnswer.error && <p role="alert">{currentAnswer.error}</p>}
              {data && currentAnswer.revision !== data.revision && (
                <p>
                  После запроса источник обновился. Сверьте выводы с карточками.
                </p>
              )}
              {currentAnswer.result?.overview?.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {currentAnswer.result?.items.map(({ id, analysis }) => {
                const excerpt = analysis.summary
                  .filter((_, i) =>
                    analysis.evidence.some(
                      (e) =>
                        e.claim === i &&
                        e.fields.some((field) =>
                          field.startsWith("description:"),
                        ),
                    ),
                  )
                  .join(" ");
                return (
                  <article className="wq-source-result" key={id}>
                    <div>
                      <button type="button" onClick={() => open(id)}>
                        {id} <Arrow />
                      </button>
                      <span>
                        {analysis.mode === "model"
                          ? "Модель · выдержки"
                          : "По полям ITSM"}
                      </span>
                    </div>
                    <p>{excerpt || analysis.summary[0]}</p>
                    {analysis.stale && (
                      <p>Данные карточки изменились во время разбора.</p>
                    )}
                    <details>
                      <summary>Основания и ограничения</summary>
                      <FieldEvidence analysis={analysis} />
                    </details>
                  </article>
                );
              })}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
