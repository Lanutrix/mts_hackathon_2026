import {
  createECDH,
  createHash,
  ECDH,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateVAPIDKeys,
  sendNotification,
  type PushSubscription,
  type VapidKeys,
} from "web-push";
import type { Auth } from "./auth.ts";
import type { DB } from "./db.ts";
import type { Store } from "../worker/ingestion.ts";

const year = 365 * 24 * 3600_000;
const deviceCookie = "srez_push_device";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function loadVapid(dataDir: string): Promise<VapidKeys> {
  const dir = join(dataDir, "secrets"),
    path = join(dir, "web-push.json");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const temp = join(dir, ".web-push-" + randomUUID());
    await writeFile(temp, JSON.stringify(generateVAPIDKeys()), {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await link(temp, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      await unlink(temp);
    }
    content = await readFile(path, "utf8");
  }
  const keys: VapidKeys = JSON.parse(content);
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(Buffer.from(keys.privateKey, "base64url"));
  if (curve.getPublicKey().toString("base64url") !== keys.publicKey)
    throw new Error("Пара ключей Web Push повреждена");
  return keys;
}

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.href !== value ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return false;
  const host = url.hostname;
  return (
    (host === "fcm.googleapis.com" &&
      /^\/(fcm\/send|wp)\/.+/.test(url.pathname)) ||
    (host === "updates.push.services.mozilla.com" &&
      url.pathname.startsWith("/wpush/")) ||
    (host.endsWith(".push.apple.com") && url.pathname.length > 1) ||
    host.endsWith(".notify.windows.com")
  );
}

function parseSubscription(value: unknown) {
  const sub = value as
    | (Partial<PushSubscription> & { expirationTime?: unknown })
    | null;
  if (
    !sub ||
    !validEndpoint(sub.endpoint) ||
    typeof sub.keys?.p256dh !== "string" ||
    typeof sub.keys.auth !== "string"
  )
    return null;
  const { p256dh, auth } = sub.keys;
  if (!/^[\w-]{87}$/.test(p256dh) || !/^[\w-]{22}$/.test(auth)) return null;
  try {
    const key = Buffer.from(p256dh, "base64url");
    if (
      key[0] !== 4 ||
      key.toString("base64url") !== p256dh ||
      Buffer.from(auth, "base64url").toString("base64url") !== auth
    )
      return null;
    ECDH.convertKey(key, "prime256v1");
  } catch {
    return null;
  }
  const expiry = sub.expirationTime ?? Date.now() + year;
  if (
    typeof expiry !== "number" ||
    !Number.isSafeInteger(expiry) ||
    expiry <= Date.now()
  )
    return null;
  return {
    subscription: { endpoint: sub.endpoint, keys: { p256dh, auth } },
    expires: Math.min(expiry, Date.now() + year),
  };
}

