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
import { Auth, type Role } from "./auth.ts";
import { Store, FileSource } from "../worker/ingestion.ts";
import { Demo, atomicWrite } from "./demo.ts";
import {
  registerJurySimulation,
  type SimulationOptions,
} from "./jurySimulation.ts";
import type { AnalysisService } from "./analysis.ts";
import { analyzeCase } from "./caseAnalysis.ts";
import { analyzeSelection } from "./operationalAnalysis.ts";
import { CanvasService } from "./canvas.ts";
import { validContext } from "./canvasPlan.ts";
import { registerDispatch } from "./dispatch.ts";
import { registerPush, type PushOptions } from "./push.ts";
import {
  buildTriage,
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
  ai?: AnalysisService;
  staticDir?: string;
  itsmUrl?: string;
  jurySimulation?: SimulationOptions;
  push?: PushOptions;
}
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
    const { groupBy, signal } = grouping(q);
    if (!/^\d+$/.test(q.revision ?? "") || !/^[a-f0-9]{64}$/.test(q.hash ?? ""))
      return void reply
        .code(400)
        .send({ message: "Для разбора укажите версию и хэш подборки." });
    remember(s);
    const version = snapshots
      .get(s.namespace)!
      .find((item) => item.revision === Number(q.revision));
    if (version) {
      const triage = buildTriage(
        filterDashboard([...version.rows.values()], q),
        groupBy,
        version.revision,
        Date.now(),
        signal,
      );
      const detail = triage.cases.find((c) => c.id === id && c.hash === q.hash);
      if (detail) return { s, detail, rows: triage.members.get(id)! };
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
    registerDispatch(app, { db, identity, readStoreFor, requireRole }),
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
      } | null;
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
      if (source)
        return canvas.read(
          source,
          identity(req)!.username,
          body.question.trim(),
          body.context,
        );
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
    const page = canvas.page(
      String(q.ns ?? "demo"),
      identity(req)!.username,
      q.selection,
      q.group,
      Number(q.offset ?? 0),
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
      reply.setCookie("wm_session", result.token, {
        httpOnly: true,
        secure: o.secure,
        sameSite: "strict",
        path: "/",
        maxAge: 8 * 3600,
      });
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
    const filtered = sortTickets(filterDashboard(all, q), q.sort);
    remember(s);
    const { groupBy, signal } = grouping(q);
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
            items: rows.slice(offset, offset + 30).map(summarize),
          },
        ];
      }),
    );
    const relevant = filtered.filter((r) => r.groups.length);
    const { members, ...triage } = buildTriage(
      relevant,
      groupBy,
      revision,
      now,
      signal,
    );
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
    for (const tickets of members.values())
      for (const ticket of tickets)
        if (ticket.sourcePresent) eligible.set(ticket.id, ticket);
    const tracking =
      ("simulation" in s ? eligible.get(s.simulation.currentId) : undefined) ??
      notifications.map((n) => eligible.get(n.id)).find(Boolean);
    return {
      revision,
      acceptedAt,
      status,
      serverTime: new Date(now).toISOString(),
      namespace: s.namespace,
      ...("simulation" in s ? { simulation: s.simulation } : {}),
      unique: new Set(relevant.map((r) => r.key)).size,
      total: all.length,
      groups,
      triage: {
        ...triage,
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
      events: notifications.slice(0, 20),
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
        (current.revision !== detail.revision ||
          ("simulation" in s &&
            "simulation" in current &&
            s.simulation.runId !== current.simulation.runId))
      ) {
        const q = req.query as Record<string, string>;
        const { groupBy, signal } = grouping(q);
        const live = buildTriage(
          filterDashboard([...current.rows.values()], q),
          groupBy,
          current.revision,
          Date.now(),
          signal,
        );
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
    const revision = s.revision,
      offset = Math.max(0, Math.floor(Number((req.query as any).offset) || 0));
    const items = await s.notifications(
      identity(req)?.username ?? "",
      0,
      revision,
      offset,
    );
    return {
      revision,
      offset,
      items,
      nextOffset: items.length === 200 ? offset + 200 : null,
    };
  });
  app.post("/api/notifications/read", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const s = storeFor(req, reply);
    if (!s) return;
    const b = req.body as any;
    if (!Number.isInteger(b?.revision) || typeof b?.key !== "string")
      return reply.code(400).send({ message: "Некорректная отметка" });
    await s.markRead(u.username, b.revision, b.key);
    return { ok: true };
  });
  app.get("/api/preferences", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const db = [...o.stores.values()][0].db;
    return (
      (
        await db.query("SELECT doc FROM preferences WHERE username=$1", [
          u.username,
        ])
      ).rows[0]?.doc ?? {
        sound: false,
        notifications: false,
        zone: "Europe/Moscow",
      }
    );
  });
  app.post("/api/preferences", async (req, reply) => {
    const u = requireRole(req, reply, ["coordinator", "demo-admin"]);
    if (!u) return;
    const b = req.body as any;
    if (
      !["Europe/Moscow", "UTC"].includes(b?.zone) ||
      typeof b.sound !== "boolean" ||
      typeof b.notifications !== "boolean"
    )
      return reply.code(400).send({ message: "Некорректные настройки" });
    const doc = {
      zone: b.zone,
      sound: b.sound,
      notifications: b.notifications,
    };
    await audit(u.username, "preferences", "account", {
      zone: doc.zone,
      sound: doc.sound,
      notifications: doc.notifications,
    });
    await [...o.stores.values()][0].db.query(
      "INSERT INTO preferences(username,doc) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET doc=excluded.doc",
      [u.username, JSON.stringify(doc)],
    );
    return doc;
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
