import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { FastifyReply } from "fastify";
import { createApp } from "../../apps/server/api.ts";
import { Auth, passwordHash } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { FileSource, Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";
import type {
  CanvasPage,
  CanvasResult,
} from "../../packages/contracts/canvas.ts";

const rows = generate(360).rows;
const credentials = { username: "canvas-coordinator", password: randomUUID() };
const reader = { username: "canvas-reader", password: randomUUID() };
let db: Awaited<ReturnType<typeof openDB>>;
let app: Awaited<ReturnType<typeof createApp>>;
let demoStore: Store;
let origin: string;
let fault: {
  path: string;
  method: string;
  respond: (reply: FastifyReply) => Promise<void> | void;
} | null;
// Independent scenarios share the same loopback IP. Isolate their request quotas.
test.beforeEach(async () => {
  fault = null;
  db = await openDB(":memory:");
  const store = new Store(db, "demo");
  demoStore = store;
  const original = new Store(db, "original");
  const varied = new Store(db, "workspace");
  const products = [
    "Платежи",
    "Поиск",
    "Лента",
    "Кино",
    "Музыка",
    "Каталог",
    "Подписки",
    "Бонусы",
    "Уведомления",
    "Доставка",
  ];
  const variedRows = generate(24).rows.map((row, i) => ({
    ...row,
    productName: products[i % 10],
    assignedGroupName: i < 15 ? "Платформа" : "Поддержка",
    isNeedUp: i < 10,
    deadline: new Date(
      Date.now() + (i % 3 ? 3600_000 : -3600_000),
    ).toISOString(),
  }));
  await varied.ingest(JSON.stringify(variedRows));
  await store.ingest(JSON.stringify(rows));
  const auth = new Auth();
  auth.users.push({
    username: credentials.username,
    role: "coordinator",
    salt: "test",
    hash: passwordHash(credentials.password, "test"),
  });
  auth.users.push({
    username: reader.username,
    role: "viewer",
    salt: "test",
    hash: passwordHash(reader.password, "test"),
  });
  const options = {
    stores: new Map([
      ["demo", store],
      ["original", original],
      ["workspace", varied],
    ]),
    sources: new Map([
      ["demo", new FileSource(store, "demo")],
      ["original", new FileSource(original, "original")],
      ["workspace", new FileSource(varied, "workspace")],
    ]),
    auth,
    publicDemo: true,
    secure: false,
    origin: "",
    staticDir: resolve(process.env.CANVAS_E2E_BUILD || "dist/web"),
  };
  app = await createApp(options);
  app.addHook("onRequest", async (req, reply) => {
    if (
      fault &&
      req.method === fault.method &&
      req.url.split("?")[0] === fault.path
    ) {
      const once = fault;
      fault = null;
      await once.respond(reply);
    }
  });
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
  options.origin = origin;
});
test.afterEach(async () => {
  await app?.close();
  await db?.close();
});

async function enter(page: Page) {
  expect(
    (
      await page.request.post(origin + "/api/login", { data: credentials })
    ).ok(),
  ).toBe(true);
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/canvas" &&
      r.request().method() === "GET",
  );
  await page.goto(origin + "/workspace");
  const data: CanvasResult = await (await response).json();
  await expect(page.getByTestId("group-field")).toBeVisible();
  return data;
}
async function ask(page: Page, question: string) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/canvas" &&
      r.request().method() === "POST",
  );
  const input = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  await input.fill(question);
  await input.press("Enter");
  const result: CanvasResult = await (await response).json();
  await expect(page.locator(".cx-stage")).toHaveAttribute("aria-busy", "false");
  return result;
}
async function capture(page: Page, name: string) {
  if (
    !process.env.CANVAS_SCREENSHOTS ||
    test.info().project.name !== "chromium"
  )
    return;
  await mkdir(process.env.CANVAS_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: resolve(process.env.CANVAS_SCREENSHOTS, name + ".png"),
    animations: "disabled",
  });
}

test("source answers choose a team directory, ranked durations and an inspectable incident graph", async ({ page }) => {
  await enter(page);
  const teams = await ask(page, "Сколько сейчас команд и как они называются?");
  const register = page.getByRole("list", { name: "Перечень значений" });
  await expect(register.getByRole("button")).toHaveCount(teams.groups.length);
  await register.getByRole("button").first().click();
  await expect(page.getByRole("dialog").getByRole("link").first()).toBeVisible();
  await page.keyboard.press("Escape");
  const ranked = await ask(page, "назови за последний год самую долгорешаемую проблему");
  const first = ranked.fact!.durations![0];
  const firstRow = page.getByRole("table").getByRole("row").nth(1);
  await expect(firstRow.getByRole("link", { name: first.id })).toBeVisible();
  await expect(firstRow).toContainText(String(rows.find(r => r.id === first.id)!.header));
  await ask(page, "Построй диаграмму связей между DEMO-42-00001 и DEMO-42-00004");
  const graph = page.locator(".fact-graph");
  await expect(graph.getByRole("link", { name: "DEMO-42-00001" })).toBeVisible();
  await graph.locator(".fact-edge summary").first().click();
  await expect(graph.getByText(/assignedGroupName|productName|Симптом|service/i).first()).toBeVisible();
  await graph.getByRole("link", { name: "DEMO-42-00004" }).click();
  await expect(page).toHaveURL(/\/incident\/DEMO-42-00004/);
});