export type PushOptions = {
  dataDir: string;
  subject: string;
  send?: typeof sendNotification;
};
type Device = {
  device: string;
  username: string;
  namespace: string;
  endpoint_hash: string;
  subscription: PushSubscription;
  version: string;
};
type Context = {
  db: DB;
  auth: Auth;
  stores: Map<string, Store>;
  secure: boolean;
};
export function registerPush(
  app: FastifyInstance,
  options: PushOptions,
  { db, auth, stores, secure }: Context,
) {
  let keyPromise: Promise<VapidKeys> | undefined;
  const keys = () =>
    (keyPromise ??= loadVapid(options.dataDir).catch(() => {
      keyPromise = undefined;
      throw new Error("Ключи Web Push недоступны");
    }));
  function deviceId(req: FastifyRequest, reply?: FastifyReply) {
    let token = req.cookies[deviceCookie];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      if (!reply) return null;
      token = randomBytes(32).toString("hex");
      reply.setCookie(deviceCookie, token, {
        secure,
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: year / 1000,
      });
    }
    return digest(token);
  }
  const session = (req: FastifyRequest) => auth.get(req.cookies.wm_session);
  const denied = (reply: FastifyReply) =>
    reply.code(401).send({ message: "Требуется вход" });
  app.get("/api/push/device", async (req, reply) => {
    const user = session(req);
    if (!user) return denied(reply);
    const { rows } = await db.query<Device>(
      "SELECT namespace,endpoint_hash,version FROM push_devices WHERE device=$1 AND username=$2 AND expires_at>$3",
      [deviceId(req, reply), user.username, Date.now()],
    );
    const sources = [...stores.keys()].filter((ns) =>
      ["demo", "workspace", "original"].includes(ns),
    );
    return {
      publicKey: (await keys()).publicKey,
      namespace: rows[0]?.namespace ?? null,
      binding: rows[0]?.version ?? null,
      endpointHash: rows[0]?.endpoint_hash ?? null,
      sources,
    };
  });
  const limits = {
    bodyLimit: 4096,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  };
  app.post("/api/push/device", limits, async (req, reply) => {
    const user = session(req);
    if (!user) return denied(reply);
    const id = deviceId(req);
    if (!id)
      return reply
        .code(409)
        .send({ message: "Обновите настройки этого устройства" });
    const body = req.body as {
      namespace?: unknown;
      subscription?: unknown;
      previousHash?: unknown;
    } | null;
    const ns = body?.namespace;
    const data = parseSubscription(body?.subscription);
    if (
      !data ||
      typeof ns !== "string" ||
      !stores.has(ns) ||
      !["workspace", "demo", "original"].includes(ns)
    )
      return reply
        .code(400)
        .send({
          message: "Браузер передал неподдерживаемую подписку или источник",
        });
    const hash = digest(data.subscription.endpoint);
    await keys();
    return db.transaction(async (tx) => {
      // Enrolments are rare. Serialize ownership and quota checks across connections.
      await tx.query("LOCK TABLE push_devices IN SHARE ROW EXCLUSIVE MODE");
      if (session(req)?.csrf !== user.csrf) return denied(reply);
      await tx.query("DELETE FROM push_devices WHERE expires_at <= $1", [
        Date.now(),
      ]);
      const { rows } = await tx.query<Device>(
        "SELECT device,username,endpoint_hash,namespace FROM push_devices WHERE device=$1 OR endpoint_hash=$2",
        [id, hash],
      );
      if (
        rows.some((r) => r.device !== id || r.username !== user.username) ||
        (body?.previousHash !== undefined &&
          rows[0]?.endpoint_hash !== body.previousHash)
      )
        return reply
          .code(409)
          .send({
            message: "Подписка устройства изменилась. Обновите настройки.",
          });
      const count = await tx.query(
        "SELECT COUNT(*) AS n FROM push_devices WHERE username=$1",
        [user.username],
      );
      if (!rows.length && Number(count.rows[0].n) >= 8)
        return reply
          .code(429)
          .send({ message: "Доступно восемь устройств на учётную запись" });
      await tx.query(
        `INSERT INTO push_devices(device,username,endpoint_hash,subscription,namespace,version,since_revision,expires_at,next_at)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE((SELECT revision FROM watermarks WHERE namespace=$5),0),$7,0)
        ON CONFLICT(device) DO UPDATE SET endpoint_hash=excluded.endpoint_hash,subscription=excluded.subscription,namespace=excluded.namespace,
          version=excluded.version,expires_at=excluded.expires_at,since_revision=CASE WHEN push_devices.namespace=excluded.namespace THEN push_devices.since_revision ELSE excluded.since_revision END`,
        [
          id,
          user.username,
          hash,
          JSON.stringify(data.subscription),
          ns,
          randomUUID(),
          data.expires,
        ],
      );
      return { enabled: true };
    });
  });
  app.delete("/api/push/device", limits, async (req, reply) => {
    const user = session(req);
    if (!user) return denied(reply);
    await db.query("DELETE FROM push_devices WHERE device=$1 AND username=$2", [
      deviceId(req),
      user.username,
    ]);
    return { enabled: false };
  });

  const send = options.send ?? sendNotification;
  async function transmit(
    device: Device,
    data: Record<string, unknown>,
    topic: string,
  ) {
    return send(
      device.subscription,
      JSON.stringify({ ...data, binding: device.version }),
      {
        vapidDetails: { ...(await keys()), subject: options.subject },
        TTL: 120,
        urgency: "normal",
        topic,
        timeout: 5000,
      },
    );
  }
  app.post(
    "/api/push/device/test",
    {
      bodyLimit: 256,
      config: {
        rateLimit: {
          max: 4,
          timeWindow: "1 hour",
          keyGenerator: (req) => session(req)?.username ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const user = session(req);
      if (!user) return denied(reply);
      const now = Date.now();
      const { rows } = await db.query<Device>(
        `UPDATE push_devices SET test_after=$3 WHERE device=$1 AND username=$2
      AND expires_at>$4 AND test_after<=$4 RETURNING *`,
        [deviceId(req), user.username, now + 60_000, now],
      );
      if (!rows.length)
        return reply
          .code(409)
          .send({
            message:
              "Включите уведомления на этом устройстве или повторите проверку через минуту.",
          });
      const device = rows[0];
      try {
        await transmit(
          device,
          { kind: "test", namespace: device.namespace },
          "srez-device-test",
        );
        return { accepted: true };
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await db.query("DELETE FROM push_devices WHERE version=$1", [
            device.version,
          ]);
          return reply
            .code(410)
            .send({
              message: "Срок подписки истёк. Включите уведомления повторно.",
            });
        }
        return reply
          .code(503)
          .send({
            message: "Служба доставки недоступна. Повторите проверку позже.",
          });
      }
    },
  );
  let running: Promise<void> | null = null;
  let stopped = false;
  async function deliver(r: Device & { revision: number; ids: string[] }) {
    if (stopped) return;
    if (
      !auth.users.some((u) => u.username === r.username) ||
      !stores.has(r.namespace) ||
      !validEndpoint(r.subscription.endpoint)
    ) {
      await db.query("DELETE FROM push_devices WHERE version=$1", [r.version]);
      return;
    }
    // Claim just before delivery. Logout, resubscription and concurrent wake-ups invalidate stale candidates.
    const now = Date.now();
    const claim = await db.query(
      "UPDATE push_devices SET next_at=$2 WHERE version=$1 AND next_at<=$3 AND expires_at>$3 RETURNING device",
      [r.version, now + 60_000, now],
    );
    if (!claim.rows.length) return;
    const incident =
      r.ids.length === 1 &&
      /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,119}$/.test(r.ids[0])
        ? r.ids[0]
        : null;
    try {
      await transmit(r, { namespace: r.namespace, incident }, "srez-incidents");
      await db.query(
        "UPDATE push_devices SET since_revision=$2 WHERE version=$1",
        [r.version, r.revision],
      );
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410)
        await db.query("DELETE FROM push_devices WHERE version=$1", [
          r.version,
        ]);
      else
        app.log.warn(
          { statusCode: code },
          "Служба Web Push не подтвердила доставку",
        );
    }
  }
  async function batch() {
    const now = Date.now();
    await db.query("DELETE FROM push_devices WHERE expires_at<=$1", [now]);
    const due = await db.query<Device & { revision: number; ids: string[] }>(
      `SELECT d.*, n.revision, n.ids
      FROM push_devices d CROSS JOIN LATERAL (
        SELECT max(revision) AS revision, array_agg(id) AS ids FROM (
          SELECT revision,id FROM notifications WHERE namespace=d.namespace AND revision>d.since_revision AND at >= $2
          ORDER BY revision DESC,key LIMIT 2
        ) AS latest
      ) AS n WHERE d.next_at<=$1 AND n.revision IS NOT NULL ORDER BY d.next_at,d.device LIMIT 12`,
      [now, new Date(now - 5 * 60_000).toISOString()],
    );
    for (let i = 0; i < due.rows.length && !stopped; i += 3)
      await Promise.all(due.rows.slice(i, i + 3).map(deliver));
  }
  function flush() {
    if (!running && !stopped)
      running = batch()
        .catch(() => app.log.warn("Проверка очереди Web Push отложена"))
        .finally(() => {
          running = null;
        });
    return running;
  }
  const timer = setInterval(flush, 10_000);
  timer.unref();
  for (const store of stores.values()) store.on("notifications", flush);
  app.addHook("onClose", async () => {
    stopped = true;
    clearInterval(timer);
    for (const store of stores.values()) store.off("notifications", flush);
    await running;
  });
  return {
    async login(req: FastifyRequest, username: string) {
      await db.query(
        "DELETE FROM push_devices WHERE device=$1 AND username<>$2",
        [deviceId(req), username],
      );
    },
    async logout(req: FastifyRequest, reply: FastifyReply) {
      await db.query("DELETE FROM push_devices WHERE device=$1", [
        deviceId(req),
      ]);
      reply.clearCookie(deviceCookie, { path: "/" });
    },
  };
}
