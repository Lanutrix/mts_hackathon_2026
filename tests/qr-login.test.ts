import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../apps/server/db.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { Auth, loadQrLoginConfig, passwordHash } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";

test("a QR link signs in separate browsers as the configured account until the link expires", async (t) => {
  const db = await openDB(":memory:");
  t.after(() => db.close());
  const store = await new Store(db, "workspace").load();
  const auth = new Auth();
  const token = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  const password = "test-password";
  const hash = passwordHash(password, salt);
  auth.users = [
    { username: "Жюри", role: "coordinator", salt, hash },
    { username: "observer", role: "viewer", salt, hash },
  ];
  const options = {
    stores: new Map([["workspace", store]]),
    sources: new Map(),
    auth,
    publicDemo: false,
    secure: true,
    origin: "https://example.test",
  };
  const qrLogin = {
    username: "Жюри",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expires: Date.now() + 60_000,
  };
  const app = await createApp({ ...options, qrLogin });
  const disabled = await createApp(options);
  t.after(async () => {
    await app.close();
    await disabled.close();
  });

  const redeem = (code: string, cookie?: string) => app.inject({
    method: "GET",
    url: "/api/login/qr",
    headers: { authorization: "Bearer " + code, ...(cookie ? { cookie } : {}) },
  });

  const first = await redeem(token);
  assert.equal(first.statusCode, 204);
  assert.equal(first.headers["cache-control"], "no-store");
  const cookie = first.cookies[0];
  assert.equal(cookie.name, "wm_session");
  assert.ok(cookie.httpOnly && cookie.secure);
  assert.equal(cookie.sameSite, "Strict");
  assert.ok(cookie.maxAge! > 0 && cookie.maxAge! <= 60);
  const sessionCookie = "wm_session=" + cookie.value;
  const me = await app.inject({ url: "/api/me", headers: { cookie: sessionCookie } });
  assert.equal(me.json().user.username, "Жюри");
  assert.equal(me.json().user.role, "coordinator");
  assert.ok(me.json().user.csrf);
  const second = await redeem(token);
  assert.equal(second.statusCode, 204);
  assert.notEqual(second.cookies[0].value, cookie.value);

  for (const code of ["", randomBytes(32).toString("base64url")]) {
    const response = await redeem(code);
    assert.equal(response.statusCode, 401);
    assert.equal(response.cookies.length, 0);
  }
  const disabledResponse = await disabled.inject({
    url: "/api/login/qr", headers: { authorization: "Bearer " + token },
  });
  assert.equal(disabledResponse.statusCode, 401);
  assert.equal(disabledResponse.cookies.length, 0);

  const operator = await app.inject({
    method: "POST",
    url: "/api/login",
    payload: { username: "observer", password },
  });
  assert.equal(operator.statusCode, 200);
  const operatorCookie = "wm_session=" + operator.cookies[0].value;
  const current = await redeem(token, operatorCookie);
  assert.equal(current.statusCode, 204);
  assert.equal(current.cookies.length, 0);
  const operatorMe = await app.inject({
    url: "/api/me", headers: { cookie: operatorCookie },
  });
  assert.equal(operatorMe.json().user.role, "viewer");
  assert.equal(auth.loginWithQr(token, { ...qrLogin, expires: Date.now() - 1 }), null);
  assert.equal(auth.loginWithQr(token, { ...qrLogin, username: "unknown" }), null);
});

test("a seven-day QR link does not extend an individual session past eight hours", () => {
  const auth = new Auth();
  const token = randomBytes(32).toString("base64url");
  auth.users.push({ username: "test-coordinator", role: "coordinator", salt: "", hash: "" });
  const result = auth.loginWithQr(token, {
    username: "test-coordinator",
    tokenHash: auth.digest(token),
    expires: Date.now() + 7 * 24 * 3600_000,
  });
  assert.ok(result);
  assert.ok(result.session.expires - Date.now() <= 8 * 3600_000);
});

test("an active release renews a stale entry for the same account and preserves a different active account", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wm-release-qr-"));
  const localPath = join(dir, "local.json");
  const releasePath = join(dir, "release.json");
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = Date.now();
  const release = { username: "test-coordinator", tokenHash: "a".repeat(64), expires: now + 604_800_000 };
  const stale = { ...release, expires: now - 1 };
  await writeFile(releasePath, JSON.stringify(release));
  assert.deepEqual(await loadQrLoginConfig(localPath, releasePath), release);
  await writeFile(localPath, JSON.stringify(stale));
  assert.deepEqual(await loadQrLoginConfig(localPath, releasePath), release);
  assert.deepEqual(await loadQrLoginConfig(localPath), stale);

  const other = { username: "other", tokenHash: "b".repeat(64), expires: now + 60_000 };
  await writeFile(localPath, JSON.stringify(other));
  assert.deepEqual(await loadQrLoginConfig(localPath, releasePath), other);
  await writeFile(releasePath, JSON.stringify(stale));
  assert.deepEqual(await loadQrLoginConfig(localPath, releasePath), other);
});
