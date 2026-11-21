import { chromium } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { generate } from "../packages/domain/generator.ts";
const root = resolve(".runtime/bench/" + randomUUID());
await mkdir(root, { recursive: true });
await mkdir(".runtime/qa", { recursive: true });
const browser = await chromium.launch(),
  report: any = {
    environment: {
      os: process.platform,
      node: process.version,
      browser: browser.version(),
    },
    runs: [],
  };
const until = async (f: () => Promise<boolean>, timeout = 60000) => {
  const start = Date.now();
  while (!(await f())) {
    if (Date.now() - start > timeout)
      throw new Error("Ожидание превысило timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
};
try {
  for (const count of [2000, 10000]) {
    const dir = join(root, String(count)),
      source = join(dir, "incidents.json");
    await mkdir(dir, { recursive: true });
    const { rows, manifest } = generate(count, 92831);
    rows[0].id = "DEMO-42-00001";
    rows[0].priorityId = 4;
    rows[0].priority = "Наивысший";
    await writeFile(source, JSON.stringify(rows));
    const server = spawn(
      process.execPath,
      ["--import", "tsx", "apps/server/main.ts"],
      {
        env: {
          ...process.env,
          DATA_DIR: dir,
          SOURCE_FILE: source,
          PORT: "3220",
          ORIGIN: "http://127.0.0.1:3220",
        },
        stdio: "ignore",
        windowsHide: true,
      },
    );
    try {
      await until(async () => {
        try {
          return (await fetch("http://127.0.0.1:3220/api/health")).ok;
        } catch {
          return false;
        }
      });
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
      });
      await page.goto("http://127.0.0.1:3220/?sort=id");
      await page.getByTestId("card-DEMO-42-00001").first().waitFor();
      const samples: any[] = [];
      for (let n = 0; n < 20; n++) {
        const value = `Измерение ${count}/${n}`;
        const output = execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/mutate.ts", source, "header", value],
          { encoding: "utf8", windowsHide: true },
        );
        const written = Number(output.trim());
        await page
          .getByRole("button", { name: value, exact: true })
          .first()
          .waitFor();
        const d = await fetch("http://127.0.0.1:3220/api/dashboard").then((r) =>
          r.json(),
        );
        await page.waitForFunction(
          (rev) =>
            (
              performance
                .getEntriesByName("watermelon:paint")
                .at(-1) as PerformanceMark
            )?.detail?.revision === rev,
          d.revision,
        );
        const paint = await page.evaluate(() => {
          const m = performance
            .getEntriesByName("watermelon:paint")
            .at(-1) as PerformanceMark;
          return {
            at: performance.timeOrigin + m.startTime,
            streamReceivedAt: m.detail.streamReceivedAt,
          };
        });
        const m = d.status.metrics;
        samples.push({
          endToEndMs: Math.round(paint.at - written),
          watcherDelayMs: m.observedAt - written,
          readMs: m.readMs,
          validationMs: m.validationMs,
          commitMs: m.commitMs,
          streamDeliveryMs: paint.streamReceivedAt - m.committedAt,
          apiAndRenderMs: paint.at - paint.streamReceivedAt,
          revision: d.revision,
        });
      }
      const sorted = samples.map((s) => s.endToEndMs).sort((a, b) => a - b);
      report.runs.push({
        count,
        seed: manifest.seed,
        samples,
        p50: sorted[9],
        p95: sorted[18],
        max: sorted[19],
        domCards: await page.locator("article.incident").count(),
      });
      await page.close();
    } finally {
      server.kill();
      await new Promise((r) => server.once("exit", r));
    }
  }
} finally {
  await browser.close();
  await writeFile(
    ".runtime/qa/performance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.runs.map(({ samples, ...r }: any) => r)));
}
