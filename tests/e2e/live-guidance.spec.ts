import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/server/api.ts";
import { AnalysisService } from "../../apps/server/analysis.ts";
import { Auth } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { VseLlm } from "../../apps/server/vsellm.ts";
import { Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";
import { PRIORITIES, STATES } from "../../packages/domain/index.ts";

test("live assistant switches between distinct checks in the current queue with the keyboard", async ({ page, context }, info) => {
  const db = await openDB(":memory:");
  const store = new Store(db, "original");
  const deadline = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const base = { ...generate(1).rows[0], sysId: null, assignedGroupName: "Платформа", stateId: 2,
    stateEnum: STATES[2].enum, state: STATES[2].label, priorityId: 3, priority: PRIORITIES[3],
    deadline, isNeedUp: false };
  const rows = [
    { ...base, id: "URGENT", priorityId: 4, priority: PRIORITIES[4], deadline: new Date(Date.now() - 60_000).toISOString() },
    { ...base, id: "FOLLOW", isNeedUp: true },
    { ...base, id: "INVESTIGATE", stateId: 20, stateEnum: STATES[20].enum, state: STATES[20].label },
  ];
  const auth = new Auth();
  auth.sessions.set(auth.digest("shift-user"), { username: "дежурный", role: "coordinator", csrf: "csrf",
    expires: Date.now() + 120_000 });
  const app = await createApp({ stores: new Map([["original", store]]), sources: new Map(), auth,
    publicDemo: false, secure: false, origin: "", staticDir: resolve("dist/web") });
  try {
    await store.ingest(JSON.stringify(rows));
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    await context.addCookies([{name: "wm_session", value: "shift-user", url: origin}]);
    await page.goto(origin + "/live?ns=original");
    const card = page.getByTestId("live-guidance");
    await expect(card.getByTestId("guidance-action")).toContainText("Запросите новый срок");
    const checks = card.getByRole("group", {name: "Подсказки смены"});
    await expect(checks.getByRole("button")).toHaveCount(3);
    const research = checks.getByRole("button", {name: "Исследование"});
    await research.focus();
    await page.keyboard.press("Enter");
    await expect(research).toBeFocused();
    await expect(research).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("guidance-action")).toContainText("результат исследования");
    await expect(card.getByTestId("guidance-basis")).toContainText("на исследовании");
    const ticket = card.getByRole("link", {name: "Открыть заявку INVESTIGATE"});
    await expect(ticket).toHaveAttribute("href", "/incident/INVESTIGATE?ns=original");
    await card.getByRole("button", {name: "Подробнее"}).click();
    await expect(page.getByRole("dialog")).toContainText("Сверить исследование");
    await page.keyboard.press("Escape");
    await expect(card.getByRole("button", {name: "Подробнее"})).toBeFocused();
    await page.setViewportSize({width: 390, height: 844});
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("live-register").locator("tbody tr").first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({path: info.outputPath("shift-assistant-mobile-dark.png")});
    await page.setViewportSize({width: 320, height: 568});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.setViewportSize({width: 1366, height: 768});
    await page.emulateMedia({colorScheme: "light"});
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await checks.getByRole("button", {name: "Последствия"}).click();
    await expect(card.getByTestId("guidance-action")).toContainText("последствия");
    await page.screenshot({path: info.outputPath("shift-assistant-desktop-light.png")});
    await store.ingest(JSON.stringify(rows.map(row => row.id === "URGENT" ? row :
      {...row, stateId: 7, stateEnum: STATES[7].enum, state: STATES[7].label})));
    await expect(card.getByRole("link", {name: "Открыть заявку URGENT"})).toBeVisible();
    await expect(checks).toHaveCount(0);
    await card.getByRole("link", {name: "Открыть заявку URGENT"}).press("Enter");
    await expect(page).toHaveURL(/\/incident\/URGENT\?ns=original/);
  } finally {
    await page.close(); await app.close(); await db.close();
  }
});