test("natural questions open a team ranking and an evidence graph without a format prompt", async ({ page }) => {
  await enter(page);
  const ranking = await ask(page, "У какой команды больше всего заявок?");
  await expect(page.getByRole("heading", { name: ranking.fact!.headline, exact: true })).toBeVisible();
  const method = page.locator(".fact-method");
  await expect(method).toBeHidden();
  const details = page.getByText("Как посчитано", { exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(method).toHaveText(ranking.fact!.method);
  await expect(method).toBeVisible();
  await page.keyboard.press("Enter");
  const source = page.getByRole("button", { name: /^Открыть заявки/ });
  await expect(source).toHaveCount(1);
  await source.press("Enter");
  await expect(page.getByRole("dialog").getByRole("link").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();
  await capture(page, "answer-ranking");
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: size.width === 320 ? "dark" : "light" });
    await expect(source).toBeInViewport();
    await expect(page.getByRole("textbox", { name: "Вопрос об инцидентах" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
      document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await capture(page, "answer-ranking-" + size.width);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  const bars = page.locator('.fact-distribution[data-display="bars"]');
  await expect(bars.getByRole("button").first()).toContainText(ranking.groups[0].label);
  await bars.getByRole("button").first().click();
  await expect(page.getByRole("dialog").getByRole("link").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await ask(page, "Что общего у двух инцидентов?");
  await expect(page.locator(".cx-stage")).toContainText("номера");
  await expect(page.locator(".fact-graph")).toHaveCount(0);
  const ids = ["DEMO-42-00001", "DEMO-42-00004"];
  await ask(page, ids.join(" и "));
  const graph = page.locator(".fact-graph");
  for (const id of ids) await expect(graph.getByRole("link", { name: id })).toBeVisible();
  await expect(graph.locator(".fact-edge summary").first()).toContainText("Демо-сервис 1");
  await expect(graph.locator(".fact-edge summary").first()).toContainText("Ошибки авторизации");
  await expect(graph.getByText(/причинную связь/)).toBeVisible();
  await capture(page, "answer-relations");
});

test("square map to compound views to incident and back preserves the conversation and each exact selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  const first = await enter(page);
  expect(first.total).toBe(
    rows.filter((row) => [0, 2, 20].includes(Number(row.stateId))).length,
  );
  const group = first.groups[0];
  const groupButton = page.getByRole("button", {
    name: group.label,
  });
  await expect(groupButton).toBeVisible();
  await capture(page, "canvas-desktop");
  await groupButton.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: group.label });
  await expect(drawer.getByRole("link").first()).toBeVisible();
  const selection = new URLSearchParams({
    ns: "demo",
    selection: first.selection,
    group: group.key,
  });
  const expected: CanvasPage = await (
    await page.request.get(origin + "/api/canvas/tickets?" + selection)
  ).json();

  const count = await drawer.getByRole("link").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(expected.total);
  await expect(drawer.getByRole("link").first()).toHaveAttribute(
    "href",
    "/incident/" + expected.items[0].id,
  );
  await drawer.getByRole("button", { name: "Следующая страница" }).click();
  await expect(drawer.getByRole("link").first()).toHaveAttribute(
    "href",
    "/incident/" + expected.items[count].id,
  );
  await page.keyboard.press("Escape");
  await expect(groupButton).toBeFocused();
  await ask(page, "Сгруппируй по командам и рядом покажи сроки");
  await expect(page.getByTestId("group-field")).toBeVisible();

  const deadlines = page.getByTestId("deadline-windows");
  await expect(deadlines).toBeVisible();
  await capture(page, "canvas-compound");
  await deadlines.getByRole("button", { name: /Срок прошёл/ }).click();
  const overdue = page.getByRole("dialog", { name: "Срок прошёл" });
  const ticket = overdue.getByRole("link").first();
  await expect(ticket).toContainText("Просрочен");
  const href = await ticket.getAttribute("href");
  await ticket.click();
  await expect(page).toHaveURL(origin + href);
  await page.getByRole("link", { name: "Вернуться на холст" }).click();
  await expect(overdue).toBeVisible();
  await expect(overdue.getByRole("link").first()).toHaveAttribute(
    "href",
    href!,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "История диалога" }).click();
  await expect(page.getByRole("log")).toContainText(
    "Сгруппируй по командам и рядом покажи сроки",
  );
  await page.getByRole("button", { name: "Закрыть историю" }).click();
  const filtered = await ask(page, "Покажи просроченные заявки списком");
  expect(filtered.intent.filters.deadline).toBe("overdue");
  await expect(
    page.getByTestId("ticket-register").getByRole("link").first(),
  ).toContainText(filtered.tickets[0].id);
  await expect(page.getByRole("button", { name: /^Все \d+ заявок/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Открыть заявки/ }).click();
  await expect(page.getByRole("dialog").getByRole("link").first()).toContainText(filtered.tickets[0].id);
  await page.keyboard.press("Escape");
  const compared = await ask(page, "А сравни по приоритетам");
  expect(compared.total).toBe(filtered.total);
  expect(compared.intent.filters.deadline).toBe("overdue");
  await expect(page.getByRole("group", { name: "Условия отбора" })).toContainText("Срок прошёл");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  await capture(page, "canvas-compare");
  await ask(page, "Какая была выручка вчера?");
  await expect(page.getByTestId("conversation-answer")).toContainText("недостаточно");
  await expect(page.getByTestId("group-comparison")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "История диалога" }).click();
  await expect
    .poll(() =>
      page.getByRole("log").evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      page
        .getByRole("log")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThanOrEqual(2);
  await capture(page, "canvas-history");
  await page.getByRole("button", { name: "Новый диалог" }).click();
  await expect(page.getByTestId("group-field")).toBeVisible();
  await page.getByRole("button", { name: "История диалога" }).click();
  await expect(page.getByRole("log")).not.toContainText("выручка");
});

test("an explanation keeps its source ranking on demand and advice opens the cited ticket", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  const ranking = await ask(page, "У какой команды больше всего заявок?");
  const explanation = await ask(page, "Откуда эти цифры?");
  expect(explanation.selection).toBe(ranking.selection);
  const prose = page.getByTestId("conversation-answer");
  await expect(prose).toContainText(ranking.groups[0].label);
  await expect(page.locator(".fact-board")).toHaveCount(0);
  await capture(page, "answer-explanation");
  await page.getByRole("button", { name: "Показать срез" }).press("Enter");
  const bars = page.locator(".fact-bar");
  await expect(bars.first()).toContainText(ranking.groups[0].label);
  await bars.first().click();
  await expect(page.getByRole("dialog").getByRole("link").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "К ответу" }).click();
  await expect(prose).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const advice = await ask(page, "С какой заявки начать?");
  const id = advice.tickets[0].id;
  await expect(prose.getByRole("link", { name: id })).toHaveAttribute("href", "/incident/" + id);
  await capture(page, "answer-advice-390");
  await prose.getByRole("link", { name: id }).click();
  await expect(page).toHaveURL(new RegExp("/incident/" + id + "$"));
  await page.getByRole("link", { name: "Вернуться на холст" }).click();
  await expect(prose).toContainText(id);
});

