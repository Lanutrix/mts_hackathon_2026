import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { openDB } from "../apps/server/db.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { Auth, passwordHash } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";

test("a QR link signs in separate browsers as a viewer until the link expires", async (t) => {
  const db = await openDB(":memory:");
  t.after(() => db.close());
  const store = await new Store(db, "workspace").load();
  const auth = new Auth();
  const secret = randomBytes(32).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const password = "test-password";
  const hash = passwordHash(password, salt);
  auth.users = [
    { username: "Жюри", role: "viewer", salt, hash },
    { username: "operator", role: "coordinator", salt, hash },
  ];
  const options = {
    stores: new Map([["workspace", store]]),
    sources: new Map(),
    auth,
    publicDemo: false,
    secure: true,
    origin: "https://example.test",
  };
  const app = await createApp({ ...options, qrLoginSecret: secret });
  const disabled = await createApp(options);
  t.after(async () => {
    await app.close();
    await disabled.close();
  });

  function sign(username: string, expiry: number) {
    const payload = expiry + "." + Buffer.from(username).toString("base64url");
    return payload + "." + createHmac("sha256", Buffer.from(secret, "hex"))
      .update(payload).digest("base64url");
  }
  const now = Math.floor(Date.now() / 1000);
  const token = sign("Жюри", now + 60);
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
  assert.equal(me.json().user.role, "viewer");
  assert.ok(me.json().user.csrf);
  const second = await redeem(token);
  assert.equal(second.statusCode, 204);
  assert.notEqual(second.cookies[0].value, cookie.value);

  for (const code of [
    "",
    token.replace(/[^.]+$/, "A".repeat(43)),
    sign("Жюри", now - 1),
    sign("Жюри", now + 9 * 3600),
    sign("operator", now + 60),
    sign("unknown", now + 60),
  ]) {
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
    payload: { username: "operator", password },
  });
  assert.equal(operator.statusCode, 200);
  const operatorCookie = "wm_session=" + operator.cookies[0].value;
  const current = await redeem(token, operatorCookie);
  assert.equal(current.statusCode, 204);
  assert.equal(current.cookies.length, 0);
  const operatorMe = await app.inject({
    url: "/api/me", headers: { cookie: operatorCookie },
  });
  assert.equal(operatorMe.json().user.role, "coordinator");
});
