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
  const rows = generate(15).rows;
  const names = [
    "Анна Орлова", "Борис Егоров", "Вера Белова", "Галина Петрова",
    "Денис Попов", "Евгений Серов", "Жанна Соколова", "Зоя Иванова",
    "Игорь Мельников", "Кира Алексеева", "Лев Артамонов", "Яна Сафонова",
  ];
  rows.forEach((row, i) => Object.assign(row, {
    productName: "Личный кабинет", header: "Ошибка при входе",
    assignedGroupName: "Платформа", assignedEmployee: names[i - 1] ?? null,
    assignedEmployeeLogin: i > 0 && i <= names.length ? "agent-" + i : null,
    priorityId: 1, priority: "Низкий",
  }));
  Object.assign(rows[0], {
    assignedGroupName: "Координация",
    customField: { empty: null, nested: ["образец", false] },
    priorityId: 4,
    priority: "Наивысший",
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  Object.assign(rows[13], { assignedGroupName: "Сеть", assignedEmployee: "Илья Лукин" });
  Object.assign(rows[14], { assignedGroupName: "Архив" });
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
    const feed = origin + "/live?groupBy=team";
    await page.goto(feed);
    const login = page.getByRole("dialog");
    await expect(login).toBeVisible();
    await login.getByLabel("Имя пользователя").fill("дежурный");
    await login.getByLabel("Пароль").fill(password);
    await login.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(feed);
    await page.getByTestId("live-guidance").getByRole("link", { name: "Открыть заявку " + rows[0].id }).click();
    await expect(page).toHaveURL(new RegExp("/incident/" + rows[0].id));
    const facts = page.getByRole("region", { name: "Текущее состояние" });
    await expect(facts).toContainText("Координация");
    await expect(facts).toContainText("Срок решения");
    await expect(facts).toContainText("Исполнитель");
    const raw = page.getByText("Исходная запись JSON", { exact: true });
    await raw.focus();
    await page.keyboard.press("Enter");
    const source = page.getByRole("textbox", { name: "Исходный JSON инцидента" });
    expect(JSON.parse(await source.inputValue())).toEqual(rows[0]);
    const columns = page.locator(".ticket-columns");
    const actions = columns.locator(".ticket-actions");
    const story = columns.locator(".ticket-story");
    await expect(actions).toHaveCSS("position", "sticky");
    const beforeScroll = await actions.boundingBox();
    expect(await story.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    })).toBeGreaterThan(0);
    expect((await actions.boundingBox())?.y).toBe(beforeScroll?.y);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(story).toHaveCSS("overflow-y", "visible");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "Скопировать JSON" }).click();
    await expect(page.getByRole("status").filter({ hasText: /JSON скопирован|JSON выделен/ })).toBeVisible();
    await raw.press("Enter");
    const panel = page.getByRole("region", { name: "Маршрутизация" });
    await expect(panel).toBeVisible();
    const team = panel.getByRole("combobox", { name: "Команда назначения" });
    const search = panel.getByRole("searchbox", { name: "Найти исполнителя" });
    const review = panel.getByRole("button", { name: "Проверить решение" });
    await expect(team).toHaveValue("");
    await expect(review).toBeDisabled();
    await panel.getByRole("button", { name: "Предложить команду решения" }).click();
    await expect(panel.getByText("Совпали продукт и симптом в других инцидентах команды: 12.", { exact: true })).toBeVisible();
    await expect(team).toHaveValue("");
    await panel.getByRole("button", { name: "Выбрать команду Платформа" }).click();
    await expect(team).toHaveValue("Платформа");
    await expect(panel.getByRole("radio", {name: /Вся команда/})).toBeChecked();
    const note = panel.getByRole("textbox", { name: "Комментарий" });
    await note.fill("Мой текст");
    await panel.getByRole("button", { name: "Предложить комментарий" }).click();
    const suggestion = panel.getByRole("group", {name: "Зона ответственности"});
    const proposedText = await suggestion.locator("p").innerText();
    await expect(note).toHaveValue("Мой текст");
    await suggestion.getByRole("button", { name: "Заменить комментарий", exact: true }).click();
    await expect(note).toHaveValue(proposedText);
    await panel.getByText("Выбрать сотрудника", { exact: true }).click();
    const laterMember = panel.getByRole("radio", { name: /Яна Сафонова/ });
    await expect(laterMember).toHaveCount(0);
    await panel.getByRole("button", { name: /Показать ещё/ }).click();
    await expect(laterMember).toBeVisible();
    await search.fill("никого");
    await expect(panel.getByText("Исполнители не найдены")).toBeVisible();
    await search.fill("AGENT-12");
    await laterMember.focus();
    await page.keyboard.press("Space");
    await expect(laterMember).toBeChecked();
    await team.selectOption("Архив");
    await expect(review).toBeEnabled();
    await expect(search).toHaveCount(0);
    await panel.getByRole("radio", { name: /Вся команда/ }).check();
    await review.click();
    const preview = panel.getByRole("region", { name: "Проверка перед сохранением" });
    await expect(preview).toContainText("Архив");
    await expect(preview).toContainText("Вся команда");
    await expect(preview).not.toContainText("Яна Сафонова");
    await preview.getByRole("button", { name: "Изменить выбор" }).click();
    await team.selectOption("Платформа");
    await panel.getByText("Выбрать сотрудника", { exact: true }).click();
    await expect(search).toHaveValue("");
    await search.fill("сафонова");
    await laterMember.check();
    await panel
      .getByRole("textbox", { name: "Комментарий" })
      .fill("Проверить журнал авторизации");
    await review.click();
    await expect(preview).toContainText("Проверить журнал авторизации");
    await expect(preview).toContainText("Яна Сафонова");
    await expect(preview).toContainText("agent-12");
    await panel.getByRole("button", { name: "Сохранить решение" }).click();
    await expect(panel.getByRole("status")).toContainText("Решение сохранено");
    await page.reload();
    await expect(panel).toContainText("дежурный");
    await expect(panel).toContainText("Проверить журнал авторизации");
    const journal = panel.getByRole("region", { name: "Журнал решений" });
    await expect(journal).toContainText("Яна Сафонова (agent-12)");
    await journal.getByRole("link", { name: "Посмотреть макет ITSM" }).click();
    await expect(page).toHaveURL(new RegExp("/itsm/" + rows[0].id));
    await page.goBack();
    await expect(journal).toContainText("Яна Сафонова (agent-12)");
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole("button", { name: "Изменить назначение" }).click();
    await team.selectOption("Сеть");
    await panel.getByRole("radio", { name: /Вся команда/ }).check();
    await review.click();
    await preview.getByRole("button", { name: "Сохранить решение" }).click();
    await expect(journal).toContainText("Сеть");
    await journal.getByText(/Предыдущие решения/).click();
    await expect(journal).toContainText("Проверить журнал авторизации");
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await journal.getByRole("link", { name: "Вернуться в эфир" }).click();
    await expect(page).toHaveURL(feed);
    const stamp = page.getByRole("status").filter({ hasText: "Решение в журнале" });
    await expect(stamp).toContainText(String(rows[0].id));
    await expect(stamp).toContainText("Сеть");
    await expect(page.getByTestId("card-" + rows[0].id)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("live-register")).toBeVisible();
    await expect(stamp).toHaveCount(0);
  } finally {
    await page.close();
    await app.close();
    await db.close();
  }
});