test("two and ten real groups repack by weight, paginate on smaller screens and keep the composer in view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(
    (
      await page.request.post(origin + "/api/login", { data: credentials })
    ).ok(),
  ).toBe(true);
  await page.goto(origin + "/workspace?ns=workspace");
  await expect(page.getByTestId("group-field")).toBeVisible();
  const two = await ask(page, "Сгруппируй заявки по командам");
  expect(two.groups.length).toBe(2);
  const field = page.getByTestId("group-field"),
    squares = field.locator(".cx-square");
  await expect(squares).toHaveCount(2);
  await capture(page, "canvas-two");
  const weighted = await ask(page, "Размер групп по числу инцидентов с последствиями");
  await expect(field).toHaveAttribute("data-weight", "escalated");
  expect(weighted.total).toBe(two.total);
  await expect(field.locator('[data-zero="true"]')).toHaveCount(1);
  await field.getByRole("button", { name: /Поддержка/ }).click();
  await expect(
    page.getByRole("dialog").getByRole("link").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const ten = await ask(
    page,
    "Сгруппируй по продуктам, размер по количеству заявок",
  );
  expect(ten.groups.length).toBe(10);
  await expect(squares).toHaveCount(10);
  const expected = ten.groups[0].count / ten.groups.at(-1)!.count;
  await expect
    .poll(() =>
      squares.evaluateAll((nodes) => {
        const side = (el: Element) =>
          el.querySelector(".cx-square-ink")!.getBoundingClientRect().width;
        return Math.round((side(nodes[0]) / side(nodes.at(-1)!)) ** 2 * 100);
      }),
    )
    .toBe(Math.round(expected * 100));
  await capture(page, "canvas-ten");
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(
    field.getByRole("button", { name: "Следующая страница" }),
  ).toBeVisible();
  const names = new Set<string>();
  while (true) {
    for (const text of await squares.allTextContents()) names.add(text);
    const next = field.getByRole("button", { name: "Следующая страница" });
    if (await next.isDisabled()) break;
    await next.click();
  }
  expect(names.size).toBe(10);
  await expect(
    page.getByRole("textbox", { name: "Вопрос об инцидентах" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
  ).toBe(true);
});

test("a reader can inspect an empty private source without submitting model questions", async ({
  page,
}) => {
  expect(
    (await page.request.post(origin + "/api/login", { data: reader })).ok(),
  ).toBe(true);
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/canvas"))
      writes.push(req.url());
  });
  await page.goto(origin + "/workspace?ns=original");
  await expect(
    page.getByRole("heading", { name: "Источник пока пуст" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Вопрос об инцидентах" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("group", { name: "Предложенные вопросы" }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("generation fills the canvas and keeps the conversation accessible until the requested result arrives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const status = page.getByRole("status").filter({ hasText: "Готовлю ответ" });
  let openSource!: () => void;
  const initialLoad = new Promise<void>((resolve) => {
    openSource = resolve;
  });
  fault = { method: "GET", path: "/api/canvas", respond: () => initialLoad };
  const starting = enter(page);
  try {
    await expect(page.getByText("Читаю источник…", { exact: true })).toBeVisible();
    await expect(status).toHaveCount(0);
  } finally {
    openSource();
    await starting;
  }
  await ask(page, "Покажи доли команд круговой диаграммой");
  const previous = page.getByTestId("answer-orbit");
  await expect(previous).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  fault = { method: "POST", path: "/api/canvas", respond: () => pending };
  const input = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  const question = "Сравни команды по приоритетам";
  await input.fill(question);
  await input.press("Enter");
  try {
    await expect(status).toBeInViewport();
    await expect(previous).toBeHidden();
    const coversCanvas = () => page.locator(".cx-generation").evaluate(loader => {
      const area = document.querySelector("#cx-stage")!.getBoundingClientRect();
      const rect = loader.getBoundingClientRect();
      return rect.top <= area.top + 1 && rect.bottom >= area.bottom - 1 &&
        rect.left <= area.left + 1 && rect.right >= area.right - 1;
    });
    expect(await coversCanvas()).toBe(true);
    await expect(page.getByRole("timer")).toContainText(/0:0[1-9]/);
    await capture(page, "assistant-generation");
    const history = page.getByRole("button", { name: "История диалога" });
    await history.press("Enter");
    await expect(page.getByRole("log")).toContainText(question);
    await page.keyboard.press("Escape");
    await expect(history).toBeFocused();
    await input.focus();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await expect(status).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Остановить запрос" }),
    ).toBeInViewport();
    await expect(previous).toBeHidden();
    expect(await coversCanvas()).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(
      await status.evaluate((el) => el.getAnimations({ subtree: true }).length),
    ).toBe(0);
    await capture(page, "assistant-generation-mobile");
  } finally {
    release();
  }
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  await expect(status).toHaveCount(0);
});

test("a mobile keyboard can ask, recover from a failed request, cancel, and reopen an expired selection", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const first = await enter(page);
  await capture(page, "canvas-mobile");

  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 720, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const field = document
            .querySelector(".cx-stage")!
            .getBoundingClientRect();
          const dock = document
            .querySelector(".cx-composer")!
            .getBoundingClientRect();
          const marks = [...document.querySelectorAll(".cx-square")].map((el) =>
            el.getBoundingClientRect(),
          );
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight + 1 &&
            dock.bottom <= innerHeight + 1 &&
            dock.top >= field.bottom - 1 &&
            marks.length > 0 &&
            marks.every(
              (rect) =>
                rect.left >= field.left - 1 &&
                rect.right <= field.right + 1 &&
                rect.top >= field.top - 1 &&
                rect.bottom <= field.bottom + 1,
            )
          );
        }),
      )
      .toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await capture(page, "canvas-dark-mobile");
  fault = {
    method: "POST",
    path: "/api/canvas",
    respond: (reply) => {
      reply.code(503).send({});
    },
  };
  const input = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  await input.fill("Сравни приоритеты");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Не удалось");
  await page.getByRole("button", { name: "Повторить запрос" }).click();
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    reached = resolve;
  });
  fault = {
    method: "POST",
    path: "/api/canvas",
    respond: async (reply) => {
      reached();
      await pending;
      reply.code(503).send({});
    },
  };
  await input.fill("Покажи по продуктам");
  await input.press("Enter");
  await intercepted;
  const generating = page.getByRole("status").filter({ hasText: "Готовлю ответ" });
  try {
    await expect(generating).toBeVisible();
    await input.press("Tab");
    await expect(
      page.getByRole("button", { name: "Остановить запрос" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
  } finally {
    release();
  }
  await expect(generating).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Покажи по продуктам");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  fault = {
    method: "GET",
    path: "/api/canvas/tickets",
    respond: (reply) => {
      reply.code(409).send({});
    },
  };
  await page
    .getByTestId("group-comparison")
    .getByRole("button")
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("alert")).toBeVisible();
  const refresh = page.waitForRequest(
    (r) => r.method() === "POST" && r.postDataJSON()?.refresh === true,
  );
  await drawer.getByRole("button", { name: "Обновить срез" }).click();
  expect((await refresh).postDataJSON().context.groupBy).toBe("priority");
  await expect(drawer.getByRole("link").first()).toBeVisible();
  await drawer.getByRole("button", { name: "Закрыть выборку" }).click();
  await page.getByRole("button", { name: "История диалога" }).click();
  await expect(page.getByRole("log")).toContainText("Сравни приоритеты");
  await page.getByRole("button", { name: "Закрыть историю" }).click();
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  expect(first.total).toBeGreaterThan(0);
});

