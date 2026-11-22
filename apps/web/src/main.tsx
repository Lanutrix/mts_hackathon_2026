import Select from "./Select";
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
import Landing from "./Landing";
import Login from "./LoginForm";
import ThemeControl from "./ThemeControl";
import IconHints from "./IconHints";
import {
  registerDeviceWorker,
  disconnectDeviceBrowser,
  DeviceNotifications,
} from "./DeviceNotifications";
import { isTrainingPath, liveReturnHref, screenLink, screenPath } from "./routes";
import Loader from "./Loader";
import { IncidentNotice, type IncidentSignal } from "./IncidentNotice";
import { mergeSignals } from "./signalQueue";
import CoordinatorDispatch from "./CoordinatorDispatch";
import { ItsmLink, TicketDeadline, TicketSource } from "./TicketRecord";
import { groups } from "./liveFeed";
import { ProductBrand, MtsCaseBrand, Icon, type IconName } from "./Brand";
import "./ops.css";
import "./ticket.css";
import { analysisSource, analysisText } from "./analysisLabels";
import type { Incident } from "../../../packages/domain/index.ts";
import { defaultPreferences, wallboardIntervals, wallboardOrders, type AccountPreferences, type WallboardOrder } from "../../../packages/contracts/preferences.ts";
import type { Analysis } from "../../server/analysis.ts";
const IncidentIntake = React.lazy(() => import("./IncidentIntake").then(m => ({ default: m.IncidentIntake })));
const Help = React.lazy(() => import("./Help"));
const LiveBoard = React.lazy(() => import("./LiveBoard"));
const Wallboard = React.lazy(() => import("./Wallboard"));
const Workspace = React.lazy(() => import("./Workspace"));

type User = {
  username: string;
  role: "viewer" | "coordinator" | "demo-admin";
  csrf: string;
  expiresInMs: number;
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
  if (response.status === 401 && path !== "/login") promptLogin();
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Не удалось получить данные");
  return data;
}
const legacyFilters = ["q", "ns", "sort", "service", "up", ...groups];
function readRoute() {
  const url = new URL(location.href);
  if (
    url.pathname === "/simulation/login" ||
    (url.pathname === "/login" && url.searchParams.get("ns") === "simulation")
  ) {
    url.pathname = "/login";
    url.searchParams.delete("ns");
    history.replaceState(history.state, "", url);
  }
  if (
    url.pathname === "/" &&
    legacyFilters.some((key) => url.searchParams.has(key))
  ) {
    url.pathname = "/live";
    history.replaceState(history.state, "", url);
  }
  if (
    url.searchParams.get("ns") === "simulation" &&
    !isTrainingPath(url.pathname)
  ) {
    history.replaceState(
      history.state,
      "",
      screenLink(url.pathname + url.search + url.hash, "simulation"),
    );
    return new URL(location.href);
  }
  return url;
}
function promptLogin() {
  if (location.pathname === "/" || location.pathname === "/login") return;
  const next = location.pathname + location.search + location.hash;
  location.replace("/login?" + new URLSearchParams({ next }));
}
function afterLogin(url: URL) {
  const next = url.searchParams.get("next");
  if (!next?.startsWith("/") || next.startsWith("//")) return "/live";
  const destination = new URL(next, location.origin);
  if (
    destination.origin !== location.origin ||
    !/^\/(?:simulation(?:\/|$)|live$|workspace$|help$|wallboard$|incident\/|itsm\/|preferences$|notifications$|demo$|import$|intake$|history$|quality$)/.test(
      destination.pathname,
    )
  )
    return "/live";
  return (
    destination.pathname + destination.search + (destination.hash || url.hash)
  );
}
type SessionInfo = { user: User; sources: string[]; publicDemo: boolean };

