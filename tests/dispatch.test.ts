import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/api.ts";
import { Auth, passwordHash } from "../apps/server/auth.ts";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";

test("coordinator dispatch uses scoped evidence, requires confirmation versions and persists one attributed decision per request", async (t) => {
  const db = await openDB(":memory:");
  const stores = new Map<string, Store>(),
    sources = new Map<string, FileSource>();
  const rows = generate(5).rows;
  const base = {
    productName: "Банк",
    header: "Ошибка при входе",
    assignedGroupName: "Команда входа",
    assignedEmployee: "Анна",
    assignedEmployeeLogin: "anna",
  };
  rows.forEach((r) => Object.assign(r, base));
  Object.assign(rows[0], {
    assignedGroupName: "Координаторы",
    assignedEmployee: null,
    assignedEmployeeLogin: null,
  });
  Object.assign(rows[3], {
    assignedGroupName: "Сеть",
    header: "Рост времени ответа",
    assignedEmployee: "Иван",
    assignedEmployeeLogin: "ivan",
  });
  Object.assign(rows[4], { productName: "Связь" });
  for (const ns of ["demo", "original", "workspace"]) {
    const store = new Store(db, ns);
    stores.set(ns, store);
    sources.set(ns, new FileSource(store, ns));
    await store.ingest(
      JSON.stringify(
        ns === "demo"
          ? rows
          : rows.map((r) => ({ ...r, assignedGroupName: "Приватная группа" })),
      ),
    );
  }
  const auth = new Auth();
  const password = randomUUID();
  for (const role of ["viewer", "coordinator", "demo-admin"] as const)
    auth.users.push({
      role,
      username: role,
      salt: role,
      hash: passwordHash(password, role),
    });
  const app = await createApp({
    auth,
    stores,
    sources,
    origin: "http://localhost",
    publicDemo: true,
    secure: false,
  });
  t.after(async () => {
    await app.close();
    await db.close();
  });
  const session = (name: string) => {
    const login = auth.login(name, password)!;
    return {
      cookie: "wm_session=" + login.token,
      "x-csrf-token": login.session.csrf,
    };
  };
  const writer = session("coordinator"),
    admin = session("demo-admin"),
    viewer = session("viewer");
  const path = "/api/incident/" + rows[0].id + "/dispatch";
  const get = async (headers = {}, ns = "demo") =>
    app.inject({ method: "GET", url: path + "?ns=" + ns, headers });
  const post = async (payload: object, headers = {}, ns = "demo") =>
    app.inject({ method: "POST", url: path + "?ns=" + ns, headers, payload });
  const result = await get(writer);
  assert.equal(result.statusCode, 200);
  const view = result.json();
  const best = view.teams.find((team: any) => team.name === "Команда входа");
  assert.equal(view.recommended, best.name);
  assert.deepEqual([best.both, best.product, best.symptom], [2, 2, 3]);
  assert.equal(best.members[0].label, "Анна (anna)");
  assert.ok(!result.body.includes("Приватная группа"));
  assert.ok(
    !view.teams.find((team: any) => team.name === "Координаторы").product,
  );
  const payload = {
    requestId: randomUUID(),
    snapshot: view.snapshot,
    expectedVersion: 0,
    team: best.name,
    member: best.members[0].id,
    note: "Сверить журнал авторизации",
  };
  for (const ns of ["original", "workspace"])
    assert.equal((await get({}, ns)).statusCode, 401);
  assert.equal((await post(payload)).statusCode, 401);
  assert.equal((await post(payload, viewer)).statusCode, 403);
  assert.equal(
    (await post(payload, { cookie: writer.cookie })).statusCode,
    403,
  );
  assert.equal(
    (await post(payload, { ...writer, origin: "https://outside.invalid" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/incident/" + rows[1].id + "/dispatch",
        headers: writer,
        payload,
      })
    ).statusCode,
    409,
  );
  assert.equal((await post(payload, admin, "original")).statusCode, 403);
  assert.equal((await post(payload, admin, "simulation")).statusCode, 403);
  assert.equal(
    (await post({ ...payload, team: "Сеть" }, writer)).statusCode,
    400,
  );
  const [first, repeat] = await Promise.all([
    post(payload, writer),
    post(payload, writer),
  ]);
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json(), repeat.json());
  assert.equal(first.json().decision.version, 1);
  assert.equal(first.json().decision.actor, "coordinator");
  assert.equal(
    (await post({ ...payload, note: "Подмена" }, writer)).statusCode,
    409,
  );
  assert.equal(
    (await post({ ...payload, requestId: randomUUID() }, admin)).statusCode,
    409,
  );
  const saved = (await get(admin)).json();
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].note, payload.note);
  assert.equal(saved.history[0].member, "Анна (anna)");
  const second = await post(
    { ...payload, expectedVersion: 1, requestId: randomUUID(), member: null },
    admin,
  );
  assert.equal(second.json().decision.version, 2);
  for (const headers of [{}, viewer]) {
    const publicView = (await get(headers)).json();
    assert.equal(publicView.canSave, false);
    assert.equal(publicView.history.length, 0);
    assert.ok(publicView.teams.every((team: any) => team.members.length === 0));
    assert.ok(!JSON.stringify(publicView).includes(payload.note));
  }
  const ws = (await get(admin, "workspace")).json();
  assert.equal(ws.history.length, 0);
  assert.equal(ws.recommended, "Приватная группа");
  assert.equal(
    (
      await post(
        {
          ...payload,
          requestId: randomUUID(),
          snapshot: ws.snapshot,
          team: ws.recommended,
          member: null,
        },
        admin,
        "workspace",
      )
    ).statusCode,
    200,
  );
  rows[1].header = "Информация изменилась";
  await stores.get("demo")!.ingest(JSON.stringify(rows));
  assert.equal(
    (
      await post(
        { ...payload, requestId: randomUUID(), expectedVersion: 2 },
        writer,
      )
    ).statusCode,
    409,
  );
  assert.equal((await post(payload, writer)).json().decision.version, 1);
  assert.equal(
    (await app.inject("/api/export?ns=demo")).json()[0].assignedGroupName,
    "Координаторы",
  );
  await stores.get("demo")!.reset();
  await stores.get("demo")!.ingest(JSON.stringify(rows));
  assert.equal((await get(writer)).json().history.length, 0);
  assert.equal((await post(payload, writer)).statusCode, 409);
});

