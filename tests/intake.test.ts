import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../apps/server/api.ts";
import { Auth, passwordHash, type Role } from "../apps/server/auth.ts";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";

test("intake appends atomically and preserves file, history and namespace boundaries", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "srez-intake-"));
  const db = await openDB(":memory:");
  const stores = new Map<string, Store>();
  const sources = new Map<string, FileSource>();
  const auth = new Auth();
  const [original, first, second, third, fourth, fifth] = generate(6).rows;
  for (const ns of ["demo", "workspace", "original"]) {
    const store = await new Store(db, ns).load();
    const source = new FileSource(store, join(dir, ns + ".json"));
    const initialText =
      ns === "workspace"
        ? "[\n  " +
          JSON.stringify(original).replace(
            /}$/,
            ',"externalSequence":9007199254740993}',
          ) +
          "\n]\n"
        : JSON.stringify([original]);
    await writeFile(source.path, initialText);
    await source.tick();
    stores.set(ns, store);
    sources.set(ns, source);
  }
  const app = await createApp({
    stores,
    sources,
    auth,
    publicDemo: true,
    secure: false,
    origin: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    for (const source of sources.values()) await source.stop();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  });
  function session(role: Role) {
    const password = randomBytes(20).toString("hex");
    const salt = randomBytes(16).toString("hex");
    auth.users.push({
      username: role,
      role,
      salt,
      hash: passwordHash(password, salt),
    });
    const login = auth.login(role, password)!;
    return {
      cookie: "wm_session=" + login.token,
      "x-csrf-token": login.session.csrf,
    };
  }
  const admin = session("demo-admin");
  const post = (
    payload: object,
    ns = "workspace",
    headers: Record<string, string> = admin,
  ) =>
    app.inject({
      method: "POST",
      url: "/api/intake?ns=" + ns,
      payload: JSON.stringify(payload),
      headers: { ...headers, "content-type": "application/json" },
    });
  const read = async (ns = "workspace") =>
    JSON.parse(await readFile(sources.get(ns)!.path, "utf8"));
  const store = stores.get("workspace")!;
  const firstReceipt = await post(first);
  assert.equal(firstReceipt.statusCode, 200, firstReceipt.body);
  assert.deepEqual(firstReceipt.json(), {
    namespace: "workspace",
    revision: 2,
    added: [first.id],
    existing: [],
  });
  const batch = await post([first, second, second]);
  assert.equal(batch.statusCode, 200, batch.body);
  assert.deepEqual(batch.json(), {
    namespace: "workspace",
    revision: 3,
    added: [second.id],
    existing: [first.id, second.id],
  });
  const originalInWorkspace = {
    ...original,
    externalSequence: Number("9007199254740993"),
  };
  assert.deepEqual(await read(), [originalInWorkspace, first, second]);
  assert.ok(
    (await readFile(sources.get("workspace")!.path, "utf8")).includes(
      '"externalSequence":9007199254740993}',
    ),
  );
  const retry = await post([first, second]);
  assert.deepEqual(retry.json(), {
    namespace: "workspace",
    revision: 3,
    added: [],
    existing: [first.id, second.id],
  });
  assert.equal(
    (
      await store.history(
        [...store.rows.values()].find((r) => r.id === first.id)!.key,
      )
    ).length,
    1,
  );
  const conflicts: Record<string, unknown>[] = [
    { ...first, header: "конфликт" },
    { ...first, sysId: null },
    { ...first, id: "Другой-ID" },
  ];
  for (const bad of conflicts) {
    const reject = await post([third, bad]);
    assert.equal(reject.statusCode, 409);
    assert.match(reject.json().message, /2/);
    assert.ok(reject.json().message.includes(String(bad.id)));
  }
  const invalid = await post([third, { ...fourth, stateEnum: "?" }]);
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json().message, /2.*stateEnum/);
  const inBatchConflict = await post([third, { ...third, header: "другой" }]);
  assert.equal(inBatchConflict.statusCode, 409);
  assert.deepEqual(await read(), [originalInWorkspace, first, second]);
  assert.equal(store.revision, 3);
  const beforeFailure = await readFile(sources.get("workspace")!.path, "utf8");
  const databaseFailure = t.mock.method(
    db,
    "transaction",
    async () => {
      throw new Error("temporary database outage");
    },
    { times: 1 },
  );
  assert.equal((await post(third)).statusCode, 503);
  databaseFailure.mock.restore();
  assert.equal(
    await readFile(sources.get("workspace")!.path, "utf8"),
    beforeFailure,
  );
  assert.equal(store.revision, 3);
  const concurrent = await Promise.all([post([third, fourth]), post(fifth)]);
  assert.ok(concurrent.every((r) => r.statusCode === 200));
  assert.deepEqual(
    new Set((await read()).map((r: any) => r.id)),
    new Set([original, first, second, third, fourth, fifth].map((r) => r.id)),
  );
  const externalFile = JSON.stringify([original, first]);
  await writeFile(sources.get("workspace")!.path, externalFile);
  assert.equal(
    (await post({ ...fifth, id: "NEW", sysId: "new" })).statusCode,
    409,
  );
  assert.equal(
    await readFile(sources.get("workspace")!.path, "utf8"),
    externalFile,
  );
  assert.equal((await post(second)).statusCode, 409);
  assert.deepEqual(await read(), [original, first]);
  assert.equal((await post(first, "workspace", {})).statusCode, 401);
  for (const headers of [
    session("viewer"),
    session("coordinator"),
    { cookie: admin.cookie },
  ])
    assert.equal((await post(first, "workspace", headers)).statusCode, 403);
  for (const ns of ["original", "simulation"])
    assert.equal((await post(first, ns)).statusCode, 403);
  assert.equal(
    (await post({ ...first, id: "REAL-ID" }, "demo")).statusCode,
    400,
  );
  assert.deepEqual(await read("demo"), [original]);
  assert.deepEqual(await read("original"), [original]);
});
