import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { Demo } from "../apps/server/demo.ts";
import { generate, FIXED_CLOCK } from "../packages/domain/generator.ts";
import { TEAM } from "../packages/domain/index.ts";
test("F05 F06 F07 F08 F09 F12 F13 F14 observed field transitions preserve deadlines, groups and facts", async () => {
  const db = await openDB(":memory:");
  try {
    const s = await new Store(db, "transitions").load(),
      rows = generate(1).rows,
      r = rows[0];
    r.deadline = FIXED_CLOCK;
    await s.ingest(JSON.stringify(rows));
    const key = [...s.rows.keys()][0];
    r.priorityId = 3;
    r.priority = "Высокий";
    await s.ingest(JSON.stringify(rows));
    assert.deepEqual(s.rows.get(key)?.groups, ["high"]);
    r.assignedGroupName = "  КЦ ИТ  Координаторы Массовых Инцидентов ";
    await s.ingest(JSON.stringify(rows));
    assert.deepEqual(s.rows.get(key)?.groups, ["coordinators", "high"]);
    r.priorityId = 4;
    r.priority = "Наивысший";
    await s.ingest(JSON.stringify(rows));
    assert.equal(s.rows.get(key)?.dates.deadline, FIXED_CLOCK);
    assert.deepEqual(s.rows.get(key)?.groups, ["critical", "coordinators"]);
    r.deadline = null;
    await s.ingest(JSON.stringify(rows));
    assert.equal(s.rows.get(key)?.dates.deadline, null);
    r.isNeedUp = true;
    r.isEffect = null;
    r.isDouble = true;
    await s.ingest(JSON.stringify(rows));
    assert.equal(s.rows.get(key)?.raw.isDouble, true);
    r.assignedGroupName = "Другая команда";
    r.priorityId = 2;
    r.priority = "Средний";
    await s.ingest(JSON.stringify(rows));
    assert.deepEqual(s.rows.get(key)?.groups, []);
    r.stateId = 20;
    r.stateEnum = "Research";
    r.priorityId = 4;
    r.priority = "Наивысший";
    r.assignedGroupName = TEAM;
    await s.ingest(JSON.stringify(rows));
    assert.deepEqual(s.rows.get(key)?.groups, ["coordinators", "research"]);
    r.stateId = 7;
    r.stateEnum = "Resolved";
    r.completionDate = FIXED_CLOCK;
    await s.ingest(JSON.stringify(rows));
    assert.deepEqual(s.rows.get(key)?.groups, []);
  } finally {
    await db.close();
  }
});
test("F11 F35 demo terminal Closed rejects edit, repeat uses new ID; reset uses own namespace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wm-demo-")),
    db = await openDB(":memory:"),
    s = await new Store(db, "demo").load(),
    other = await new Store(db, "original").load(),
    path = join(dir, "incidents.json"),
    source = new FileSource(s, path),
    demo = new Demo(s, source);
  try {
    await other.ingest(JSON.stringify(generate(1, 44).rows));
    await writeFile(path, "[]");
    await source.tick();
    await demo.action("reset");
    assert.equal(s.rows.size, 800);
    const rows = generate(1).rows;
    rows[0].stateId = 10;
    rows[0].stateEnum = "Closed";
    await writeFile(path, JSON.stringify(rows));
    await source.tick(true);
    const item = [...s.rows.values()].find((r) => r.sourcePresent)!;
    await assert.rejects(demo.edit(item.key, 2));
    assert.equal(item.stateId, 10);
    await demo.action("reset");
    for (let i = 0; i < 9; i++) await demo.action("step");
    assert.ok([...s.rows.values()].some((r) => r.id === "DEMO-REPEAT-8"));
    assert.equal(
      [...s.rows.values()].find((r) => r.id === "DEMO-SCENARIO")?.stateId,
      10,
    );
    assert.equal(other.rows.size, 1);
    await demo.action("play");
    assert.equal(demo.playing, true);
    await demo.action("pause");
    assert.equal(demo.playing, false);
  } finally {
    demo.pause();
    await source.stop();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("F19 storm of 600 criticals persisted once; repeat does not duplicate", async () => {
  const db = await openDB(":memory:");
  try {
    const s = await new Store(db, "storm").load();
    await s.ingest("[]");
    const rows = generate(600).rows.map((r) => ({
      ...r,
      stateId: 0,
      stateEnum: "Assigned",
      priorityId: 4,
      priority: "Наивысший",
      completionDate: null,
    }));
    await s.ingest(JSON.stringify(rows));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM notifications WHERE namespace=$1",
          ["storm"],
        )
      ).rows[0].n,
      600,
    );
    await s.ingest(JSON.stringify(rows.reverse(), null, 2));
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM notifications WHERE namespace=$1",
          ["storm"],
        )
      ).rows[0].n,
      600,
    );
  } finally {
    await db.close();
  }
});