function SessionGate({
  route,
  go,
}: {
  route: URL;
  go: (path: string) => void;
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  const training = isTrainingPath(route.pathname);
  useEffect(() => {
    let active = true;
    api(training ? "/me?ns=simulation" : "/me")
      .then((info) => {
        if (!active) return;
        if (!info.user) promptLogin();
        else setSession(info);
      })
      .catch(() => {
        if (active) setError("Не удалось проверить вход");
      });
    const signedOut = (event: StorageEvent) => {
      if (event.key === "srez:logout") {
        setSession(null);
        promptLogin();
      }
    };
    window.addEventListener("storage", signedOut);
    return () => {
      active = false;
      window.removeEventListener("storage", signedOut);
    };
  }, [attempt, training]);
  useEffect(() => {
    if (!session) return;
    const expire = () => {
      setSession(null);
      promptLogin();
    };
    const timer = window.setTimeout(expire, session.user.expiresInMs);
    return () => window.clearTimeout(timer);
  }, [session]);
  const passive = screenPath(route.pathname) === "/wallboard";
  useEffect(() => {
    if (!passive || !error || session) return;
    const timer = window.setTimeout(() => retry((n) => n + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [attempt, passive, error, session]);
  if (session) return <Dashboard route={route} go={go} session={session} />;
  if (passive && error)
    return (
      <main className="access-check" role="status">
        {error}. Повторяем подключение…
      </main>
    );
  if (error)
    return (
      <main className="access-check">
        <p role="alert">{error}</p>
        <button
          onClick={() => {
            setError("");
            retry((n) => n + 1);
          }}
        >
          Повторить
        </button>
      </main>
    );
  return <Loader label="Проверяем вход…" stage />;
}
function LoginLanding({
  route,
  go,
}: {
  route: URL;
  go: (path: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <>
      <Landing go={go} />
      <dialog
        ref={dialog}
        className="access-dialog"
        aria-labelledby="access-title"
        onCancel={() => go("/")}
      >
        <button
          type="button"
          className="access-close"
          onClick={() => go("/")}
          aria-label="Закрыть вход"
        >
          ×
        </button>
        <Login
          onSubmit={async (username, password) => {
            await api("/login", {
              method: "POST",
              body: JSON.stringify({ username, password }),
            });
            try { localStorage.setItem("srez:login", String(Date.now())); } catch {}
            location.replace(afterLogin(route));
          }}
        />
      </dialog>
    </>
  );
}
function App({ initialRoute }: { initialRoute: URL }) {
  const [route, setRoute] = useState(initialRoute);
  const [visit, setVisit] = useState(0);
  useEffect(() => {
    const path = screenPath(route.pathname);
    const names: Record<string, string> = {
      "/": "Инциденты в срезе",
      "/help": "Помощь",
      "/live": "Эфир смены",
      "/workspace": "ИИ-помощник",
      "/wallboard": "Общий экран",
      "/login": "Вход",
      "/intake": "Приём инцидентов",
    };
    document.title = (names[path] ?? "Дашборд координатора") + " · Срез";
  }, [route.pathname]);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    const restore = (event: PageTransitionEvent) => {
      // A cached document can outlive its session and its event stream.
      if (event.persisted) setVisit((current) => current + 1);
    };
    window.addEventListener("popstate", update);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  const go = (path: string) => {
    const previous = location.pathname;
    const fromCanvas =
      screenPath(previous) === "/workspace" &&
      screenPath(new URL(path, location.origin).pathname).startsWith(
        "/incident/",
      );
    const target = screenPath(new URL(path, location.origin).pathname);
    const fromLive = screenPath(previous) === "/live" && target.startsWith("/incident/");
    const fromJournal = screenPath(previous) === "/notifications" && target.startsWith("/incident/");
    const restoredPage = target === "/live" && path === history.state?.liveOrigin
      ? history.state?.livePage : undefined;
    history.pushState(fromLive
      ? { liveOrigin: location.pathname + location.search, livePage: history.state?.livePage }
      : fromJournal ? { journalOrigin: location.pathname + location.search }
      : fromCanvas ? { fromCanvas: true } : restoredPage ? { livePage: restoredPage } : null, "", path);
    const next = readRoute();
    setRoute(next);
    if (next.pathname !== previous) window.scrollTo(0, 0);
  };
  return route.pathname === "/" ? (
    <Landing go={go} />
  ) : route.pathname === "/login" ? (
    <LoginLanding route={route} go={go} />
  ) : (
    <SessionGate
      key={
        visit +
        ":" +
        (isTrainingPath(route.pathname)
          ? "simulation"
          : route.searchParams.get("ns") || "demo")
      }
      route={route}
      go={go}
    />
  );
}
function Dashboard({
  route,
  go,
  session,
}: {
  route: URL;
  go: (path: string) => void;
  session: SessionInfo;
}) {
  const { user, sources, publicDemo } = session;
  const roleLabel = {
    coordinator: "Координатор",
    "demo-admin": "Администратор",
    viewer: "Наблюдатель",
  }[user.role];
  const path = screenPath(route.pathname),
    training = isTrainingPath(route.pathname),
    params = route.searchParams,
    query = route.search.slice(1),
    ns = training ? "simulation" : (params.get("ns") ?? "demo");
  const link = (to: string) => screenLink(to, ns);
  const detailKey = path + route.search;
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [signals, setSignals] = useState<IncidentSignal[]>([]),
    [connection, setConnection] = useState("Подключение…"),
    [detailPage, setDetailPage] = useState<{ key: string; value: any } | null>(
      null,
    ),
    [prefs, setPrefs] = useState<AccountPreferences | null>(null),
    [preferenceError, setPreferenceError] = useState("");
  const [tick, setTick] = useState(Date.now()),
    lastRevision = useRef(0),
    lastNotified = useRef(0),
    generation = useRef(0),
    run = useRef(""),
    receipt = useRef({ key: "", revision: 0 }),
    pending = useRef<AbortController | null>(null),
    detailCache = useRef<{ key: string; value: any } | null>(null),
    serverClockOffset = useRef(0),
    streamReceivedAt = useRef(0),
    eventStream = useRef<EventSource | null>(null),
    liveStatus = useRef(""),
    prefsRef = useRef(prefs ?? defaultPreferences);
  prefsRef.current = prefs ?? defaultPreferences;
  const extra = detailPage?.key === detailKey ? detailPage.value : null;
  const zone = prefsRef.current.zone,
    wall = path === "/wallboard",
    wallOrder = wall && (user.role === "viewer" || prefs || preferenceError)
      ? prefsRef.current.wallboardOrder : null,
    write =
      !training && (user.role === "coordinator" || user.role === "demo-admin");
  const suffix = (url: string) =>
    url + (url.includes("?") ? "&" : "?") + "ns=" + encodeURIComponent(ns);
  const post = async (url: string, body: unknown) =>
    api(suffix(url), {
      method: "POST",
      headers: { "X-CSRF-Token": user?.csrf ?? "" },
      body: JSON.stringify(body),
    });
  const load = useCallback(async () => {
    if (wall && !wallOrder) return;
    const gen = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const read = (url: string) => api(url, { signal: controller.signal });
    try {
      const q = new URLSearchParams(path === "/wallboard" ? "" : query);
      q.set("ns", ns);
      if (wallOrder) q.set("sort", wallOrder);
      if (path === "/live" || path === "/wallboard")
        for (const group of groups) q.delete(group);
      if (path === "/live") {
        q.set("register", "1");
        q.delete("offset");
        q.delete("limit");
        if (!q.has("groupBy")) q.set("groupBy", q.has("case") ? "symptom" : "semantic");
      }
      const dashboard = await read("/dashboard?" + q);
      if (gen !== generation.current) return;
      const serverTime = Date.parse(dashboard.serverTime);
      if (Number.isFinite(serverTime)) {
        serverClockOffset.current = serverTime - Date.now();
        setTick(serverTime);
      }
      setData({ ...dashboard, filterQuery: query, wallOrder });
      lastRevision.current = dashboard.revision;
      setError("");
      const simulation = dashboard.simulation;
      const firstInRun = simulation && run.current !== simulation.runId;
      if (firstInRun) {
        run.current = simulation.runId;
        receipt.current = { key: "", revision: 0 };
        try {
          const saved = JSON.parse(
            sessionStorage.getItem("watermelon:training:receipt") || "null",
          );
          if (saved?.run === simulation.runId) receipt.current = saved;
        } catch {
          /* Storage is optional. */
        }
      }
      if (firstInRun || dashboard.revision < lastNotified.current)
        setSignals([]);
      if (simulation)
        setSignals((items) =>
          items.every((item) => item.id === simulation.currentId)
            ? items
            : items.filter((item) => item.id === simulation.currentId),
        );
      if (
        firstInRun ||
        (lastNotified.current > 0 && dashboard.revision > lastNotified.current)
      ) {
        const fresh: IncidentSignal[] = dashboard.events.filter(
          (n: IncidentSignal) =>
            (!simulation || n.id === simulation.currentId) &&
            (firstInRun || n.revision > lastNotified.current) &&
            (!simulation ||
              n.key !== receipt.current.key ||
              n.revision > receipt.current.revision),
        );
        if (fresh.length) {
          setSignals((previous) => mergeSignals(previous, fresh));
          if (prefsRef.current.sound) beep();
        }
      }
      lastNotified.current = dashboard.revision;
      let e: any = null;
      if (path.startsWith("/incident/") || path.startsWith("/itsm/")) {
        const key = [
          ns,
          run.current,
          path.split("/")[2],
          dashboard.revision,
        ].join(":");
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
            (params.get("offset") ?? 0) +
            (params.has("revision") ? "&revision=" + encodeURIComponent(params.get("revision")!) : ""),
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
      if (gen === generation.current)
        setDetailPage({ key: detailKey, value: e });
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [query, ns, path, user?.role, wall, wallOrder]);
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
    if (user.role === "viewer") return;
    const controller = new AbortController();
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const saved = await api("/preferences", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setPrefs(saved);
          setPreferenceError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) setPreferenceError((error as Error).message);
      } finally {
        reading = false;
      }
    };
    void refresh();
    // Another display may use this account on a different device.
    const timer = wall ? window.setInterval(refresh, 5000) : undefined;
    const changed = (event: StorageEvent) => {
      if (event.key === "srez:preferences:" + user.username) void refresh();
    };
    if (wall) window.addEventListener("storage", changed);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("storage", changed);
    };
  }, [user.username, user.role, wall]);
  const latestLoad = useRef(load);
  useLayoutEffect(() => {
    latestLoad.current = load;
  }, [load]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (path !== "/live" || data?.namespace !== ns || data?.filterQuery !== query || !data?.triage?.refining) return;
    const timer = setTimeout(() => { if (!pending.current) void latestLoad.current(); }, 1400);
    return () => clearTimeout(timer);
  }, [data, ns, path, query]);
  useEffect(() => {
    const boundary = data?.triage?.nextChangeAt;
    if (path !== "/live" || data?.namespace !== ns || data.filterQuery !== query ||
      typeof boundary !== "number") return;
    const delay = boundary - Date.parse(data.serverTime);
    // The regular five-second poll covers distant boundaries and reconnects.
    if (delay > 5000) return;
    const timer = setTimeout(() => void latestLoad.current(), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [data, ns, path, query]);
  useEffect(() => {
    let disposed = false;
    const es = new EventSource(
      "/api/stream?ns=" +
        encodeURIComponent(ns) +
        "&cursor=" +
        lastRevision.current,
    );
    eventStream.current = es;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      refresh = undefined;
      if (disposed) return;
      if (pending.current) {
        refresh = setTimeout(flush, 120);
        return;
      }
      void latestLoad.current();
    };
    const update = () => {
      if (!disposed) {
        streamReceivedAt.current = Date.now();
        setConnection("На связи");
        liveStatus.current = "На связи";
        // A continuous stream must allow the current read to reach the screen.
        refresh ??= setTimeout(flush, 500);
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
      if (!document.hidden && !pending.current) void latestLoad.current();
    }, 5000);
    const clock = setInterval(
      () => setTick(Date.now() + serverClockOffset.current),
      1000,
    );
    const online = () => void latestLoad.current();
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
      clearTimeout(refresh);
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
  }, [ns]);
  const dismiss = () => {
    const note = signals[0];
    if (!note) return;
    if (training) {
      receipt.current = { key: note.key, revision: note.revision };
      try {
        sessionStorage.setItem(
          "watermelon:training:receipt",
          JSON.stringify({ run: run.current, ...receipt.current }),
        );
      } catch {
        /* Dismissal still applies in memory. */
      }
    }
    setSignals((items) => items.filter((item) => item !== note));
  };
  const nav = (
    to: string,
    label: string,
    icon?: IconName,
    compact = false,
    short?: string,
  ) => (
    <a
      tabIndex={0}
      href={to === "/preferences" ? "/preferences" : link(to)}
      aria-current={path === to ? "page" : undefined}
      className={compact ? "icon-link" : undefined}
      data-hint={icon ? label : undefined}
      aria-label={compact || short ? label : undefined}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(to === "/preferences" ? "/preferences" : link(to));
      }}
    >
      {icon && <Icon name={icon} size={18} />}
      <span className={compact ? "sr-only" : undefined}>{short ?? label}</span>
    </a>
  );
  const open = (id: string) => go(link("/incident/" + encodeURIComponent(id)));
  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(query);
    if (key === "breakdown") {
      if (value) p.set("band", value);
      else p.delete("band");
      p.set("groupBy", value ? "symptomProduct" : "response");
      p.delete("case");
      go(link(path + "?" + p));
      return;
    }
    if (key === "case" && data?.triage) p.set("groupBy", data.triage.groupBy);
    value ? p.set(key, value) : p.delete(key);
    if (["signal", "groupBy", "q", "service", "up", "priority", "team", "product", "symptom", "band"].includes(key))
      p.delete("case");
    for (const g of groups) if (g !== key) p.delete(g);
    go(link(p.size ? path + "?" + p : path));
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
  const visibleCases = new Map<string, string>(
    (data?.events ?? []).filter((note: {caseId?: string}) => note.caseId)
      .map((note: {key: string; caseId: string}) => [note.key, note.caseId]),
  );
  const wave = path === "/live" && data?.filterQuery === query && signals.length >= 4
    ? data.triage?.cases.find((item: {id: string}) =>
        signals.filter(signal => visibleCases.get(signal.key) === item.id).length >= 4)
    : undefined;
  const dismissWave = () => setSignals(items => items.filter(note => visibleCases.get(note.key) !== wave?.id));
  const openNotification = async (note: IncidentSignal & {read?: boolean}) => {
    if (write && !note.read) {
      try {
        await post("/notifications/read", {key: note.key, revision: note.revision});
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    if (training && signals[0] === note) dismiss();
    setSignals(items => items.filter(item => item.key !== note.key || item.revision > note.revision));
    open(note.id);
  };
  const journalPage = (offset: number) => {
    const p = new URLSearchParams();
    if (offset) {
      p.set("offset", String(offset));
      p.set("revision", String(extra.revision));
    }
    go(link("/notifications" + (p.size ? "?" + p : "")));
  };
  const sourceProblem =
    error ||
    data?.status.state === "error" ||
    connection.startsWith("Нет сети") ||
    connection.startsWith("Связь прервана");
  if (wall) {
    if (!data?.wallOrder || data.namespace !== ns)
      return error ? (
        <main role="alert" className="access-check">
          {error}
        </main>
      ) : (
        <Loader stage label="Подключаем общий экран…" />
      );
    return (
      <React.Suspense
        fallback={<Loader stage label="Подключаем общий экран…" />}
      >
        <Wallboard
          key={data.namespace + ":" + data.wallOrder}
          data={data}
          order={data.wallOrder}
          seconds={prefsRef.current.wallboardSeconds}
          now={tick}
          zone={zone}
          online={connection === "На связи" && !sourceProblem}
        />
      </React.Suspense>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <div
        className={
          "app ops-shell" +
          (path === "/workspace"
            ? " ops-shell--canvas"
            : path === "/live"
              ? " ops-shell--live"
              : "")
        }
      >
        <a tabIndex={0} className="skip" href="#main">
          К содержимому
        </a>
        <header className="ops-header">
          <a
            className="ops-brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              go("/");
            }}
          >
            <ProductBrand />
            <MtsCaseBrand compact />
          </a>
          <nav className="primary-switch" aria-label="Основная навигация">
            {nav("/live", "Эфир смены", "live", false, "Эфир")}
            {nav("/workspace", "ИИ-помощник", "layers", false, "Помощник")}
          </nav>
          <nav className="ops-actions" aria-label="Сервисы">
            {nav("/notifications", "Уведомления", "bell", true)}
            <button
              className="ops-more"
              type="button"
              aria-label="Дополнительные разделы"
              data-hint="Дополнительные разделы"
              popoverTarget="service-menu"
            >
              <Icon name="more" size={19} />
            </button>
            <div
              className="service-menu"
              id="service-menu"
              popover="auto"
              key={path}
            >
              {nav("/help", "Помощь", "help")}
              {nav("/history", "История", "history")}
              {nav("/quality", "Качество данных", "quality")}
              {nav("/wallboard", "Общий экран", "expand")}
              <a href={training ? "/live" : "/simulation"}>
                <Icon name="live" size={16} />
                {training ? "Рабочий эфир" : "Учебный эфир"}
              </a>
              <div
                className="menu-source"
                data-testid="source-status"
                aria-label="Состояние источника"
              >
                <span>{connection}</span>
                {data?.acceptedAt && (
                  <span>
                    Обновлён {formatDate(data.acceptedAt, zone)} ·{" "}
                    {zone === "UTC" ? "UTC" : "МСК"}
                  </span>
                )}
              </div>
            </div>
            {user ? (
              <>
                <button
                  className="user-pill profile-trigger"
                  type="button"
                  aria-label={"Профиль: " + user.username + ", " + roleLabel}
                  data-hint={"Профиль · " + roleLabel}
                  popoverTarget="profile-menu"
                >
                  <Icon name="profile" size={17} />
                  <span>{roleLabel}</span>
                </button>
                <div
                  className="service-menu profile-menu"
                  id="profile-menu"
                  popover="auto"
                  key={path}
                >
                  <strong>{user.username}</strong>
                  {nav("/preferences", "Настройки", "settings")}
                  <ThemeControl />
                  {!training && user.role === "demo-admin" && (
                    <>
                      {(ns === "demo" || ns === "workspace") && nav("/intake", "Приём инцидентов", "intake")}
                      {nav("/import", "Импорт")}
                      {nav("/demo", "Управление сценарием")}
                    </>
                  )}
                  <button
                    aria-label={"Выйти: " + user.username}
                    onClick={() =>
                      void api("/logout", {
                        method: "POST",
                        headers: { "X-CSRF-Token": user.csrf },
                        body: "{}",
                      })
                        .then(async () => {
                          try {
                            localStorage.setItem(
                              "srez:logout",
                              String(Date.now()),
                            );
                          } catch {}
                          await disconnectDeviceBrowser().catch(() => {});
                          location.replace("/");
                        })
                        .catch((e) => setError(e.message))
                    }
                  >
                    Выйти
                  </button>
                </div>
              </>
            ) : (
              nav("/login", "Войти")
            )}
          </nav>
        </header>
        {sourceProblem && !error && (
          <div className="source-problem" role="status">
            {data?.status.state === "error" ? data.status.error : connection}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button tabIndex={0} onClick={() => void load()}>
              Повторить
            </button>
          </div>
        )}
        <IncidentNotice
          signal={
            path === "/notifications" || path === "/login"
              ? null
              : (signals[0] ?? null)
          }
          pendingCount={signals.length}
          wave={wave ? { label: wave.label, count: wave.count } : undefined}
          onDismiss={wave ? dismissWave : dismiss}
          onOpen={() => {
            if (wave) {
              dismissWave();
              updateParam("case", wave.id);
              return;
            }
            const current = signals[0];
            if (current) void openNotification(current);
          }}
          onJournal={() => go(link("/notifications"))}
        />
        <main id="main">
          {path === "/help" ? (
            <React.Suspense
              fallback={<Loader stage label="Открываем помощь…" />}
            >
              <Help ns={ns} go={go} />
            </React.Suspense>
          ) : path === "/workspace" &&
            (!training || data?.simulation?.runId) ? (
            <React.Suspense
              fallback={<Loader label="Открываем холст…" stage />}
            >
              <Workspace
                go={go}
                ns={ns}
                userKey={JSON.stringify([
                  user.username,
                  training ? data.simulation.runId : ns,
                ])}
                zone={zone}
                csrf={user.csrf}
                canAsk={write || (publicDemo && (ns === "demo" || training))}
                revision={data?.namespace === ns ? data.revision : 0}
                open={open}
              />
            </React.Suspense>
          ) : !data || data.namespace !== ns || (path === "/live" && !data.register) ? (
            error ? null : (
              <Loader label="Загрузка данных…" stage />
            )
          ) : (path.startsWith("/incident/") ||
              path.startsWith("/itsm/") ||
              ["/notifications", "/history", "/quality"].includes(path)) &&
            !extra ? (
            error ? null : (
              <Loader label="Загрузка раздела…" stage />
            )
          ) : path === "/live" ? (
            <React.Suspense fallback={<Loader stage label="Открываем эфир…" />}>
              <LiveBoard
                data={data}
                username={user.username}
                csrf={user?.csrf}
                canAnalyze={
                  !!write || (publicDemo && (ns === "demo" || training))
                }
                filtering={data.filterQuery !== query}
                params={params}
                ns={ns}
                now={tick}
                zone={zone}
                online={connection === "На связи" && !sourceProblem && data.status.state === "live"}
                sources={sources}
                open={open}
                setParam={updateParam}
                switchSource={(source) =>
                  go("/live?ns=" + encodeURIComponent(source))
                }
              >
                {(data.quality.quarantined > 0 || data.quality.missing > 0) && (
                  <div className="warning notice">
                    Требуется сверка: {data.quality.quarantined} с конфликтами,{" "}
                    {data.quality.missing} отсутствуют в текущем снимке.{" "}
                    {nav("/quality", "Проверить качество данных")}
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
              </LiveBoard>
            </React.Suspense>
          ) : path.startsWith("/incident/") || path.startsWith("/itsm/") ? (
            extra?.incident &&
            extra.incident.id === decodeURIComponent(path.split("/")[2]) && (
              <Detail
                key={extra.incident.key}
                liveBack={liveReturnHref(ns)}
                journalBack={history.state?.journalOrigin}
                canvasBack={
                  history.state?.fromCanvas === true
                    ? link("/workspace")
                    : undefined
                }
                item={extra}
                now={tick}
                dispatch={
                  <CoordinatorDispatch
                    key={
                      ns +
                      "/" +
                      extra.incident.key +
                      "/" +
                      (user?.username ?? "")
                    }
                    incident={extra.incident}
                    username={user.username}
                    ns={ns}
                    sourceRevision={data.revision}
                    csrf={user?.csrf}
                    zone={zone}
                    itsmHref={extra.itsmMock ? link(extra.itsm) : extra.itsm}
                    itsmMock={extra.itsmMock}
                    navigate={go}
                  />
                }
                zone={zone}
                mock={path.startsWith("/itsm/")}
                write={!!write}
                onAnalyze={() =>
                  post("/analysis/" + encodeURIComponent(extra.incident.id), {})
                }
                itsmHref={extra.itsmMock ? link(extra.itsm) : extra.itsm}
                onNavigate={go}
              />
            )
          ) : path === "/notifications" ? (
            <section className="content">
              <h1>Уведомления</h1>
              {extra && <div className="journal-summary">
                <span>{write ? "Непрочитанных: " + extra.unread + " · " : ""}Всего событий: {extra.total}</span>
                {write && extra.unread > 0 && <button type="button" onClick={() => void call(async () => {
                  await post("/notifications/read", {throughRevision:extra.revision});
                  setSignals(items => items.filter(item => item.revision > extra.revision));
                })}>Прочитать все</button>}
              </div>}
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
                        onClick={() => void openNotification(n)}
                      >
                        {n.header && <span>{n.header} · </span>}
                        <span>{n.id}</span>
                      </button>
                      <p className="muted">{formatDate(n.at, zone)}</p>
                    </div>
                    {n.snapshot && (
                      <details className="event-facts">
                        <summary>На момент сигнала</summary>
                        <p>
                          {n.snapshot.state || "Статус не указан"} · {n.snapshot.team || "Команда не указана"}
                        </p>
                        {n.snapshot.description && <p>{n.snapshot.description}</p>}
                        {n.snapshot.deadline && (
                          <p>Срок {formatDate(n.snapshot.deadline, zone)}</p>
                        )}
                      </details>
                    )}
                    {write && (
                      <button
                        tabIndex={0}
                        disabled={n.read}
                        onClick={() =>
                          void call(async () => {
                            await post("/notifications/read", {key: n.key, revision: n.revision});
                            setSignals(items => items.filter(item => item.key !== n.key || item.revision > n.revision));
                          })
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
                    journalPage(Math.max(0, Number(params.get("offset")) - 200))
                  }
                >
                  Предыдущие
                </button>
                <button
                  tabIndex={0}
                  disabled={extra?.nextOffset == null}
                  onClick={() =>
                    journalPage(extra.nextOffset)
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
                  : "Завершённые и закрытые инциденты."}
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
          ) : path === "/intake" ? (
            !training && user.role === "demo-admin" && (ns === "demo" || ns === "workspace") ? (
              <IncidentIntake key={ns} ns={ns} publicDemo={session.publicDemo} post={post} sources={session.sources} />
            ) : <Denied />
          ) : path === "/import" ? (
            user?.role === "demo-admin" ? (
              <ImportPanel ns={ns} post={post} onDone={load} />
            ) : (
              <Denied />
            )
          ) : path === "/demo" ? (
            user?.role === "demo-admin" ? (
              <section className="content">
                <h1>Управление сценарием</h1>
                <p>
                  Шаг {extra?.step ?? 0}. Часы сценария: {extra?.clock ?? "—"}.
                </p>
                <div className="toolbar">
                  {[
                    ["play", "Запустить"],
                    ["pause", "Пауза"],
                    ["step", "Следующий шаг"],
                    ["reset", "Сбросить сценарий"],
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
            <>
              <section className="content login appearance-settings">
                <h1>Личные настройки</h1>
                <ThemeControl />
                {write && preferenceError && <p role="alert">{preferenceError}</p>}
                {write && prefs && (
                  <Preferences
                    prefs={prefs}
                    onSave={async (p) => {
                      const saved = await post("/preferences", p);
                      setPrefs(saved);
                      setPreferenceError("");
                      try { localStorage.setItem("srez:preferences:" + user.username, String(Date.now())); }
                      catch { /* The display also checks account settings on its own. */ }
                    }}
                  />
                )}
              </section>
              <DeviceNotifications user={user} namespace={ns} />
            </>
          ) : (
            <section className="content">
              <h1>Страница не найдена</h1>
              {nav("/live", "Вернуться к обзору")}
            </section>
          )}
        </main>
        <footer className="platform-footer">
          мы не несем ответственность за провал инцидентов, только смертельную
        </footer>
      </div>
    </MotionConfig>
  );
}
function fieldCaption(field: string) {
  const names: Record<string, string> = {
    header: "Тема",
    description: "Описание",
    stateId: "Статус",
    priorityId: "Приоритет",
    deadline: "Срок",
    productName: "Продукт",
    assignedEmployee: "Исполнитель",
    assignedGroupName: "Команда назначения",
    isNeedUp: "Устранение последствий",
    "history.changed": "История изменений",
    solution: "Решение",
  };
  return names[field.split(":")[0]] ?? field;
}
function Detail({
  canvasBack,
  journalBack,
  liveBack,
  item,
  dispatch,
  zone,
  now,
  mock,
  itsmHref,
  write,
  onAnalyze,
  onNavigate,
}: {
  item: any;
  canvasBack?: string;
  journalBack?: string;
  liveBack: string;
  dispatch: React.ReactNode;
  zone: string;
  now: number;
  mock: boolean;
  itsmHref: string;
  write: boolean;
  onAnalyze: () => Promise<Analysis>;
  onNavigate: (p: string) => void;
}) {
  const i: Incident = item.incident;
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const seenRevision = useRef(i.revision);
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (i.revision === seenRevision.current) return;
    seenRevision.current = i.revision;
    setUpdated(true);
    const clear = window.setTimeout(() => setUpdated(false), 4200);
    return () => window.clearTimeout(clear);
  }, [i.revision]);
  const completed = i.stateId === 7 || i.stateId === 10;
  const displayPerson = text(i.raw.assignedEmployee || i.raw.assignedEmployeeLogin, "Не указан");
  const zoneLabel = zone === "Europe/Moscow" ? "МСК" : zone;
  const backToTicket = location.pathname.replace("/itsm/", "/incident/") + location.search;
  return (
    <section className={"content detail" + (mock ? "" : " detail-with-actions")}>
      <div className="ticket-columns">
        <div className="ticket-story" role="region" aria-label="Карточка инцидента" tabIndex={0}>
          {!canvasBack && !mock && (
            <a className="canvas-back" href={journalBack || liveBack} onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(journalBack || liveBack);
            }}><span aria-hidden="true">←</span> {journalBack ? "Вернуться в журнал" : "Вернуться в эфир"}</a>
          )}
          {canvasBack && (
            <a
              className="canvas-back"
              href={canvasBack}
              onClick={(event) => {
                if (
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                history.back();
              }}
            >
              <span aria-hidden="true">←</span> Вернуться на холст
            </a>
          )}
          <header className="ticket-hero">
            <div className="ticket-topline">
              <p className="ticket-key"><ProductBrand /><span>Инцидент</span><b>{i.id}</b></p>
              {!mock && <a href="#ticket-actions" className="ticket-actions-jump">К действиям ↓</a>}
            </div>
            <h1>{text(i.raw.header, "Без темы")}</h1>
            <div className="ticket-meta">
              <span><Icon name="layers" size={16} /><small>Продукт</small><strong>{text(i.raw.productName)}</strong></span>
              <span><Icon name="history" size={16} /><small>Регистрация</small><time dateTime={i.dates.submitDate || undefined}>{i.dates.submitDate ? formatDate(i.dates.submitDate, zone) + " " + zoneLabel : "Не указана"}</time></span>
              <span data-priority={completed ? undefined : i.priorityId}><Icon name={i.priorityId === 4 ? "critical" : "ranking"} size={16} /><small>Приоритет</small><strong>{i.priorityLabel}</strong></span>
            </div>
          </header>
          {mock && (
            <div className="ticket-mock notice">
              <strong>Макет перехода в SimpleOne</strong>
              <p>Показан тот же инцидент {i.id}. Данные взяты из выгрузки.</p>
              <a href={backToTicket} onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(backToTicket);
              }}>Вернуться к инциденту</a>
            </div>
          )}
          {updated && <p role="status" className="notice">Данные инцидента обновлены</p>}
          {!i.sourcePresent && <p role="status" className="warning">Инцидент отсутствует в последней выгрузке. Проверьте данные в ITSM.</p>}
          <section className="ticket-current" aria-label="Текущее состояние">
            <dl>
              <div><dt><Icon name="live" size={16} />Статус</dt>
                <dd className="ticket-state" data-completed={completed}>{i.stateLabel}</dd></div>
              <div><dt><Icon name="clock" size={16} />Срок решения</dt>
                <TicketDeadline incident={i} now={now} stamp={formatDate(i.dates.deadline, zone) + " " + zoneLabel} /></div>
              <div><dt><Icon name="coordinators" size={16} />Команда назначения</dt><dd>{i.team || "Не указана"}</dd></div>
              <div><dt><Icon name="profile" size={16} />Исполнитель</dt><dd>{displayPerson}</dd></div>
            </dl>
          </section>
          <div className="ticket-context">
            <div className="ticket-description">
              <h2>Описание</h2>
              <p className="prose">{text(i.raw.description || i.raw.shortDescription, "Описание отсутствует в выгрузке.")}</p>
            </div>
            {!!i.raw.solution && <section className="ticket-solution">
              <h2>{completed || i.stateId === 20 ? "Решение" : "Запись о решении"}</h2>
              <p className="prose">{text(i.raw.solution)}</p>
              {(i.stateId === 0 || i.stateId === 2) && <small>В выгрузке инцидент по-прежнему активен. Запись может описывать предыдущую попытку.</small>}
            </section>}
            <p className="ticket-consequences"><Icon name="escalation" size={16} /><span>Устранение последствий</span>
              <strong>{i.raw.isNeedUp === true ? "Требуется" : i.raw.isNeedUp === false ? "Не требуется" : "Не указано"}</strong>
            </p>
          </div>
          {i.issues.length > 0 && (
            <details className="ticket-fold">
              <summary>Проверить данные · {i.issues.length}</summary>
              <ul>
                {i.issues.map((q, n) => (
                  <li key={n}>{q.message}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="ticket-fold">
            <summary>История · {item.history.length}</summary>
            <ol className="history">
              {item.history.map((e: any) => (
                <li key={e.revision}>
                  <time dateTime={e.at}>{formatDate(e.at, zone)}</time>
                  <p>
                    {e.kind === "missing"
                      ? "Запись исчезла из выписки. Сохранено последнее состояние."
                      : e.kind === "created"
                        ? "Первое наблюдение"
                        : "Изменены поля: " + e.changed.map(fieldCaption).join(", ")}
                  </p>
                </li>
              ))}
            </ol>
          </details>
          <TicketSource incident={i} />
        </div>
        {!mock && <aside className="ticket-actions" id="ticket-actions" aria-label="Действия с заявкой" tabIndex={-1}>
          <header className="ticket-actions-head">
            <h2>Действия с заявкой</h2>
            <ItsmLink href={itsmHref} mock={item.itsmMock} navigate={onNavigate} className="button ticket-itsm">
              {item.itsmMock ? "Открыть в ITSM (макет)" : "Открыть в ITSM"}
            </ItsmLink>
          </header>
          {write && (
            <section className="analysis detail-ai" aria-label="ИИ-сводка">
              <button
                type="button"
                className="detail-ai-trigger"
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
                <Icon name="layers" size={18} />
                {busy ? (
                  <Loader label="Готовим разбор…" />
                ) : analysis ? (
                  "Обновить ИИ-разбор"
                ) : (
                  "ИИ-разбор"
                )}
              </button>
              {error && <p role="alert">{error}</p>}
              {analysis && (
                <div className="detail-ai-result">
                  {(analysis.stale || analysis.inputRevision !== i.revision) && (
                    <p role="status" className="warning">
                      После разбора инцидент изменился.
                    </p>
                  )}
                  {analysis.mode === "fallback" && (
                    <p className="muted">Сводка по полям</p>
                  )}
                  <ul>
                    {analysis.summary.map((s, n) => (
                      <li key={n}>{s}</li>
                    ))}
                  </ul>
                  {analysis.error && <p role="status">{analysisText(analysis.error)}</p>}
                  <details>
                    <summary>Основания разбора</summary>
                    {analysis.evidence.map((e, n) => (
                      <p key={n}>
                        {e.claim + 1}.{" "}
                        {e.fields.map((field) => fieldCaption(field)).join(" · ")}
                      </p>
                    ))}
                    {analysis.uncertainties.map((s, n) => (
                      <p key={n}>{s}</p>
                    ))}
                    <small>
                      {analysisSource(analysis.provider)}
                    </small>
                  </details>
                </div>
              )}
            </section>
          )}
          {dispatch}
        </aside>}
      </div>
    </section>
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
        Назначение — {ns === "demo" ? "сценарий" : "рабочая копия"}. JSON-массив
        до 20 МиБ и 20 000 записей. Сначала проверка, затем запись рабочей
        копии.
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
      {busy && (
        <Loader label={preview ? "Сохранение снимка…" : "Проверка снимка…"} />
      )}
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
  prefs: AccountPreferences;
  onSave: (p: AccountPreferences) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [p, setP] = useState(prefs),
    [status, setStatus] = useState("");
  useEffect(() => setP(prefs), [prefs]);
  return (
    <form
      className="preferences-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await onSave(p);
          setStatus("Настройки сохранены");
          if (p.sound) beep();
        } catch (e) {
          setStatus((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Часовой пояс
        <Select
          aria-label="Часовой пояс"
          value={p.zone}
          onChange={(e) => setP({ ...p, zone: e.target.value })}
        >
          <option value="Europe/Moscow">Москва (UTC+3)</option>
          <option value="UTC">UTC</option>
        </Select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={p.sound}
          onChange={(e) => setP({ ...p, sound: e.target.checked })}
        />
        Звук важных событий
      </label>
      <fieldset className="wallboard-preferences">
        <legend>Общий экран</legend>
        <label>
          Порядок активных заявок
          <Select aria-label="Порядок активных заявок" value={p.wallboardOrder}
            onChange={(e) => setP({ ...p, wallboardOrder: e.target.value as WallboardOrder })}>
            {wallboardOrders.map(order => <option key={order} value={order}>{{
              priority: "Сначала высокий приоритет",
              deadline: "Сначала ближайший срок",
              registered: "Сначала новые заявки",
            }[order]}</option>)}
          </Select>
        </label>
        <label>
          Смена страниц
          <Select aria-label="Смена страниц" value={p.wallboardSeconds}
            onChange={(e) => setP({ ...p, wallboardSeconds: Number(e.target.value) })}>
            {wallboardIntervals.map(seconds => <option key={seconds} value={seconds}>{seconds} секунд</option>)}
          </Select>
        </label>
      </fieldset>
      <button tabIndex={0} disabled={saving}>
        {saving ? (
          <Loader label="Сохранение настроек…" />
        ) : (
          "Сохранить настройки"
        )}
      </button>
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
void registerDeviceWorker().catch(() => {});
createRoot(document.getElementById("root")!).render(
  <>
    <App initialRoute={readRoute()} />
    <IconHints />
  </>,
);
