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
          return (await fetch("http://127.0.0.1:3210/health/ready")).status;
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
async function reset(page: Page) {
  await writeFile(source, JSON.stringify(generate(120).rows));
  await expect
    .poll(async () => {
      const r = await page.request
        .get("http://127.0.0.1:3210/api/incident/DEMO-42-00001")
        .then((r) => r.json());
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
    page.getByRole("button", { name: "Профиль: " + role }),
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
  await expect(main.getByText("Сигналы эфира")).toHaveCount(0);
  await expect(page).toHaveURL("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.clock.fastForward(6000);
  expect(apiCalls).toEqual([]);
  await page.getByRole("link", { name: "ИИ-помощник" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("live-register")).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть вход" }).click();
  await expect(title).toBeVisible();
  const ticket = "/incident/DEMO-42-00019?ns=demo#main";
  await page.goto(ticket);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Основная навигация" }),
  ).toHaveCount(0);
  for (const route of [
    "/api/export",
    "/api/dashboard",
    "/api/canvas",
    "/api/canvas/tickets",
    "/api/incident/DEMO-42-00019",
    "/api/simulation/stream",
    "/api/stream?ns=simulation",
    "/api/public/focus",
  ])
    expect((await page.request.get(route)).status()).toBe(401);
  await page.getByLabel("Имя пользователя").fill("viewer");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(ticket);
  await expect(page.locator("main .detail")).toContainText("DEMO-42-00019");
});
async function viewerSession(page: Page) {
  const result = await page.request.post("/api/login", {
    data: { username: "viewer", password },
  });
  expect(result.ok()).toBe(true);
}
test.beforeEach(async ({ page }, info) => {
  if (
    !info.title.startsWith("public landing") &&
    !info.title.startsWith("F18 ")
  )
    await viewerSession(page);
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
  const current = page.getByTestId("live-register");
  const banner = page.getByRole("region", { name: "Уведомление об инциденте" });
  await expect(page.getByRole("heading", { name: "Эфир смены" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "ИИ-помощник" }),
  ).toHaveAttribute("href", "/simulation/workspace");
  await expect(current).toBeVisible();
  await expect(banner).toContainText("Новый критический инцидент", {
    timeout: 12000,
  });
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    const second = await guest.newPage();
    await viewerSession(second);
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
    await expect(page.locator(".melon-tracker")).toHaveAttribute(
      "data-ticket",
      "SIM-001",
    );
    await expect(banner).toHaveCount(0);
    await expect(banner).toContainText("Назначен группе координаторов", {
      timeout: 16000,
    });
    await banner.getByRole("button", { name: "Открыть инцидент" }).click();
    await expect(page).toHaveURL("/simulation/incident/SIM-001");
    const detail = page.locator("main .detail");
    await expect(detail).toContainText("Рекомендация координатору");
    await expect(banner).toHaveCount(0);
    await expect(detail.getByText("Команда", { exact: true })).toBeVisible();
    await expect(banner).toContainText("Критический инцидент завершён", {
      timeout: 27000,
    });
    await page.getByRole("link", { name: "Уведомления", exact: true }).click();
    await expect(page).toHaveURL("/simulation/notifications");
    const events = page.locator("main .notification");
    await expect(events).toHaveCount(3);
    const critical = events.filter({
      has: page.getByRole("heading", {
        name: "Критический инцидент",
        exact: true,
      }),
    });
    await critical.getByText("На момент сигнала").click();
    await expect(critical).toContainText("Сопровождение платежей");
    await page.getByRole("link", { name: "ИИ-помощник" }).click();
    await expect(
      page.getByRole("heading", { name: "Холст смены" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("source-status")).toContainText(
      "Учебный эфир",
    );
    await page.getByRole("button", { name: "Дополнительные разделы" }).click();
    await page.getByRole("link", { name: "История", exact: true }).click();
    await expect(page).toHaveURL("/simulation/history");
    await expect(page.locator("main")).toContainText("SIM-001");
    await page.goBack();
    await expect(page).toHaveURL("/simulation/workspace");
    expect(writes).toEqual([]);
  } finally {
    await guest.close();
  }
});

test("the 3D surface rotates the chosen object with reduced motion and follows incident filters", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/live");
  const scene = page.locator(".melon-scene");
  await expect(scene).toHaveAttribute("data-mode", /^(webgl|canvas)$/);
  await expect(scene.getByRole("button")).toHaveCount(0);
  await expect(scene).toHaveAttribute("data-paused", "true");
  const surface = scene.locator(".melon-view");
  for (const [key, target] of [
    ["2", "frame"],
    ["1", "fruit"],
  ]) {
    await surface.press(key);
    await expect(scene).toHaveAttribute("data-object", target);
    await surface.press("Home");
    const before = await surface.screenshot();
    await surface.press("Shift+ArrowRight");
    await expect
      .poll(async () => !(await surface.screenshot()).equals(before))
      .toBe(true);
  }
  await page.getByTestId("group-critical").click();
  await expect(scene).toHaveAttribute("data-active", "critical");
  await expect(scene).toHaveAccessibleName(/Критические/);
  await expect(scene.locator(".melon-tracker")).toHaveAttribute(
    "data-group",
    "critical",
  );
  await page.locator(".case-insight .case-source").click();
  await expect(
    page.getByRole("region", { name: "Маршрутизация" }),
  ).toBeVisible();
});

test("cases rank the filtered queue, explain the source tickets and fit the viewport", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/live");
  const register = page.getByTestId("live-register"),
    rows = register.locator("tbody tr");
  const ids = () =>
    rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    );
  await expect(rows.first()).toBeVisible();
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 768, height: 820 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        rows
          .last()
          .evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY),
      )
      .toBeLessThanOrEqual(viewport.height);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
  }
  const before = await ids();
  await page
    .getByRole("button", { name: "Следующая страница", exact: true })
    .click();
  await expect.poll(ids).not.toEqual(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const dimension = page.getByLabel("Группировка кейсов"),
    pick = page.getByLabel("Выбрать кейс");
  for (const value of ["team", "product", "priority", "symptom"]) {
    const load = page.waitForResponse(
      (r) =>
        r.url().includes("/api/dashboard?") &&
        new URL(r.url()).searchParams.get("groupBy") === value,
    );
    await dimension.selectOption(value);
    await load;
    await expect(dimension).toHaveValue(value);
  }
  await pick.selectOption({ index: 1 });
  await expect(register.locator(".triage-ledger-title small")).toBeVisible();
  const caseId = await pick.inputValue();
  const board = await (
    await page.request.get("/api/dashboard?ns=demo&groupBy=symptom")
  ).json();
  const c = board.triage.cases.find(
    (record: { id: string }) => record.id === caseId,
  );
  const detail = await (
    await page.request.get(
      "/api/triage/" +
        encodeURIComponent(c.id) +
        "?ns=demo&revision=" +
        board.revision +
        "&hash=" +
        c.hash +
        "&limit=1",
    )
  ).json();
  await expect(rows.first()).toHaveAttribute(
    "data-testid",
    "card-" + detail.items[0].id,
  );
  await expect(page.locator(".melon-tracker")).toHaveAttribute(
    "data-ticket",
    c.lead.id,
  );
  await page.goto("/simulation");
  await expect(rows.first()).toBeVisible();
  await page.locator(".case-analyze").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".case-result")).toBeVisible({ timeout: 25000 });
  const evidence = dialog.locator(".case-evidence button").first();
  await expect(evidence).toHaveText(/SIM-/);
  await evidence.click();
  await expect(page).toHaveURL(/\/simulation\/incident\/SIM-/);
});

