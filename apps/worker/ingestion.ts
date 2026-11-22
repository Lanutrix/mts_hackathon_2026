import { EventEmitter } from "node:events";
import { readFile, lstat, realpath } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  canonical,
  parseSnapshot,
  transition,
  type Incident,
  type Snapshot,
  type Issue,
} from "../../packages/domain/index.ts";
import type { DB } from "../server/db.ts";

export class Store extends EventEmitter {
  rows = new Map<string, Incident>();
  revision = 0;
  lastHash = "";
  acceptedAt = "";
  status: {
    state: "waiting" | "live" | "error";
    checkedAt: string;
    error: string | null;
    metrics: Record<string, number>;
  } = { state: "waiting", checkedAt: "", error: null, metrics: {} };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    public db: DB,
    public namespace: string,
  ) {
    super();
  }
  async load() {
    const [{ rows: marks }, { rows: incidents }] = await Promise.all([
      this.db.query("SELECT * FROM watermarks WHERE namespace=$1", [
        this.namespace,
      ]),
      this.db.query<{ doc: Incident }>(
        "SELECT doc FROM incidents WHERE namespace=$1",
        [this.namespace],
      ),
    ]);
    if (marks[0]) {
      this.revision = marks[0].revision;
      this.lastHash = marks[0].hash;
      this.acceptedAt = marks[0].accepted_at;
    }
    this.rows = new Map(incidents.map((r) => [r.doc.key, r.doc]));
    return this;
  }
  ingest(text: string) {
    const job = this.queue.then(async () => {
      try {
        const start = performance.now();
        const snapshot = parseSnapshot(text, this.namespace);
        this.status.metrics.validationMs = performance.now() - start;
        return await this.apply(snapshot);
      } catch (e) {
        await this.db
          .query(
            "INSERT INTO ingest_runs(namespace,at,status,revision,detail) VALUES($1,$2,'rejected',$3,$4)",
            [
              this.namespace,
              new Date().toISOString(),
              this.revision,
              JSON.stringify({
                reason: "Снимок не принят; предыдущая версия сохранена",
              }),
            ],
          )
          .catch(() => {});
        throw e;
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }
  private async apply(snapshot: Snapshot) {
    const start = performance.now();
    const at = new Date().toISOString();
    if (snapshot.hash === this.lastHash) {
      this.status = {
        ...this.status,
        state: "live",
        checkedAt: at,
        error: null,
      };
      return { changed: false, revision: this.revision };
    }
    const revision = this.revision + 1,
      initial = this.revision === 0;
    const next = new Map(this.rows);
    const changed: { key: string; id: string; doc: Incident }[] = [],
      events: any[] = [],
      notifications: any[] = [];
    const idIndex = new Map([...this.rows.values()].map((r) => [r.id, r.key]));
    for (const row of snapshot.rows) {
      if (idIndex.has(row.id) && idIndex.get(row.id) !== row.key)
        throw new Error(
          "Изменение sysId при прежнем id: требуется сверка идентичности",
        );
    }
    const put = (candidate: Incident, kind: string) => {
      const before = this.rows.get(candidate.key);
      if (
        before?.hash === candidate.hash &&
        before.sourcePresent === candidate.sourcePresent
      )
        return;
      const { incident, reasons } = transition(before, candidate);
      incident.revision = revision;
      incident.updatedAt = at;
      next.set(incident.key, incident);
      changed.push({ key: incident.key, id: incident.id, doc: incident });
      const fields = Object.keys({ ...before?.raw, ...incident.raw }).filter(
        (k) => canonical(before?.raw[k]) !== canonical(incident.raw[k]),
      );
      events.push({
        key: incident.key,
        kind,
        at,
        before_doc: before ?? null,
        after_doc: incident,
        changed: fields,
      });
      if (!initial && incident.sourcePresent && reasons.length)
        notifications.push({ key: incident.key, id: incident.id, reasons, at });
    };
    const present = new Set(snapshot.rows.map((r) => r.key));
    for (const row of snapshot.rows)
      put(row, this.rows.has(row.key) ? "updated" : "created");
    for (const row of this.rows.values())
      if (!present.has(row.key) && row.sourcePresent)
        put({ ...row, sourcePresent: false }, "missing");
    await this.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO snapshots(namespace,revision,hash,accepted_at,row_count) VALUES($1,$2,$3,$4,$5)",
        [this.namespace, revision, snapshot.hash, at, snapshot.rows.length],
      );
      await db.query(
        "INSERT INTO ingest_runs(namespace,at,status,revision,hash,detail) VALUES($1,$2,'accepted',$3,$4,$5)",
        [
          this.namespace,
          at,
          revision,
          snapshot.hash,
          JSON.stringify({
            rows: snapshot.rows.length,
            changed: changed.length,
            notifications: notifications.length,
          }),
        ],
      );
      if (changed.length)
        await db.query(
          `INSERT INTO incidents(namespace,key,id,doc) SELECT $1,x.key,x.id,x.doc FROM jsonb_to_recordset($2::jsonb) AS x(key text,id text,doc jsonb) ON CONFLICT(namespace,key) DO UPDATE SET id=excluded.id,doc=excluded.doc`,
          [this.namespace, JSON.stringify(changed)],
        );
      if (events.length)
        await db.query(
          `INSERT INTO events(namespace,revision,key,kind,at,before_doc,after_doc,changed) SELECT $1,$2,x.key,x.kind,x.at,x.before_doc,x.after_doc,x.changed FROM jsonb_to_recordset($3::jsonb) AS x(key text,kind text,at text,before_doc jsonb,after_doc jsonb,changed jsonb)`,
          [this.namespace, revision, JSON.stringify(events)],
        );
      if (notifications.length)
        await db.query(
          `INSERT INTO notifications(namespace,revision,key,id,reasons,at) SELECT $1,$2,x.key,x.id,x.reasons,x.at FROM jsonb_to_recordset($3::jsonb) AS x(key text,id text,reasons jsonb,at text)`,
          [this.namespace, revision, JSON.stringify(notifications)],
        );
      await db.query(
        `INSERT INTO watermarks(namespace,revision,hash,accepted_at) VALUES($1,$2,$3,$4) ON CONFLICT(namespace) DO UPDATE SET revision=excluded.revision,hash=excluded.hash,accepted_at=excluded.accepted_at`,
        [this.namespace, revision, snapshot.hash, at],
      );
    });
    this.rows = next;
    this.revision = revision;
    this.lastHash = snapshot.hash;
    this.acceptedAt = at;
    this.status = {
      state: "live",
      checkedAt: at,
      error: null,
      metrics: {
        ...this.status.metrics,
        commitMs: performance.now() - start,
        committedAt: Date.now(),
        changed: changed.length,
      },
    };
    this.emit("revision", { revision, at });
    if (notifications.length) this.emit("notifications");
    // Embedded PostgreSQL may resolve consecutive commits as microtasks. Let
    // Node flush SSE and serve dashboard reads before accepting the next cut.
    await new Promise<void>(resolve => setImmediate(resolve));
    return { changed: true, revision };
  }
  fail(error: unknown) {
    const message =
      error instanceof Error ? error.message : "Источник недоступен";
    const changed =
      this.status.state !== "error" || this.status.error !== message;
    this.status = {
      ...this.status,
      state: "error",
      checkedAt: new Date().toISOString(),
      error: message,
    };
    if (changed) this.emit("status", { state: "error" });
  }
  async history(key: string, maxRevision = this.revision) {
    return (
      await this.db.query(
        "SELECT revision,kind,at,changed,before_doc,after_doc FROM events WHERE namespace=$1 AND key=$2 AND revision <= $3 ORDER BY revision DESC LIMIT 50",
        [this.namespace, key, maxRevision],
      )
    ).rows;
  }
  async notifications(
    username: string,
    after = 0,
    maxRevision = this.revision,
    offset = 0,
  ) {
    return (
      await this.db.query(
        `SELECT n.*, r.username IS NOT NULL AS read,
                e.after_doc->'raw'->>'header' AS header,
                e.after_doc->'raw'->>'productName' AS product,
                e.after_doc->'dates'->>'deadline' AS deadline
           FROM notifications n
           LEFT JOIN events e USING (namespace, revision, key)
           LEFT JOIN reads r ON r.namespace=n.namespace AND r.revision=n.revision AND r.key=n.key AND r.username=$2
          WHERE n.namespace=$1 AND n.revision > $3 AND n.revision <= $4
          ORDER BY n.revision DESC,n.key LIMIT 200 OFFSET $5`,
        [this.namespace, username, after, maxRevision, offset],
      )
    ).rows;
  }
  async markRead(username: string, revision: number, key: string) {
    await this.db.query(
      `INSERT INTO reads(username,namespace,revision,key) SELECT $1,namespace,revision,key FROM notifications WHERE namespace=$2 AND revision=$3 AND key=$4 ON CONFLICT DO NOTHING`,
      [username, this.namespace, revision, key],
    );
  }
  async reset() {
    const job = this.queue.then(async () => {
      await this.db.transaction(async (db) => {
        await db.query("UPDATE push_devices SET since_revision=0,version=gen_random_uuid() WHERE namespace=$1", [this.namespace]);
        for (const t of [
          "reads",
          "notifications",
          "events",
          "incidents",
          "watermarks",
          "snapshots",
        ])
          await db.query(`DELETE FROM ${t} WHERE namespace=$1`, [
            this.namespace,
          ]);
      });
      this.rows.clear();
      this.revision = 0;
      this.lastHash = "";
      this.acceptedAt = "";
      this.status = {
        state: "waiting",
        checkedAt: "",
        error: null,
        metrics: {},
      };
      this.emit("reset");
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export class FileSource {
  private timer: ReturnType<typeof setInterval> | undefined;
  private watcher: FSWatcher | undefined;
  private busy = false;
  private signature = "";
  private lastFull = 0;
  private closed = false;
  private paused = false;
  private writes: Promise<unknown> = Promise.resolve();
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.writes.then(async () => {
      this.paused = true;
      while (this.busy) await new Promise((r) => setTimeout(r, 10));
      try {
        return await operation();
      } finally {
        this.paused = false;
        await this.tick(true);
      }
    });
    this.writes = job.catch(() => {});
    return job;
  }
  constructor(
    public store: Store,
    public path: string,
    public interval = 200,
  ) {}
  async start() {
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.interval);
    try {
      this.watcher = watch(dirname(this.path), () => void this.tick());
    } catch {}
    return this;
  }
  async tick(force = false) {
    if (this.busy || this.closed || this.paused) return;
    this.busy = true;
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Источник должен быть обычным файлом без symlink");
      if (stat.size > 20 * 1024 * 1024)
        throw new Error("Файл превышает ограничение 20 МиБ");
      const signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (
        !force &&
        signature === this.signature &&
        Date.now() - this.lastFull < 2000
      )
        return;
      const start = performance.now();
      this.store.status.metrics.observedAt = Date.now();
      const first = await readFile(this.path, "utf8");
      await new Promise((r) => setTimeout(r, 60));
      const check = await lstat(this.path);
      if (!check.isFile() || check.isSymbolicLink())
        throw new Error("Источник заменён на недопустимый файл");
      const second = await readFile(this.path, "utf8");
      if (
        first !== second ||
        stat.size !== check.size ||
        stat.mtimeMs !== check.mtimeMs
      )
        return;
      this.store.status.metrics.readMs = performance.now() - start;
      await this.store.ingest(second);
      this.signature = signature;
      this.lastFull = Date.now();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      this.store.fail(
        code === "ENOENT"
          ? new Error(
              "Файл источника отсутствует; показан последний принятый снимок",
            )
          : e,
      );
    } finally {
      this.busy = false;
    }
  }
  async stop() {
    this.closed = true;
    clearInterval(this.timer);
    this.watcher?.close();
    while (this.busy) await new Promise((r) => setTimeout(r, 10));
  }
}