for (const view of ["map", "selection"] as const) {
  test("accessibility of the " + view, async ({ page }) => {
    const start = await enter(page);
    if (view === "selection") {
      await page.getByRole("button", { name: start.groups[0].label }).click();
      await expect(
        page.getByRole("dialog").getByRole("link").first(),
      ).toBeVisible();
    }
    const report = await new AxeBuilder({ page })
      .include(view === "map" ? ".cx" : "dialog[open]")
      .analyze();
    expect(
      report.violations.filter(
        (issue) => issue.impact === "serious" || issue.impact === "critical",
      ),
    ).toEqual([]);
  });
}

test("a definition opens relevant help and a conversation can change into diagrams and evidence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  const article = await ask(page, "Что такое инцидент?");
  expect(article.answer?.kind).toBe("knowledge");
  const guide = page.getByTestId("answer-guide");
  await expect(guide).toContainText("незапланированный сбой");
  await page.getByRole("button", { name: "История диалога" }).click();
  await expect(page.getByRole("log")).toContainText("Справка Среза");
  await page.getByRole("button", { name: "Закрыть историю" }).click();
  await expect(page.getByTestId("group-field")).toHaveCount(0);
  await expect(page.locator(".cx")).not.toContainText(
    /демо-данные|версия [0-9]/i,
  );
  const help = guide.getByRole("link").first();
  await expect(help).toHaveAttribute("href", /\/help#incident$/);
  const composer = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  await expect
    .poll(async () => (await composer.boundingBox())!.y)
    .toBeGreaterThan(720);
  await expect(guide.getByRole("heading", { name: "Например" })).toBeVisible();
  await capture(page, "answer-definition");
  await help.click();
  await expect(page).toHaveURL(/\/help#incident$/);
  await page.goBack();
  await expect(guide).toBeVisible();
  for (const [question, kind] of [
    ["Покажи доли команд круговой диаграммой", "orbit"],
    ["Построй схему по командам", "flow"],
    ["Покажи матрицу по командам", "matrix"],
    ["Покажи карточки групп по командам", "cards"],
  ]) {
    const answer = await ask(page, question);
    expect(answer.intent.presentation, question).toBe(kind);
    const chart = page.getByTestId("answer-" + kind);
    await expect(chart).toBeVisible();
    await capture(page, "answer-" + kind);
    const first = chart.getByRole("button").first();
    await first.click();
    await expect(
      page.getByRole("dialog").getByRole("link").first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  for (const size of [
    { width: 1440, height: 900 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    for (const [question, id] of [
      ["Возраст очереди", "age-bands"],
      ["Решения в срок", "finished-on-time"],
      ["Связи продуктов и команд", "product-team"],
    ]) {
      const response = await ask(page, question);
      expect(
        response.insights?.some((item) => item.id === id),
        question,
      ).toBe(true);
      const item = page.locator('[data-insight="' + id + '"]');
      await expect(item).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Вопрос об инцидентах" }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight + 1,
        ),
      ).toBe(true);
      for (const visual of [
        item,
        page.locator(".cx-stage"),
        page.locator(".cx-plot").first(),
      ]) {
        const box = await visual.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
      }
      if (id === "product-team")
        await capture(page, "answer-links-" + size.width);
    }
  }
});

test("free-form answers paginate on a phone and follow-up uses the same conversation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const initial = await enter(page);
  const followUp = "А что с просроченными?";
  const answer = {
    title: "Дежурный и арбуз",
    text: "Дежурный заметил сбой и сверил срок решения. ".repeat(11).trim(),
    followUp,
  };
  const token = "test-conversation";
  fault = { method: "POST", path: "/api/canvas", respond: (reply) => {
    reply.send({
      ...initial, title: answer.title, summary: answer.text, conversation: answer,
      turnToken: token, mode: "model", provider: "VseLLM", total: 0, selection: "",
      suggestions: [followUp, ...initial.suggestions.slice(0, 2)],
      groups: [], blocks: [], tickets: [], metrics: [],
    });
  } };
  await ask(page, "Расскажи как сказку");
  const prose = page.getByTestId("conversation-answer");
  await expect(prose).toBeVisible();
  await expect(page.getByTestId("group-field")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: answer.title })).toBeVisible();
  const pagination = prose.getByRole("navigation", { name: "Страницы ответа" });
  await pagination.getByRole("button", { name: "Следующая страница" }).click();
  expect(await prose.locator(".cx-prose-sheet").evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  fault = { method: "POST", path: "/api/canvas", respond: (reply) => { reply.send(initial); } };
  const pending = page.waitForRequest(req => req.method() === "POST" && new URL(req.url()).pathname === "/api/canvas");
  await page.getByRole("group", { name: "Варианты следующего вопроса" }).getByRole("button", { name: followUp }).click();
  const followUpBody = (await pending).postDataJSON();
  await expect(page.getByTestId("group-field")).toBeVisible();
  expect(followUpBody).toMatchObject({ question: followUp, turnToken: token, context: initial.intent });
});
test("a factual frequency keeps the same sample when drawn as a ring, directory, table, diagram and cards", async ({
  page,
}) => {
  await enter(page);
  await page.goto(origin + "/workspace?ns=workspace");
  await expect(page.getByTestId("group-field")).toBeVisible();
  const first = await ask(page, "Какой продукт встречается чаще всего?");
  expect(first.groups).toHaveLength(10);
  const ringAnswer = await ask(
    page,
    "А теперь покажи это кольцевой диаграммой",
  );
  const board = page.locator(".fact-board");
  const ring = board.locator('[data-answer-element="share-wheel"]');
  await expect(ring).toBeVisible();
  const labels = await new AxeBuilder({ page })
    .include(".ar-orbit")
    .withRules(["label-content-name-mismatch"])
    .analyze();
  expect(labels.violations).toEqual([]);
  expect(ringAnswer.groups).toEqual(first.groups);
  expect(ringAnswer.total).toBe(first.total);
  await expect(
    ring.locator('[data-answer-element="wheel-total"]'),
  ).toContainText(String(first.total));
  const firstArc = ring.locator('[data-answer-element="share-arc"]').first();
  const fraction = await firstArc.evaluate(
    (el) => (el as SVGPathElement).getTotalLength() / (2 * Math.PI * 77),
  );
  expect(fraction).toBeCloseTo(first.groups[0].count / first.total, 3);
  const arcPoint = await firstArc.evaluate((el) => {
    const path = el as SVGPathElement;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    const onPage = middle.matrixTransform(path.getScreenCTM()!);
    return { x: onPage.x, y: onPage.y };
  });
  await page.mouse.click(arcPoint.x, arcPoint.y);
  await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(
    first.groups[0].count,
  );
  await page.keyboard.press("Escape");
  const legend = ring.locator('[data-answer-element="share-key"]');
  await expect(legend.getByText(/Остальные группы/)).toBeVisible();
  await board
    .getByRole("navigation", { name: "Страницы групп" })
    .getByRole("button", { name: "Следующая страница" })
    .click();
  await expect(legend.getByRole("button").last()).toContainText(
    first.groups.at(-1)!.label,
  );
  await legend.getByRole("button").last().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(
    first.groups.at(-1)!.count,
  );
  await page.keyboard.press("Escape");
  await capture(page, "fact-group-ring");
  for (const [form, selector] of [
    ["Сравни команды в таблице", ".fact-group-table"],
    ["Покажи результат списком", ".fact-directory"],
    ["Покажи результат схемой", '[data-answer-element="branch-map"]'],
    ["Покажи результат карточками", ".ar-dossiers"],
    ["Покажи результат столбцами", ".fact-bar"],
  ]) {
    const answer = await ask(
      page,
      "Какой продукт встречается чаще всего? " + form,
    );
    expect(answer.groups).toEqual(first.groups);
    await expect(board.locator(selector).first()).toBeVisible();
    await expect(
      board.getByText(first.groups[0].label, { exact: true }).first(),
    ).toBeVisible();
  }
});

test("resolution time supports bars and an accessible list with the original dates and ticket", async ({
  page,
}) => {
  await enter(page);
  const plain = await ask(page, "Назови самую долгорешаемую проблему");
  const leader = plain.fact!.durations![0];
  for (const [form, selector] of [
    ["столбчатой диаграммой", ".fact-duration-bars"],
    ["списком", ".fact-duration-list"],
  ]) {
    const answer = await ask(
      page,
      "Назови самую долгорешаемую проблему, покажи результат " + form,
    );
    expect(answer.fact!.durations).toEqual(plain.fact!.durations);
    const item = page.locator(selector).locator("li").first();
    await expect(item.getByRole("link", { name: leader.id })).toBeVisible();
    await expect(item).toContainText(leader.header!);
    await expect(item.locator("time").first()).toHaveAttribute(
      "datetime",
      leader.start,
    );
    await expect(item.locator("time").last()).toHaveAttribute(
      "datetime",
      leader.end,
    );
  }
});
test("a list and a comparison table retain the groups and proportions of the ordinary ring", async ({
  page,
}) => {
  await enter(page);
  const response = await ask(page, "Покажи доли команд круговой диаграммой");
  const group = response.groups[0];
  const label = new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(group.count / response.total);
  const list = await ask(page, "Покажи доли команд списком");
  expect(list.groups).toEqual(response.groups);
  const directory = page.getByTestId("group-directory");
  const item = directory.getByRole("button").filter({ hasText: group.label });
  await expect(item).toContainText(label);
  await item.click();
  await expect(
    page.getByRole("dialog").getByRole("link").first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const compared = await ask(page, "Покажи доли команд таблицей");
  expect(compared.groups).toEqual(response.groups);
  const table = page.getByTestId("group-comparison").getByRole("table");
  await expect(
    table.getByRole("row").filter({ hasText: group.label }),
  ).toContainText(label);
});

test("an action request renders its records and typed consent opens the offered explanation", async ({ page }) => {
  const initial = await enter(page);
  const overdue = initial.metrics.find(metric => metric.key === "overdue")!.value;
  const list = await ask(page, "Собери просроченные заявки в список");
  expect(list.total).toBe(overdue);
  await expect(page.getByTestId("ticket-register").getByRole("link").first()).toContainText(list.tickets[0].id);
  await page.getByRole("button", { name: /^Открыть заявки/ }).click();
  await expect(page.getByRole("dialog").getByRole("link").first()).toContainText(list.tickets[0].id);
  await page.keyboard.press("Escape");
  const advice = await ask(page, "С чего начать смену?");
  const explanation = await ask(page, "Да, сделай");
  expect(explanation.selection).toBe(advice.selection);
  const answer = page.getByTestId("conversation-answer");
  await expect(answer).toContainText("На момент выбора");
  await answer.getByRole("link", { name: advice.tickets[0].id }).click();
  await expect(page).toHaveURL(new RegExp("/incident/" + advice.tickets[0].id + "$"));
});

test("a coordinator reads resolution times and the same glyphs used by the platform", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enter(page);
  const total = await ask(page, "Общее число инцидентов");
  expect(total.fact?.statusCounts?.reduce((sum, state) => sum + state.count, 0)).toBe(total.total);
  await expect(page.locator(".fact-status-composition")).toContainText("Закрыт");
  await capture(page, "assistant-status-count");
  const compare = await ask(page, "Анализ времени по командам");
  expect(compare.intent.fact?.operation).toBe("duration");
  expect(compare.intent.groupBy).toBe("team");
  await expect(page.locator(".fact-board")).toContainText(/медиан/iu);
  await capture(page, "assistant-team-duration");
  const legend = await ask(page, "Значки в системе");
  expect(legend.answer?.topic).toBe("icons");
  const article = page.getByTestId("answer-guide");
  await expect(article.getByText("Критический инцидент", { exact: true })).toBeVisible();
  await expect(article.locator('[data-srez-icon="Критический инцидент"]')).toBeVisible();
  await capture(page, "assistant-symbols");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await ask(page, "Что означает значок часов?");
  await expect(page.locator('.cx-plot-title [data-srez-icon="Срок решения"]')).toBeVisible();
  await expect(article).toContainText("Плановый срок из карточки ITSM");
  await capture(page, "assistant-symbol-mobile");
  await article.getByRole("link", { name: "Словарь иконок" }).click();
  await expect(page).toHaveURL(/\/help#icons$/);
});

test("recent incidents show registered time and deep links; sparse status history exposes the sample", async ({ page }) => {
  await enter(page);
  const recent = await ask(page, "дай инфу о последних трех инцедентах");
  const list = page.getByRole("list", { name: "По времени регистрации" });
  await expect(list.getByRole("listitem")).toHaveCount(3, { timeout: 3500 });
  for (const item of recent.tickets) {
    const row = list.getByRole("listitem").filter({ hasText: item.id });
    await expect(row.getByRole("link", { name: item.id })).toHaveAttribute("href", new RegExp("/incident/" + item.id));
    await expect(row).toContainText(item.header);
    await expect(row).toContainText(item.state);
    await expect(row.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}/);
  }
  await ask(page, "время смены статуса среднее");
  const sample = page.getByRole("group", { name: "Основание расчёта" });
  await expect(sample).toBeVisible();
  await expect(sample.getByText("Интервалов", { exact: true })).toBeVisible();
  await expect(sample.locator("dd").first()).toHaveText("0");
  await expect(page.getByRole("list", { name: "Интервалы по заявкам" })).toHaveCount(0);
});

test("prompt buttons execute distinct follow-ups from the displayed turn", async ({ page }) => {
  const initial = await enter(page);
  const prompts = page.getByRole("group", { name: "Варианты следующего вопроса" });
  await expect(prompts.getByRole("button")).toHaveCount(3);
  const button = prompts.getByRole("button", { name: "С какой заявки начать?" });
  await button.click();
  await expect(page.getByRole("heading", { name: "Первая заявка для проверки" })).toBeVisible();
  await expect(prompts.getByRole("button")).toHaveCount(3);
  const next = page.waitForRequest(req => req.method() === "POST" && req.url().includes("/api/canvas"));
  await prompts.getByRole("button", { name: "Напиши комментарий о ходе работ" }).click();
  const body = (await next).postDataJSON();
  expect(body.context.shiftAdvice).toBe(true);
  expect(body.turnToken).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Черновик комментария" })).toBeVisible();
  expect(initial.total).toBeGreaterThan(1);
});

async function observeCanvasMotion(page: Page) {
  return page.evaluateHandle(() => {
    const stage = document.getElementById("cx-stage")!;
    const events: { id: string; node: string; delay: number; start: Keyframe; end: Keyframe }[] = [];
    const seen = new WeakSet<Animation>();
    const observer = new MutationObserver(() => {
      for (const animation of stage.getAnimations({ subtree: true })) {
        if (seen.has(animation) || !animation.id.startsWith("canvas-enter-")) continue;
        seen.add(animation);
        const effect = animation.effect as KeyframeEffect;
        const frames = effect.getKeyframes();
        events.push({ id: animation.id, node: effect.target?.tagName ?? "", delay: Number(effect.getTiming().delay),
          start: frames[0], end: frames[frames.length - 1] });
      }
    });
    observer.observe(stage, { attributes: true, characterData: true, childList: true, subtree: true });
    return { events };
  });
}

test("live and wall KPIs roll on entry and changed totals, and settle immediately with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const seen = new WeakSet<Animation>();
    const rolls: string[] = [];
    Object.assign(window, { rolls });
    new MutationObserver(() => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect as KeyframeEffect;
        const metric = effect.target?.closest(".shift-metrics > div");
        if (!metric || seen.has(animation) || !effect.getKeyframes().some(frame => frame.transform)) continue;
        seen.add(animation);
        rolls.push(metric.querySelector("dt")!.textContent!);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const rolls = () => page.evaluate(() => (window as Window & { rolls?: string[] }).rolls!.slice());
  expect((await page.request.post(origin + "/api/login", { data: credentials })).ok()).toBe(true);
  for (const path of ["/wallboard", "/live"]) {
    await page.goto(origin + path);
    await expect(page.getByTestId("live-count")).toBeVisible();
    expect(new Set(await rolls())).toEqual(new Set(["Под наблюдением", "Просрочены", "Устранение последствий"]));
  }
  const count = page.getByTestId("escalation-count");
  const entering = (await rolls()).length;
  await demoStore.ingest(JSON.stringify(rows.map(row => ({ ...row, isNeedUp: false }))));
  await expect(count).toHaveText("0");
  await expect.poll(rolls).toHaveLength(entering + 1);
  expect((await rolls()).at(-1)).toBe("Устранение последствий");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await demoStore.ingest(JSON.stringify(rows));
  await expect(count).not.toHaveText("0");
  expect((await rolls()).length).toBe(entering + 1);
});

test("a new answer types intact graphemes over selectable text and keeps its source link usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const initial = await enter(page);
  const id = initial.tickets[0].id;
  const line = "Е\u0308ж и 👩🏽‍💻 проверяют " + id + ". ";
  const prose = line.repeat(8).trim();
  const observed = await page.evaluateHandle(() => {
    const frames: { hidden: string; text: string; height: number }[] = [];
    let active = true;
    function sample() {
      const body = document.querySelector(".cx-prose-sheet p");
      if (body) {
        const hidden = [...CSS.highlights.values()].flatMap(highlight => [...highlight])
          .filter(range => body.contains(range.startContainer)).map(range => range.toString()).join("");
        frames.push({ hidden, text: body.textContent!, height: (body as HTMLElement).offsetHeight });
      }
      if (active) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    return { frames, stop() { active = false; } };
  });
  fault = { path: "/api/canvas", method: "POST", respond: reply => {
    reply.send({ ...initial, conversation: { title: "Ответ смены", text: prose, sourceIds: [id] } });
  } };
  await ask(page, "Подготовь ответ");
  const body = page.locator(".cx-prose-sheet p");
  await expect(body).toHaveText(prose);
  await expect(body.getByRole("link", { name: id }).first()).toBeVisible();
  await expect.poll(() => observed.evaluate(log => log.frames.at(-1)?.hidden), { timeout: 2500 }).toBe("");
  const frames = await observed.evaluate(log => { log.stop(); return log.frames; });
  const partial = frames.filter(frame => frame.hidden && frame.hidden.length < prose.length);
  expect(new Set(partial.map(frame => frame.hidden)).size).toBeGreaterThan(1);
  const offsets = new Set(Array.from(new Intl.Segmenter("ru").segment(prose), part => part.index));
  for (const frame of partial) {
    expect(frame.text).toBe(prose);
    expect(prose.endsWith(frame.hidden)).toBe(true);
    expect(offsets.has(prose.length - frame.hidden.length)).toBe(true);
  }
  expect([...new Set(frames.map(frame => frame.height))]).toEqual([frames.at(-1)!.height]);
  expect(await body.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const copied = selection.toString();
    selection.removeAllRanges();
    return copied;
  })).toBe(prose);
  await body.getByRole("link", { name: id }).first().click();
  await expect(page).toHaveURL(new RegExp("/incident/" + id + "$"));
  await page.goBack();
  await expect(body).toHaveText(prose);
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
});

