import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { Auth, passwordHash } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";
import { generate } from "../packages/domain/generator.ts";
import { FIELDS } from "../packages/domain/index.ts";
test("F23 F24 F33 F34 import preview/commit/raw roundtrip and server role/CSRF enforcement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wm-api-")),
    db = await openDB(":memory:");
  const store = await new Store(db, "demo").load(),
    path = join(dir, "incidents.json"),
    source = new FileSource(store, path),
    auth = new Auth();
  const password = randomBytes(24).toString("hex");
  for (const role of ["viewer", "coordinator", "demo-admin"] as const) {
    const salt = randomBytes(16).toString("hex");
    auth.users.push({
      username: role,
      role,
      salt,
      hash: passwordHash(password, salt),
    });
  }
  const app = await createApp({
    stores: new Map([["demo", store]]),
    sources: new Map([["demo", source]]),
    auth,
    publicDemo: true,
    secure: false,
    origin: "http://localhost",
  });
  try {
    await writeFile(path, "[]");
    await source.tick();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/demo",
          payload: { action: "reset" },
        })
      ).statusCode,
      401,
    );
    for (const role of ["viewer", "coordinator", "demo-admin"]) {
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        payload: { username: role, password },
      });
      assert.equal(login.statusCode, 200);
      const cookie = login.cookies[0];
      assert.ok(cookie.httpOnly);
      assert.equal(cookie.sameSite, "Strict");
      const headers = {
        cookie: `wm_session=${cookie.value}`,
        "x-csrf-token": login.json().csrf,
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/demo",
            headers: { cookie: headers.cookie },
            payload: { action: "pause" },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/demo",
            headers: { ...headers, origin: "https://attacker.invalid" },
            payload: { action: "pause" },
          })
        ).statusCode,
        403,
      );
      if (role !== "demo-admin") {
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/import/preview",
              headers,
              payload: { text: "[]" },
            })
          ).statusCode,
          403,
        );
        continue;
      }
      for (const text of ["{", "{}", "[null]"])
        assert.equal(
          (
            await app.inject({
              method: "POST",
              url: "/api/import/preview",
              headers,
              payload: { text },
            })
          ).statusCode,
          400,
        );
      const rows = generate(120).rows;
      const preview = await app.inject({
        method: "POST",
        url: "/api/import/preview",
        headers,
        payload: { text: JSON.stringify(rows) },
      });
      assert.equal(preview.statusCode, 200);
      assert.equal(store.rows.size, 0);
      const result = await app.inject({
        method: "POST",
        url: "/api/import/commit",
        headers,
        payload: { token: preview.json().token },
      });
      assert.equal(result.statusCode, 200);
      assert.equal(store.rows.size, 120);
      const exported = await app.inject("/api/export");
      assert.deepEqual(exported.json(), rows);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), rows);
      const preview2 = await app.inject({
        method: "POST",
        url: "/api/import/preview",
        headers,
        payload: { text: exported.body },
      });
      await app.inject({
        method: "POST",
        url: "/api/import/commit",
        headers,
        payload: { token: preview2.json().token },
      });
      assert.equal(store.revision, 2);
    }
  } finally {
    await app.close();
    await source.stop();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("F17 every one of 46 raw fields produces persisted revision with exact value", async () => {
  const db = await openDB(":memory:");
  try {
    const store = await new Store(db, "fields").load(),
      rows = generate(1).rows;
    await store.ingest(JSON.stringify(rows));
    let rev = 1;
    for (const field of FIELDS) {
      if (field === "sysId" || field === "id") {
        const separate = generate(1, field === "id" ? 43 : 44).rows;
        await new Store(db, field).load().then(async (s) => {
          await s.ingest(JSON.stringify(separate));
          const raw = structuredClone(separate);
          raw[0][field] = String(raw[0][field]) + "X";
          if (field === "sysId") raw[0].id += "-new";
          await s.ingest(JSON.stringify(raw));
          assert.ok(
            [...s.rows.values()].some((r) => r.raw[field] === raw[0][field]),
          );
        });
        continue;
      }
      const raw = rows[0],
        old = raw[field];
      raw[field] =
        typeof old === "boolean"
          ? !old
          : typeof old === "number"
            ? old + 1
            : typeof old === "string"
              ? old + " · изменено"
              : "Новая информация";
      await store.ingest(JSON.stringify(rows));
      assert.equal(store.revision, ++rev, field);
      assert.equal([...store.rows.values()][0].raw[field], raw[field], field);
      const history = await store.history([...store.rows.keys()][0]);
      assert.ok(history[0].changed.includes(field), field);
    }
  } finally {
    await db.close();
  }
});
