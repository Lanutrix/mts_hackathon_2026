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
test("dictation preserves the draft and help links retain the selected source", async ({ page }) => {
  await page.addInitScript(() => {
    class Recognition {
      onresult?: (value: unknown) => void;
      onerror?: (value: unknown) => void;
      onend?: () => void;
      start() {
        window.addEventListener("test-speech", this);
      }
      handleEvent(event: Event) {
        const sample = (event as CustomEvent).detail;
        if (sample.error) {
          this.onerror?.(sample);
          this.stop();
        } else this.onresult?.({ results: [{ 0: { transcript: sample.words }, isFinal: sample.final }] });
      }
      stop() { window.removeEventListener("test-speech", this); this.onend?.(); }
      abort() { this.stop(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
  });
  await login(page);
  await page.goto("/workspace");
  const draft = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  const mic = page.getByRole("button", { name: "Продиктовать вопрос" });
  const emit = (detail: object) => page.evaluate(d => { window.dispatchEvent(new CustomEvent("test-speech", { detail: d })); }, detail);
  await draft.fill("Покажи");
  await mic.click();
  await emit({words: "первый", final: false});
  await expect(draft).toHaveValue("Покажи");
  await emit({words: "самый первый инцидент", final: true});
  await emit({words: "самый первый инцидент", final: true});
  await page.getByRole("button", { name: "Завершить диктовку" }).click();
  await expect(draft).toHaveValue("Покажи самый первый инцидент");
  await mic.click();
  await emit({error: "not-allowed"});
  await expect(page.getByText("Разрешите микрофон в настройках сайта.")).toBeVisible();
  await expect(draft).toHaveValue("Покажи самый первый инцидент");
  await page.goto("/simulation/help");
  const contents = page.getByRole("navigation", {name: "Содержание помощи"});
  await expect(contents.getByRole("link")).toHaveCount(8);
  await expect(contents.locator("a svg")).toHaveCount(8);
  await contents.getByRole("link", {name: "ИИ-помощник"}).click();
  await expect(page).toHaveURL(/\/simulation\/help#assistant$/);
  await page.goto("/simulation/quality?offset=50");
  await expect(page).toHaveURL("/simulation");
  await page.goto("/quality?ns=original&offset=50");
  await expect(page).toHaveURL("/live?ns=original");
  await expect(page.getByRole("link", {name: "Качество данных", includeHidden: true})).toHaveCount(0);
});

test("technical intake accepts successive incidents and an atomic JSON batch in the selected source", async ({ page }) => {
  await login(page, "demo-admin");
  await expect(page.getByTestId("live-register")).toBeVisible();
  await page.goto("/intake?ns=workspace");
  const registered = page.getByLabel("Регистрация (UTC)", { exact: true });
  await expect(registered).not.toHaveValue("");
  await registered.fill("2026-11-21T09:00");
  await page.getByLabel("Срок решения (UTC)").fill("2026-11-21T10:00");
  await page.getByLabel("ID инцидента", { exact: true }).fill("INC-UI-1");
  await page.getByLabel("Тема", { exact: true }).fill("Платёж не проходит");
  const priority = page.getByRole("combobox", {name: "Приоритет", exact: true});
  await priority.press("Enter");
  await page.getByRole("listbox", {name: "Приоритет"}).getByRole("option", {name: "Наивысший"}).click();
  await expect(priority).toHaveValue("4");
  // WebKit's active service worker bypasses Playwright routing. Let the server
  // commit the real POST, then simulate the lost receipt at the fetch consumer.
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch.call(window, ...args);
      if (response.ok && new URL(response.url).pathname === "/api/intake") {
        window.fetch = originalFetch;
        return Response.json({ message: "Ответ сервера потерян" }, { status: 503 });
      }
      return response;
    };
  });
  await page.getByRole("button", { name: "Добавить инцидент", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ответ сервера потерян" })).toBeVisible();
  await expect(registered).toHaveValue("2026-11-21T09:00");
  await page.getByRole("button", { name: "Добавить инцидент", exact: true }).click();
  await expect(page.getByText("Уже в источнике 1", { exact: true })).toBeVisible();
  const first = page.getByRole("link", { name: "INC-UI-1", exact: true });
  await expect(first).toHaveAttribute("href", "/incident/INC-UI-1?ns=workspace");
  await expect(priority).toHaveValue("2");
  const stored = await (await page.request.get("/api/incident/INC-UI-1?ns=workspace")).json();
  expect(stored.incident.priorityId).toBe(4);
  await expect(page.getByLabel("ID инцидента", { exact: true })).toHaveValue("");
  await page.getByLabel("ID инцидента", { exact: true }).fill("INC-UI-2");
  await page.getByLabel("Тема", { exact: true }).fill("Ошибка авторизации");
  await page.getByRole("combobox", { name: "Статус", exact: true }).selectOption("7");
  await registered.fill("2026-11-21T11:00");
  await page.getByLabel("Фактическое время решения (UTC)").fill("2026-11-21T11:45");
  await page.getByLabel("Решение", { exact: true }).fill("Вход восстановлен");
  await page.getByRole("button", { name: "Добавить инцидент", exact: true }).click();
  await expect(page.getByRole("link", { name: "INC-UI-2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Пакет JSON", exact: true }).click();
  const records = generate(2, 973).rows;
  await page.getByLabel("Записи в формате JSON").fill(JSON.stringify(records));
  await page.getByRole("button", { name: "Отправить JSON" }).click();
  await expect(page.getByText("Добавлено 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Отправить JSON" }).click();
  await expect(page.getByText("Уже в источнике 2", { exact: true })).toBeVisible();
  await page.getByLabel("Записи в формате JSON").fill(JSON.stringify([records[0], { ...records[1], header: "Конфликт" }]));
  await page.getByRole("button", { name: "Отправить JSON" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Запись 2" })).toContainText(String(records[1].id));
  const attachments = page.getByLabel("Прикрепить JSON");
  const send = page.getByRole("button", {name:"Отправить JSON"});
  const sourceFile = (name: string, content: string) => ({name, mimeType:"application/json", buffer:Buffer.from(content)});
  const attached = generate(3, 975).rows;
  const objectFile = sourceFile("обращение.json", "\uFEFF" + JSON.stringify(attached[0]));
  await attachments.setInputFiles([objectFile, sourceFile("сломанный.json", "{")]);
  await send.click();
  await expect(page.getByRole("alert")).toContainText("сломанный.json");
  expect(await (await page.request.get("/api/export?ns=workspace")).json()).toHaveLength(4);
  await attachments.setInputFiles([objectFile, sourceFile("пакет.json", JSON.stringify(attached.slice(1)))]);
  await expect(page.getByRole("list",{name:"Прикреплённые файлы"})).toContainText("пакет.json");
  await send.click();
  await expect(page.getByText("Добавлено 3", {exact:true})).toBeVisible();
  await send.click();
  await expect(page.getByText("Уже в источнике 3", {exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Убрать файлы"}).click();
  await expect(page.getByLabel("Записи в формате JSON")).toBeVisible();
  const exported = await (await page.request.get("/api/export?ns=workspace")).json();
  expect(exported).toHaveLength(7);
  expect(exported[0]).toMatchObject({ submitDate: "2026-11-21T09:00:00.000Z", deadline: "2026-11-21T10:00:00.000Z" });
  expect(exported[1]).toMatchObject({ submitDate: "2026-11-21T11:00:00.000Z", completionDate: "2026-11-21T11:45:00.000Z", solution: "Вход восстановлен" });
  expect((await (await page.request.get("/api/export?ns=demo")).json()).length).toBe(120);
  for (const role of ["coordinator", "viewer"]) {
    await page.goto("about:blank");
    await page.context().clearCookies();
    await login(page, role);
    await expect(page.getByTestId("live-register")).toBeVisible();
    await expect(page.locator('a[href*="/intake"]')).toHaveCount(0);
    await page.goto("/intake?ns=workspace");
    await expect(page.getByText("Недостаточно прав", { exact: true })).toBeVisible();
    await expect(page.getByLabel("ID инцидента", { exact: true })).toHaveCount(0);
  }
});
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
  const title = page.getByRole("heading", { name: "Инциденты в срезе." });
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
  expect([...new Set(apiCalls)]).toEqual(["/api/me"]);
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
  await expect(page.getByRole("link", { name: "ИИ-помощник" })).toHaveAttribute(
    "href",
    "/simulation/workspace",
  );
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
    await expect(page.getByTestId("live-register")).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(banner).toContainText("Назначен группе координаторов", {
      timeout: 16000,
    });
    await banner.getByRole("button", { name: "Открыть инцидент" }).click();
    await expect(page).toHaveURL("/simulation/incident/SIM-001");
    const detail = page.locator("main .detail");
    await expect(detail).toContainText("Рекомендация координатору");
    await expect(banner).toHaveCount(0);
    await expect(detail.getByText("Команда назначения", { exact: true }).first()).toBeVisible();
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
    await page.getByRole("button", { name: "Дополнительные разделы" }).click();
    await expect(page.getByTestId("source-status")).toBeVisible();
    await expect(page.getByTestId("source-status")).not.toContainText(
      /Демо-данные|Версия/i,
    );
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

test("the landing links to the current profile for a signed-in user", async ({ page }) => {
  await login(page, "coordinator");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Мой профиль" })).toHaveAttribute("href", "/preferences");
  await expect(page.getByRole("link", { name: "Войти", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Мой профиль" }).click();
  await expect(page).toHaveURL("/preferences");
});

test("system and explicit themes persist from the landing to help and authenticated screens", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "dark");
  const picker = page.getByRole("combobox", { name: "Тема оформления" });
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveAttribute("href", "/srez-night.webmanifest");
  await picker.selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
  await page.reload();
  await expect(picker).toHaveValue("light");
  await page.goto("/help");
  await expect(
    page.getByRole("heading", { name: "Помощь", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Словарь иконок" }).click();
  await expect(
    page.getByRole("heading", { name: "Словарь иконок" }),
  ).toBeInViewport();
  await expect(page.getByRole("contentinfo")).toHaveText(
    "мы не несем ответственность за провал инцидентов, только смертельную",
  );
  await page.goto("/preferences");
  const settings = page
    .getByRole("main")
    .getByRole("combobox", { name: "Тема оформления" });
  await settings.selectOption("system");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  const more = page.getByRole("button", { name: "Дополнительные разделы" });
  await more.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Дополнительные разделы");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("live embeds a quiet 3D slice with the active count and opens evidence from cases", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/live");
  const count = page.locator(".metric-live-count");
  await expect(count.getByTestId("shift-slice")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const still = () =>
    count
      .locator("canvas")
      .evaluate((el) => (el as HTMLCanvasElement).toDataURL());
  await expect(page.getByText("Риски кейса", { exact: true })).toHaveCount(0);
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/dashboard" &&
      url.searchParams.get("signal") === "critical"
    );
  });
  await page.getByTestId("group-critical").click();
  const board = await (await filtered).json();
  const id = (board.triage.liveFocus?.step ?? board.triage.cases[0].step).ticketId;
  const ticket = page.getByRole("link", { name: "Открыть заявку " + id, exact: true });
  await expect(ticket).toBeVisible();
  const { unique, overdue, escalations } = board.triage;
  const slice = count.getByRole("img");
  await expect(slice).toHaveAccessibleName(new RegExp(`Просрочены ${overdue} из ${unique}.*Отметка об устранении последствий у ${escalations}`));
  const filteredImage = await still();
  await page.waitForTimeout(150);
  expect(await still()).toBe(filteredImage);
  await ticket.click();
  await expect(page).toHaveURL(new RegExp("/incident/" + id));
  await expect(
    page.getByRole("region", { name: "Маршрутизация" }),
  ).toBeVisible();
});

test("the live slice follows the monitored deadlines and consequence flags on the same screen", async ({ page }) => {
  const productName = "Проверка дольки";
  const rows = generate(21).rows.slice(18, 21).map(r => ({ ...r, productName, deadline: null as string | null, isNeedUp: false }));
  await writeFile(source, JSON.stringify(rows));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/live?product=" + encodeURIComponent(productName));
  const metric = page.locator(".metric-live-count");
  const slice = metric.getByRole("img");
  const pixels = () => metric.locator("canvas").evaluate(el => (el as HTMLCanvasElement).toDataURL());
  await expect(slice).toHaveAccessibleName(/Просрочены 0 из 3.*Отметка об устранении последствий у 0/);
  const clear = await pixels();
  rows[0].deadline = "2000-01-01T00:00:00Z";
  await writeFile(source, JSON.stringify(rows));
  await expect(slice).toHaveAccessibleName(/Просрочены 1 из 3/);
  await expect.poll(pixels).not.toBe(clear);
  const third = await pixels();
  rows[2].isNeedUp = true;
  await writeFile(source, JSON.stringify(rows));
  await expect(slice).toHaveAccessibleName(/Просрочены 1 из 3.*Отметка об устранении последствий у 1/);
  await expect.poll(pixels).not.toBe(third);
  await slice.focus();
  await expect(page.getByRole("tooltip")).toContainText("Косточка");
  await page.getByRole("searchbox").fill("нет-такого-инцидента");
  await expect(slice).toHaveAccessibleName(/нет заявок под наблюдением/i);
});

test("cases rank the filtered queue, explain the source tickets and fit the viewport", async ({
  page,
}) => {
  await login(page);
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
  const filters = page.getByLabel("Фильтры и сортировка");
  const groups = page.getByRole("group", {name: "Выбрать группу"});
  await filters.click();
  for (const [key, name] of [["team", "Команда"], ["product", "Продукт"], ["priority", "Приоритет"], ["symptom", "Симптом"]]) {
    const select = page.getByRole("combobox", {name, exact:true});
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value!);
    await expect.poll(() => new URL(page.url()).searchParams.get(key)).toBe(value);
    await select.selectOption("");
  }
  await filters.click();
  await groups.getByRole("button").nth(1).click();
  await expect(register.locator(".triage-ledger-title small")).toBeVisible();
  const caseId = new URL(page.url()).searchParams.get("case");
  const board = await (
    await page.request.get("/api/dashboard?ns=demo&groupBy=semantic")
  ).json();
  const c = board.triage.cases.find(
    (record: { id: string }) => record.id === caseId,
  );
  const detail = await (
    await page.request.get(
      "/api/triage/" +
        encodeURIComponent(c.id) +
        "?ns=demo&groupBy=semantic&revision=" +
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
  await expect(page.getByTestId("live-guidance").getByRole("link", {name: "Открыть заявку " + c.step.ticketId})).toBeVisible();
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
  await expect(page.locator(".metric-live-count").getByRole("img")).toHaveAccessibleName(/Загрузка выборки/);
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
    page.getByRole("heading", { name: "Инциденты в срезе." }),
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
  await login(page);
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
  const display = page.getByTestId("wallboard");
  for (const width of [390, 1024, 1440, 1920, 2560, 3840]) {
    await page.setViewportSize({
      width,
      height: width >= 2560 ? Math.round((width * 9) / 16) : 900,
    });
    await expect(display.getByTestId("shift-clock")).toHaveText(
      /\d{2}:\d{2}:\d{2}/,
    );
    await expect(display.getByTestId("wall-ticket").first()).toBeVisible();
    await expect(display.getByTestId("wall-ticket").first().locator(".observe-priority")).toBeVisible();
    await expect(display.getByTestId("wall-ticket").first().locator(".observe-team")).toBeVisible();
    await expect(
      page.locator("a,button,input,select,textarea,summary,nav,[tabindex]"),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true);
  }
  await page.goBack();
  await expect(
    page.getByText(/Показан тот же инцидент DEMO-42-00019/),
  ).toBeVisible();
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
test("account wallboard settings update an open display and persist on reload", async ({ page, browser }) => {
  await login(page);
  const remote = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const wall = await remote.newPage();
    await wall.goto(new URL("/wallboard", page.url()).href);
    const display = wall.getByTestId("wallboard");
    const ticket = display.getByTestId("wall-ticket").first();
    const firstId = async (sort: string) => {
      const response = await page.request.get("/api/dashboard?register=1&groupBy=symptom&limit=1&sort=" + sort);
      return (await response.json()).register.items[0].id as string;
    };
    await expect(ticket).toContainText(await firstId("priority"));
    await page.goto("/preferences");
    const order = page.getByLabel("Порядок активных заявок", { exact: true });
    const interval = page.getByLabel("Смена страниц", { exact: true });
    await expect(order).toHaveValue("priority");
    await order.selectOption("registered");
    await interval.selectOption("10");
    await page.getByRole("button", { name: "Сохранить настройки" }).click();
    await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible();
    await expect(display.getByText("Смена каждые 10 с")).toBeVisible({ timeout: 16_000 });
    await expect(ticket).toContainText(await firstId("registered"));
    await page.reload();
    await expect(order).toHaveValue("registered");
    await expect(interval).toHaveValue("10");
    await wall.reload();
    await expect(ticket).toContainText(await firstId("registered"));
    const first = await ticket.innerText();
    await expect(ticket).not.toHaveText(first, { timeout: 14_000, useInnerText: true });
    await wall.setViewportSize({ width: 390, height: 844 });
    await expect(ticket).toBeVisible();
    await expect(wall.locator("a,button,input,select,textarea,summary,nav,[tabindex]")).toHaveCount(0);
    expect(await wall.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  } finally { await remote.close(); }
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
  await page
    .getByRole("link", { name: "Управление сценарием", exact: true })
    .click();
  await page.getByRole("button", { name: "Следующий шаг" }).click();
  await page.getByRole("link", { name: "Уведомления", exact: true }).click();
  await expect(
    page.getByText("DEMO-SCENARIO", { exact: true }).first(),
  ).toBeVisible();
  const journalRow = page.locator("article.notification").filter({ hasText: "DEMO-SCENARIO" }).first();
  await journalRow.getByText("На момент сигнала").click();
  await expect(journalRow.locator("details")).toContainText(/Назначен|Выполняется|Завершён/);
  await journalRow.getByRole("button", { name: /DEMO-SCENARIO/ }).click();
  await expect(page.getByRole("link", {name: "Вернуться в журнал"})).toBeVisible();
  await page.getByRole("link", {name: "Вернуться в журнал"}).click();
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
    page.getByRole("heading", { name: "Инциденты в срезе." }),
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
    ["/", page.getByRole("heading", { name: "Инциденты в срезе." })],
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
  // The feed takes its time from the server, including when the device clock differs.
  let serverTime = "2026-11-21T09:00:00Z";
  await page.route("**/api/dashboard?*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), serverTime } });
  });
  await page.clock.setFixedTime(new Date(serverTime));
  await page.goto("/live?sort=id");
  const card = page.getByTestId("card-DEMO-42-00001").first();
  await expect(card).toContainText("Срок близко");
  serverTime = "2026-11-21T09:00:01Z";
  await page.clock.setFixedTime(new Date(serverTime));
  await expect(card).toContainText("Просрочен");
  await mutate("deadline", "null");
  await expect(card).toContainText("Срок не задан");
  await mutate("flags");
  await expect(card).toContainText("Требуется устранение последствий");
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

test("offline fallback respects this device and the passive wall route", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByLabel("Тема оформления").selectOption("dark");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  const exited = once(server, "exit");
  server.kill();
  await exited;
  for (const key of ["/workspace", "/wallboard", "/simulation/wallboard"]) {
    await page.goto(key);
    await expect(
      page.getByRole("heading", { name: "Нет соединения" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("a,button")).toHaveCount(
      key === "/workspace" ? 1 : 0,
    );
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe("rgb(24, 23, 31)");
  }
});
