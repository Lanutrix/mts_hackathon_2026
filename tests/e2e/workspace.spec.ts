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
let origin: string;
let fault: {
  path: string;
  method: string;
  respond: (reply: FastifyReply) => Promise<void> | void;
} | null;
test.beforeAll(async () => {
  db = await openDB(":memory:");
  const store = new Store(db, "demo");
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
test.afterAll(async () => {
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
  const compared = await ask(page, "А сравни по приоритетам");
  expect(compared.total).toBe(filtered.total);
  expect(compared.intent.filters.deadline).toBe("overdue");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  await capture(page, "canvas-compare");
  await ask(page, "Какая была выручка вчера?");
  await expect(page.locator(".cx-latest")).toContainText("недостаточно");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
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
  const weighted = await ask(page, "Размер групп по числу эскалаций");
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
  await page.getByRole("button", { name: "Остановить запрос" }).click();
  release();
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
