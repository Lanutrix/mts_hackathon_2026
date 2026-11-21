import Fastify from "fastify";
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
import { registerJurySimulation } from "./jurySimulation.ts";
import type { AnalysisService } from "./analysis.ts";
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
    if (!identity(req) && (!o.publicDemo || ns !== "demo")) {
      reply.code(401).send({ message: "Для этого источника требуется вход" });
      return null;
    }
    return o.stores.get(ns)!;
  };
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== o.origin) {
        reply.code(403).send({ message: "Недопустимый источник запроса" });
        return;
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        reply.code(403).send({ message: "Межсайтовый запрос запрещён" });
        return;
      }
      if (req.url.split("?")[0] !== "/api/login") {
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
  app.get("/api/health", async () => ({
    status: "ok",
    sources: [...o.stores].map(([namespace, s]) => ({
      namespace,
      revision: s.revision,
      state: s.status.state,
    })),
  }));
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
      .send({ status: ready ? "ready" : "degraded", database, sources });
  });
  app.get("/api/me", async (req) => {
    const u = identity(req);
    return {
      user: u ? { username: u.username, role: u.role, csrf: u.csrf } : null,
      publicDemo: o.publicDemo,
      sources: [...o.stores.keys()].filter(
        (n) => u || (n === "demo" && o.publicDemo),
      ),
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
    reply.clearCookie("wm_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/dashboard", async (req, reply) => {
    const s = storeFor(req, reply);
    if (!s) return;
    const q = req.query as Record<string, string>;
    const now = Date.now();
    const revision = s.revision,
      acceptedAt = s.acceptedAt;
    let status = structuredClone(s.status);
    const all = [...s.rows.values()],
      search = (q.q ?? "").toLocaleLowerCase("ru").slice(0, 300);
    const filtered = all.filter(
      (r) =>
        (!search ||
          [
            r.id,
            r.raw.header,
            r.raw.productName,
            r.team,
            r.raw.assignedEmployee,
          ]
            .join(" ")
            .toLocaleLowerCase("ru")
            .includes(search)) &&
        (!q.service || String(r.raw.serviceTypeId) === q.service) &&
        (!q.up || r.raw.isNeedUp === true),
    );
    filtered.sort((a, b) =>
      q.sort === "registered"
        ? String(b.dates.submitDate).localeCompare(String(a.dates.submitDate))
        : q.sort === "id"
          ? a.id.localeCompare(b.id)
          : (Date.parse(a.dates.deadline ?? "") || Infinity) -
              (Date.parse(b.dates.deadline ?? "") || Infinity) ||
            a.id.localeCompare(b.id),
    );
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
    return {
      revision,
      acceptedAt,
      status,
      serverTime: new Date(now).toISOString(),
      namespace: s.namespace,
      unique: new Set(relevant.map((r) => r.key)).size,
      total: all.length,
      groups,
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
  app.get("/api/incidents", async (req, reply) => {
    const s = storeFor(req, reply);
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
    const s = storeFor(req, reply);
    if (!s) return;
    const id = (req.params as any).id;
    const r = [...s.rows.values()].find((r) => r.id === id);
    if (!r) return reply.code(404).send({ message: "Инцидент не найден" });
    return {
      incident: r,
      history: await s.history(r.key, r.revision),
      itsm: safeItsm(r.id, o.itsmUrl),
      itsmMock: !o.itsmUrl,
    };
  });
  app.get("/api/notifications", async (req, reply) => {
    const s = storeFor(req, reply);
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
      return reply
        .code(400)
        .send({
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
      return reply
        .code(503)
        .send({
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
    const s = storeFor(req, reply);
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
    "/api/analysis/:id",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
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
      const history = await s.history(r.key);
      return o.ai.analyze(
        r,
        () => s.rows.get(r.key)!,
        history[0]?.kind === "updated" ? history[0].changed : [],
      );
    },
  );
  registerJurySimulation(app, o.publicDemo);
  app.get("/api/stream", async (req, reply) => {
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
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ message: "Маршрут не найден" })
        : reply.sendFile("index.html"),
    );
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
