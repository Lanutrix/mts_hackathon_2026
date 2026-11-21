import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 200));
});
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
await page.goto("http://127.0.0.1:3000/wallboard");
await page.getByTestId("group-critical").waitFor();
const samples: any[] = [],
  settled: any[] = [];
const seconds = Number(process.env.SOAK_SECONDS ?? 600);
const start = Date.now();
try {
  while (Date.now() - start < seconds * 1000) {
    const metrics = await cdp.send("Performance.getMetrics");
    samples.push({
      elapsedSeconds: Math.round((Date.now() - start) / 1000),
      metrics: Object.fromEntries(
        metrics.metrics
          .filter((m) =>
            [
              "JSHeapUsedSize",
              "Nodes",
              "JSEventListeners",
              "Documents",
            ].includes(m.name),
          )
          .map((m) => [m.name, m.value]),
      ),
      cards: await page.locator(".incident").count(),
    });
    await new Promise((r) => setTimeout(r, 30000));
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const finalMetrics = await cdp.send("Performance.getMetrics");
  settled.push(
    Object.fromEntries(
      finalMetrics.metrics
        .filter((m) =>
          ["JSHeapUsedSize", "Nodes", "JSEventListeners", "Documents"].includes(
            m.name,
          ),
        )
        .map((m) => [m.name, m.value]),
    ),
  );
} finally {
  await browser.close();
  await mkdir(".runtime/qa", { recursive: true });
  await writeFile(
    ".runtime/qa/soak.json",
    JSON.stringify(
      {
        durationSeconds: Math.round((Date.now() - start) / 1000),
        errors,
        samples,
        settled,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      durationSeconds: Math.round((Date.now() - start) / 1000),
      samples: samples.length,
      errors,
    }),
  );
}
