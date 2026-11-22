import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  parseSnapshot,
  GROUPS,
  safeItsm,
  deadlineStatus,
  type Group,
  type Incident,
} from "../../packages/domain/index.ts";
import { Auth, type QrLogin, type Role } from "./auth.ts";
import { Store, FileSource } from "../worker/ingestion.ts";
import { Demo, atomicWrite } from "./demo.ts";
import { appendIncidents, IntakeError } from "./intake.ts";
import { intakeByteLimit } from "../../packages/contracts/intake.ts";
import { defaultPreferences, wallboardIntervals, wallboardOrders } from "../../packages/contracts/preferences.ts";
import {
  registerJurySimulation,
  type SimulationOptions,
} from "./jurySimulation.ts";
import type { AnalysisService } from "./analysis.ts";
import { analyzeCase } from "./caseAnalysis.ts";
import { liveStep } from "../../packages/domain/liveStep.ts";
import { refineLiveStep } from "./liveGuidance.ts";
import { LiveClusters } from "./liveClusters.ts";
import { analyzeSelection } from "./operationalAnalysis.ts";
import { CanvasService } from "./canvas.ts";
import type { CanvasResult } from "../../packages/contracts/canvas.ts";
import { validContext } from "./canvasPlan.ts";
import { registerDispatch } from "./dispatch.ts";
import { registerPush, type PushOptions } from "./push.ts";
import {
  buildTriage,
  dashboardFacets,
  filterDashboard,
  grouping,
  sortTickets,
  type CaseAnalysis,
} from "../../packages/domain/triage.ts";
export interface AppOptions {
  stores: Map<string, Store>;
  sources: Map<string, FileSource>;
  auth: Auth;
  publicDemo: boolean;
  secure: boolean;
  origin: string;
  qrLogin?: QrLogin;
  ai?: AnalysisService;
  staticDir?: string;
  itsmUrl?: string;
  jurySimulation?: SimulationOptions;
  push?: PushOptions;
}

function logCanvasAnswer(result: CanvasResult) {
  // An empty shift recommendation has no paging token even though it checked the queue.
  const checkedRows = !!result.selection || (result.mode === "snapshot" && result.intent.shiftAdvice);
  const selection = checkedRows ? (result.total > 0 ? "nonempty" : "empty") : "none";
  let kind = "notice";
  if (result.intent.brief && result.selection && result.conversation) kind = "brief";
  else if (result.conversation) kind = "prose";
  else if (result.answer) kind = "guide";
  else if (result.fact) kind = "fact";
  else if (result.selection) kind = "view";
  console.info(JSON.stringify({ event: "canvas.answer", mode: result.mode, kind, selection }));
}

const qrLoginPath = "/api/login/qr";

