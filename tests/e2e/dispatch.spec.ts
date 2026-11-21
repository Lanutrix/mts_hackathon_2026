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
    await page.goto(origin + "/live");
    const login = page.getByRole("dialog");
    await expect(login).toBeVisible();
    await login.getByLabel("Имя пользователя").fill("дежурный");
    await login.getByLabel("Пароль").fill(password);
    await login.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page).toHaveURL(origin + "/live");
    await page.getByRole("button", { name: "Назначить исполнителя для " + rows[0].id }).click();
    await expect(page).toHaveURL(new RegExp("/incident/" + rows[0].id));
    const panel = page.getByRole("region", { name: "Маршрутизация" });
    await expect(panel).toBeVisible();
    const team = panel.getByRole("combobox", { name: "Команда назначения" });
    const search = panel.getByRole("searchbox", { name: "Найти исполнителя" });
    const review = panel.getByRole("button", { name: "Проверить решение" });
    await expect(team).toHaveValue("Платформа");
    await expect(review).toBeDisabled();
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
    await expect(review).toBeDisabled();
    await expect(search).toHaveCount(0);
    await panel.getByRole("radio", { name: /Вся команда/ }).check();
    await review.click();
    const preview = panel.getByRole("region", { name: "Проверка перед сохранением" });
    await expect(preview).toContainText("Архив");
    await expect(preview).toContainText("Вся команда");
    await expect(preview).not.toContainText("Яна Сафонова");
    await preview.getByRole("button", { name: "Изменить выбор" }).click();
    await team.selectOption("Платформа");
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
  } finally {
    await page.close();
    await app.close();
    await db.close();
  }
});
