import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rename,
  readdir,
  rm,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "../apps/server/demo.ts";
import { openDB } from "../apps/server/db.ts";
import { Store, FileSource } from "../apps/worker/ingestion.ts";
import { Auth } from "../apps/server/auth.ts";
import { createApp } from "../apps/server/api.ts";
import { generate } from "../packages/domain/generator.ts";

test("F23 F25 Windows transient rename lock retries; failure leaves accepted file and removes temp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wm-lock-")),
    path = join(dir, "source.json");
  try {
    await writeFile(path, "[]");
    let attempts = 0;
    await atomicWrite(path, "[1]", async (a, b) => {
      if (++attempts < 3)
        throw Object.assign(new Error("lock"), { code: "EPERM" });
      await rename(a, b);
    });
    assert.equal(attempts, 3);
    assert.equal(await readFile(path, "utf8"), "[1]");
    await assert.rejects(
      atomicWrite(path, "[2]", async () => {
        throw Object.assign(new Error("denied"), { code: "EINVAL" });
      }),
    );
    assert.equal(await readFile(path, "utf8"), "[1]");
    assert.deepEqual(await readdir(dir), ["source.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("F30 offline backup restored into separate directory retains projection, history and read state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wm-backup-"));
  let db = await openDB(join(dir, "source"));
  try {
    let s = await new Store(db, "demo").load();
    await s.ingest("[]");
    const rows = generate(1).rows;
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    await s.ingest(JSON.stringify(rows));
    const note = (await s.notifications("alice"))[0];
    await s.markRead("alice", note.revision, note.key);
    await db.close();
    await cp(join(dir, "source"), join(dir, "restore"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    db = await openDB(join(dir, "restore"));
    s = await new Store(db, "demo").load();
    assert.equal(s.revision, 2);
    assert.equal(s.rows.size, 1);
    assert.equal((await s.notifications("alice"))[0].read, true);
    assert.equal((await s.history(note.key)).length, 1);
    await s.ingest(JSON.stringify(rows));
    assert.equal(s.revision, 2);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("F01 F28 integration original control and quarantined fields never invent closure", async (t) => {
  const db = await openDB(":memory:");
  try {
    if (process.env.ORIGINAL_PATH) {
      const s = await new Store(db, "private").load();
      await s.ingest(await readFile(process.env.ORIGINAL_PATH, "utf8"));
      assert.deepEqual(
        ["critical", "coordinators", "high", "research"].map(
          (g) =>
            [...s.rows.values()].filter((r) => r.groups.includes(g as any))
              .length,
        ),
        [0, 2, 1, 5],
      );
      assert.equal((await s.notifications("")).length, 0);
    }
    const s = await new Store(db, "boundary").load(),
      rows = generate(1).rows;
    rows[0].solution = "Прежняя попытка";
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    await s.ingest(JSON.stringify(rows));
    let item = [...s.rows.values()][0];
    assert.equal(item.stateId, 0);
    assert.deepEqual(item.groups, ["critical"]);
    assert.ok(item.issues.some((x) => x.code === "active-solution"));
    rows[0].stateEnum = "Unknown";
    await s.ingest(JSON.stringify(rows));
    item = [...s.rows.values()][0];
    assert.equal(item.quarantined, true);
    assert.deepEqual(item.groups, []);
    assert.equal(item.raw.waitingExitDate, "0001-01-01T00:00:00");
    assert.equal(item.dates.waitingExitDate, null);
    assert.equal((await s.notifications("")).length, 0);
  } finally {
    await db.close();
  }
});

test("F29 F30 F36 dashboard is one revision across concurrent commit and database failure is explicit", async () => {
  const db = await openDB(":memory:"),
    s = await new Store(db, "demo").load();
  const app = await createApp({
    stores: new Map([["demo", s]]),
    sources: new Map([["demo", new FileSource(s, "unused")]]),
    auth: new Auth(),
    publicDemo: true,
    secure: false,
    origin: "http://localhost",
  });
  try {
    const rows = generate(120).rows;
    await s.ingest(JSON.stringify(rows));
    const firstRevision = s.revision;
    const normal = s.notifications.bind(s);
    let updated = false;
    s.notifications = async (...args) => {
      if (!updated) {
        updated = true;
        rows[0].priorityId = 4;
        rows[0].priority = "Наивысший";
        await s.ingest(JSON.stringify(rows));
      }
      return normal(...args);
    };
    const response = (await app.inject("/api/dashboard")).json();
    assert.equal(response.revision, firstRevision);
    assert.equal(response.groups.critical.count, 12);
    assert.equal(response.events.length, 0);
    assert.equal(s.revision, firstRevision + 1);
    s.notifications = async () => {
      throw new Error("database unavailable");
    };
    const stale = (await app.inject("/api/dashboard")).json();
    assert.equal(stale.status.state, "error");
    assert.equal(stale.groups.critical.count, 13);
    assert.match(stale.status.error, /База данных недоступна/);
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    assert.equal((await db.query("SELECT * FROM snapshots")).rows.length, 2);
    await assert.rejects(s.ingest("{broken"));
    assert.equal(
      (await db.query("SELECT * FROM ingest_runs WHERE status='rejected'")).rows
        .length,
      1,
    );
    const query = db.query;
    db.query = async () => {
      throw new Error("offline");
    };
    assert.equal((await app.inject("/health/ready")).statusCode, 503);
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    db.query = query;
  } finally {
    await app.close();
    await db.close();
  }
});
