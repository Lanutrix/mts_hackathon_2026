import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/server/api.ts";
import { Auth } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";

test("wide displays fill adjacent incident lists without scrolling", async ({ page, context }) => {
  const db = await openDB(":memory:");
  const store = new Store(db, "demo");
  const auth = new Auth();
  auth.sessions.set(auth.digest("ultrawide"), {
    username: "Дежурный", role: "coordinator", csrf: "test", expires: Date.now() + 120_000,
  });
  const app = await createApp({
    stores: new Map([["demo", store]]), sources: new Map(), auth,
    origin: "", secure: false, publicDemo: false, staticDir: resolve("dist/web"),
  });
  try {
    await store.ingest(JSON.stringify(generate(800, 42, new Date().toISOString()).rows));
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    await context.addCookies([{ name: "wm_session", value: "ultrawide", url: origin }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const displaySizes = [
      { width: 2256, height: 1504, liveColumns: 2, wallColumns: 1 },
      { width: 3440, height: 1440, liveColumns: 3, wallColumns: 1 },
      { width: 3840, height: 2160, liveColumns: 4, wallColumns: 1 },
      { width: 2560, height: 720, liveColumns: 3, wallColumns: 2 },
      { width: 5120, height: 1440, liveColumns: 5, wallColumns: 3 },
    ];
    for (const { width, height, liveColumns, wallColumns } of displaySizes) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + "/live");
      const register = page.getByTestId("live-register");
      const next = register.getByRole("button", { name: "Следующая страница" });
      await expect.poll(() => register.locator("tbody tr").evaluateAll(rows =>
        new Set(rows.map(row => Math.round(row.getBoundingClientRect().left))).size,
      )).toBe(liveColumns);
      const shell = await page.locator(".ops-shell--live").boundingBox();
      expect(shell?.width).toBeGreaterThanOrEqual(width * .98);
      await expect(next).toBeEnabled();
      const tickets = register.locator("tbody tr");
      const firstBatch = await tickets.evaluateAll(rows => rows.map(row => row.getAttribute("data-testid")));
      expect(new Set(firstBatch).size).toBe(firstBatch.length);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      const capture = process.env.ULTRAWIDE_SCREENSHOTS;
      if (capture) await page.screenshot({ path: resolve(capture, `live-${width}x${height}.png`) });
      await next.click();
      await expect.poll(() => tickets.first().getAttribute("data-testid")).not.toBe(firstBatch[0]);
      await expect(tickets).toHaveCount(firstBatch.length);
      expect(await tickets.evaluateAll(rows => rows.some(row => row.getBoundingClientRect().bottom > innerHeight))).toBe(false);
      expect(await tickets.evaluateAll((rows, previous) => rows.some(row =>
        previous.includes(row.getAttribute("data-testid"))), firstBatch)).toBe(false);

      await page.goto(origin + "/wallboard");
      const wallTickets = page.getByTestId("wall-ticket");
      await expect.poll(() => wallTickets.evaluateAll(rows =>
        new Set(rows.map(row => Math.round(row.getBoundingClientRect().left))).size,
      )).toBe(wallColumns);
      expect(await wallTickets.evaluateAll(rows => rows.every(row =>
        row.getBoundingClientRect().bottom <= row.parentElement!.getBoundingClientRect().bottom + 1,
      ))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      if (capture) await page.screenshot({ path: resolve(capture, `wallboard-${width}x${height}.png`) });
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await expect.poll(() => page.getByTestId("wall-ticket").evaluateAll(rows =>
      new Set(rows.map(row => Math.round(row.getBoundingClientRect().left))).size,
    )).toBe(1);
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + "/live");
      await expect(page.getByTestId("live-register").getByRole("table")).toHaveCount(1);
    }
  } finally {
    await page.close();
    await app.close();
    await db.close();
  }
});
