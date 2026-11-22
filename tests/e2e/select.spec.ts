import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/server/api.ts";
import { Auth } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";
import { STATES } from "../../packages/domain/index.ts";

test.use({ hasTouch: true });

test("branded selectors support touch, keyboard and nested popups across viewport sizes", async ({page, context}, info) => {
  const db = await openDB(":memory:");
  const store = new Store(db, "demo");
  const auth = new Auth();
  auth.sessions.set(auth.digest("picker-session"), {username: "дежурный", role: "coordinator", csrf: "csrf",
    expires: Date.now() + 120_000});
  const options = {stores: new Map([["demo", store]]), sources: new Map(), auth,
    publicDemo: true, secure: false, origin: "", staticDir: resolve("dist/web")};
  const app = await createApp(options);
  try {
    await store.ingest(JSON.stringify([{...generate(1).rows[0], stateId: 2, state: STATES[2].label,
      stateEnum: STATES[2].enum, priorityId: 4, priority: "Наивысший"}]));
    const origin = await app.listen({host: "127.0.0.1", port: 0});
    options.origin = origin;
    await context.addCookies([{name: "wm_session", value: "picker-session", url: origin}]);
    await page.goto(origin + "/live");
    const card = page.getByTestId("live-guidance");
    await expect(card).toHaveAccessibleName("Совет ИИ");
    const profile = page.getByRole("button", {name: /Профиль:/});
    await profile.press("Enter");
    const theme = page.getByRole("combobox", {name: "Тема оформления"});
    await theme.press("Space");
    const themes = page.getByRole("listbox", {name: "Тема оформления"});
    await themes.getByRole("option", {name: "Тёмная"}).tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(theme).toBeFocused();
    await theme.press("Enter");
    await themes.press("Home");
    await themes.press("Enter");
    await page.keyboard.press("Escape");
    await expect(profile).toBeFocused();
    for (const [width, height] of [[320, 568], [390, 844], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({colorScheme: width === 390 ? "dark" : "light"});
      const button = card.getByRole("button", { name: "Подробнее" });
      const cardRect = (await card.boundingBox())!;
      const buttonRect = (await button.boundingBox())!;
      expect(Math.abs(buttonRect.x + buttonRect.width / 2 - cardRect.x - cardRect.width / 2)).toBeLessThan(2);
      expect(buttonRect.y + buttonRect.height).toBeCloseTo(cardRect.y + cardRect.height, 0);
      const trigger = page.getByLabel("Фильтры и сортировка");
      await trigger.press("Enter");
      const popup = page.locator(".filter-pop");
      const panel = (await popup.boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(height);
      const priority = popup.getByRole("combobox", {name: "Приоритет"});
      await priority.press("Space");
      const list = page.getByRole("listbox", {name: "Приоритет"});
      await expect(list).toBeFocused();
      const bounds = (await list.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      if (info.project.name === "chromium")
        await page.screenshot({path: info.outputPath("filter-options-" + width + ".png")});
      await list.press("End");
      await list.press("Escape");
      await expect(priority).toBeFocused();
      await expect(priority).toHaveValue("");
      const highest = list.getByRole("option", {name: "Наивысший"});
      if (width <= 390) {
        await priority.tap();
        await highest.tap();
      } else {
        await priority.click();
        await highest.click();
      }
      await expect(priority).toHaveValue("4");
      await priority.press("ArrowDown");
      await list.press("Home");
      await list.press("Enter");
      await expect(priority).toHaveValue("");
      const service = popup.getByRole("combobox", {name: "Тип сервиса"});
      await service.focus();
      await expect(service).toBeInViewport();
      await service.press("Enter");
      const services = page.getByRole("listbox", {name: "Тип сервиса"});
      await services.press("Tab");
      await expect(popup.getByRole("checkbox")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
  } finally {
    await page.close();
    await app.close();
    await db.close();
  }
});