export async function createApp(o: AppOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 21 * 1024 * 1024,
    trustProxy: "127.0.0.1",
    requestTimeout: 20_000,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        // Relative assets stay on the current origin. Caddy owns HTTPS redirects;
        // forced upgrade breaks Safari's HTTP localhost and the read-only IP preview.
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  const demo = o.stores.has("demo")
    ? new Demo(o.stores.get("demo")!, o.sources.get("demo")!)
    : null;
  const clients = new Set<() => void>();
  const previews = new Map<
    string,
    { username: string; ns: string; text: string; expires: number }
  >();
  const identity = (req: any) => o.auth.get(req.cookies.wm_session);
  const jury = registerJurySimulation(
    app,
    o.publicDemo,
    o.jurySimulation,
    (req) => !!identity(req),
  );
  const db = [...o.stores.values()][0].db;
  const audit = (
    actor: string,
    action: string,
    namespace: string,
    detail: Record<string, unknown> = {},
  ) =>
    db.query(
      "INSERT INTO audit(at,actor,action,namespace,detail) VALUES($1,$2,$3,$4,$5)",
      [
        new Date().toISOString(),
        actor,
        action,
        namespace,
        JSON.stringify(detail),
      ],
    );
  const requireRole = (req: any, reply: any, roles: Role[]) => {
    const user = identity(req);
    if (!user) {
      reply.code(401).send({ message: "Требуется вход" });
      return null;
    }
    if (!roles.includes(user.role)) {
      reply.code(403).send({ message: "Недостаточно прав" });
      return null;
    }
    return user;
  };
  const storeFor = (req: any, reply: any) => {
    const ns = req.query?.ns ?? "demo";
    if (typeof ns !== "string" || !o.stores.has(ns)) {
      reply.code(404).send({ message: "Источник не найден" });
      return null;
    }
    return o.stores.get(ns)!;
  };
  const readStoreFor = async (req: any, reply: any) =>
    req.query?.ns === "simulation" ? jury.read(reply) : storeFor(req, reply);
  type ReadStore = NonNullable<Awaited<ReturnType<typeof readStoreFor>>>;
  type TriageSnapshot = {
    revision: number;
    rows: Map<string, Incident>;
    run: string;
  };
  const snapshots = new Map<string, TriageSnapshot[]>();
  const clusters = new LiveClusters(o.ai?.remote);
  function triageFor(s: TriageSnapshot, ns: string, q: Record<string, string>, now: number,
    rows: Incident[], generate = false, local = false) {
    const {groupBy, signal} = grouping(q);
    const classify = groupBy === "semantic"
      ? clusters.read(ns + "/" + s.run, s.rows, generate, local) : undefined;
    return buildTriage(rows, groupBy, s.revision, now, signal, classify);
  }
  const snapshotOf = (s: ReadStore): TriageSnapshot => ({
    revision: s.revision, rows: s.rows, run: "simulation" in s ? s.simulation.runId : "",
  });
  // Pin at most two previous displayed snapshots per source, sharing immutable
  // row objects with the store. Discard old runs on reset or simulation restart.
  function remember(s: ReadStore) {
    const run = "simulation" in s ? s.simulation.runId : "";
    let previous = snapshots.get(s.namespace) ?? [];
    if (
      previous[0] &&
      (previous[0].run !== run || previous[0].revision > s.revision)
    )
      previous = [];
    if (previous[0]?.rows !== s.rows)
      snapshots.set(s.namespace, [
        { revision: s.revision, rows: s.rows, run },
        ...previous.filter((p) => p.revision !== s.revision).slice(0, 2),
      ]);
  }
  for (const s of o.stores.values())
    s.on("reset", () => snapshots.delete(s.namespace));
  function trainingAnalysis(req: FastifyRequest) {
    const ns = (req.query as Record<string, string>).ns ?? "demo";
    return (
      o.publicDemo &&
      (ns === "simulation" || ns === "demo") &&
      req.method === "POST" &&
      (req.routeOptions.url === "/api/triage/:id/analysis" || req.routeOptions.url === "/api/canvas")
    );
  }
  async function readCase(req: FastifyRequest, reply: FastifyReply) {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const q = req.query as Record<string, string>;
    const id = (req.params as { id: string }).id;
    const { groupBy } = grouping(q);
    if (!/^\d+$/.test(q.revision ?? "") || !/^[a-f0-9]{64}$/.test(q.hash ?? ""))
      return void reply
        .code(400)
        .send({ message: "Для разбора укажите версию и хэш подборки." });
    remember(s);
    const version = snapshots
      .get(s.namespace)!
      .find((item) => item.revision === Number(q.revision));
    if (version) {
      const now = Date.now(), filtered = filterDashboard([...version.rows.values()], q, now);
      // A locally rendered group may have been opened just before a model
      // partition became available. Both drilldowns must refer to exact members.
      for (const local of groupBy === "semantic" ? [false,true] : [false]) {
        const triage = triageFor(version, s.namespace, q, now, filtered, false, local);
        const detail = triage.cases.find((c) => c.id === id && c.hash === q.hash);
        if (detail) return { s, detail, rows: triage.members.get(id)!, nextChangeAt: triage.nextChangeAt, groupBy,
          plan: !local && groupBy === "semantic" ? clusters.activePlan(version.rows) : undefined };
      }
    }
    reply.code(409).send({
      message: "Подборка изменилась. Откройте её из обновлённой очереди.",
      revision: s.revision,
    });
  }
  const juryReadRoutes = new Set([
    "/api/me",
    "/api/health",
    "/api/dashboard",
    "/api/canvas",
    "/api/canvas/tickets",
    "/api/triage/:id",
    "/api/incidents",
    "/api/incident/:id",
    "/api/incident/:id/itsm",
    "/api/notifications",
    "/api/export",
    "/api/stream",
    "/api/simulation/stream",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const route = req.routeOptions.url ?? "";
    const apiRequest = route.startsWith("/api/") || req.url.startsWith("/api/");
    if (
      apiRequest &&
      route !== "/api/login" &&
      !(req.method === "GET" && route === qrLoginPath) &&
      route !== "/api/me" &&
      !identity(req)
    )
      return reply.code(401).send({ message: "Требуется вход" });
    const ns = apiRequest ? (req.query as { ns?: unknown }).ns : undefined;
    if (ns !== undefined && typeof ns !== "string")
      return reply.code(400).send({ message: "Укажите один источник" });
    if (ns === "simulation") {
      if (!o.publicDemo)
        return reply.code(404).send({ message: "Учебный эфир отключён" });
      if (
        !trainingAnalysis(req) &&
        (!["GET", "HEAD"].includes(req.method) ||
          !juryReadRoutes.has(req.routeOptions.url ?? ""))
      )
        return reply
          .code(403)
          .send({ message: "Учебный источник доступен только для просмотра" });
      if (req.method === "HEAD" && req.routeOptions.url?.endsWith("/stream"))
        return reply.code(405).send();
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== o.origin) {
        reply.code(403).send({ message: "Недопустимый источник запроса" });
        return;
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        reply.code(403).send({ message: "Межсайтовый запрос запрещён" });
        return;
      }
      if (route !== "/api/login") {
        const user = identity(req);
        if (!user) {
          reply.code(401).send({ message: "Требуется вход" });
          return;
        }
        if (req.headers["x-csrf-token"] !== user.csrf) {
          reply.code(403).send({
            message: "Обновите страницу: проверка запроса не пройдена",
          });
          return;
        }
      }
    }
  });
  juryReadRoutes.add(
    registerDispatch(app, { db, identity, readStoreFor, requireRole, remote: o.ai?.remote }),
  );
  const canvas = new CanvasService(o.ai?.remote);
  app.get("/api/canvas", async (req, reply) => {
    const source = await readStoreFor(req, reply);
    if (source) return canvas.read(source, identity(req)!.username);
  });
  app.post(
    "/api/canvas",
    {
      bodyLimit: 16_384,
      config: { rateLimit: { max: 24, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (
        !trainingAnalysis(req) &&
        !requireRole(req, reply, ["coordinator", "demo-admin"])
      )
        return;
      const body = req.body as {
        question?: unknown;
        context?: unknown;
        refresh?: unknown;
        turnToken?: unknown;
      } | null;
      if (body?.turnToken !== undefined && (typeof body.turnToken !== "string" ||
          !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(body.turnToken)))
        return reply.code(400).send({ message: "Некорректная ссылка на реплику." });
      if (body?.context !== undefined && !validContext(body.context))
        return reply
          .code(400)
          .send({ message: "Некорректный контекст холста." });
      if (
        body?.refresh === true &&
        body.context &&
        body.question === undefined
      ) {
        const source = await readStoreFor(req, reply);
        if (source)
          return canvas.read(
            source,
            identity(req)!.username,
            undefined,
            body.context,
          );
        return;
      }
      if (
        body?.refresh !== undefined ||
        typeof body?.question !== "string" ||
        !body.question.trim() ||
        body.question.length > 500
      )
        return reply
          .code(400)
          .send({
            message:
              "Введите вопрос длиной до 500 символов или обновите существующий срез.",
          });
      const source = await readStoreFor(req, reply);
      if (!source) return;
      const result = await canvas.read(
        source,
        identity(req)!.username,
        body.question.trim(),
        body.context,
        body.turnToken,
      );
      logCanvasAnswer(result);
      return result;
    },
  );
  app.get("/api/canvas/tickets", async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    if (
      typeof q.selection !== "string" ||
      (q.group !== undefined && typeof q.group !== "string") ||
      (q.offset !== undefined &&
        (typeof q.offset !== "string" || !/^\d{1,8}$/u.test(q.offset)))
    )
      return reply
        .code(400)
        .send({ message: "Некорректный запрос списка заявок." });
    const simulation = q.ns === "simulation" ? await jury.read(reply) : undefined;
    if (q.ns === "simulation" && !simulation) return;
    const page = canvas.page(
      String(q.ns ?? "demo"),
      identity(req)!.username,
      q.selection,
      q.group,
      Number(q.offset ?? 0),
      simulation?.simulation.runId,
    );
    if (!page)
      return reply
        .code(409)
        .send({
          message: "Срок хранения этой подборки истёк. Обновите холст.",
        });
    return page;
  });
  const push =
    o.push &&
    registerPush(app, o.push, {
      db,
      auth: o.auth,
      stores: o.stores,
      secure: o.secure,
    });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number };
    reply.code(e.statusCode && e.statusCode < 500 ? e.statusCode : 400).send({
      message:
        e.statusCode === 429
          ? "Слишком много запросов. Повторите позже."
          : e.message.startsWith("FST_")
            ? "Некорректный запрос"
            : e.message.slice(0, 500),
    });
  });
  app.get("/api/health", async (req, reply) => {
    if ((req.query as any).ns === "simulation") {
      const s = await jury.read(reply);
      if (s)
        return {
          status: "ok",
          sources: [
            {
              namespace: s.namespace,
              revision: s.revision,
              state: s.status.state,
            },
          ],
        };
      return;
    }
    return {
      status: "ok",
      sources: [...o.stores].map(([namespace, s]) => ({
        namespace,
        revision: s.revision,
        state: s.status.state,
      })),
    };
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (req, reply) => {
    let database = true;
    try {
      await db.query("SELECT 1");
    } catch {
      database = false;
    }
    const sources = [...o.stores].map(([namespace, s]) => ({
      namespace,
      revision: s.revision,
      state: s.status.state,
    }));
    const ready = database && sources.every((s) => s.state === "live");
    return reply
      .code(ready ? 200 : 503)
      .send(
        identity(req)
          ? { status: ready ? "ready" : "degraded", database, sources }
          : { status: ready ? "ready" : "degraded" },
      );
  });
  app.get("/api/me", async (req) => {
    const u = identity(req);
    if (!u) return { user: null, sources: [] };
    return {
      user: {
        username: u.username,
        role: u.role,
        csrf: u.csrf,
        expiresInMs: Math.max(0, u.expires - Date.now()),
      },
      publicDemo: o.publicDemo,
      sources:
        (req.query as any).ns === "simulation"
          ? ["simulation"]
          : [...o.stores.keys()],
    };
  });
  const setSessionCookie = (reply: FastifyReply, token: string, maxAge: number) =>
    reply.setCookie("wm_session", token, {
      httpOnly: true,
      secure: o.secure,
      sameSite: "strict",
      path: "/",
      maxAge,
    });
  app.get(
    qrLoginPath,
    { exposeHeadRoute: false },
    async (req, reply) => {
      const authorization = req.headers.authorization;
      if (!o.qrLogin || !authorization?.startsWith("Bearer "))
        return reply.code(401).send({ message: "QR-ссылка недействительна или устарела" });
      if (identity(req)) return reply.code(204).send();

      const result = o.auth.loginWithQr(authorization.slice(7), o.qrLogin);
      if (!result)
        return reply.code(401).send({ message: "QR-ссылка недействительна или устарела" });

      await push?.login(req, result.session.username);
      setSessionCookie(reply, result.token, Math.ceil((result.session.expires - Date.now()) / 1000));
      return reply.code(204).send();
    },
  );
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = req.body as any;
      const result = o.auth.login(b?.username, b?.password);
      if (!result)
        return reply
          .code(401)
          .send({ message: "Неверное имя пользователя или пароль" });
      o.auth.logout(req.cookies.wm_session);
      await push?.login(req, result.session.username);
      setSessionCookie(reply, result.token, 8 * 3600);
      return {
        username: result.session.username,
        role: result.session.role,
        csrf: result.session.csrf,
      };
    },
  );
  app.post("/api/logout", async (req, reply) => {
    o.auth.logout(req.cookies.wm_session);
    await push?.logout(req, reply);
    reply.clearCookie("wm_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/dashboard", async (req, reply) => {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const q = req.query as Record<string, string>;
    const now = Date.now();
    const revision = s.revision,
      acceptedAt = s.acceptedAt;
    let status = structuredClone(s.status);
    const all = [...s.rows.values()];
    const { groupBy, signal } = grouping(q);
    const sort = q.sort || (groupBy === "response" || groupBy === "semantic" ? "response" : undefined);
    const filtered = sortTickets(filterDashboard(all, q, now), sort, now);
    remember(s);
    const groups = Object.fromEntries(
      GROUPS.map((g) => {
        const rows = filtered.filter((r) => r.groups.includes(g));
        const offset = Math.max(0, Number(q[g] ?? 0) || 0);
        return [
          g,
          {
            count: rows.length,
            unverified: rows.filter((r) => !r.sourcePresent).length,
            offset,
            items: q.register === "1" ? [] : rows.slice(offset, offset + 30).map(summarize),
          },
        ];
      }),
    );
    const relevant = filtered.filter((r) => r.groups.length);
    const allowGroups = identity(req)?.role !== "viewer" ||
      (o.publicDemo && (s.namespace === "simulation" || s.namespace === "demo"));
    const { members, ...triage } = triageFor(snapshotOf(s), s.namespace, q, now, relevant, allowGroups);
    let register;
    if (q.register === "1") {
      const selected = q.case ? members.get(q.case) ?? [] :
        signal === "all" ? relevant : relevant.filter(row => row.groups.includes(signal));
      if (q.case && q.sort) sortTickets(selected, q.sort, now);
      const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
      const limit = Math.max(1, Math.min(100, Math.floor(Number(q.limit) || 30)));
      register = { offset, total: selected.length, nextChangeAt: triage.nextChangeAt, items: selected.slice(offset, offset + limit).map(summarize) };
    }
    let notifications: any[] = [];
    try {
      notifications = await s.notifications(
        identity(req)?.username ?? "",
        0,
        revision,
      );
    } catch {
      status = {
        ...status,
        state: "error",
        error:
          "База данных недоступна. Показан последний снимок; уведомления временно недоступны.",
      };
    }
    const eligible = new Map<string, Incident>();
    const caseByKey = new Map<string, string>();
    for (const [caseId, tickets] of members)
      for (const ticket of tickets) {
        if (!ticket.sourcePresent) continue;
        eligible.set(ticket.id, ticket);
        caseByKey.set(ticket.key, caseId);
      }
    const tracking =
      ("simulation" in s ? eligible.get(s.simulation.currentId) : undefined) ??
      notifications.map((n) => eligible.get(n.id)).find(Boolean);
    const recentEvent = notifications.find((n) => n.revision === revision &&
      Date.parse(n.at) >= now - 15 * 60_000 && eligible.has(n.id));
    const active = "simulation" in s ? eligible.get(s.simulation.currentId)
      : recentEvent ? eligible.get(recentEvent.id) : undefined;
    const activeCase = active && triage.cases.find((c) => members.get(c.id)?.includes(active));
    return {
      revision,
      acceptedAt,
      register,
      ...(register ? {facets:dashboardFacets(all)} : {}),
      status,
      serverTime: new Date(now).toISOString(),
      namespace: s.namespace,
      ...("simulation" in s ? { simulation: s.simulation } : {}),
      unique: new Set(relevant.map((r) => r.key)).size,
      total: all.length,
      itsmMock: s.namespace === "simulation" || !o.itsmUrl,
      groups,
      triage: {
        ...triage,
        refining: groupBy === "semantic" && clusters.refining(s.rows),
        modelGuidance: !!o.ai?.remote,
        liveFocus: groupBy === "response" && triage.cases[0]
          ? { caseId: triage.cases[0].id, step: triage.cases[0].step }
          : activeCase && active
          ? { caseId: activeCase.id, step: liveStep(active, now, activeCase) }
          : null,
        tracking: tracking
          ? {
              id: tracking.id,
              header: String(tracking.raw.header ?? ""),
              groups: tracking.groups,
              revision: tracking.revision,
            }
          : (triage.cases[0]?.lead ?? null),
      },
      quality: {
        quarantined: all.filter((r) => r.quarantined).length,
        warnings: all.filter((r) => r.issues.length).length,
        missing: all.filter((r) => !r.sourcePresent).length,
      },
      events: notifications.slice(0, 20).map(note => ({...note, caseId: caseByKey.get(note.key) ?? null})),
      recent: notifications
        .filter(
          (n) =>
            n.reasons.includes("critical-resolved") &&
            Date.parse(n.at) > now - 15 * 60_000,
        )
        .slice(0, 20),
    };
  });
  app.get("/api/triage/:id", async (req, reply) => {
    const selection = await readCase(req, reply);
    if (!selection) return;
    const { detail, rows } = selection;
    const q = req.query as Record<string, string>;
    if (q.sort) sortTickets(rows, q.sort);
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(q.limit) || 30)));
    return {
      revision: detail.revision,
      hash: detail.hash,
      total: rows.length,
      offset,
      items: rows.slice(offset, offset + limit).map(summarize),
      nextOffset: offset + limit < rows.length ? offset + limit : null,
    };
  });
  const analyses = new Map<string, CaseAnalysis>();
  app.post(
    "/api/triage/:id/analysis",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (
        !trainingAnalysis(req) &&
        !requireRole(req, reply, ["coordinator", "demo-admin"])
      )
        return;
      const selection = await readCase(req, reply);
      if (!selection) return;
      const { s, detail, rows } = selection;
      const request = req.body as {
        purpose?: unknown; ticketId?: unknown; decisionKey?: unknown; runId?: unknown;
      } | null;
      if (request?.purpose !== undefined && request.purpose !== "liveStep")
        return reply.code(400).send({ message: "Неизвестный вид разбора." });
      if (request?.purpose === "liveStep") {
        const runId = "simulation" in s ? s.simulation.runId : "";
        const row = rows.find((r) => r.id === request.ticketId);
        if (!row || request.runId !== runId || typeof request.decisionKey !== "string")
          return reply.code(409).send({ message: "Совет уже изменился." });
        const now = Date.now();
        const step = liveStep(row, now, detail);
        const currentStep = () => {
          const store = s.namespace === "simulation" ? jury.latest() : s;
          if (!store || ("simulation" in store && store.simulation.runId !== runId))
            return false;
          const clock = Date.now();
          const q = req.query as Record<string, string>;
          const semantic = selection.groupBy === "semantic";
          if ((!semantic || clusters.activePlan(store.rows) === selection.plan) &&
            store.revision === detail.revision && store.rows.get(row.key)?.hash === row.hash &&
            store.rows.get(row.key)?.sourcePresent === row.sourcePresent &&
            (selection.nextChangeAt === null || clock < selection.nextChangeAt)) return true;
          const latest = triageFor(snapshotOf(store), store.namespace, q, clock, filterDashboard([...store.rows.values()], q, clock));
          const group = latest.cases.find((c) => c.id === detail.id);
          const target = latest.members.get(detail.id)?.find((r) => r.key === row.key);
          return !!group && !!target && (!semantic || group.hash === detail.hash) && liveStep(target, clock, group).key === step.key;
        };
        if (step.key !== request.decisionKey || !currentStep())
          return reply.code(409).send({ message: "Совет уже изменился." });
        const result = await refineLiveStep(o.ai?.remote, step, row, detail, now, () => !reply.raw.destroyed && currentStep());
        if (!currentStep())
          return reply.code(409).send({ message: "Совет уже изменился." });
        return result;
      }
      const question =
        (req.body as { question?: unknown } | null)?.question ?? "";
      if (typeof question !== "string" || question.length > 500)
        return reply
          .code(400)
          .send({ message: "Вопрос должен быть строкой до 500 символов." });
      const key = [
        s.namespace,
        detail.id,
        detail.hash,
        detail.overdue,
        detail.soon,
      ].join("/");
      let result =
        o.ai?.remote || question.trim() ? undefined : analyses.get(key);
      if (!result) {
        result = await analyzeCase(detail, rows, o.ai, s.namespace, question);
        if (result.mode === "model" && !o.ai?.remote) {
          analyses.set(key, result);
          if (analyses.size > 96)
            analyses.delete(analyses.keys().next().value!);
        }
      }
      const current = s.namespace === "simulation" ? jury.latest() : s;
      let stale = !current;
      if (
        current &&
        ((req.query as Record<string,string>).groupBy === "semantic" || current.revision !== detail.revision ||
          ("simulation" in s &&
            "simulation" in current &&
            s.simulation.runId !== current.simulation.runId))
      ) {
        const q = req.query as Record<string, string>;
        const clock = Date.now();
        const live = triageFor(snapshotOf(current), current.namespace, q, clock, filterDashboard([...current.rows.values()], q, clock));
        stale = !live.cases.some(
          (c) => c.id === detail.id && c.hash === detail.hash,
        );
      }
      return { ...result, inputRevision: detail.revision, stale };
    },
  );
  app.get("/api/incidents", async (req, reply) => {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const q = req.query as any;
    const rows = [...s.rows.values()].filter((r) =>
      q.quality
        ? r.issues.length || !r.sourcePresent
        : q.history
          ? [7, 10].includes(r.stateId!)
          : true,
    );
    const offset = Math.max(0, Number(q.offset) || 0);
    return {
      revision: s.revision,
      total: rows.length,
      items: rows.slice(offset, offset + 50).map(summarize),
    };
  });
  app.get("/api/incident/:id/itsm", async (req, reply) => {
    const source = await readStoreFor(req, reply);
    if (!source) return;
    const id = (req.params as { id: string }).id;
    if (![...source.rows.values()].some((row) => row.id === id))
      return reply.code(404).send({ message: "Инцидент не найден" });
    const base = source.namespace === "simulation" ? undefined : o.itsmUrl;
    const url = safeItsm(id, base);
    const path =
      source.namespace === "simulation"
        ? "/simulation" + url
        : !base && source.namespace !== "demo"
          ? url + "?ns=" + encodeURIComponent(source.namespace)
          : url;
    return reply.redirect(path);
  });
  app.get("/api/incident/:id", async (req, reply) => {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const id = (req.params as any).id;
    const r = [...s.rows.values()].find((r) => r.id === id);
    if (!r) return reply.code(404).send({ message: "Инцидент не найден" });
    const itsmUrl = s.namespace === "simulation" ? undefined : o.itsmUrl;
    return {
      incident: r,
      history: await s.history(r.key, r.revision),
      itsm: safeItsm(r.id, itsmUrl),
      itsmMock: !itsmUrl,
    };
  });
  app.get("/api/notifications", async (req, reply) => {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const q = req.query as Record<string, string>;
    const revision = q.revision === undefined ? s.revision : Number(q.revision);
    const offset = Number(q.offset ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(offset) || offset < 0)
      return reply.code(400).send({message: "Некорректная страница журнала."});
    if (revision > s.revision)
      return reply.code(409).send({message: "Источник был сброшен. Откройте первую страницу журнала."});
    const username = identity(req)!.username;
    const [items, counts] = await Promise.all([
      s.notifications(username, 0, revision, offset, true),
      s.notificationCounts(username, revision),
    ]);
    return { revision, offset, items, ...counts, nextOffset: offset + items.length < counts.total ? offset + 200 : null };
  });
  app.post("/api/notifications/read", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const s = storeFor(req, reply);
    if (!s) return;
    const b = req.body as any;
    if (Number.isSafeInteger(b?.throughRevision) && b.throughRevision >= 0 && b.throughRevision <= s.revision && b.key === undefined) {
      await s.markReadThrough(u.username, b.throughRevision);
    } else {
      if (!Number.isSafeInteger(b?.revision) || b.revision < 1 || b.revision > s.revision || typeof b?.key !== "string" || b.throughRevision !== undefined)
        return reply.code(400).send({ message: "Некорректная отметка" });
      if (!await s.markRead(u.username, b.revision, b.key))
        return reply.code(404).send({message: "Событие отсутствует в этом журнале."});
    }
    return { ok: true };
  });
  app.get("/api/preferences", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const result = await db.query("SELECT doc FROM preferences WHERE username=$1", [u.username]);
    return { ...defaultPreferences, ...result.rows[0]?.doc };
  });
  app.post("/api/preferences", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const b = req.body as any;
    if (
      !["Europe/Moscow", "UTC"].includes(b?.zone) ||
      typeof b.sound !== "boolean" ||
      typeof b.notifications !== "boolean" ||
      (b.wallboardOrder !== undefined && !wallboardOrders.includes(b.wallboardOrder)) ||
      (b.wallboardSeconds !== undefined && !wallboardIntervals.includes(b.wallboardSeconds))
    )
      return reply.code(400).send({ message: "Некорректные настройки" });
    const doc = {
      zone: b.zone,
      sound: b.sound,
      notifications: b.notifications,
      ...(b.wallboardOrder !== undefined && { wallboardOrder: b.wallboardOrder }),
      ...(b.wallboardSeconds !== undefined && { wallboardSeconds: b.wallboardSeconds }),
    };
    await audit(u.username, "preferences", "account", doc);
    const result = await db.query(
      "INSERT INTO preferences(username,doc) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET doc=preferences.doc || excluded.doc RETURNING doc",
      [u.username, JSON.stringify(doc)],
    );
    return { ...defaultPreferences, ...result.rows[0].doc };
  });
  app.post("/api/intake", { bodyLimit: intakeByteLimit }, async (req, reply) => {
    const user = requireRole(req, reply, ["demo-admin"]);
    if (!user) return;
    const store = storeFor(req, reply);
    if (!store) return;
    if (store.namespace !== "demo" && store.namespace !== "workspace")
      return reply.code(403).send({ message: "Для приёма нужна рабочая копия или демоисточник." });
    const source = o.sources.get(store.namespace);
    if (!source) return reply.code(503).send({ message: "Источник недоступен." });
    try {
      const receipt = await appendIncidents(source, req.body, o.publicDemo);
      await audit(user.username, "incident-intake", store.namespace, {
        revision: receipt.revision, added: receipt.added.length, existing: receipt.existing.length,
      });
      return receipt;
    } catch (error) {
      if (error instanceof IntakeError)
        return reply.code(error.statusCode).send({ message: error.message });
      return reply.code(503).send({ message: "Не удалось подтвердить приём. Проверьте состояние источника и повторите отправку." });
    }
  });
  app.post("/api/import/preview", async (req, reply) => {
    const u = requireRole(req, reply, ["demo-admin"]);
    if (!u) return;
    const s = storeFor(req, reply);
    if (!s) return;
    const text = (req.body as any)?.text;
    if (typeof text !== "string")
      return reply.code(400).send({ message: "Передайте JSON-файл" });
    const p = parseSnapshot(text, s.namespace);
    if (
      o.publicDemo &&
      s.namespace === "demo" &&
      p.rows.some((r) => !r.id.startsWith("DEMO-"))
    )
      return reply.code(400).send({
        message:
          "Публичный DEMO принимает только синтетику с ID DEMO-. Для оригинала выберите приватную рабочую копию.",
      });
    for (const [k, v] of previews)
      if (v.expires < Date.now()) previews.delete(k);
    if (previews.size > 20)
      return reply
        .code(429)
        .send({ message: "Слишком много ожидающих импортов" });
    const token = randomUUID();
    previews.set(token, {
      username: u.username,
      ns: s.namespace,
      text,
      expires: Date.now() + 300_000,
    });
    return {
      token,
      count: p.rows.length,
      issues: p.issues.slice(0, 100),
      issueCount: p.issues.length,
      hash: p.hash,
    };
  });
  app.post("/api/import/commit", async (req, reply) => {
    const u = requireRole(req, reply, ["demo-admin"]);
    if (!u) return;
    const s = storeFor(req, reply);
    if (!s) return;
    const token = (req.body as any)?.token,
      p = previews.get(token);
    if (
      !p ||
      p.username !== u.username ||
      p.ns !== s.namespace ||
      p.expires < Date.now()
    )
      return reply
        .code(400)
        .send({ message: "Предпросмотр устарел; выберите файл заново" });
    if (s.namespace === "original")
      return reply.code(403).send({
        message:
          "Оригинал доступен только для чтения; используйте рабочую копию",
      });
    await audit(u.username, "import-attempt", s.namespace, {
      previousRevision: s.revision,
    });
    await o.sources
      .get(s.namespace)!
      .exclusive(() => atomicWrite(o.sources.get(s.namespace)!.path, p.text));
    if (s.status.state !== "live")
      return reply.code(503).send({
        message:
          "Рабочий файл записан, но ещё не принят. Проверьте состояние источника; показана предыдущая версия.",
      });
    await audit(u.username, "import-accepted", s.namespace, {
      revision: s.revision,
    });
    previews.delete(token);
    return { ok: true, revision: s.revision };
  });
  app.get("/api/export", async (req, reply) => {
    const s = await readStoreFor(req, reply);
    if (!s) return;
    const normalized = (req.query as any).mode === "normalized";
    reply
      .header(
        "Content-Disposition",
        `attachment; filename="watermelon-${s.namespace}-${normalized ? "normalized" : "raw"}.json"`,
      )
      .type("application/json");
    return JSON.stringify(
      [...s.rows.values()]
        .filter((r) => r.sourcePresent)
        .map((r) =>
          normalized
            ? { ...r.raw, ...r.dates, priority: r.priorityLabel }
            : r.raw,
        ),
      null,
      2,
    );
  });
  app.get("/api/demo", async (req, reply) => {
    if (!requireRole(req, reply, ["demo-admin"])) return;
    return {
      playing: demo?.playing,
      step: demo?.stepIndex,
      clock: demo?.clock,
    };
  });
  app.post("/api/demo", async (req, reply) => {
    const u = requireRole(req, reply, ["demo-admin"]);
    if (!u) return;
    if (!demo)
      return reply
        .code(404)
        .send({ message: "Демонстрационный источник отсутствует" });
    const b = req.body as any;
    await audit(u.username, "demo-attempt", "demo", {
      action: String(b?.action).slice(0, 32),
      previousRevision: o.stores.get("demo")?.revision,
    });
    if (b?.action === "edit") await demo.edit(b.key, b.state);
    else await demo.action(b?.action);
    return { playing: demo.playing, step: demo.stepIndex, clock: demo.clock };
  });
  app.post(
    "/api/analysis/selection",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (!requireRole(req, reply, ["coordinator", "demo-admin"])) return;
      const s = storeFor(req, reply);
      if (!s) return;
      const b = req.body as {
        ids?: unknown;
        question?: unknown;
        zone?: unknown;
      } | null;
      if (
        !Array.isArray(b?.ids) ||
        !b.ids.length ||
        b.ids.length > 6 ||
        !b.ids.every(
          (id) => typeof id === "string" && id.length > 0 && id.length <= 200,
        ) ||
        typeof b.question !== "string" ||
        !b.question.trim() ||
        b.question.length > 500 ||
        (b.zone !== undefined && b.zone !== "Europe/Moscow" && b.zone !== "UTC")
      )
        return reply
          .code(400)
          .send({ message: "Нужны 1–6 заявок и вопрос до 500 символов." });
      const ids = [...new Set<string>(b.ids)];
      const byId = new Map([...s.rows.values()].map((row) => [row.id, row]));
      const rows = ids.flatMap((id) => byId.get(id) ?? []);
      if (rows.length !== ids.length)
        return reply
          .code(404)
          .send({ message: "Заявка отсутствует в выбранном источнике." });
      return analyzeSelection(
        rows,
        (row) => s.rows.get(row.key),
        s.namespace,
        b.question,
        b.zone ?? "Europe/Moscow",
        o.ai?.remote,
      );
    },
  );
  app.post(
    "/api/analysis/:id",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      if (!requireRole(req, reply, ["coordinator", "demo-admin"])) return;
      const s = storeFor(req, reply);
      if (!s) return;
      const r = [...s.rows.values()].find(
        (r) => r.id === (req.params as any).id,
      );
      if (!r) return reply.code(404).send({ message: "Инцидент не найден" });
      if (!o.ai)
        return reply
          .code(503)
          .send({ message: "Модель недоступна. Основные данные доступны." });
      const question =
        (req.body as { question?: unknown } | null)?.question ?? "";
      if (typeof question !== "string" || question.length > 500)
        return reply
          .code(400)
          .send({ message: "Вопрос должен быть строкой до 500 символов." });
      const history = await s.history(r.key);
      return o.ai.analyze(
        r,
        () => s.rows.get(r.key)!,
        history[0]?.kind === "updated" ? history[0].changed : [],
        s.namespace,
        question,
      );
    },
  );
  app.get("/api/stream", async (req, reply) => {
    if ((req.query as any).ns === "simulation")
      return jury.stream(req, reply, "dashboard");
    const s = storeFor(req, reply);
    if (!s) return;
    if (clients.size >= 100)
      return reply
        .code(503)
        .send({ message: "Поток перегружен; используется опрос" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: any, id?: number) => {
      if (!identity(req)) {
        reply.raw.end();
        return;
      }
      if (!reply.raw.destroyed)
        reply.raw.write(
          `${id !== undefined ? "id: " + id + "\n" : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        );
    };
    const cursor = Number(
      req.headers["last-event-id"] ?? (req.query as any).cursor ?? 0,
    );
    send(
      cursor === s.revision ? "ready" : "resync",
      {
        revision: s.revision,
        reason: cursor > s.revision ? "server-reset" : "snapshot-required",
      },
      s.revision,
    );
    const onRevision = (d: any) => send("revision", d, d.revision),
      onStatus = (d: any) => send("status", d),
      onReset = () => send("resync", { revision: 0, reason: "demo-reset" }, 0);
    s.on("revision", onRevision);
    s.on("status", onStatus);
    s.on("reset", onReset);
    const heartbeat = setInterval(
      () =>
        send("heartbeat", {
          revision: s.revision,
          at: new Date().toISOString(),
        }),
      10_000,
    );
    const close = () => {
      clearInterval(heartbeat);
      s.off("revision", onRevision);
      s.off("status", onStatus);
      s.off("reset", onReset);
      clients.delete(close);
      reply.raw.end();
    };
    clients.add(close);
    req.raw.on("close", close);
  });
  app.addHook("preClose", async () => {
    demo?.pause();
    for (const close of clients) close();
  });
  const root = o.staticDir ?? resolve("dist/web");
  if (existsSync(root)) {
    await app.register(staticFiles, { root, cacheControl: false });
    app.setNotFoundHandler((req, reply) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/"))
        return reply.code(404).send({ message: "Маршрут не найден" });
      if (
        url.pathname.startsWith("/assets/") ||
        !["GET", "HEAD"].includes(req.method)
      )
        return reply.code(404).send();
      if (url.pathname !== "/" && url.pathname !== "/login" && !identity(req)) {
        const next = new URLSearchParams({ next: url.pathname + url.search });
        return reply.redirect("/login?" + next, 303);
      }
      return reply.sendFile("index.html");
    });
  }
  return app;
}
function summarize(r: Incident) {
  const { raw, ...rest } = r;
  return {
    ...rest,
    raw: Object.fromEntries(
      [
        "header",
        "productName",
        "assignedEmployee",
        "isNeedUp",
        "isMaster",
        "isDouble",
        "isEffect",
        "isReason",
        "serviceType",
        "serviceTypeId",
      ].map((k) => [k, raw[k]]),
    ),
  };
}
