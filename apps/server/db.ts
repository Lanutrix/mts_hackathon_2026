import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
export interface DB {
  query<T = Record<string, any>>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[] }>;
  transaction<T>(f: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function openDB(
  path: string,
  connectionString?: string,
): Promise<DB> {
  let db: DB;
  if (connectionString) {
    const pool = new pg.Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5000,
    });
    const adapter = (client: pg.Pool | pg.PoolClient): DB => ({
      query: async <T>(sql: string, p?: any[]) => ({
        rows: (await client.query(sql, p)).rows as T[],
      }),
      transaction: async (f) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const value = await f(adapter(c));
          await c.query("COMMIT");
          return value;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    });
    db = adapter(pool);
  } else {
    const p = new PGlite(path === ":memory:" ? undefined : path);
    await p.waitReady;
    const adapter = (c: any): DB => ({
      query: (sql, params) => c.query(sql, params),
      transaction: (f) => p.transaction((tx) => f(adapter(tx))),
      close: () => p.close(),
    });
    db = adapter(p);
  }
  for (const sql of schema) await db.query(sql);
  return db;
}
const schema = [
  `CREATE TABLE IF NOT EXISTS snapshots(namespace text NOT NULL, revision integer NOT NULL, hash text NOT NULL, accepted_at text NOT NULL, row_count integer NOT NULL, PRIMARY KEY(namespace,revision))`,
  `CREATE TABLE IF NOT EXISTS ingest_runs(id bigserial PRIMARY KEY, namespace text NOT NULL, at text NOT NULL, status text NOT NULL, revision integer NOT NULL, hash text, detail jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY, at text NOT NULL, actor text NOT NULL, action text NOT NULL, namespace text NOT NULL, detail jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_jobs(id text PRIMARY KEY, cache_key text NOT NULL, input_revision integer NOT NULL, started_at text NOT NULL, finished_at text, status text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS watermarks(namespace text PRIMARY KEY, revision integer NOT NULL DEFAULT 0, hash text NOT NULL, accepted_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS incidents(namespace text NOT NULL, key text NOT NULL, id text NOT NULL, doc jsonb NOT NULL, PRIMARY KEY(namespace,key), UNIQUE(namespace,id))`,
  `CREATE TABLE IF NOT EXISTS events(namespace text NOT NULL, revision integer NOT NULL, key text NOT NULL, kind text NOT NULL, at text NOT NULL, before_doc jsonb, after_doc jsonb NOT NULL, changed jsonb NOT NULL, PRIMARY KEY(namespace,revision,key))`,
  `CREATE TABLE IF NOT EXISTS notifications(namespace text NOT NULL, revision integer NOT NULL, key text NOT NULL, id text NOT NULL, reasons jsonb NOT NULL, at text NOT NULL, PRIMARY KEY(namespace,revision,key))`,
  `CREATE TABLE IF NOT EXISTS reads(username text NOT NULL, namespace text NOT NULL, revision integer NOT NULL, key text NOT NULL, PRIMARY KEY(username,namespace,revision,key))`,
  `CREATE TABLE IF NOT EXISTS preferences(username text PRIMARY KEY, doc jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_cache(cache_key text PRIMARY KEY, doc jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS event_history ON events(namespace,key,revision DESC)`,
];
