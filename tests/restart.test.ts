import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../packages/domain/generator.ts";
import { atomicWrite } from "../apps/server/demo.ts";
test("F30 actual backend process restart retains committed revision and notifications", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wm-process-")),
    source = join(dir, "incidents.json"),
    rows = generate(1).rows;
  await writeFile(source, JSON.stringify(rows));
  let child: ChildProcess | undefined;
  const start = () => {
    child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/server/main.ts"],
      {
        env: {
          ...process.env,
          DATA_DIR: dir,
          SOURCE_FILE: source,
          ORIGINAL_PATH: "",
          DATABASE_URL: "",
          USERS_FILE: "",
          PORT: "3240",
          ORIGIN: "http://127.0.0.1:3240",
        },
        stdio: "ignore",
        windowsHide: true,
      },
    );
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((r) => child!.once("exit", r));
    child.kill();
    await exited;
  };
  const until = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      try {
        if (await check()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Backend condition timeout");
  };
  const get = (path: string) =>
    fetch("http://127.0.0.1:3240" + path).then((r) => r.json());
  try {
    start();
    await until(async () => (await get("/health/ready")).status === "ready");
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    await atomicWrite(source, JSON.stringify(rows));
    await until(async () => (await get("/api/dashboard")).revision === 2);
    assert.equal((await get("/api/notifications")).items.length, 1);
    await stop();
    start();
    await until(async () => (await get("/health/ready")).status === "ready");
    assert.equal((await get("/api/dashboard")).revision, 2);
    assert.equal((await get("/api/notifications")).items.length, 1);
    await atomicWrite(source, JSON.stringify(rows, null, 2));
    await until(
      async () => (await get("/api/dashboard")).status.state === "live",
    );
    assert.equal((await get("/api/dashboard")).revision, 2);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