test("new canvas answers reveal their text, chart geometry, timeline and graph in reading order", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await enter(page);
  const recording = await observeCanvasMotion(page);
  const samples = async (question: string) => {
    await recording.evaluate(log => { log.events.length = 0; });
    await ask(page, question);
    return recording.evaluate(log => log.events);
  };
  let events = await samples("Какой продукт встречается чаще всего?");
  expect(events.some(e => e.id === "canvas-enter-heading" && Number(e.start.opacity) < Number(e.end.opacity))).toBe(true);
  expect(events.some(e => e.id === "canvas-enter-measure" && e.start.clipPath !== e.end.clipPath)).toBe(true);
  await expect.poll(() => page.locator("#cx-stage").evaluate(el => el.getAnimations({ subtree: true }).length),
    { timeout: 1800 }).toBe(0);
  events = await samples("Покажи это кольцевой диаграммой");
  expect(events.some(e => e.id === "canvas-enter-arc" && e.node.toLowerCase() === "path" &&
    e.start.strokeDashoffset !== e.end.strokeDashoffset)).toBe(true);
  events = await samples("Покажи последние три инцидента");
  const rows = events.filter(e => e.id === "canvas-enter-row" && e.node === "LI");
  expect(rows).toHaveLength(3);
  expect(rows[0].delay).toBeLessThan(rows[1].delay);
  expect(rows[1].delay).toBeLessThan(rows[2].delay);
  events = await samples("Сколько сейчас просроченных заявок?");
  expect(events.some(e => e.id === "canvas-enter-slice" && e.node.toLowerCase() === "path")).toBe(true);
  events = await samples("Что общего у DEMO-42-00001 и DEMO-42-00004?");
  expect(events.filter(e => e.id === "canvas-enter-node").length).toBeGreaterThanOrEqual(2);
  expect(events.some(e => e.id === "canvas-enter-link")).toBe(true);
  events = await samples("С какой заявки начать?");
  expect(events.some(e => e.id === "canvas-enter-prose" && e.node === "P")).toBe(true);
});