test("search and ticket loading keep focus and remove their indicators when data arrives", async ({
  page,
}) => {
  await page.goto("/live");
  await expect(page.getByTestId("live-register")).toBeVisible();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q")) await hold;
    await route.continue().catch(() => {});
  });
  const search = page.getByRole("searchbox");
  await search.fill("DEMO-42-00019");
  await expect(page.getByText("Поиск инцидентов…")).toBeVisible();
  await expect(search).toBeFocused();
  release();
  const ticket = page.getByTestId("card-DEMO-42-00019");
  await expect(ticket).toBeVisible();
  await expect(page.getByText("Поиск инцидентов…")).toHaveCount(0);
  let showDetail!: () => void;
  const waitDetail = new Promise<void>((resolve) => {
    showDetail = resolve;
  });
  await page.route("**/api/incident/*", async (route) => {
    await waitDetail;
    await route.continue().catch(() => {});
  });
  await ticket.getByRole("button").click();
  await expect(page.getByText("Загрузка раздела…")).toBeVisible();
  showDetail();
  await expect(page.getByRole("heading", { name: "Описание" })).toBeVisible();
  await expect(page.getByText("Загрузка раздела…")).toHaveCount(0);
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
  await reset(page);
  const second = await browser.newContext();
  const other = await second.newPage();
  await viewerSession(other);
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
  await reset(page);
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
test("an unenrolled device opens settings without querying the native push service", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if ("PushManager" in window) {
      PushManager.prototype.getSubscription = async () => {
        throw new Error(
          "Unexpected native push lookup on an unenrolled device",
        );
      };
    }
  });
  const loginResponse = await page.request.post("/api/login", {
    data: { username: "coordinator", password },
  });
  expect(loginResponse.ok()).toBeTruthy();
  await page.goto("/preferences");
  const device = page.getByRole("region", {
    name: "Уведомления на этом устройстве",
  });
  await expect(device.getByRole("status")).toHaveText(
    "Выключены на этом устройстве.",
  );
});
test("F18 F20 F23 F24 F33 F34 F35 authenticated settings/import/demo", async ({
  page,
}, info) => {
  await login(page, "demo-admin");
  await page.getByRole("link", { name: /Срез/ }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: "ИИ-помощник" }).click();
  await expect(page).toHaveURL("/workspace");
  await expect(
    page.getByRole("button", { name: "Профиль: demo-admin" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Профиль: demo-admin" }).click();
  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Часовой пояс", { exact: true }).selectOption("UTC");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(
    page.getByText("Настройки сохранены", { exact: true }),
  ).toHaveText("Настройки сохранены");
  await page.reload();
  await expect(page.getByLabel("Часовой пояс", { exact: true })).toHaveValue(
    "UTC",
  );
  await page.getByRole("button", { name: "Профиль: demo-admin" }).click();
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
  await page.getByRole("button", { name: "Профиль: demo-admin" }).click();
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
  await page.getByRole("button", { name: "Профиль: demo-admin" }).click();
  await page.getByRole("button", { name: "Выйти: demo-admin" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Инциденты в фокусе." }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeVisible();
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
  await reset(page);
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
