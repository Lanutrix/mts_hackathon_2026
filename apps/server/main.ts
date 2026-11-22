import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { openDB } from "./db.ts";
import { Store, FileSource } from "../worker/ingestion.ts";
import { Auth, loadQrLogin, qrLoginFile } from "./auth.ts";
import { createApp } from "./api.ts";
import { AnalysisService } from "./analysis.ts";
import { loadVseLlm } from "./vsellm.ts";
import { trainingRows } from "../../packages/domain/trainingShift.ts";
const root = resolve(process.env.DATA_DIR ?? ".runtime");
await mkdir(root, { recursive: true });
const qrLogin = await loadQrLogin(resolve(root, qrLoginFile));
const db = await openDB(resolve(root, "db"), process.env.DATABASE_URL),
  stores = new Map<string, Store>(),
  sources = new Map<string, FileSource>();
const paths: Record<string, string> = {
  demo: resolve(
    process.env.SOURCE_FILE ?? resolve(root, "demo/incidents.json"),
  ),
  workspace: resolve(root, "workspace/incidents.json"),
};
if (process.env.ORIGINAL_PATH)
  paths.original = resolve(process.env.ORIGINAL_PATH);
for (const [namespace, path] of Object.entries(paths)) {
  if (namespace !== "original" && !existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        namespace === "demo"
          ? trainingRows(new Date().toISOString())
          : [],
      ),
    );
  }
  const store = await new Store(db, namespace).load();
  stores.set(namespace, store);
  sources.set(namespace, await new FileSource(store, path).start());
}
const auth = await new Auth().load(process.env.USERS_FILE),
  secure = process.env.NODE_ENV === "production";
const ai = new AnalysisService(
  db,
  resolve(root, "models"),
  Number(process.env.AI_TIMEOUT_MS ?? 60_000),
  undefined,
  await loadVseLlm(root),
);
const origin = process.env.ORIGIN ?? "http://127.0.0.1:3000";
const app = await createApp({
  stores,
  sources,
  auth,
  publicDemo: process.env.PUBLIC_DEMO !== "false",
  secure,
  origin,
  qrLogin,
  push: { dataDir: root, subject: process.env.VAPID_SUBJECT ?? (origin.startsWith("https://") ? origin : "https://mts-watermelon.ru") },
  ai,
  itsmUrl: process.env.ITSM_URL,
});
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
});
console.log(
  JSON.stringify({
    event: "ready",
    port: Number(process.env.PORT ?? 3000),
    namespaces: [...stores.keys()],
  }),
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  for (const source of sources.values()) await source.stop();
  await ai.close();
  await db.close();
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
