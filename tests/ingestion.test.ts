import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { generate } from "../packages/domain/generator.ts";
import { TEAM } from "../packages/domain/index.ts";
test("F19 F26 F27 F30 transaction/restart/dedup/A→B→A/disappearance", async () => {
  const db = await openDB(":memory:");
  try {
    let s = await new Store(db, "test").load();
    const rows = generate(2).rows;
    await s.ingest(JSON.stringify(rows));
    assert.equal((await s.notifications("a")).length, 0);
    const base = s.revision;
    await s.ingest(JSON.stringify([...rows].reverse(), null, 4));
    assert.equal(s.revision, base);
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    rows[0].assignedGroupName = TEAM;
    await s.ingest(JSON.stringify(rows));
    assert.equal((await s.notifications("a")).length, 1);
    assert.equal((await s.notifications("a"))[0].reasons.length, 2);
    rows[0].priorityId = 1;
    rows[0].priority = "Низкий";
    rows[0].assignedGroupName = "Другая команда";
    await s.ingest(JSON.stringify(rows));
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    rows[0].assignedGroupName = TEAM;
    await s.ingest(JSON.stringify(rows));
    assert.equal((await s.notifications("a")).length, 2);
    s = await new Store(db, "test").load();
    assert.equal(s.revision, 4);
    await s.ingest(JSON.stringify(rows));
    assert.equal(s.revision, 4);
    await assert.rejects(s.ingest("{"));
    assert.equal(s.revision, 4);
    await s.ingest("[]");
    assert.equal(s.rows.size, 2);
    assert.ok([...s.rows.values()].every((r) => !r.sourcePresent));
    assert.equal([...s.rows.values()][0].stateId, 0);
    assert.equal((await s.notifications("a")).length, 2);
  } finally {
    await db.close();
  }
});
test("F18 F36 per-user read survives new Store and does not change source", async () => {
  const db = await openDB(":memory:");
  try {
    const s = await new Store(db, "test").load();
    const rows = generate(1).rows;
    await s.ingest("[]");
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    await s.ingest(JSON.stringify(rows));
    const n = (await s.notifications("one"))[0];
    await s.markRead("one", n.revision, n.key);
    assert.equal((await s.notifications("one"))[0].read, true);
    assert.equal((await s.notifications("two"))[0].read, false);
    const restart = await new Store(db, "test").load();
    assert.equal((await restart.notifications("one"))[0].read, true);
    assert.equal(restart.rows.get(n.key)!.stateId, 0);
  } finally {
    await db.close();
  }
});
test("F25 file partial write, atomic rename, missing file recovers last good revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watermelon-")),
    path = join(dir, "incidents.json"),
    db = await openDB(":memory:");
  const s = await new Store(db, "file").load(),
    source = new FileSource(s, path);
  try {
    await writeFile(path, JSON.stringify(generate(2).rows));
    await source.tick();
    assert.equal(s.revision, 1);
    await writeFile(path, "[{");
    await source.tick();
    assert.equal(s.revision, 1);
    assert.equal(s.status.state, "error");
    await writeFile(join(dir, "next.json"), JSON.stringify(generate(3).rows));
    await rename(join(dir, "next.json"), path);
    await source.tick();
    assert.equal(s.revision, 2);
    assert.equal(s.rows.size, 3);
    await rm(path);
    await source.tick();
    assert.equal(s.status.state, "error");
    assert.equal(s.rows.size, 3);
  } finally {
    await source.stop();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
