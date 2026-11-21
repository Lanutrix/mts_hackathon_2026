import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Group, Incident } from "../../../packages/domain/index.ts";
import Loader from "./Loader";
import MelonScene from "./MelonScene";
import TriageCases, { caseRequest } from "./TriageCases";
import type { TriageCase, Triage } from "../../../packages/domain/triage";
import "./triage.css";
import {
  duration,
  groups,
  mergeStreams,
  type Dashboard,
  type Signal,
} from "./liveFeed";
import { Icon } from "./Brand";

const label: Record<Signal, string> = {
  all: "Все",
  critical: "Критические",
  coordinators: "Координаторы",
  high: "Высокие",
  research: "Исследование",
};
const shortLabel: Record<Signal, string> = {
  all: "Все",
  critical: "Критич.",
  coordinators: "Коорд.",
  high: "Высокие",
  research: "Исслед.",
};
const reasons: Record<Group, string> = {
  critical: "Критический",
  coordinators: "У координаторов",
  high: "Высокий",
  research: "Исследование",
};
const descriptions: Record<Group, string> = {
  critical: "Активный инцидент наивысшего приоритета",
  coordinators: "Назначен дежурной группе координаторов",
  high: "Активный инцидент высокого приоритета",
  research: "Уточняются причины инцидента",
};
const signals: Signal[] = ["all", ...groups];
const seedPath =
  "M14.8 2.7c.1 3.5-.2 9.1-3.6 12.1-1.8 1.6-4.6 1.4-6-.6-1.4-2.1-.7-4.8 1.4-6.4 2.9-2.3 5.4-3.5 8.2-5.1Z";