test("the local journal survives a database restart and a ticket cannot recommend itself", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dispatch-restart-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const auth = new Auth();
  const password = randomUUID();
  auth.users.push({
    role: "coordinator",
    username: "owner",
    salt: "owner",
    hash: passwordHash(password, "owner"),
  });
  const session = auth.login("owner", password)!;
  const headers = {
    cookie: "wm_session=" + session.token,
    "x-csrf-token": session.session.csrf,
  };
  const rows = generate(1).rows;
  const url = "/api/incident/" + rows[0].id + "/dispatch";
  for (const initial of [true, false]) {
    const db = await openDB(join(directory, "db"));
    const store = await new Store(db, "demo").load();
    const app = await createApp({
      auth,
      stores: new Map([["demo", store]]),
      sources: new Map([["demo", new FileSource(store, "unused")]]),
      origin: "http://localhost",
      publicDemo: true,
      secure: false,
    });
    try {
      if (initial) await store.ingest(JSON.stringify(rows));
      const read = () =>
        app.inject({ method: "GET", url, headers }).then((r) => r.json());
      const view = await read();
      assert.equal(view.recommended, null);
      if (initial) {
        const result = await app.inject({
          method: "POST",
          url,
          headers,
          payload: {
            requestId: randomUUID(),
            snapshot: view.snapshot,
            expectedVersion: 0,
            team: view.teams[0].name,
            member: null,
            note: "Журнал смены",
          },
        });
        assert.equal(result.statusCode, 200, result.body);
      } else {
        assert.equal(view.history[0].note, "Журнал смены");
        assert.equal(view.history[0].actor, "owner");
        await store.ingest("[]");
        const absent = await read();
        assert.equal(absent.canSave, false);
        assert.deepEqual(absent.teams, []);
        assert.equal(absent.history.length, 1);
      }
    } finally {
      await app.close();
      await db.close();
    }
  }
});
