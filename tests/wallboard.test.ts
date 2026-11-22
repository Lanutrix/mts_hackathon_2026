import { test } from "node:test";
import assert from "node:assert/strict";
import { openDB } from "../apps/server/db.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { Auth } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";
import { generate } from "../packages/domain/generator.ts";
import { TEAM } from "../packages/domain/index.ts";
import { groups, mergeStreams, type Dashboard } from "../apps/web/src/liveFeed.ts";

test("wallboard settings persist per account, including upgrades from legacy preferences", async (t) => {
  const db = await openDB(":memory:");
  const store = await new Store(db, "workspace").load();
  const auth = new Auth();
  const app = await createApp({ stores: new Map([["workspace", store]]), sources: new Map(),
    auth, publicDemo: false, secure: false, origin: "http://localhost" });
  t.after(async () => { await app.close(); await db.close(); });
  for (const username of ["alice", "bob"])
    auth.sessions.set(auth.digest(username), { username, role: "coordinator", csrf: "token", expires: Date.now() + 60_000 });
  const read = (user: string) => app.inject({url: "/api/preferences", headers: {cookie: "wm_session=" + user}}).then(r => r.json());
  const save = (user: string, payload: object) => app.inject({method: "POST", url: "/api/preferences",
    headers: {cookie: "wm_session=" + user, "x-csrf-token": "token"}, payload});
  const legacy = { zone: "UTC", notifications: true, sound: true };
  await db.query("INSERT INTO preferences(username,doc) VALUES ($1,$2)", ["alice", JSON.stringify(legacy)]);
  assert.deepEqual(await read("alice"), { ...legacy, wallboardOrder: "priority", wallboardSeconds: 18 });
  const updated = { ...legacy, wallboardOrder: "registered", wallboardSeconds: 10 };
  assert.equal((await save("alice", updated)).statusCode, 200);
  assert.deepEqual(await read("alice"), updated);
  assert.equal((await save("alice", { ...legacy, sound: false })).statusCode, 200);
  assert.deepEqual(await read("alice"), { ...updated, sound: false });
  for (const invalid of [{ wallboardOrder: "unknown" }, { wallboardSeconds: 0 }, { wallboardSeconds: "30" }])
    assert.equal((await save("alice", { ...legacy, ...invalid })).statusCode, 400);
  assert.deepEqual(await read("alice"), { ...updated, sound: false });
  assert.deepEqual(await read("bob"), { zone: "Europe/Moscow", sound: false, notifications: false,
    wallboardOrder: "priority", wallboardSeconds: 18 });
});

test("wallboard sorts the full queue before pagination and merges overlapping queues without duplicates", async (t) => {
  const db = await openDB(":memory:");
  const store = await new Store(db, "demo").load();
  const auth = new Auth();
  auth.sessions.set(auth.digest("reader"), { username: "reader", role: "coordinator", csrf: "token", expires: Date.now() + 60_000 });
  const app = await createApp({ stores: new Map([["demo", store]]), sources: new Map(),
    auth, publicDemo: true, secure: false, origin: "http://localhost" });
  t.after(async () => { await app.close(); await db.close(); });
  const fixture = generate(1).rows[0];
  const date = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
  const rows = Array.from({length: 70}, (_, index) => {
    const n = index + 1, id = String(n).padStart(2, "0");
    return { ...fixture, id, sysId: id, stateId: 0, stateEnum: "Assigned", assignedGroupName: TEAM,
      priorityId: n === 68 || n === 69 ? 4 : n === 67 ? 3 : 2,
      submitDate: n === 70 ? null : date(n === 66 ? 100 : n),
      deadline: n === 70 ? null : date(n), completionDate: null };
  });
  await store.ingest(JSON.stringify(rows));
  for (const [sort, leading, trailing] of [
    ["priority", ["68", "69", "67"], "70"],
    ["registered", ["66", "69", "68"], "70"],
    ["deadline", ["01", "02", "03"], "70"],
  ] as const) {
    const pages: Dashboard[] = [];
    for (const offset of [0, 30, 60]) {
      const q = new URLSearchParams({sort});
      for (const group of groups) q.set(group, String(offset));
      const response = await app.inject({url: "/api/dashboard?" + q, headers: {cookie: "wm_session=reader"}});
      assert.equal(response.statusCode, 200);
      pages.push(response.json());
    }
    assert.deepEqual(mergeStreams(pages[0], [], "all", sort, 3).map(i => i.id), leading, sort);
    const ids = mergeStreams(pages[0], pages.slice(1), "all", sort, 70).map(i => i.id);
    assert.equal(ids.length, 70);
    assert.equal(new Set(ids).size, 70);
    assert.equal(ids.at(-1), trailing, sort);
    assert.deepEqual(ids.slice(0, 3), leading);
  }
});
