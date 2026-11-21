import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import "@fontsource/golos-text/cyrillic-400.css";
import "@fontsource/golos-text/cyrillic-600.css";
import "@fontsource/golos-text/latin-400.css";
import "@fontsource/golos-text/latin-600.css";
import "./style.css";
import Workspace from "./Workspace";
import { analyzeContext } from "./contextAnalysis";
import {
  LiveIntro,
  incidentCount,
  IncidentLane,
  Mark,
  Icon,
  lanes as groups,
  type IconName,
} from "./LiveBoard";
import "./ops.css";
import type { Incident } from "../../../packages/domain/index.ts";
import type { Analysis } from "../../server/analysis.ts";
type User = {
  username: string;
  role: "viewer" | "coordinator" | "demo-admin";
  csrf: string;
};
const reasons: Record<string, string> = {
  critical: "Критический инцидент",
  "critical-reopened": "Критический возвращён в работу",
  "assigned-coordinators": "Назначено координаторам",
  "critical-resolved": "Критический инцидент завершён",
};
const text = (v: unknown, fallback = "Не указано") =>
  v == null || v === "" ? fallback : String(v);
function formatDate(v: string | null, zone: string) {
  if (!v) return "Не задано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(v));
}
async function api(path: string, options: RequestInit = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Не удалось получить данные");
  return data;
}
function useRoute() {
  const [route, setRoute] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const update = () => setRoute(location.pathname + location.search);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const go = (path: string) => {
    history.pushState(null, "", path);
    setRoute(path);
    window.scrollTo(0, 0);
  };
  return [route, go] as const;
}
function App() {
  const [route, go] = useRoute(),
    [path, query = ""] = route.split("?"),
    params = new URLSearchParams(query),
    ns = params.get("ns") ?? "demo";
  const [user, setUser] = useState<User | null>(null),
    [sources, setSources] = useState<string[]>(["demo"]),
    [ready, setReady] = useState(false),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [announcement, setAnnouncement] = useState(""),
    [connection, setConnection] = useState("Подключение…"),
    [extra, setExtra] = useState<any>(null),
    [prefs, setPrefs] = useState({
      sound: false,
      notifications: false,
      zone: "Europe/Moscow",
    });
  const [tick, setTick] = useState(Date.now()),
    lastRevision = useRef(0),
    lastNotified = useRef(0),
    generation = useRef(0),
    pending = useRef<AbortController | null>(null),
    detailCache = useRef<{ key: string; value: any } | null>(null),
    streamReceivedAt = useRef(0),
    eventStream = useRef<EventSource | null>(null),
    liveStatus = useRef(""),
    prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const zone = prefs.zone,
    wall = path === "/wallboard",
    write = user?.role === "coordinator" || user?.role === "demo-admin";
  const suffix = (url: string) =>
    url + (url.includes("?") ? "&" : "?") + "ns=" + encodeURIComponent(ns);
  const post = async (url: string, body: unknown) =>
    api(suffix(url), {
      method: "POST",
      headers: { "X-CSRF-Token": user?.csrf ?? "" },
      body: JSON.stringify(body),
    });
  const load = useCallback(async () => {
    const gen = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const read = (url: string) => api(url, { signal: controller.signal });
    try {
      const q = new URLSearchParams(query);
      q.set("ns", ns);
      const dashboard = await read("/dashboard?" + q);
      if (gen !== generation.current) return;
      setData(dashboard);
      lastRevision.current = dashboard.revision;
      setError("");
      if (
        dashboard.revision > lastNotified.current &&
        lastNotified.current > 0
      ) {
        const note = dashboard.events?.[0];
        if (note && note.revision > lastNotified.current) {
          const fresh = dashboard.events.filter(
            (n: any) => n.revision > lastNotified.current,
          );
          setAnnouncement(
            `${fresh.length}${fresh.length === 20 ? "+" : ""} важных событий. ${note.reasons.map((r: string) => reasons[r]).join("; ")}: ${note.id}`,
          );
          if (
            prefsRef.current.notifications &&
            "Notification" in window &&
            Notification.permission === "granted"
          )
            new Notification("Watermelon: важное событие", {
              body: note.id,
            });
          if (prefsRef.current.sound) beep();
        }
      }
      lastNotified.current = dashboard.revision;
      let e: any = null;
      if (path.startsWith("/incident/") || path.startsWith("/itsm/")) {
        const key = [ns, path.split("/")[2], dashboard.revision].join(":");
        if (detailCache.current?.key === key) e = detailCache.current.value;
        else {
          e = await read(
            "/incident/" + path.split("/")[2] + "?ns=" + encodeURIComponent(ns),
          );
          if (gen === generation.current)
            detailCache.current = { key, value: e };
        }
      } else if (path === "/notifications")
        e = await read(
          "/notifications?ns=" +
            encodeURIComponent(ns) +
            "&offset=" +
            (params.get("offset") ?? 0),
        );
      else if (path === "/quality" || path === "/history")
        e = await read(
          "/incidents?" +
            (path === "/quality" ? "quality=1" : "history=1") +
            "&offset=" +
            (params.get("offset") ?? 0) +
            "&ns=" +
            encodeURIComponent(ns),
        );
      else if (path === "/demo" && user?.role === "demo-admin")
        e = await read("/demo");
      if (gen === generation.current) setExtra(e);
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    }
  }, [query, ns, path, user?.role]);
  useLayoutEffect(() => {
    if (!data) return;
    let next = 0;
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => {
        performance.clearMarks("watermelon:paint");
        performance.mark("watermelon:paint", {
          detail: {
            revision: data.revision,
            streamReceivedAt: streamReceivedAt.current,
          },
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(next);
    };
  }, [data?.revision]);
  useEffect(() => {
    api("/me")
      .then((m) => {
        setUser(m.user);
        setSources(m.sources);
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
  }, []);
  useEffect(() => {
    if (user && user.role !== "viewer")
      api("/preferences")
        .then(setPrefs)
        .catch((e) => setError(e.message));
  }, [user?.username]);
  useEffect(() => {
    if (!ready) return;
    void load();
    let disposed = false;
    const es = new EventSource(
      "/api/stream?ns=" +
        encodeURIComponent(ns) +
        "&cursor=" +
        lastRevision.current,
    );
    eventStream.current = es;
    const update = () => {
      if (!disposed) {
        streamReceivedAt.current = Date.now();
        setConnection("На связи");
        liveStatus.current = "На связи";
        void load();
      }
    };
    es.addEventListener("ready", update);
    es.addEventListener("resync", update);
    es.addEventListener("revision", update);
    es.addEventListener("status", update);
    es.addEventListener("heartbeat", () => {
      setConnection("На связи");
      liveStatus.current = "На связи";
    });
    es.onerror = () => {
      setConnection("Связь прервана — переподключение");
      liveStatus.current = "offline";
    };
    const poll = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    const online = () => void load();
    const offline = () => setConnection("Нет сети — показаны последние данные");
    const unload = () => {
      generation.current++;
      pending.current?.abort();
      es.close();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("pagehide", unload);
    return () => {
      disposed = true;
      es.close();
      eventStream.current = null;
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pagehide", unload);
      generation.current++;
      pending.current?.abort();
    };
  }, [load, ready]);
  const link = (to: string) =>
    to + (ns !== "demo" ? "?ns=" + encodeURIComponent(ns) : "");
  const nav = (to: string, label: string, icon?: IconName, compact = false) => (
    <a
      tabIndex={0}
      href={link(to)}
      aria-current={path === to || (wall && to === "/") ? "page" : undefined}
      className={compact ? "icon-link" : undefined}
      title={compact ? label : undefined}
      onClick={(e) => {
        e.preventDefault();
        go(link(to));
      }}
    >
      {icon && <Icon name={icon} size={18} />}
      <span className={compact ? "sr-only" : undefined}>{label}</span>
    </a>
  );
  const open = (id: string) => go(link("/incident/" + encodeURIComponent(id)));
  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(query);
    value ? p.set(key, value) : p.delete(key);
    for (const g of groups) if (g !== key) p.delete(g);
    go(path + "?" + p);
  };
  const call = async (f: () => Promise<unknown>) => {
    try {
      setError("");
      await f();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <MotionConfig reducedMotion="user">
      <div className={"app ops-shell" + (wall ? " wallboard" : "")}>
        <a tabIndex={0} className="skip" href="#main">
          К содержимому
        </a>
        <header className="ops-header">
          <a
            className="ops-brand"
            href={link("/")}
            onClick={(e) => {
              e.preventDefault();
              go(link("/"));
            }}
          >
            <Mark />
            <span>Watermelon</span>
            <small>МТС</small>
          </a>
          <nav className="primary-switch" aria-label="Основная навигация">
            {nav("/", "Эфир смены", "live")}
            {nav("/workspace", "Рабочая очередь", "queue")}
          </nav>
          <nav className="ops-actions" aria-label="Сервисы">
            {!wall && nav("/notifications", "Уведомления", "bell", true)}
            {!wall && nav("/history", "История", "history", true)}
            {!wall && nav("/quality", "Качество данных", "quality", true)}
            {nav(
              wall ? "/" : "/wallboard",
              wall ? "Обычный режим" : "Общий экран",
              "expand",
              true,
            )}
            {!wall &&
              (user ? (
                <button
                  className="user-pill"
                  onClick={() =>
                    void call(async () => {
                      await post("/logout", {});
                      setUser(null);
                      setSources(["demo"]);
                      setData(null);
                      go("/");
                    })
                  }
                >
                  Выйти: {user.username}
                </button>
              ) : (
                nav("/login", "Войти")
              ))}
          </nav>
        </header>
        {!wall && write && (
          <nav className="role-nav" aria-label="Управление">
            {nav("/preferences", "Настройки")}
            {user?.role === "demo-admin" && (
              <>
                {nav("/import", "Импорт")}
                {nav("/demo", "Демонстрация")}
              </>
            )}
          </nav>
        )}
        <div
          className={
            "source-banner " +
            (error || data?.status.state === "error" ? "warning" : "")
          }
          role="status"
          data-testid="source-status"
        >
          <span>{connection}</span>
          <span>
            {data?.acceptedAt
              ? "Источник обновлён " + formatDate(data.acceptedAt, zone)
              : "Ожидание первого снимка"}{" "}
            · {zone === "UTC" ? "UTC" : "МСК"}
          </span>
          <span data-testid="revision">Версия {data?.revision ?? 0}</span>
          <span>
            {ns === "demo"
              ? "Демо-данные"
              : ns === "original"
                ? "Оригинал · только чтение"
                : "Рабочая копия"}
          </span>
          {data?.status.state === "error" && (
            <strong>{data.status.error}</strong>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button tabIndex={0} onClick={() => void load()}>
              Повторить
            </button>
          </div>
        )}
        <main id="main">
          {path === "/login" ? (
            <Login
              onSubmit={async (username, password) => {
                const u = await api("/login", {
                  method: "POST",
                  body: JSON.stringify({ username, password }),
                });
                const m = await api("/me");
                setSources(m.sources);
                setUser(u);
                go("/");
              }}
            />
          ) : !data ? (
            <div className="empty" aria-busy={!error}>
              Загрузка данных…
            </div>
          ) : path === "/workspace" ? (
            <Workspace
              data={data.namespace === ns ? data : null}
              ns={ns}
              userKey={user ? "user:" + user.username : "public"}
              write={!!write}
              zone={zone}
              open={open}
              analyze={(ids, q) =>
                analyzeContext(
                  ids,
                  q,
                  zone,
                  async (id) =>
                    (await api(suffix("/incident/" + encodeURIComponent(id))))
                      .incident,
                  (id) => post("/analysis/" + encodeURIComponent(id), {}),
                )
              }
            />
          ) : path === "/" || wall ? (
            <>
              <LiveIntro
                data={data}
                now={tick}
                zone={zone}
                ns={ns}
                online={connection === "На связи"}
              />
              <div className="flow-heading">
                <h2>Поток инцидентов</h2>
                <span data-testid="unique">{incidentCount(data.unique)}</span>
              </div>
              {!wall && (
                <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
                  <label className="search">
                    <span className="sr-only">
                      Поиск по ID, продукту, команде
                    </span>
                    <input
                      type="search"
                      placeholder="Поиск по ID, продукту, команде"
                      value={params.get("q") ?? ""}
                      onChange={(e) => updateParam("q", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Тип сервиса</span>
                    <select
                      value={params.get("service") ?? ""}
                      onChange={(e) => updateParam("service", e.target.value)}
                    >
                      <option value="">Все сервисы</option>
                      <option value="1">Технический</option>
                      <option value="2">Клиентский</option>
                      <option value="3">Внутренний</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Сортировка</span>
                    <select
                      value={params.get("sort") ?? "deadline"}
                      onChange={(e) => updateParam("sort", e.target.value)}
                    >
                      <option value="deadline">По сроку</option>
                      <option value="registered">По регистрации</option>
                      <option value="id">По номеру</option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={params.has("up")}
                      onChange={(e) =>
                        updateParam("up", e.target.checked ? "1" : "")
                      }
                    />
                    Требует эскалации
                  </label>
                  {sources.length > 1 && (
                    <label>
                      <span className="sr-only">Источник</span>
                      <select
                        value={ns}
                        onChange={(e) => go("/?ns=" + e.target.value)}
                      >
                        {sources.map((n) => (
                          <option key={n} value={n}>
                            {n === "demo"
                              ? "Демо"
                              : n === "original"
                                ? "Оригинал"
                                : "Рабочая копия"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {["q", "service", "up"].some((k) => params.has(k)) && (
                    <button
                      tabIndex={0}
                      type="button"
                      className="link"
                      onClick={() => go(link("/"))}
                    >
                      Сбросить фильтры
                    </button>
                  )}
                </form>
              )}
              {(data.quality.quarantined > 0 || data.quality.missing > 0) && (
                <div className="warning notice">
                  Требуется сверка: {data.quality.quarantined} с конфликтами,{" "}
                  {data.quality.missing} отсутствуют в текущем снимке.{" "}
                  {nav("/quality", "Проверить качество данных")}
                </div>
              )}
              {announcement && (
                <div className="notice" role="status">
                  {announcement} {nav("/notifications", "Открыть уведомления")}
                </div>
              )}
              {data.recent.length > 0 && (
                <section className="recent" aria-label="Недавние решения">
                  <strong>Недавно завершены критические</strong>
                  {data.recent.map((n: any) => (
                    <button
                      tabIndex={0}
                      className="link"
                      key={n.revision + ":" + n.key}
                      onClick={() => open(n.id)}
                    >
                      {n.id} · {formatDate(n.at, zone)}
                    </button>
                  ))}
                </section>
              )}
              <div className="board">
                {groups.map((g) => (
                  <IncidentLane
                    key={g}
                    g={g}
                    bucket={data.groups[g]}
                    now={tick}
                    zone={zone}
                    open={open}
                    page={(offset) => updateParam(g, String(offset))}
                    scope={ns + "?" + query}
                    revision={data.revision}
                  />
                ))}
              </div>
            </>
          ) : path.startsWith("/incident/") || path.startsWith("/itsm/") ? (
            extra?.incident &&
            extra.incident.id === decodeURIComponent(path.split("/")[2]) && (
              <Detail
                key={extra.incident.key}
                item={extra}
                zone={zone}
                mock={path.startsWith("/itsm/")}
                write={!!write}
                onAnalyze={() =>
                  post("/analysis/" + encodeURIComponent(extra.incident.id), {})
                }
                onNavigate={go}
              />
            )
          ) : path === "/notifications" ? (
            <section className="content">
              <h1>Уведомления</h1>
              <p className="muted">
                Прочтение — ваша личная отметка. Статус инцидента и ACK не
                меняются.
              </p>
              {extra?.items?.length ? (
                extra.items.map((n: any) => (
                  <article
                    className={
                      "notification " +
                      (n.reasons.includes("critical-resolved")
                        ? "resolved"
                        : "")
                    }
                    key={n.revision + ":" + n.key}
                  >
                    <div>
                      <h2>
                        {n.reasons.map((r: string) => reasons[r]).join(" · ")}
                      </h2>
                      <button
                        tabIndex={0}
                        className="link"
                        onClick={() => open(n.id)}
                      >
                        {n.id}
                      </button>
                      <p className="muted">
                        {formatDate(n.at, zone)} · версия {n.revision}
                      </p>
                    </div>
                    {write && (
                      <button
                        tabIndex={0}
                        disabled={n.read}
                        onClick={() =>
                          void call(() =>
                            post("/notifications/read", {
                              key: n.key,
                              revision: n.revision,
                            }),
                          )
                        }
                      >
                        {n.read ? "Прочитано" : "Отметить прочитанным"}
                      </button>
                    )}
                  </article>
                ))
              ) : (
                <div className="empty">
                  Новых событий пока нет. Начальная загрузка не создаёт
                  исторических уведомлений.
                </div>
              )}
              <div className="pager">
                <button
                  tabIndex={0}
                  disabled={!Number(params.get("offset"))}
                  onClick={() =>
                    updateParam(
                      "offset",
                      String(Math.max(0, Number(params.get("offset")) - 200)),
                    )
                  }
                >
                  Предыдущие
                </button>
                <button
                  tabIndex={0}
                  disabled={extra?.nextOffset == null}
                  onClick={() =>
                    updateParam("offset", String(extra.nextOffset))
                  }
                >
                  Следующие
                </button>
              </div>
            </section>
          ) : path === "/quality" || path === "/history" ? (
            <section className="content">
              <h1>
                {path === "/quality" ? "Качество данных" : "История инцидентов"}
              </h1>
              <p className="muted">
                {path === "/quality"
                  ? "Исходные значения сохранены. Конфликты исключены из автоматических групп до сверки."
                  : "Завершённые и закрытые инциденты. Полная история версий доступна в карточке."}
              </p>
              <p>Записей: {extra?.total ?? 0}</p>
              {extra?.items?.map((i: Incident) => (
                <article className="list-row" key={i.key}>
                  <button
                    tabIndex={0}
                    className="link"
                    onClick={() => open(i.id)}
                  >
                    {i.id} — {text(i.raw.header)}
                  </button>
                  <span>{i.stateLabel}</span>
                  {!i.sourcePresent && (
                    <strong>Отсутствует в текущем снимке</strong>
                  )}
                  <ul>
                    {i.issues.slice(0, 6).map((q, j) => (
                      <li key={j}>{q.message}</li>
                    ))}
                  </ul>
                </article>
              ))}
              {extra?.total > 50 && (
                <div className="pagination">
                  <button
                    tabIndex={0}
                    disabled={!Number(params.get("offset"))}
                    onClick={() =>
                      updateParam(
                        "offset",
                        String(
                          Math.max(0, Number(params.get("offset") ?? 0) - 50),
                        ),
                      )
                    }
                  >
                    Назад
                  </button>
                  <button
                    tabIndex={0}
                    disabled={
                      Number(params.get("offset") ?? 0) + 50 >= extra.total
                    }
                    onClick={() =>
                      updateParam(
                        "offset",
                        String(Number(params.get("offset") ?? 0) + 50),
                      )
                    }
                  >
                    Далее
                  </button>
                </div>
              )}
            </section>
          ) : path === "/import" ? (
            user?.role === "demo-admin" ? (
              <ImportPanel ns={ns} post={post} onDone={load} />
            ) : (
              <Denied />
            )
          ) : path === "/demo" ? (
            user?.role === "demo-admin" ? (
              <section className="content">
                <h1>Демонстрация</h1>
                <p>
                  Отдельный источник DEMO. Шаг {extra?.step ?? 0}. Часы
                  сценария: {extra?.clock ?? "—"}.
                </p>
                <p>
                  Новый критический → координаторы → срок → выполнение →
                  завершение → возврат → исследование → закрытие → новый ID.
                </p>
                <div className="toolbar">
                  {[
                    ["play", "Запустить"],
                    ["pause", "Пауза"],
                    ["step", "Следующий шаг"],
                    ["reset", "Сбросить демо"],
                  ].map(([action, label]) => (
                    <button
                      tabIndex={0}
                      key={action}
                      onClick={() => void call(() => post("/demo", { action }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p role="status">
                  {extra?.playing
                    ? "Сценарий выполняется"
                    : "Сценарий приостановлен"}
                </p>
              </section>
            ) : (
              <Denied />
            )
          ) : path === "/preferences" ? (
            write ? (
              <Preferences
                prefs={prefs}
                onSave={async (p) => {
                  await post("/preferences", p);
                  setPrefs(p);
                }}
              />
            ) : (
              <Denied />
            )
          ) : (
            <section className="content">
              <h1>Страница не найдена</h1>
              {nav("/", "Вернуться к обзору")}
            </section>
          )}
        </main>
        <footer>
          Демонстрационный стенд команды Watermelon · Часовой пояс: {zone} · Не
          является продуктивной системой МТС
        </footer>
      </div>
    </MotionConfig>
  );
}
function Detail({
  item,
  zone,
  mock,
  write,
  onAnalyze,
  onNavigate,
}: {
  item: any;
  zone: string;
  mock: boolean;
  write: boolean;
  onAnalyze: () => Promise<Analysis>;
  onNavigate: (p: string) => void;
}) {
  const i: Incident = item.incident;
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const previous = useRef(i.revision);
  const updated = i.revision !== previous.current;
  return (
    <section className="content detail">
      <div className="section-heading">
        <div>
          <p className="meta">{i.id}</p>
          <h1>{text(i.raw.header)}</h1>
        </div>
        {!mock && (
          <a
            tabIndex={0}
            className="button"
            href={item.itsm}
            rel="noopener noreferrer"
            onClick={
              item.itsmMock
                ? (e) => {
                    e.preventDefault();
                    onNavigate(item.itsm + location.search);
                  }
                : undefined
            }
          >
            Открыть в ITSM{item.itsmMock ? " (макет)" : ""}
          </a>
        )}
      </div>
      {mock && (
        <div className="notice warning">
          <strong>Макет перехода в SimpleOne</strong>
          <p>
            Инстанс ITSM не предоставлен. Показан тот же инцидент {i.id}; запрос
            в реальную систему не выполняется.
          </p>
        </div>
      )}
      {updated && (
        <p role="status" className="notice">
          Данные карточки обновлены до версии {i.revision}. Положение и фокус
          сохранены.
        </p>
      )}
      <dl className="facts">
        {[
          ["Статус", i.stateLabel],
          ["Приоритет", i.priorityLabel],
          ["Продукт", i.raw.productName],
          ["Команда", i.team],
          ["Исполнитель", i.raw.assignedEmployee],
          ["Регистрация", formatDate(i.dates.submitDate, zone)],
          [
            "Срок",
            i.dates.deadline
              ? formatDate(i.dates.deadline, zone)
              : "Срок не задан",
          ],
          ["Завершение", formatDate(i.dates.completionDate, zone)],
          [
            "Источник",
            i.sourcePresent
              ? "Запись присутствует"
              : "Отсутствует; требуется сверка",
          ],
          ["Версия", i.revision],
        ].map(([name, value]) => (
          <div key={String(name)}>
            <dt>{String(name)}</dt>
            <dd>{text(value)}</dd>
          </div>
        ))}
      </dl>
      <h2>Описание</h2>
      <p className="prose">{text(i.raw.description)}</p>
      <div className="flags">
        {["isNeedUp", "isMaster", "isDouble", "isEffect", "isReason"].map(
          (f) => (
            <span className="badge" key={f}>
              {f}:{" "}
              {i.raw[f] === null
                ? "неизвестно"
                : i.raw[f] === true
                  ? "да"
                  : i.raw[f] === false
                    ? "нет"
                    : "не указано"}
            </span>
          ),
        )}
      </div>
      <p className="muted">
        Master/Double не содержат ID связанного инцидента. Направление
        Effect/Reason не подтверждено.
      </p>
      {!!i.raw.solution && (
        <>
          <h2>
            {i.stateId === 0 || i.stateId === 2
              ? "Предыдущая попытка / несогласованные данные"
              : "Текст решения"}
          </h2>
          <p className="prose">{text(i.raw.solution)}</p>
        </>
      )}
      <section className="analysis">
        <h2>ИИ-сводка</h2>
        <p className="muted">
          Локальная модель выделяет важные фрагменты. Все выводы требуют
          проверки координатором.
        </p>
        {write ? (
          <button
            tabIndex={0}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setAnalysis(await onAnalyze());
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Анализ выполняется…" : "Составить сводку"}
          </button>
        ) : (
          <p>Войдите как координатор для анализа.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {analysis && (
          <div>
            <p
              className={
                analysis.stale || analysis.inputRevision !== i.revision
                  ? "warning"
                  : "muted"
              }
            >
              {analysis.stale || analysis.inputRevision !== i.revision
                ? "Сводка устарела — данные изменились"
                : `Сводка версии ${analysis.inputRevision}`}{" "}
              ·{" "}
              {analysis.mode === "model"
                ? "Анализ локальной модели"
                : "Сводка полей без ИИ"}
            </p>
            {analysis.error && <p role="alert">{analysis.error}</p>}
            <ul>
              {analysis.summary.map((s, n) => (
                <li key={n}>
                  {s}
                  <small>
                    Основание:{" "}
                    {analysis.evidence
                      .find((e) => e.claim === n)
                      ?.fields.join(", ")}
                  </small>
                </li>
              ))}
            </ul>
            <p>{analysis.uncertainties.join(" ")}</p>
            <details>
              <summary>Модель и версия анализа</summary>
              <p className="prose">
                {analysis.model} · {analysis.provider} ·{" "}
                {analysis.promptVersion}
              </p>
            </details>
          </div>
        )}
      </section>
      <h2>Качество данных</h2>
      {i.issues.length ? (
        <ul>
          {i.issues.map((q, n) => (
            <li key={n}>{q.message}</li>
          ))}
        </ul>
      ) : (
        <p>Замечаний нет.</p>
      )}
      <h2>История версий</h2>
      <ol className="history">
        {item.history.map((e: any) => (
          <li key={e.revision}>
            <strong>Версия {e.revision}</strong> · {formatDate(e.at, zone)}
            <p>
              {e.kind === "missing"
                ? "Запись исчезла из выписки; последнее состояние сохранено"
                : e.kind === "created"
                  ? "Первое наблюдение"
                  : "Изменены поля: " + e.changed.join(", ")}
            </p>
          </li>
        ))}
      </ol>
      <details>
        <summary>Все исходные поля ({Object.keys(i.raw).length})</summary>
        <dl className="raw">
          {Object.entries(i.raw).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                {v === null
                  ? "null"
                  : typeof v === "object"
                    ? JSON.stringify(v)
                    : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
function Login({
  onSubmit,
}: {
  onSubmit: (u: string, p: string) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="content login"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await onSubmit(String(f.get("username")), String(f.get("password")));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>Вход в рабочее место</h1>
      <p className="muted">Доступ выдаёт администратор стенда.</p>
      <label>
        Имя пользователя
        <input name="username" autoComplete="username" required />
      </label>
      <label>
        Пароль
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button tabIndex={0} disabled={busy}>
        {busy ? "Вход…" : "Войти"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Denied() {
  return (
    <div className="content">
      <h1>Недостаточно прав</h1>
      <p>Войдите под учётной записью с доступом к этому действию.</p>
    </div>
  );
}
function ImportPanel({
  ns,
  post,
  onDone,
}: {
  ns: string;
  post: (p: string, b: unknown) => Promise<any>;
  onDone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return (
    <section className="content">
      <h1>Импорт снимка</h1>
      <p>
        Источник: {ns}. Исходный JSON-массив; до 20 МиБ и 20 000 записей.
        Сначала проверка, затем запись рабочей копии.
      </p>
      <label>
        JSON-файл
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setPreview(null);
            setError("");
            setDone(false);
            if (!file) return;
            if (file.size > 20 * 1024 * 1024) {
              setError("Файл превышает ограничение 20 МиБ");
              return;
            }
            setBusy(true);
            try {
              setPreview(
                await post("/import/preview", { text: await file.text() }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p role="status">Проверка…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div>
          <h2>Предпросмотр</h2>
          <p>
            Записей: {preview.count}. Замечаний: {preview.issueCount}.
          </p>
          <ul>
            {preview.issues.slice(0, 8).map((i: any, n: number) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
          <button
            tabIndex={0}
            disabled={busy || done}
            onClick={async () => {
              setBusy(true);
              try {
                await post("/import/commit", { token: preview.token });
                setDone(true);
                await onDone();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {done ? "Снимок принят" : "Принять снимок"}
          </button>
        </div>
      )}
      <h2>Экспорт</h2>
      <p>
        <a href={"/api/export?ns=" + encodeURIComponent(ns)}>
          Скачать исходные поля без изменений
        </a>
      </p>
      <p>
        <a href={"/api/export?mode=normalized&ns=" + encodeURIComponent(ns)}>
          Скачать нормализованные значения
        </a>
      </p>
    </section>
  );
}
function Preferences({
  prefs,
  onSave,
}: {
  prefs: { sound: boolean; notifications: boolean; zone: string };
  onSave: (p: any) => Promise<void>;
}) {
  const [p, setP] = useState(prefs),
    [status, setStatus] = useState("");
  useEffect(() => setP(prefs), [prefs]);
  return (
    <form
      className="content login"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          if (p.notifications && "Notification" in window) {
            const permission = await Notification.requestPermission();
            if (permission !== "granted") {
              setP({ ...p, notifications: false });
              await onSave({ ...p, notifications: false });
              setStatus(
                "Браузер запретил уведомления. Визуальная лента доступна.",
              );
              return;
            }
          }
          await onSave(p);
          setStatus("Настройки сохранены");
          if (p.sound) beep();
        } catch (e) {
          setStatus((e as Error).message);
        }
      }}
    >
      <h1>Личные настройки</h1>
      <label>
        Часовой пояс
        <select
          aria-label="Часовой пояс"
          value={p.zone}
          onChange={(e) => setP({ ...p, zone: e.target.value })}
        >
          <option value="Europe/Moscow">Москва (UTC+3)</option>
          <option value="UTC">UTC</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.sound}
          onChange={(e) => setP({ ...p, sound: e.target.checked })}
        />
        Звук важных событий
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.notifications}
          onChange={(e) => setP({ ...p, notifications: e.target.checked })}
        />
        Уведомления браузера
      </label>
      <button tabIndex={0}>Сохранить настройки</button>
      <p role="status">{status}</p>
    </form>
  );
}
function beep() {
  try {
    const c = new AudioContext(),
      o = c.createOscillator(),
      g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.frequency.value = 600;
    g.gain.value = 0.04;
    o.start();
    o.stop(c.currentTime + 0.15);
    o.onended = () => void c.close();
  } catch {}
}
createRoot(document.getElementById("root")!).render(<App />);
