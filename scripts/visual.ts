import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createFixtureViewer } from "./fixture-viewer.ts";
const dir = resolve(".runtime/visual/" + randomUUID());
await mkdir(dir, { recursive: true });
await mkdir(".runtime/qa", { recursive: true });
const viewer = await createFixtureViewer(dir);
const source = join(dir, "incidents.json");
await copyFile("data/demo/design.json", source);
const server = spawn(
  process.execPath,
  ["--import", "tsx", "apps/server/main.ts"],
  {
    env: {
      ...process.env,
      DATA_DIR: dir,
      USERS_FILE: viewer.path,
      SOURCE_FILE: source,
      PORT: "3230",
      ORIGIN: "http://127.0.0.1:3230",
    },
    stdio: "ignore",
    windowsHide: true,
  },
);
const browser = await chromium.launch();
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3230/health/ready")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const width of [390, 1024, 1440, 1920, 2560]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 2560 ? 1440 : 900 },
    });
    if (
      !(
        await page.request.post("http://127.0.0.1:3230/api/login", {
          data: viewer.credentials,
        })
      ).ok()
    )
      throw new Error("Fixture login failed");
    await page.clock.setFixedTime(new Date("2026-11-21T09:04:08Z"));
    await page.goto(
      "http://127.0.0.1:3230/" +
        (width === 2560 ? "wallboard" : "live") +
        "?sort=id",
    );
    await page.getByTestId("count-critical").waitFor();
    await page.screenshot({
      path: `.runtime/qa/design-${width}.png`,
      fullPage: width === 390,
    });
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
