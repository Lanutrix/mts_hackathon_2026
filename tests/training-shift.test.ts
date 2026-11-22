import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openDB } from "../apps/server/db.ts";
import { Store } from "../apps/worker/ingestion.ts";
import { TEAM, GROUPS, hash, parseSnapshot, type Raw } from "../packages/domain/index.ts";
import { generate } from "../packages/domain/generator.ts";
import { trainingRows } from "../packages/domain/trainingShift.ts";
import { upgradeTraining } from "../packages/domain/upgradeTraining.ts";

test("published training shift has 800 distinct cases, real routing evidence and coherent lifecycle dates", async () => {
  const source = await readFile("data/demo/incidents.json", "utf8");
  const snapshot = parseSnapshot(source, "demo");
  assert.equal(snapshot.rows.length, 800);
  assert.deepEqual(snapshot.rows.map(row => row.raw), trainingRows());
  const manifests = JSON.parse(await readFile("data/demo/manifests.json", "utf8"));
  const manifest = manifests.find((entry: { count: number }) => entry.count === 800);
  assert.equal(manifest.sha256, hash(trainingRows()));
  for (const group of GROUPS)
    assert.deepEqual(manifest.expected[group], snapshot.rows.filter(row => row.groups.includes(group)).map(row => row.id));
  assert.equal(snapshot.issues.length, 0);
  assert.equal(new Set(snapshot.rows.map(row => row.raw.header)).size, 800);
  assert.equal(new Set(snapshot.rows.map(row => row.raw.description)).size, 800);
  assert.ok(new Set(snapshot.rows.map(row => row.raw.shortDescription)).size >= 100);
  const specialists = new Map<string, Set<unknown>>();
  for (const row of snapshot.rows) {
    assert.ok(row.dates.submitDate! <= row.dates.lastAssignmentToTeamDateTime!);
    const finished = row.stateId === 7 || row.stateId === 10;
    assert.equal(Boolean(row.raw.solution && row.dates.completionDate), finished);
    if (finished) assert.ok(row.dates.lastAssignmentToTeamDateTime! <= row.dates.completionDate!);
    if (row.team === TEAM) continue;
    const members = specialists.get(row.team) ?? new Set();
    members.add(row.raw.assignedEmployeeLogin);
    specialists.set(row.team, members);
  }
  assert.ok(specialists.size >= 25);
  assert.ok([...specialists.values()].every(members => members.size >= 2 && !members.has(null)));
  assert.ok(snapshot.rows.some(row => row.team === TEAM && row.stateId === 0));
});

test("legacy upgrade preserves edits, decisions, extra tickets, identities, roster and lifecycle", () => {
  const old = generate(600, 42, "2026-03-01T18:45:00.000Z").rows;
  // Version 1.0 of the workload used the legacy service-type numbers.
  old.forEach((r, i) => Object.assign(r, { serviceTypeId: i % 3 + 1, serviceType: ["Технический", "Клиентский", "Внутренний"][i % 3] }));
  old[1].header = "Ручная правка";
  old[2].deadline = null;
  const extra: Raw = { ...old[3], id: "DEMO-LOCAL", sysId: "local", assignedGroupName: "Команда смены" };
  const input = [extra, ...old.slice().reverse()];
  const result = upgradeTraining(input, [String(old[4].id)]);
  assert.equal(result.length, 801);
  const byId = new Map(result.map(row => [row.id, row]));
  const roster = (r: Raw) => JSON.stringify([r.assignedGroupName, r.assignedEmployee, r.assignedEmployeeLogin]);
  const newRoster = new Set(result.map(roster));
  for (const r of input) {
    const next = byId.get(r.id)!;
    assert.equal(next.sysId, r.sysId);
    for (const field of ["stateId", "priorityId", "submitDate", "deadline", "completionDate", "lastAssignmentToTeamDateTime"])
      assert.equal(next[field], r[field]);
    assert.equal(next.assignedGroupName === TEAM, r.assignedGroupName === TEAM);
    assert.ok(newRoster.has(roster(r)));
  }
  for (const row of [old[1], old[2], old[4], extra]) assert.deepEqual(byId.get(row.id), row);
  assert.ok(new Set(result.map(r => r.header)).size > 780);
  assert.deepEqual(upgradeTraining(result), result);
  assert.throws(() => upgradeTraining(old.slice(1)));
  assert.throws(() => upgradeTraining([...old, { ...extra, id: "DEMO-42-00601" }]));
  assert.throws(() => upgradeTraining(old, ["DEMO-42-00601"]));
});

test("normal ingestion appends the upgraded revision and retains the original event and routing decision", async () => {
  const db = await openDB(":memory:");
  try {
    const store = await new Store(db, "demo").load();
    const old = generate(600).rows;
    await store.ingest(JSON.stringify(old));
    const key = [...store.rows.keys()][0];
    const decision = { team: old[0].assignedGroupName, member: old[0].assignedEmployeeLogin };
    await db.query(
      "INSERT INTO dispatch_decisions(namespace,key,version,actor,request_id,request_hash,decision) VALUES('demo',$1,1,'coordinator',$2,'hash',$3)",
      [key, randomUUID(), JSON.stringify(decision)],
    );
    const upgraded = upgradeTraining(old, [String(old[0].id)]);
    await store.ingest(JSON.stringify(upgraded));
    assert.equal(store.rows.size, 800);
    assert.equal(store.revision, 2);
    assert.deepEqual(store.rows.get(key)?.raw, old[0]);
    const saved = await db.query("SELECT decision FROM dispatch_decisions WHERE namespace='demo' AND key=$1", [key]);
    assert.deepEqual(saved.rows.map(r => r.decision), [decision]);
    const archived = await db.query("SELECT count(*)::int AS n FROM events WHERE namespace='demo' AND revision=1");
    assert.equal(archived.rows[0].n, 600);
    await store.ingest(JSON.stringify(upgradeTraining(upgraded)));
    assert.equal(store.revision, 2);
  } finally {
    await db.close();
  }
});