test("live recommendations follow real stream changes, reject late AI and expire on an open page", async ({ page, context }, testInfo) => {
  test.setTimeout(65_000);
  const db = await openDB(":memory:");
  const store = new Store(db, "demo");
  const original = new Store(db, "original");
  const row = { ...generate(1).rows[0], id: "PRIVATE-001", header: "Тема под проверкой",
    assignedGroupName: "Приватная группа", assignedEmployee: "Приватное имя", priorityId: 4,
    priority: "Наивысший", isNeedUp: false, stateId: 2, stateEnum: "WorkInProgress", state: "Выполняется",
    deadline: new Date(Date.now() + 60 * 60_000).toISOString() };
  await store.ingest(JSON.stringify([row]));
  await original.ingest(JSON.stringify([{ ...row, id: "ORIG-002", deadline: null }]));
  const auth = new Auth();
  auth.sessions.set(auth.digest("test-session"), { username: "дежурный", role: "coordinator", csrf: "csrf",
    expires: Date.now() + 90_000 });
  const packets: string[] = [];
  const refinements: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/analysis?")) return;
    const body = request.postDataJSON();
    if (body?.purpose === "liveStep") refinements.push(body.decisionKey);
  });
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const remote = new VseLlm("test", "test-model", async (_url, init) => {
    const content = JSON.parse(String(init?.body)).messages[1].content;
    packets.push(content);
    if (packets.length === 1) await first;
    const input = JSON.parse(content);
    const check = input.reason === "overdue" ?
      { action: "Спросите, когда исполнитель сообщит новый срок.", ref: "deadline" } : { choice: 2 };
    return Response.json({ choices: [{ message: { content: JSON.stringify(check) } }] });
  });
  const options = { stores: new Map([["demo", store], ["original", original]]), sources: new Map(), auth,
    publicDemo: true, secure: false, origin: "", staticDir: resolve("dist/web"),
    jurySimulation: {stepDelays: [1500, 2500, 2200, 2200, 2800] as const},
    ai: new AnalysisService(db, undefined, 500, undefined, remote) };
  const app = await createApp(options);
  try {
    const origin = await app.listen({host: "127.0.0.1", port: 0});
    options.origin = origin;
    await context.addCookies([{name: "wm_session", value: "test-session", url: origin}]);
    await page.goto(origin + "/live");
    const card = page.getByTestId("live-guidance");
    const basis = card.getByTestId("guidance-basis");
    const action = card.getByTestId("guidance-action");
    await expect(card.getByRole("link", {name: "Открыть заявку " + row.id, exact: true})).toBeVisible();
    await expect.poll(() => packets.length).toBe(1);
    await store.ingest(JSON.stringify([{...row, deadline: new Date(Date.now() - 60_000).toISOString()}]));
    await expect(basis).toContainText("уже прошёл");
    await expect(action).toContainText("новый срок");
    release();
    await expect(card).toHaveAttribute("data-origin", "model", {timeout: 18_000});
    await expect(card.getByRole("heading", {name: "Совет ИИ"})).toBeVisible();
    await expect(action).toHaveText("Спросите, когда исполнитель сообщит новый срок.");
    const expiry = Date.now() + 4200;
    await store.ingest(JSON.stringify([{...row, deadline: new Date(expiry).toISOString()}]));
    const unchangedRevision = store.revision;
    await expect(basis).toContainText("15 минут");
    await expect(basis).toContainText("уже прошёл", {timeout: 9000});
    expect(store.revision).toBe(unchangedRevision);
    await expect(card).toHaveAttribute("data-origin", "model");
    await page.screenshot({ path: testInfo.outputPath("live-guidance.png") });
    await page.getByRole("searchbox").fill("нет такой заявки");
    await expect(card).toHaveCount(0);
    await page.goto(origin + "/live?ns=original");
    await expect(basis).toContainText("не указан срок");
    await expect(card.getByRole("link", {name: "Открыть заявку ORIG-002", exact: true})).toBeVisible();
    await expect(card).toHaveAttribute("data-origin", "model");
    expect(packets.join(" ")).not.toMatch(/PRIVATE-001|ORIG-002|Приватн|Тема под проверкой/iu);
    const requestsBeforePoll = refinements.length;
    await page.waitForResponse((r) => r.url().includes("/api/dashboard?") &&
      new URL(r.url()).searchParams.get("ns") === "original");
    await expect(card).toHaveAttribute("data-origin", "model");
    expect(refinements).toHaveLength(requestsBeforePoll);
    await page.setViewportSize({width: 390, height: 844});
    await expect(action).toBeVisible();
    await card.getByRole("link", {name: "Открыть заявку ORIG-002", exact: true}).click();
    await expect(page).toHaveURL(/\/incident\/ORIG-002\?ns=original/);
    await page.goto(origin + "/simulation");
    // The new assignment appears in notifications while the earliest critical
    // deadline remains the first decision in both real and training queues.
    await expect(card).toContainText("SIM-AUTH-01");
    await expect(basis).toContainText("уже прошёл");
    await expect(page.getByRole("region", {name: "Уведомление об инциденте"})).toContainText("SIM-001");
    await page.screenshot({path: testInfo.outputPath("simulation-mobile.png"), animations: "disabled"});
    await page.setViewportSize({width: 1366, height: 768});
    await page.screenshot({path: testInfo.outputPath("simulation-desktop.png"), animations: "disabled"});
    await expect(card).toContainText("SIM-AUTH-01");
    await expect(basis).toContainText("уже прошёл");
  } finally {
    release();
    await page.close();
    await app.close();
    await db.close();
  }
});
