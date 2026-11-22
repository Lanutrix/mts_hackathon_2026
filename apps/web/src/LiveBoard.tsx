import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import type { Incident } from "../../../packages/domain/index.ts";
import Loader from "./Loader";
import {screenLink} from "./routes";
import {serviceFilterId} from "../../../packages/contracts/serviceType";
import { ShiftClock, ShiftMetrics } from "./LiveIndicators";
import { useLivePrefix } from "./useLivePrefix";
import TriageCases, { caseRequest } from "./TriageCases";
import type { TriageCase, Triage } from "../../../packages/domain/triage";
import "./triage.css";
import { duration, groups, type Dashboard, type Signal } from "./liveFeed";
import { Icon, SignalMark, SignalBadge } from "./Brand";

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
const signals: Signal[] = ["all", ...groups];
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
              value={serviceFilterId(params.get("service") || "")}
              onChange={(e) => setParam("service", e.target.value)}
            >
              <option value="">Все сервисы</option>
              <option value="10">Клиентский</option>
              <option value="20">Пользовательский</option>
              <option value="30">Технологический</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={params.has("up")}
              onChange={(e) => setParam("up", e.target.checked ? "1" : "")}
            />
            Требуется устранение последствий
          </label>
          {sources.length > 1 && (
            <label>
              Источник
              <select value={ns} onChange={(e) => switchSource(e.target.value)}>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s === "demo"
                      ? "Сценарий"
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
  data: Dashboard & { triage: Triage; simulation?: { runId: string } };
  csrf?: string;
  canAnalyze: boolean;
  filtering: boolean;
  now: number;
  zone: string;
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
  const amount = triage.unique;
  return (
    <section className="broadcast" aria-labelledby="shift-name">
      <header className="triage-header">
        <div className="triage-headline">
          <h1 id="shift-name">Эфир смены</h1>
          <ShiftClock now={now} zone={zone} />
        </div>
        <ShiftMetrics triage={triage} sliceRevision={data.revision} hints />
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
        <SearchFilters {...search} />
      </div>
      <div className="triage-layout">
        <TriageCases
          key={search.ns + "/" + (data.simulation?.runId ?? "")}
          cases={triage.cases}
          chosen={chosen}
          dimension={triage.groupBy}
          amount={amount}
          liveFocus={chosen ? null : triage.liveFocus}
          ready={!filtering}
          runId={data.simulation?.runId ?? ""}
          modelGuidance={!!triage.modelGuidance}
          revision={data.revision}
          query={search.params.toString()}
          ns={search.ns}
          csrf={csrf}
          canAnalyze={canAnalyze}
          open={open}
          setParam={search.setParam}
        />
        <section className="triage-register" aria-label="Инциденты в эфире">
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
    const fit = () => {
      const body = el.querySelector("tbody");
      if (!body) return;
      const first = body.querySelector("tr");
      if (!first) return;
      const rowHeight = first.getBoundingClientRect().height;
      if (!rowHeight) return;
      const top = body.getBoundingClientRect().top + window.scrollY;
      const footer = el
        .closest(".ops-shell")
        ?.querySelector(".platform-footer");
      const layout = el.closest(".triage-layout");
      const after =
        layout?.parentElement && layout
          ? Math.max(
              0,
              layout.parentElement.getBoundingClientRect().bottom -
                layout.getBoundingClientRect().bottom,
            )
          : 0;
      const available =
        document.documentElement.clientHeight -
        top -
        (footer?.getBoundingClientRect().height ?? 0) -
        after -
        4;
      setPageSize(Math.max(1, Math.floor((available + 0.1) / rowHeight)));
    };
    const observer = new ResizeObserver(fit);
    for (const node of document.querySelectorAll(
      ".ops-shell,.ops-header,.incident-notice,.triage-header,.feed-tools,.case-lens,.role-nav,.source-banner,.triage-ledger-title,.triage-register table,.platform-footer",
    ))
      observer.observe(node);
    const changes = new MutationObserver(fit);
    const shell = el.closest(".ops-shell") ?? el;
    changes.observe(shell, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  const [page, setPage] = useState(0);
  const [caseError, setCaseError] = useState(""),
    [retry, setRetry] = useState(0);
  const total =
    chosen?.count ??
    (signal === "all" ? data.unique : data.groups[signal].count);
  const current = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const target = Math.min((current + 1) * pageSize, total);
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
    setCaseError("");
    void fetch(scoped, { signal: ac.signal })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok)
          throw new Error(body.message || "Не удалось загрузить инциденты группы.");
        if (!ac.signal.aborted)
          setCasePage({ request: scoped, items: body.items });
      })
      .catch((e) => {
        if (!ac.signal.aborted) setCaseError(e.message);
      });
    return () => ac.abort();
  }, [scoped, retry]);
  const prefix = useLivePrefix(data, signal, sort, query, chosen ? 0 : target);
  const loading = chosen ? casePage?.request !== scoped : prefix.loading;
  const error = chosen ? caseError : prefix.error;
  const records = chosen
    ? casePage?.request === scoped
      ? casePage.items
      : []
    : prefix.records;
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
          <h2>Инциденты</h2>
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
          {visible.map((item) => {
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
              <tr
                key={item.key}
                data-testid={"card-" + item.id}
                className={fresh.includes(item.key) ? "feed-new" : undefined}
              >
                <td className="feed-subject">
                  <span className="ticket-detail">
                    <a
                      className="feed-itsm"
                      href={
                        data.itsmMock !== false
                          ? screenLink(
                              "/itsm/" + encodeURIComponent(item.id),
                              data.namespace,
                            )
                          : "/api/incident/" +
                            encodeURIComponent(item.id) +
                            "/itsm?ns=" +
                            encodeURIComponent(data.namespace)
                      }
                      title={
                        data.itsmMock !== false
                          ? "Открыть макет ITSM"
                          : "Открыть в ITSM"
                      }
                      aria-label={
                        (data.itsmMock !== false ? "Макет ITSM" : "ITSM") +
                        " · " +
                        item.id
                      }
                    >
                      {item.id} <span aria-hidden="true">↗</span>
                    </a>
                    {!item.sourcePresent && (
                      <small className="source-absent">
                        {" "}
                        · Требуется сверка
                      </small>
                    )}
                  </span>
                  <button onClick={() => open(item.id)}>
                    {String(item.raw.header || "Без заголовка")}
                  </button>
                </td>
                <td className="feed-reasons">
                  <div className="feed-signals">
                    {item.groups.map((g) => (
                      <SignalBadge key={g} signal={g} />
                    ))}
                    {item.raw.isNeedUp === true && (
                      <SignalBadge signal="escalation" />
                    )}
                  </div>
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
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && loading ? (
        <div className="feed-empty" role="alert">
          {error}{" "}
          <button
            onClick={() => (chosen ? setRetry((r) => r + 1) : prefix.retry())}
          >
            Повторить
          </button>
        </div>
      ) : loading ? (
        <Loader label="Загрузка страницы…" />
      ) : total === 0 ? (
        <p className="feed-empty">Инцидентов по этому фильтру нет.</p>
      ) : null}
    </div>
  );
}
