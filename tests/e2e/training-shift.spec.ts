import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { createApp, type AppOptions } from "../../apps/server/api.ts";
import { Auth } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";

test("coordinators take, edit, route and resolve a shared training ticket while viewers follow its changes", async ({ browser }) => {
  const db = await openDB(":memory:");
  const auth = new Auth();
  const options: AppOptions = {
    auth, stores: new Map([["workspace", new Store(db, "workspace")]]), sources: new Map(),
    publicDemo: true, origin: "", secure: false, staticDir: resolve("dist/web"),
    jurySimulation: { stepDelays: [120_000, 120_000, 120_000, 120_000, 120_000] },
  };
  const app = await createApp(options);
  const contexts: BrowserContext[] = [];
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    options.origin = origin;
    async function signedPage(token: string, username: string, role: "coordinator" | "viewer") {
      auth.sessions.set(auth.digest(token), { username, role, csrf: token, expires: Date.now() + 120_000 });
      const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      await context.addCookies([{ name: "wm_session", value: token, url: origin }]);
      const page = await context.newPage();
      await page.goto(origin + "/simulation");
      await expect(page.getByTestId("live-register")).toBeVisible();
      return page;
    }
    const [anna, ivan, reader] = await Promise.all([
      signedPage("anna", "Анна", "coordinator"), signedPage("ivan", "Иван", "coordinator"), signedPage("reader", "Наблюдатель", "viewer"),
    ]);
    const shiftButton = (page: Page) => page.getByRole("button", { name: /Моя смена/ });
    await expect(shiftButton(reader)).toHaveCount(0);
    await shiftButton(anna).click();
    const shift = anna.getByRole("dialog", { name: "Моя смена" });
    const suggestion = shift.locator("ol li").first();
    const id = (await suggestion.locator("small").first().innerText()).trim();
    await suggestion.getByRole("button", { name: "Взять в работу" }).click();
    await expect(shift.getByRole("status")).toHaveText("Взято в работу: " + id);
    await shift.getByRole("button", { name: /В работе у меня/ }).click();
    await shift.locator("ol li").filter({ hasText: id }).locator(".shift-ticket-link").click();
    const ticketUrl = origin + "/simulation/incident/" + id;
    await expect(anna).toHaveURL(ticketUrl);

    await shiftButton(ivan).click();
    const colleagues = ivan.getByRole("dialog", { name: "Моя смена" });
    await colleagues.getByRole("button", { name: "У коллег" }).click();
    const taken = colleagues.locator("ol li").filter({ hasText: id });
    await expect(taken).toContainText("Анна");
    await taken.locator(".shift-ticket-link").click();
    await expect(ivan).toHaveURL(ticketUrl);
    await reader.goto(ticketUrl);
    const story = (page: Page) => page.getByRole("region", { name: "Карточка инцидента" });
    const ticketActions = (page: Page) => page.getByRole("region", { name: "Работа с учебной заявкой" });
    await expect(story(reader)).toBeVisible();
    await expect(ticketActions(reader)).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "Взять в работу" })).toHaveCount(0);
    await expect(ivan.getByRole("region", { name: "Координатор заявки" })).toContainText("Координатор · Анна");

    const title = "Проверка резервного узла";
    const description = "Дежурный проверил сообщения на резервном узле.";
    const annaActions = ticketActions(anna);
    await annaActions.getByRole("button", { name: "Изменить", exact: true }).click();
    await annaActions.getByLabel("Заголовок").fill(title);
    await annaActions.getByLabel("Описание").fill(description);
    await annaActions.getByRole("button", { name: "Сохранить изменения" }).click();
    for (const page of [ivan, reader]) {
      await expect(story(page).getByRole("heading", { name: title })).toBeVisible();
      await expect(story(page).getByText(description, { exact: true })).toBeVisible();
    }

    const ivanActions = ticketActions(ivan);
    await ivanActions.getByRole("button", { name: "Направить", exact: true }).click();
    const teamSelect = ivanActions.getByRole("combobox", { name: "Команда решения" });
    const team = await teamSelect.locator("option").evaluateAll(options => {
      const destination = (options as HTMLOptionElement[]).find(option => option.value && !option.selected);
      if (!destination) throw new Error("Ожидалась другая команда решения.");
      return destination.value;
    });
    await teamSelect.selectOption(team);
    await ivanActions.getByRole("button", { name: "Передать команде" }).click();
    for (const page of [anna, reader]) {
      await expect(page.getByRole("region", { name: "Текущее состояние" }).getByText(team, { exact: true })).toBeVisible();
    }

    const solution = "Переключение проверено на резервном узле.";
    await annaActions.getByRole("button", { name: "Решить", exact: true }).click();
    await annaActions.getByLabel("Результат решения").fill(solution);
    await annaActions.getByRole("button", { name: "Подтвердить решение" }).click();
    for (const page of [anna, ivan, reader]) {
      await expect(page.getByRole("region", { name: "Текущее состояние" }).getByText("Завершён", { exact: true })).toBeVisible();
    }
    await expect(ivanActions).toContainText(solution);
    await expect(ivanActions.getByRole("button", { name: "Решить", exact: true })).toHaveCount(0);
    await expect(ticketActions(reader)).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await app.close();
    await db.close();
  }
});
