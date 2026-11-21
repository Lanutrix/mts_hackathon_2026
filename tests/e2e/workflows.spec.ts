import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { generate } from "../../packages/domain/generator.ts";
import { passwordHash } from "../../apps/server/auth.ts";
let server: ChildProcess, dir: string, source: string, password: string;
const fixtureRoot = resolve(".runtime/e2e");
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "Необработанные ошибки страницы").toEqual([]);
});
test.beforeEach(async () => {
  await mkdir(fixtureRoot, { recursive: true });
  dir = await mkdtemp(join(fixtureRoot, "workflow-"));
  source = join(dir, "incidents.json");
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
test.afterEach(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  password = "";
  if (dir && dirname(dir) === fixtureRoot)
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
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
  await expect(page).toHaveURL("/live");
}
test("public landing shows only the hero and opens either screen", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) apiCalls.push(path);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto("/");
  const title = page.getByRole("heading", { name: "Инциденты в фокусе." });
  await expect(title).toBeVisible();
  await expect(page.getByRole("link", { name: "Войти" })).toHaveAttribute(
    "href",
    "/login",
  );
  const main = page.getByRole("main");
  await expect(main.getByRole("heading")).toHaveCount(1);
  await expect(main.getByRole("link")).toHaveCount(2);
  await expect(main.getByRole("button")).toHaveCount(0);
  await expect(main.getByText("Сигналы эфира")).toHaveCount(0);
  await expect(page).toHaveURL("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.clock.fastForward(6000);
  expect(apiCalls).toEqual([]);
  await page.getByRole("link", { name: "Открыть эфир" }).click();
  await expect(page).toHaveURL("/live");
  await expect(page.getByTestId("live-register")).toBeVisible();
  await page.goBack();
  await expect(title).toBeVisible();
  apiCalls.length = 0;
  await page.clock.fastForward(6000);
  expect(apiCalls).toEqual([]);
  await page.getByRole("link", { name: "Рабочая очередь" }).click();
  await expect(page).toHaveURL("/workspace");
  await expect(page.getByRole("region", { name: "Инциденты" })).toBeVisible();
  await page.goBack();
  await expect(title).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("region", { name: "Инциденты" })).toBeVisible();
});
test("jury viewers receive the same observed events and dismiss them independently", async ({
  page,
  browser,
}) => {
  test.setTimeout(75000);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.method() + " " + r.url());
  });
  await page.goto("/simulation");
  const current = page.getByRole("region", { name: "Инцидент в эфире" });
  const banner = page.getByRole("region", { name: "Уведомление об инциденте" });
  const journal = page.getByRole("region", { name: "Журнал сигналов" });
  await expect(current).toContainText("SIM-001");
  await expect(banner).toContainText("Новый критический инцидент", {
    timeout: 12000,
  });
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const second = await guest.newPage();
    await second.goto("/simulation");
    const secondNotice = second.getByRole("region", {
      name: "Уведомление об инциденте",
    });
    await expect(secondNotice).toContainText("Новый критический инцидент");
    await banner
      .getByRole("button", { name: "Скрыть это уведомление" })
      .click();
    await expect(banner).toHaveCount(0);
    await expect(secondNotice).toBeVisible();
    await page.reload();
    await expect(current).toContainText("SIM-001");
    await expect(banner).toHaveCount(0);
    await expect(banner).toContainText("Назначен группе координаторов", {
      timeout: 16000,
    });
    await banner.getByRole("button", { name: "Открыть инцидент" }).click();
    const detail = page.getByRole("region", { name: "Сведения об инциденте" });
    await expect(detail).toContainText("Рекомендация координатору");
    await expect(banner).toHaveCount(0);
    await expect(current).toContainText("У координаторов");
    await expect(banner).toContainText("Критический инцидент завершён", {
      timeout: 27000,
    });
    await expect(journal.locator("li")).toHaveCount(3);
    await journal
      .getByRole("button")
      .filter({ hasText: "Новый критический инцидент" })
      .click();
    await expect(detail).toContainText("Снимок события, версия 2");
    await expect(detail).toContainText("Сопровождение платежей");
    expect(writes).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("legacy live bookmarks keep filters, fragments and browser history", async ({
  page,
}) => {
  await page.goto("/");
  const filters = "?ns=demo&q=DEMO-42-00019&sort=id#main";
  await page.goto("/" + filters);
  await expect(page).toHaveURL("/live" + filters);
  await expect(page.getByRole("searchbox")).toHaveValue("DEMO-42-00019");
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Инциденты в фокусе." }),
  ).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL("/live" + filters);
  await expect(page.getByTestId("live-count")).toHaveText("1");
  await page.goto("/?ns=demo");
  await expect(page).toHaveURL("/live?ns=demo");
  await expect(page.getByTestId("live-register")).toBeVisible();
});
test("F01 F02 F03 F04 F09 F10 F12 F13 F17 F29 F36 real file → two browsers without reload", async ({
  page,
  browser,
}) => {
  await reset();
  const second = await browser.newContext();
  const other = await second.newPage();
  await Promise.all([page.goto("/live?sort=id"), other.goto("/live?sort=id")]);
  await expect(page.getByTestId("count-critical")).toHaveText("12");
  await expect(page.getByTestId("count-coordinators")).toHaveText("36");
  await expect(page.getByTestId("count-high")).toHaveText("12");
  await expect(page.getByTestId("count-research")).toHaveText("24");
  await mutate("critical");
  await expect(page.getByTestId("count-critical")).toHaveText("13");
  await expect(other.getByTestId("count-critical")).toHaveText("13");
  const notice = other.getByRole("region", {
    name: "Уведомление об инциденте",
  });
  await expect(notice).toContainText("Новый критический инцидент");
  await expect(notice).toContainText("Платёжный шлюз");
  await mutate("coordinator");
  const ticket = page.getByTestId("card-DEMO-42-00001");
  await expect(ticket).toHaveCount(1);
  await expect(ticket).toContainText("У координаторов");
  await expect(notice).toContainText("Назначен группе координаторов");
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
  await expect(notice).toContainText("Критический инцидент завершён");
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
  await page.goto("/live");
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
  await page.getByRole("link", { name: "Обычный режим" }).click();
  await expect(page).toHaveURL("/live");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/live");
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
  await page.getByRole("link", { name: /Watermelon/ }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "Рабочая очередь" }).click();
  await expect(page).toHaveURL("/workspace");
  await expect(
    page.getByRole("button", { name: "Выйти: demo-admin" }),
  ).toBeVisible();
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
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Инциденты в фокусе." }),
  ).toBeVisible();
  await page.goBack();
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
  const screens = [
    ["/", page.getByRole("heading", { name: "Инциденты в фокусе." })],
    ["/live", page.getByTestId("count-critical")],
    ["/login", page.getByLabel("Имя пользователя")],
  ] as const;
  for (const [path, marker] of screens) {
    await page.goto(path);
    await expect(marker).toBeVisible();
    const report = await new AxeBuilder({ page }).analyze();
    expect(
      report.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      ),
      path,
    ).toEqual([]);
  }
});

test("F08 F14 F28 exact deadline, null and untrusted HTML stay visible without execution", async ({
  page,
}) => {
  await reset();
  await mutate("critical");
  await mutate("deadline", "2026-11-21T09:00:00Z");
  await page.clock.setFixedTime(new Date("2026-11-21T09:00:00Z"));
  await page.goto("/live?sort=id");
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