test("only accepted fresh responses start motion; reduced motion presents the complete final frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await enter(page);
  const recording = await observeCanvasMotion(page);
  const q = "Покажи последние три инцидента";
  await ask(page, q);
  const headings = () => recording.evaluate(log => log.events.filter(e => e.id === "canvas-enter-heading").length);
  expect(await headings()).toBe(1);
  const input = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  await input.fill("Черновик");
  await page.setViewportSize({ width: 820, height: 730 });
  expect(await headings()).toBe(1);
  await ask(page, q);
  expect(await headings()).toBe(2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const running = () => page.locator("#cx-stage").evaluate(stage => stage.getAnimations({ subtree: true }).length);
  await expect.poll(running).toBe(0);
  await expect.poll(() => page.evaluate(() => CSS.highlights.size)).toBe(0);
  const count = await recording.evaluate(log => log.events.length);
  await ask(page, q);
  await expect(page.locator(".fact-arrivals > li")).toHaveCount(3);
  expect(await recording.evaluate(log => log.events.length)).toBe(count);
  expect(await running()).toBe(0);
  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  expect(await page.locator(".fact-value").evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

test("a cancelled request never animates its late response and empty results still reveal their message", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const initial = await enter(page);
  const recording = await observeCanvasMotion(page);
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  fault = { path: "/api/canvas", method: "POST", respond: async reply => {
    started();
    await hold;
    reply.send({ ...initial, title: "Устаревший ответ" });
  } };
  const input = page.getByRole("textbox", { name: "Вопрос об инцидентах" });
  try {
    await input.fill("Первый запрос");
    await input.press("Enter");
    await waiting;
    await page.getByRole("button", { name: "Остановить запрос" }).click();
    await ask(page, "Покажи последние три инцидента");
  } finally { release(); }
  await expect(page.locator(".fact-arrivals > li")).toHaveCount(3);
  expect(await recording.evaluate(log => log.events.filter(e => e.id === "canvas-enter-heading").length)).toBe(1);
  const loaded = page.waitForResponse(r => new URL(r.url()).pathname === "/api/canvas" && r.request().method() === "GET");
  await page.goto(origin + "/workspace?ns=original");
  await loaded;
  await expect(page.locator(".cx-empty h3")).toBeVisible();
  const empty = await observeCanvasMotion(page);
  await ask(page, "Покажи открытые заявки списком");
  expect(await empty.evaluate(log => log.events.some(e => e.id === "canvas-enter-prose" && e.node === "H3"))).toBe(true);
});
