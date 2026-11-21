import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createApp } from "../../apps/server/api.ts";
import { Auth, passwordHash } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store, FileSource } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";

test("coordinator opens a ticket from the live feed, verifies a handoff and sees the saved decision after reload", async ({
  page,
}) => {
  const db = await openDB(":memory:");
  const store = new Store(db, "demo");
  const rows = generate(2).rows;
  Object.assign(rows[0], {
    header: "Ошибка при входе",
    priorityId: 4,
    priority: "Наивысший",
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  Object.assign(rows[1], {
    header: "Ошибка при входе",
    priorityId: 3,
    priority: "Высокий",
    deadline: new Date(Date.now() - 86400000).toISOString(),
  });
  await store.ingest(JSON.stringify(rows));
  const auth = new Auth();
  const password = randomUUID();
  auth.users.push({
    username: "дежурный",
    role: "coordinator",
    salt: "test",
    hash: passwordHash(password, "test"),
  });
  const options = {
    stores: new Map([["demo", store]]),
    sources: new Map([["demo", new FileSource(store, "demo")]]),
    auth,
    publicDemo: true,
    secure: false,
    origin: "",
    staticDir: resolve("dist/web"),
  };
  const app = await createApp(options);
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    options.origin = origin;
    await page.request.post(origin + "/api/login", {
      data: { username: "дежурный", password },
    });
    await page.goto(origin + "/live");
    const target = await page
      .locator(".case-insight .case-source")
      .first()
      .getAttribute("href");
    await page.getByRole("button", { name: /Выбрать команду для / }).click();
    await expect(page).toHaveURL(origin + target);
    const panel = page.getByRole("region", { name: "Маршрутизация" });
    await expect(panel).toBeVisible();
    const team = panel.getByRole("combobox", { name: "Команда назначения" });
    const employee = panel.getByRole("combobox", { name: "Исполнитель" });
    await team.selectOption({ index: 1 });
    await employee.selectOption({ index: 1 });
    await panel
      .getByRole("textbox", { name: "Комментарий" })
      .fill("Проверить журнал авторизации");
    await panel.getByRole("button", { name: "Проверить решение" }).click();
    await expect(panel).toContainText("Проверить журнал авторизации");
    await panel.getByRole("button", { name: "Сохранить решение" }).click();
    await expect(panel.getByRole("status")).toContainText("Решение сохранено");
    await page.reload();
    await expect(panel).toContainText("дежурный");
    await expect(panel).toContainText("Проверить журнал авторизации");
    await expect(
      panel.getByRole("link", { name: "Посмотреть макет ITSM" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      panel.getByRole("combobox", { name: "Команда назначения" }),
    ).toBeInViewport();
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  } finally {
    await page.close();
    await app.close();
    await db.close();
  }
});
