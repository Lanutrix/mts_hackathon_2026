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
import { DispatchReturn } from "./DispatchReturn";
import {screenLink} from "./routes";
import {serviceFilterId} from "../../../packages/contracts/serviceType";
import { ShiftClock, ShiftMetrics } from "./LiveIndicators";
import { responseBands, responseRank } from "../../../packages/domain/responseOrder";
import TriageCases from "./TriageCases";
import type { DashboardFacets, TriageCase, Triage } from "../../../packages/domain/triage";
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
  defaultSort,
  facets,
}: SelectionProps & { defaultSort: string; facets: DashboardFacets }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const filtered = !!(
    ["band", "priority", "product", "team", "symptom", "service"].some(key => params.get(key)) ||
    params.has("up") ||
    (params.get("sort") && params.get("sort") !== defaultSort)
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
          {([
            ["band", "Порядок разбора", responseBands.map(b => [b.key,b.label])],
            ["priority", "Приоритет", [["4","Наивысший"],["3","Высокий"],["2","Средний"],["1","Низкий"]]],
            ["symptom", "Симптом", facets.symptom.map(name => [name,name])],
            ["product", "Продукт", facets.product.map(name => [name,name])],
            ["team", "Команда", facets.team.map(name => [name,name])],
          ] as const).map(([key, title, options]) => <label key={key}>{title}
            <select value={params.get(key) ?? ""} onChange={e => setParam(key, e.target.value)}>
              <option value="">Все</option>
              {params.has(key) && !options.some(([id]) => id === params.get(key)) &&
                <option value={params.get(key)!}>{params.get(key)}</option>}
              {options.map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>)}
          <label>
            Сортировка
            <select
              value={
                params.get("sort") || defaultSort
              }
              onChange={(e) => setParam("sort", e.target.value)}
            >
              {defaultSort === "" && <option value="">По срочности</option>}
              <option value="response">По порядку разбора</option>
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
type RegisterPage = { offset: number; total: number; nextChangeAt: number | null; items: Incident[] };
type RegisterDashboard = Dashboard & { register: RegisterPage; triage: Triage; facets: DashboardFacets };
type Props = SelectionProps & {
  username: string;
  data: RegisterDashboard & { simulation?: { runId: string } };
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
  username,
  filtering,
  online,
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
  const query = new URLSearchParams(search.params);
  query.set("groupBy", triage.groupBy);
  const defaultSort = ["response","semantic"].includes(triage.groupBy) ? "response" : chosen ? "" : "deadline";
  const missingCase = search.params.has("case") && !chosen;
  const activeBand = responseBands.find(band => band.key === query.get("band"));
  const filteredView = !!activeBand || signal !== "all" ||
    ["q", "service", "up", "priority", "symptom", "product", "team"].some(key => search.params.get(key));
  return (
    <section className="broadcast" aria-labelledby="shift-name">
      <DispatchReturn username={username} namespace={data.namespace} />
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
        <SearchFilters {...search} defaultSort={defaultSort} facets={data.facets} />
      </div>
      {activeBand && <button type="button" className="scope-band" aria-label={"Снять ограничение: " + activeBand.label}
        onClick={() => search.setParam(search.params.get("groupBy") === "symptomProduct" ? "breakdown" : "band", "")}><Icon name="queue" size={15} />
        {activeBand.label}<span aria-hidden="true">×</span></button>}
      {(!amount || missingCase) && !filtering ? (
        <section className="quiet-shift" role="status" data-testid="empty-shift">
          <span className="quiet-mark"><Icon name={filteredView || missingCase ? "research" : "live"} size={30} /></span>
          <div><h2>{missingCase ? "Подборка разобрана" : filteredView ? "Совпадений нет" : "Очередь пуста"}</h2>
            <p>{missingCase ? "Состав групп изменился. Можно выбрать другую группу в очереди." :
              filteredView ? "Попробуйте другой запрос или измените фильтры." :
              online ? "Новые заявки появятся здесь автоматически." : "Ожидаем подключение к источнику."}</p>
            {missingCase && <button onClick={() => search.setParam("case", "")}>К очереди</button>}
          </div>
        </section>
      ) : <div className="triage-layout">
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
          query={query.toString()}
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
              chosen={chosen}
              responseOrder={defaultSort === "response" && (!query.has("sort") || query.get("sort") === "response")}
              query={query.toString()}
              now={now}
              zone={zone}
              open={open}
            />
          )}
        </section>
      </div>}
      {children}
    </section>
  );
}
function Ledger({
  data,
  chosen,
  responseOrder,
  query,
  now,
  zone,
  open,
}: {
  data: RegisterDashboard;
  chosen?: TriageCase;
  responseOrder: boolean;
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
  const [page, setPage] = useState(() => {
    const saved = history.state?.livePage;
    return Number.isSafeInteger(saved) && saved > 0 ? Number(saved) : 0;
  });
  const [caseError, setCaseError] = useState(""),
    [retry, setRetry] = useState(0);
  const total = data.register.total;
  const current = Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1));
  const target = Math.min((current + 1) * pageSize, total);
  const [casePage, setCasePage] = useState<{
    request: string;
    window: string;
    items: Incident[];
  } | null>(null);
  const offset = current * pageSize;
  const local = offset >= data.register.offset && target <= data.register.offset + data.register.items.length;
  const params = new URLSearchParams(query);
  params.set("ns", data.namespace);
  params.set("register", "1");
  params.set("offset", String(offset));
  params.set("limit", String(pageSize));
  const scoped = local ? "" : "/api/dashboard?" + params;
  const pageKey = JSON.stringify([scoped, data.revision, data.register.nextChangeAt, chosen?.hash]);
  useEffect(() => {
    if (!scoped) return;
    const ac = new AbortController();
    setCaseError("");
    void fetch(scoped, { signal: ac.signal }).then(async response => {
      if (!response.ok) throw new Error("Не удалось загрузить страницу.");
      const next: RegisterDashboard = await response.json();
      if (next.revision !== data.revision || next.register.total !== total || next.register.nextChangeAt !== data.register.nextChangeAt ||
          (chosen && !next.triage.cases.some(item => item.id === chosen.id && item.hash === chosen.hash)))
        throw new Error("Очередь обновляется. Повторите загрузку страницы.");
      if (!ac.signal.aborted) setCasePage({ request: pageKey, window: scoped, items: next.register.items });
    }).catch(error => { if (!ac.signal.aborted) setCaseError(error.message); });
    return () => ac.abort();
  }, [scoped, pageKey, data.revision, data.register.nextChangeAt, total, retry]);
  const loading = !local && casePage?.request !== pageKey;
  const error = local ? "" : caseError;
  const records = useMemo(() => local ? data.register.items.slice(offset, target) :
    casePage?.request === pageKey ? casePage.items : [], [local, data.register.items, offset, target, casePage, pageKey]);
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
  const visible = records;
  function turnPage(next: number) {
    history.replaceState({ ...history.state, livePage: next }, "");
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
          <h2>{responseOrder ? "Порядок разбора" : "Инциденты"}</h2>
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
            <th scope="col">{responseOrder ? "Почему в очереди" : "Сигнал"}</th>
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
            const band = responseOrder ? responseBands[responseRank(item, now)] : undefined;
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
                  {band && <small className="queue-reason" title={band.basis}>
                    {band.key === "criticalDeadline" ? (delta !== null && delta < 0 ? "Критический · просрочен" : "Критический · срок близко") : band.label}
                  </small>}
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
            onClick={() => setRetry((r) => r + 1)}
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
