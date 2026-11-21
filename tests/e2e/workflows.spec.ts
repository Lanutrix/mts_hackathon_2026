import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { generate } from "../../packages/domain/generator.ts";
import { passwordHash } from "../../apps/server/auth.ts";
let server: ChildProcess, dir: string, source: string, password: string;
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Необработанные ошибки страницы").toEqual([]);
});
test.beforeAll(async () => {
  dir = resolve(".runtime/e2e/" + randomUUID());
  source = join(dir, "incidents.json");
  await mkdir(dir, { recursive: true });
  await writeFile(source, JSON.stringify(generate(120).rows));
  password = randomBytes(24).toString("hex");
  const salt = randomBytes(16).toString("hex");
  await writeFile(
    join(dir, "users.json"),
    JSON.stringify(
      ["coordinator", "demo-admin", "viewer"].map((role) => ({
        username: role,
        role,
        salt,
        hash: passwordHash(password, salt),
      })),
    ),
  );
  server = spawn(process.execPath, ["--import", "tsx", "apps/server/main.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dir,
      SOURCE_FILE: source,
      USERS_FILE: join(dir, "users.json"),
      PORT: "3210",
      ORIGIN: "http://127.0.0.1:3210",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await expect
    .poll(
      async () => {
        try {
          return (await fetch("http://127.0.0.1:3210/api/health")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 20000 },
    )
    .toBe(200);
});
test.afterAll(async () => {
  server?.kill();
  password = "";
});
async function reset() {
  await writeFile(source, JSON.stringify(generate(120).rows));
  await expect
    .poll(async () => {
      const r = await fetch(
        "http://127.0.0.1:3210/api/incident/DEMO-42-00001",
      ).then((r) => r.json());
      return r.incident?.raw.header;
    })
    .toBe(generate(1).rows[0].header);
}
async function mutate(action: string, arg = "") {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/mutate.ts", source, action, arg],
    { stdio: "ignore", windowsHide: true },
  );
}
async function login(page: Page, role = "coordinator") {
  await page.goto("/login");
  await page.getByLabel("Имя пользователя").fill(role);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Выйти: " + role }),
  ).toBeVisible();
}
test("F01 F02 F03 F04 F09 F10 F12 F13 F17 F29 F36 real file → two browsers without reload", async ({
  page,
  browser,
}) => {
  await reset();
  const second = await browser.newContext();
  const other = await second.newPage();
  await Promise.all([page.goto("/?sort=id"), other.goto("/?sort=id")]);
  await expect(page.getByTestId("count-critical")).toHaveText("12");
  await expect(page.getByTestId("count-coordinators")).toHaveText("36");
  await expect(page.getByTestId("count-high")).toHaveText("12");
  await expect(page.getByTestId("count-research")).toHaveText("24");
  await mutate("critical");
  await expect(page.getByTestId("count-critical")).toHaveText("13");
  await expect(other.getByTestId("count-critical")).toHaveText("13");
  await mutate("coordinator");
  const ticket = page.getByTestId("card-DEMO-42-00001");
  await expect(ticket).toHaveCount(1);
  await expect(ticket).toContainText("У координаторов");
  await page.getByTestId("group-coordinators").click();
  await expect(ticket).toContainText("Критический");
  await page.getByTestId("group-critical").click();
  await page.getByTestId("card-DEMO-42-00001").getByRole("button").click();
  await expect(
    page.getByRole("heading", { name: "Описание", exact: true }),
  ).toBeVisible();
  await mutate("header", "Обновлено без перезагрузки");
  await expect(
    page.getByRole("heading", {
      name: "Обновлено без перезагрузки",
      exact: true,
    }),
  ).toBeVisible();
  await mutate("state", "7");
  await expect(other.getByTestId("count-critical")).toHaveText("12");
  await expect(
    other.getByRole("region", { name: "Недавние решения" }),
  ).toContainText("DEMO-42-00001");
  await mutate("state", "2");
  await expect(other.getByTestId("count-critical")).toHaveText("13");
  await mutate("state", "20");
  await expect(other.getByTestId("count-critical")).toHaveText("12");
  await expect(other.getByTestId("count-research")).toHaveText("25");
  await expect(other.getByTestId("count-coordinators")).toHaveText("37");
  await other.context().setOffline(true);
  await expect(other.getByTestId("source-status")).toContainText(
    /Нет сети|прервана/,
  );
  await mutate("header", "Восстановление связи");
  await other.context().setOffline(false);
  await other.getByTestId("group-research").click();
  await expect(other.getByTestId("live-register")).toContainText(
    "Восстановление связи",
  );
  await second.close();
});
test("F15 F16 F21 F22 keyboard search navigation mock wallboard and viewports", async ({
  page,
}, info) => {
  await reset();
  await page.goto("/");
  await page.getByRole("searchbox").fill("DEMO-42-00019");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await expect(page).toHaveURL(/q=DEMO/);
  await page
    .getByTestId("card-DEMO-42-00019")
    .first()
    .getByRole("button")
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Описание", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Открыть в ITSM (макет)" }).click();
  await expect(
    page.getByText("Макет перехода в SimpleOne", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Показан тот же инцидент DEMO-42-00019/),
  ).toBeVisible();
  await page.goto("/wallboard");
  for (const width of [390, 1024, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 900 });
    await expect(page.getByTestId("group-critical")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(".runtime/qa/" + info.project.name + "-" + width + ".png"),
      fullPage: false,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("count-critical")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "К содержимому" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("F18 F20 F23 F24 F33 F34 F35 authenticated settings/import/demo", async ({
  page,
}, info) => {
  await login(page, "demo-admin");
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Часовой пояс", { exact: true }).selectOption("UTC");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByRole("status").last()).toHaveText(
    "Настройки сохранены",
  );
  await page.reload();
  await expect(page.getByLabel("Часовой пояс", { exact: true })).toHaveValue(
    "UTC",
  );
  await page.getByRole("link", { name: "Импорт", exact: true }).click();
  await page.getByLabel("JSON-файл").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{"),
  });
  await expect(page.getByRole("alert")).toContainText("Некорректный JSON");
  const rows = generate(120).rows;
  await page.getByLabel("JSON-файл").setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(rows)),
  });
  await expect(
    page.getByRole("heading", { name: "Предпросмотр" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Принять снимок" }).click();
  await expect(
    page.getByRole("button", { name: "Снимок принят" }),
  ).toBeVisible();
  const raw = await page.request.get("/api/export");
  expect(await raw.json()).toEqual(rows);
  await page.getByRole("link", { name: "Демонстрация", exact: true }).click();
  await page.getByRole("button", { name: "Следующий шаг" }).click();
  await page.getByRole("link", { name: "Уведомления", exact: true }).click();
  await expect(
    page.getByText("DEMO-SCENARIO", { exact: true }).first(),
  ).toBeVisible();
  const unread = page
    .getByRole("button", { name: "Отметить прочитанным" })
    .first();
  await unread.click();
  await expect(
    page.getByRole("button", { name: "Прочитано", exact: true }).first(),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Прочитано", exact: true }).first(),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Выйти: demo-admin" }).click();
  await expect(
    page.getByRole("link", { name: "Войти", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/demo", { data: { action: "reset" } })
    ).status(),
  ).toBe(401);
});
test("F22 no serious/critical automated accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("count-critical")).not.toHaveText("");
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
  await page.goto("/login");
  const loginReport = await new AxeBuilder({ page }).analyze();
  expect(
    loginReport.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
});

test("F08 F14 F28 exact deadline, null and untrusted HTML stay visible without execution", async ({
  page,
}) => {
  await reset();
  await mutate("critical");
  await mutate("deadline", "2026-11-21T09:00:00Z");
  await page.clock.setFixedTime(new Date("2026-11-21T09:00:00Z"));
  await page.goto("/?sort=id");
  const card = page.getByTestId("card-DEMO-42-00001").first();
  await expect(card).toContainText("Срок близко");
  await page.clock.setFixedTime(new Date("2026-11-21T09:00:01Z"));
  await expect(card).toContainText("Просрочен");
  await mutate("deadline", "null");
  await expect(card).toContainText("Срок не задан");
  await mutate("flags");
  await expect(card).toContainText("Требует эскалации");
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await mutate("header", "<img src=x onerror=alert(1)>");
  await expect(card.getByRole("button")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  expect(dialogs).toEqual([]);
  expect(await card.locator("img").count()).toBe(0);
});
