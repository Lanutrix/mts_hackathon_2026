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
    ]),
    sources: new Map([
      ["demo", new FileSource(store, "demo")],
      ["original", new FileSource(original, "original")],
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
  await expect(page.getByTestId("symptom-atlas")).toBeVisible();
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
  await expect(page.getByRole("log")).toContainText(question);
  return result;
}
async function capture(page: Page, name: string) {
  if (!process.env.CANVAS_SCREENSHOTS || test.info().project.name !== "chromium") return;
  await mkdir(process.env.CANVAS_SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: resolve(process.env.CANVAS_SCREENSHOTS, name + ".png"),
    animations: "disabled",
  });
}

test("atlas to compound views to incident and back preserves the conversation and each exact selection", async ({
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
  const report = await new AxeBuilder({ page }).include(".cx").analyze();
  expect(
    report.violations.filter(
      (issue) => issue.impact === "serious" || issue.impact === "critical",
    ),
  ).toEqual([]);
  await capture(page, "canvas-desktop");
  await groupButton.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: group.label });
  const selection = new URLSearchParams({
    ns: "demo",
    selection: first.selection,
    group: group.key,
  });
  const expected: CanvasPage = await (
    await page.request.get(origin + "/api/canvas/tickets?" + selection)
  ).json();
  await expect(drawer.getByRole("link")).toHaveCount(expected.items.length);
  await expect(drawer.getByRole("link").first()).toHaveAttribute(
    "href",
    "/incident/" + expected.items[0].id,
  );
  if (expected.nextOffset !== null) {
    await drawer.getByRole("button", { name: "Показать ещё" }).click();
    await expect(drawer.getByRole("link")).toHaveCount(
      Math.min(60, expected.total),
    );
  }
  await page.keyboard.press("Escape");
  await expect(groupButton).toBeFocused();
  await page.getByRole("button", { name: "Команды и сроки" }).click();
  await expect(page.getByTestId("group-ranking")).toBeVisible();
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
  await expect(page.getByRole("log")).toContainText(
    "Сгруппируй по командам и рядом покажи сроки",
  );
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
  await expect(page.getByRole("log")).toContainText("недостаточно");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  await page.getByRole("button", { name: "Новый диалог" }).click();
  await expect(page.getByTestId("symptom-atlas")).toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("выручка");
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
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
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
  await expect(page.getByRole("log")).toContainText("Сравни приоритеты");
  await expect(page.getByTestId("group-comparison")).toBeVisible();
  expect(first.total).toBeGreaterThan(0);
});