export function SignalMark({ signal }: { signal: Signal }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      aria-hidden="true"
      className={"signal-mark signal-" + signal}
    >
      {signal === "all" ? (
        <>
          <path
            d="M2 7h16a8 8 0 0 1-16 0Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="m6 9 1 1.5m3-1v2m4-2.5-1 1.5"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </>
      ) : signal === "critical" ? (
        <path d={seedPath} fill="currentColor" />
      ) : signal === "high" ? (
        <path
          d={seedPath}
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
      ) : signal === "coordinators" ? (
        <>
          <path
            d={seedPath}
            transform="translate(0 2) scale(.74)"
            fill="currentColor"
          />
          <path
            d={seedPath}
            transform="translate(6 -1) scale(.78)"
            fill="currentColor"
          />
        </>
      ) : (
        <>
          <path
            d={seedPath}
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
          />
          <path
            d="m7 12 4-4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
function Count({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return (
    <strong className="shift-count">
      <span className="sr-only" data-testid="live-count">
        {value.toLocaleString("ru-RU")}
      </span>
      {Array.from(value.toLocaleString("ru-RU"))
        .reverse()
        .map((c, pos) => (
          <span key={pos} className="digit-slot" aria-hidden="true">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={c}
                initial={{ y: reduced ? 0 : "98%" }}
                animate={{ y: 0 }}
                exit={{ y: reduced ? 0 : "-98%" }}
                transition={{
                  duration: reduced ? 0 : 0.34,
                  ease: [0.2, 0.78, 0.18, 1],
                }}
              >
                {c}
              </motion.span>
            </AnimatePresence>
          </span>
        ))
        .reverse()}
    </strong>
  );
}
type SelectionProps = {
  params: URLSearchParams;
  setParam: (key: string, value: string) => void;
  ns: string;
  sources: string[];
  switchSource: (value: string) => void;
};
function SearchFilters({
  params,
  setParam,
  ns,
  sources,
  switchSource,
}: SelectionProps) {
  const panel = useRef<HTMLDetailsElement>(null);
  const filtered = !!(
    params.get("service") ||
    params.has("up") ||
    (params.get("sort") && params.get("sort") !== "deadline")
  );
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node))
        panel.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel.current?.open) {
        panel.current.open = false;
        panel.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <div className="feed-controls">
      <label className="feed-search">
        <Icon name="research" size={16} />
        <input
          type="search"
          placeholder="Найти инцидент"
          aria-label="Поиск по ID, продукту, команде"
          value={params.get("q") || ""}
          onChange={(e) => setParam("q", e.target.value)}
        />
      </label>
      <details className="feed-filter" ref={panel}>
        <summary
          aria-label="Фильтры и сортировка"
          title="Фильтры и сортировка"
          className={filtered ? "on" : ""}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M3 7h7m4 0h7M3 17h11m4 0h3" />
            <circle cx="12" cy="7" r="2" />
            <circle cx="16" cy="17" r="2" />
          </svg>
        </summary>
        <div className="filter-pop">
          <label>
            Сортировка
            <select
              value={
                params.get("sort") || (params.has("case") ? "" : "deadline")
              }
              onChange={(e) => setParam("sort", e.target.value)}
            >
              {params.has("case") && <option value="">По срочности</option>}
              <option value="deadline">По сроку</option>
              <option value="registered">По регистрации</option>
              <option value="id">По номеру</option>
            </select>
          </label>
          <label>
            Тип сервиса
            <select
              value={params.get("service") || ""}
              onChange={(e) => setParam("service", e.target.value)}
            >
              <option value="">Все сервисы</option>
              <option value="1">Технический</option>
              <option value="2">Клиентский</option>
              <option value="3">Внутренний</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={params.has("up")}
              onChange={(e) => setParam("up", e.target.checked ? "1" : "")}
            />
            Требует эскалации
          </label>
          {sources.length > 1 && (
            <label>
              Источник
              <select value={ns} onChange={(e) => switchSource(e.target.value)}>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s === "demo"
                      ? "Демо"
                      : s === "original"
                        ? "Оригинал"
                        : "Рабочая копия"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </details>
    </div>
  );
}
type Props = SelectionProps & {
  data: Dashboard & { triage: Triage };
  csrf?: string;
  canAnalyze: boolean;
  filtering: boolean;
  now: number;
  zone: string;
  wall: boolean;
  online: boolean;
  open: (id: string) => void;
  children?: ReactNode;
};
export default function LiveBoard({
  data,
  filtering,
  csrf,
  canAnalyze,
  now,
  zone,
  wall,
  online,
  open,
  children,
  ...search
}: Props) {
  const requested = search.params.get("signal") as Signal | null;
  const signal = requested && signals.includes(requested) ? requested : "all";
  const setSignal = (next: Signal) =>
    search.setParam("signal", next === "all" ? "" : next);
  const triage = data.triage;
  const chosen = triage.cases.find(
    (item) => item.id === search.params.get("case"),
  );
  const lead = chosen?.lead ?? triage.tracking ?? triage.cases[0]?.lead;
  const group =
    lead &&
    (signal !== "all" && lead.groups.includes(signal)
      ? signal
      : lead.groups[0]);
  const tracking =
    !filtering && lead && group
      ? { id: lead.id, group, header: lead.header, revision: lead.revision }
      : null;
  const amount = signal === "all" ? data.unique : data.groups[signal].count;
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return (
    <section className="broadcast" aria-labelledby="shift-name">
      <header className="triage-header">
        <div className="triage-headline">
          <div className="triage-clock">
            <i data-online={online} />
            {time} {zone === "UTC" ? "UTC" : "МСК"}
          </div>
          <h1 id="shift-name">Эфир смены</h1>
        </div>
        <dl className="triage-indices">
          <div className="triage-total">
            <dt>В поле внимания</dt>
            <dd>
              <Count value={amount} />
            </dd>
          </div>
          <div>
            <dt>Срок прошёл</dt>
            <dd className={triage.overdue ? "past-due" : ""}>
              {triage.overdue}
            </dd>
          </div>
          <div>
            <dt>К эскалации</dt>
            <dd>{triage.escalations}</dd>
          </div>
        </dl>
        <div className="triage-object">
          <MelonScene
            active={signal}
            counts={Object.fromEntries(
              groups.map((g) => [g, data.groups[g].count]),
            )}
            unique={data.unique}
            showMeters={false}
            onGroupSelect={setSignal}
            tracking={tracking}
          />
        </div>
      </header>
      <div className="feed-tools">
        <div
          className="signal-tabs"
          role="group"
          aria-label="Сигналы инцидентов"
        >
          {signals.map((g) => (
            <button
              type="button"
              key={g}
              data-testid={"group-" + g}
              aria-pressed={signal === g}
              title={label[g]}
              className={"tab-" + g}
              onClick={() => setSignal(g)}
            >
              <SignalMark signal={g} />
              <span className="signal-long">{label[g]}</span>
              <span className="signal-short">{shortLabel[g]}</span>
              {g !== "all" && (
                <>
                  <small data-testid={"count-" + g}>
                    {data.groups[g].count}
                  </small>
                  <span className="signal-meter" aria-hidden="true">
                    <b
                      style={{
                        width:
                          (data.unique
                            ? (100 * data.groups[g].count) / data.unique
                            : 0) + "%",
                      }}
                    />
                  </span>
                </>
              )}
              {signal === g && (
                <motion.i
                  layoutId="signal-underline"
                  transition={{ type: "spring", stiffness: 420, damping: 38 }}
                />
              )}
            </button>
          ))}
        </div>
        {!wall && <SearchFilters {...search} />}
      </div>
      <div className="triage-layout">
        <TriageCases
          cases={triage.cases}
          chosen={chosen}
          dimension={triage.groupBy}
          amount={amount}
          revision={data.revision}
          query={search.params.toString()}
          ns={search.ns}
          csrf={csrf}
          canAnalyze={canAnalyze}
          open={open}
          setParam={search.setParam}
        />
        <section className="triage-register" aria-label="Тикеты в эфире">
          {filtering ? (
            <Loader label="Поиск инцидентов…" stage />
          ) : (
            <Ledger
              key={search.ns + "?" + search.params.toString()}
              data={data}
              signal={signal}
              chosen={chosen}
              sort={search.params.get("sort") || "deadline"}
              query={search.params.toString()}
              now={now}
              zone={zone}
              open={open}
            />
          )}
        </section>
      </div>
      {children}
    </section>
  );
}
function Ledger({
  data,
  signal,
  chosen,
  sort,
  query,
  now,
  zone,
  open,
}: {
  data: Dashboard;
  signal: Signal;
  chosen?: TriageCase;
  sort: string;
  query: string;
  now: number;
  zone: string;
  open: (id: string) => void;
}) {
  const register = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(4);
  useLayoutEffect(() => {
    const el = register.current;
    if (!el) return;
    const media = matchMedia("(max-width: 740px)");
    let lastGeometry = "";
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const reserved = media.matches ? 57 : 91;
      const rowHeight = media.matches
        ? 86
        : window.innerWidth <= 950
          ? 104
          : 73;
      const geometry = [
        Math.round(top),
        window.innerWidth,
        window.innerHeight,
      ].join("/");
      if (geometry === lastGeometry) return;
      lastGeometry = geometry;
      const capacity = Math.max(
        1,
        Math.min(
          8,
          Math.floor((window.innerHeight - top - reserved) / rowHeight),
        ),
      );
      setPageSize(capacity);
    };
    const trim = () => {
      const rows = Array.from(el.querySelectorAll("tbody tr"));
      const clipped = rows.findIndex(
        (row) =>
          row.getBoundingClientRect().bottom + window.scrollY >
          window.innerHeight - 4,
      );
      if (clipped > 0) setPageSize((size) => Math.min(size, clipped));
    };
    const tableObserver = new ResizeObserver(trim);
    const table = el.querySelector("table");
    if (table) tableObserver.observe(table);
    fit();
    const observer = new ResizeObserver(fit);
    for (const node of document.querySelectorAll(
      ".ops-header,.incident-notice,.triage-header,.feed-tools,.case-lens,.role-nav",
    ))
      observer.observe(node);
    const alerts = new MutationObserver(fit);
    const shell = el.closest(".ops-shell");
    if (shell) alerts.observe(shell, { childList: true });
    window.addEventListener("resize", fit);
    return () => {
      tableObserver.disconnect();
      observer.disconnect();
      alerts.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  const [page, setPage] = useState(0),
    [extra, setExtra] = useState<{ rev: number; pages: Dashboard[] }>({
      rev: data.revision,
      pages: [],
    });
  const [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const reduced = useReducedMotion();
  const total =
    chosen?.count ??
    (signal === "all" ? data.unique : data.groups[signal].count);
  const current = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1)),
    target = Math.min((current + 1) * pageSize, total);
  const [casePage, setCasePage] = useState<{
    request: string;
    items: Incident[];
  } | null>(null);
  const scoped = chosen
    ? caseRequest(chosen, query, data.namespace, data.revision) +
      "&offset=" +
      current * pageSize +
      "&limit=" +
      pageSize
    : "";
  useEffect(() => {
    if (!scoped) return;
    const ac = new AbortController();
    setError("");
    void fetch(scoped, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.message || "Не удалось загрузить тикеты кейса.");
        if (!ac.signal.aborted)
          setCasePage({ request: scoped, items: body.items });
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [scoped, retry]);
  const allRecords = useMemo(
    () =>
      mergeStreams(
        data,
        extra.rev === data.revision ? extra.pages : [],
        signal,
        sort,
        target,
      ),
    [data, extra, signal, sort, target],
  );
  const depth = extra.rev === data.revision ? extra.pages.length : 0,
    loading = chosen
      ? casePage?.request !== scoped
      : allRecords.length < target;
  const records = chosen
    ? casePage?.request === scoped
      ? casePage.items
      : []
    : allRecords;
  useEffect(() => {
    if (!loading || scoped) return;
    const ctl = new AbortController(),
      rev = data.revision,
      next = new URLSearchParams(query);
    next.set("ns", data.namespace);
    for (const g of groups) next.set(g, String((depth + 1) * 30));
    setError("");
    fetch("/api/dashboard?" + next, { signal: ctl.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить страницу.");
        const result: Dashboard = await response.json();
        if (ctl.signal.aborted || result.namespace !== data.namespace) return;
        if (result.revision !== rev)
          throw new Error("Источник обновился. Загрузите страницу ещё раз.");
        setExtra((prev) => ({
          rev,
          pages: [...(prev.rev === rev ? prev.pages : []), result],
        }));
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e.message);
      });
    return () => ctl.abort();
  }, [loading, scoped, data.revision, data.namespace, depth, query, retry]);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        timeZone: zone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [zone],
  );
  const prior = useRef<{
    rev: number;
    values: Map<string, string>;
    page: number;
  } | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    const values = new Map(records.map((i) => [i.key, i.hash])),
      previous = prior.current;
    prior.current = { rev: data.revision, values, page: current };
    if (!previous || previous.page !== current || previous.rev >= data.revision)
      return;
    setFresh(
      records
        .filter((i) => previous.values.get(i.key) !== i.hash)
        .map((i) => i.key),
    );
  }, [records, data.revision, current]);
  useEffect(() => {
    if (!fresh.length) return;
    const timer = setTimeout(() => setFresh([]), 4000);
    return () => clearTimeout(timer);
  }, [fresh]);
  const visible = chosen
    ? records.slice(0, pageSize)
    : records.slice(current * pageSize, target);
  function turnPage(next: number) {
    setPage(next);
    register.current?.focus({ preventScroll: true });
  }
  return (
    <div
      className="incident-register"
      ref={register}
      tabIndex={-1}
      aria-busy={loading && !error}
      data-testid="live-register"
    >
      <div className="triage-ledger-title">
        <div>
          <h2>Тикеты</h2>
          {chosen && <small>{chosen.label}</small>}
        </div>
        {total > 0 && (
          <nav className="feed-pages" aria-label="Страницы инцидентов">
            <span>
              {current * pageSize + 1}–{target} из {total}
            </span>
            <button
              aria-label="Предыдущая страница"
              disabled={!current}
              onClick={() => turnPage(current - 1)}
            >
              ←
            </button>
            <button
              aria-label="Следующая страница"
              disabled={target >= total || loading}
              onClick={() => turnPage(current + 1)}
            >
              →
            </button>
          </nav>
        )}
      </div>
      <table className="feed-table">
        <caption className="sr-only">Инциденты в эфире</caption>
        <thead>
          <tr>
            <th scope="col">Инцидент</th>
            <th scope="col">Сигнал</th>
            <th scope="col">Статус</th>
            <th scope="col">Срок</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item, index) => {
            const deadline = item.dates.deadline
                ? Date.parse(item.dates.deadline)
                : null,
              delta = deadline === null ? null : deadline - now;
            const clock =
              delta === null
                ? "Срок не задан"
                : delta < 0
                  ? "Просрочен"
                  : delta <= 900000
                    ? "Срок близко"
                    : "До срока";
            return (
              <motion.tr
                layout={reduced ? false : "position"}
                key={item.key}
                data-testid={"card-" + item.id}
                className={fresh.includes(item.key) ? "feed-new" : undefined}
                initial={reduced ? false : { y: 7 }}
                animate={{ y: 0 }}
                transition={{
                  y: { duration: 0.3, delay: Math.min(index, 5) * 0.023 },
                  layout: { type: "spring", stiffness: 450, damping: 40 },
                }}
              >
                <td className="feed-subject">
                  <span className="ticket-detail">
                    {item.id}
                    {item.raw.serviceType
                      ? " · " + String(item.raw.serviceType)
                      : ""}
                  </span>
                  <button onClick={() => open(item.id)}>
                    {String(item.raw.header || "Без заголовка")}
                  </button>
                  {!item.sourcePresent && (
                    <small className="warning">
                      Нет в снимке · требуется сверка
                    </small>
                  )}
                </td>
                <td className="feed-reasons">
                  {item.groups.map((g) => (
                    <span key={g} title={descriptions[g]}>
                      <SignalMark signal={g} />
                      {reasons[g]}
                    </span>
                  ))}
                  {item.raw.isNeedUp === true && (
                    <small>Требует эскалации</small>
                  )}
                </td>
                <td className="feed-state">{item.stateLabel}</td>
                <td
                  className={
                    "feed-time" +
                    (delta !== null && delta <= 900000 ? " due" : "")
                  }
                  title={
                    deadline === null ? undefined : timeFormat.format(deadline)
                  }
                >
                  {delta !== null && <strong>{duration(delta)}</strong>}
                  <small>{clock}</small>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
      {error && loading ? (
        <div className="feed-empty" role="alert">
          {error}{" "}
          <button onClick={() => setRetry((r) => r + 1)}>Повторить</button>
        </div>
      ) : loading ? (
        <Loader label="Загрузка страницы…" />
      ) : total === 0 ? (
        <p className="feed-empty">Инцидентов по этому фильтру нет.</p>
      ) : null}
    </div>
  );
}
