import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { generateRequestDetails, type PushSubscription } from "web-push";
import { createApp } from "../apps/server/api.ts";
import { Auth, passwordHash } from "../apps/server/auth.ts";
import { openDB } from "../apps/server/db.ts";
import { loadVapid, type PushOptions } from "../apps/server/push.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";

function subscription(token: string): PushSubscription {
  const curve = createECDH("prime256v1");
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/" + token,
    keys: {
      p256dh: curve.generateKeys().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(25);
  }
  assert.fail("Timed out waiting for push delivery state");
}

test("VAPID credentials survive concurrent initialization and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "srez-vapid-"));
  try {
    const all = await Promise.all([
      loadVapid(dir),
      loadVapid(dir),
      loadVapid(dir),
    ]);
    assert.deepEqual(all[0], all[1]);
    assert.deepEqual(all[1], all[2]);
    assert.deepEqual(await loadVapid(dir), all[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("authenticated device subscriptions deliver accepted transitions, bound retries and revoke on shared devices", async () => {
  const dir = await mkdtemp(join(tmpdir(), "srez-push-"));
  const db = await openDB(join(dir, "db"));
  const store = await new Store(db, "workspace").load();
  const auth = new Auth(),
    password = randomBytes(24).toString("hex");
  for (const username of ["one", "two"]) {
    const salt = randomBytes(16).toString("hex");
    auth.users.push({
      username,
      role: "viewer",
      salt,
      hash: passwordHash(password, salt),
    });
  }
  const sent: string[] = [];
  let upstreamStatus = 201;
  const push: PushOptions = {
    dataDir: dir,
    subject: "https://example.org",
    send: async (sub, data, options) => {
      assert.equal(typeof data, "string");
      const encrypted = generateRequestDetails(sub, String(data), options);
      assert.equal(encrypted.headers["Content-Encoding"], "aes128gcm");
      assert.ok(encrypted.headers.Authorization);
      assert.ok(
        encrypted.body && !encrypted.body.includes(Buffer.from(String(data))),
      );
      sent.push(String(data));
      if (upstreamStatus !== 201)
        throw Object.assign(new Error("push failure"), {
          statusCode: upstreamStatus,
        });
      return { statusCode: 201, headers: {}, body: "" };
    },
  };
  const makeApp = () =>
    createApp({
      auth,
      stores: new Map([["workspace", store]]),
      sources: new Map(),
      origin: "https://example.org",
      publicDemo: false,
      secure: true,
      push,
    });
  let app = await makeApp();
  async function login(username: string, device = "") {
    const r = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { cookie: device },
      payload: { username, password },
    });
    assert.equal(r.statusCode, 200);
    const cookie =
      "wm_session=" + r.cookies.find((c) => c.name === "wm_session")!.value;
    const result = await app.inject({
      url: "/api/push/device",
      headers: { cookie: cookie + "; " + device },
    });
    assert.equal(result.statusCode, 200);
    const newDevice = result.cookies.find((c) => c.name === "srez_push_device");
    if (newDevice) {
      assert.ok(newDevice.httpOnly && newDevice.secure);
      device = newDevice.name + "=" + newDevice.value;
    }
    return {
      cookie: cookie + "; " + device,
      "x-csrf-token": r.json().csrf as string,
    };
  }
  const save = (
    headers: Record<string, string>,
    sub: unknown,
    namespace = "workspace",
  ) =>
    app.inject({
      method: "POST",
      url: "/api/push/device",
      headers,
      payload: { namespace, subscription: sub },
    });
  const deviceCount = async () =>
    Number(
      (await db.query("SELECT COUNT(*) AS n FROM push_devices")).rows[0].n,
    );
  try {
    const url = "/api/push/device";
    assert.equal((await app.inject(url)).statusCode, 401);
    const a = await login("one"),
      b = await login("two");
    const sub = subscription("endpoint-a");
    assert.equal((await save({ cookie: a.cookie }, sub)).statusCode, 403);
    assert.equal(
      (await save(a, { ...sub, endpoint: "https://example.invalid/path" }))
        .statusCode,
      400,
    );
    assert.equal(
      (await save(a, { ...sub, expirationTime: 1 })).statusCode,
      400,
    );
    assert.equal(
      (await save(a, { ...sub, keys: { ...sub.keys, auth: "INVALID" } }))
        .statusCode,
      400,
    );
    assert.equal((await save(a, sub, "simulation")).statusCode, 400);
    const raw = generate(1).rows;
    Object.assign(raw[0], {
      priorityId: 2,
      priority: "Средний",
      header: "PRIVATE INCIDENT TEXT",
    });
    await store.ingest(JSON.stringify(raw));
    assert.equal((await save(a, sub)).statusCode, 200);
    assert.equal((await save(b, sub)).statusCode, 409);
    assert.equal(
      (await app.inject({ url, headers: b })).json().namespace,
      null,
    );
    await app.inject({ url, method: "DELETE", headers: b });
    assert.equal(await deviceCount(), 1);
    const config = (await app.inject({ url, headers: a })).json();
    assert.equal(config.namespace, "workspace");
    assert.ok(config.binding);
    assert.ok(!JSON.stringify(config).includes("endpoint-a"));
    await app.close();
    app = await makeApp();
    assert.equal(
      (await app.inject({ url, headers: a })).json().binding,
      config.binding,
    );
    raw[0].header = "ANOTHER PRIVATE HEADER";
    await store.ingest(JSON.stringify(raw));
    assert.equal(sent.length, 0);
    Object.assign(raw[0], { priorityId: 4, priority: "Наивысший" });
    await store.ingest(JSON.stringify(raw));
    await eventually(async () => sent.length === 1);
    assert.deepEqual(JSON.parse(sent[0]), {
      namespace: "workspace",
      incident: raw[0].id,
      binding: config.binding,
    });
    await eventually(
      async () =>
        Number(
          (await db.query("SELECT since_revision FROM push_devices")).rows[0]
            .since_revision,
        ) === store.revision,
    );
    await store.ingest(JSON.stringify(raw));
    Object.assign(raw[0], { stateId: 7, stateEnum: "Resolved" });
    await store.ingest(JSON.stringify(raw));
    await delay(50);
    assert.equal(sent.length, 1);
    upstreamStatus = 410;
    await db.query("UPDATE push_devices SET next_at=0");
    store.emit("notifications");
    await eventually(async () => (await deviceCount()) === 0);
    assert.equal(sent.length, 2);
    assert.equal((await save(a, sub)).statusCode, 200);
    const cookie = a.cookie.split("; ")[1];
    const switched = await login("two", cookie);
    assert.equal(await deviceCount(), 0);
    assert.equal(
      (await save(switched, subscription("new-account"))).statusCode,
      200,
    );
    const otherDevice = await login("two");
    assert.equal(
      (await save(otherDevice, subscription("other-device"))).statusCode,
      200,
    );
    const testUrl = "/api/push/device/test";
    upstreamStatus = 201;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: testUrl,
          headers: { cookie: otherDevice.cookie },
        })
      ).statusCode,
      403,
    );
    const probe = await app.inject({
      method: "POST",
      url: testUrl,
      headers: otherDevice,
    });
    assert.equal(probe.statusCode, 200);
    assert.ok(probe.json().accepted);
    assert.equal(JSON.parse(sent.at(-1)!).kind, "test");
    assert.equal(
      (await app.inject({ method: "POST", url: testUrl, headers: otherDevice }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/logout",
          headers: switched,
        })
      ).statusCode,
      200,
    );
    assert.equal(await deviceCount(), 1);
    assert.equal(
      (await app.inject({ url, headers: otherDevice })).json().namespace,
      "workspace",
    );
    assert.equal(
      (await app.inject({ method: "DELETE", url, headers: otherDevice }))
        .statusCode,
      200,
    );
    assert.equal(await deviceCount(), 0);
  } finally {
    await app.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
