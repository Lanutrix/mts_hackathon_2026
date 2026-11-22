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

test("live assistant presents generated prose with a Russian ticket link and recovers from failure", async ({ page, context }, info) => {
  const db = await openDB(":memory:");
  const store = new Store(db, "original");
  const row = { ...generate(1).rows[0], id: "ORIG-004", stateId: 2, stateEnum: STATES[2].enum,
    state: STATES[2].label, priorityId: 4, priority: PRIORITIES[4], deadline: new Date(Date.now() - 60_000).toISOString() };
  const auth = new Auth();
  auth.sessions.set(auth.digest("shift-user"), { username: "дежурный", role: "coordinator", csrf: "csrf",
    expires: Date.now() + 120_000 });
  const observation = "Срок решения заявки уже прошёл.";
  const action = "Уточните у команды, когда она сможет назвать новый срок.";
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let tries = 0;
  const remote = new VseLlm("test", "test-model", async (_url, init) => {
    if (++tries === 1) { await waiting; return new Response(null, {status: 503}); }
    if (JSON.parse(JSON.parse(String(init?.body)).messages[1].content).candidate)
      return Response.json({choices: [{message: {content: JSON.stringify({grounded: true, manual: true})}}]});
    return Response.json({ choices: [{message: {content: JSON.stringify({observation, action, refs: ["deadline"]})}}] });
  });
  const options = { stores: new Map([["original", store]]), sources: new Map(), auth,
    ai: new AnalysisService(db, undefined, 500, undefined, remote),
    publicDemo: false, secure: false, origin: "", staticDir: resolve("dist/web") };
  const app = await createApp(options);
  try {
    await store.ingest(JSON.stringify([row]));
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    options.origin = origin;
    await context.addCookies([{name: "wm_session", value: "shift-user", url: origin}]);
    await page.goto(origin + "/live?ns=original");
    const card = page.getByTestId("live-guidance");
    const ticket = card.getByRole("link", {name: "Открыть заявку ORIG-004"});
    await expect(ticket).toHaveText("Открыть заявку");
    await expect(ticket).toHaveAttribute("href", "/incident/ORIG-004?ns=original");
    await expect(card.getByRole("status")).toContainText("Готовим совет");
    await expect(card.getByTestId("guidance-action")).toHaveCount(0);
    release();
    const retry = card.getByRole("button", {name: "Повторить"});
    await expect(retry).toBeVisible();
    await expect(card.getByTestId("guidance-action")).toHaveCount(0);
    await retry.press("Enter");
    await expect(card.getByTestId("guidance-action")).toHaveText(observation + " " + action, {timeout: 30_000});
    await context.setOffline(true);
    await expect(card.getByRole("status")).toContainText("Нет подключения к сети");
    await expect(card.getByTestId("guidance-action")).toHaveCount(0);
    await context.setOffline(false);
    await expect(card.getByTestId("guidance-action")).toHaveText(observation + " " + action);
    await expect(card.getByRole("group", {name: "Подсказки смены"})).toHaveCount(0);
    await card.getByRole("button", {name: "Подробнее"}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card.getByRole("button", {name: "Подробнее"})).toBeFocused();
    for (const [theme, width, height] of [["dark", 390, 844], ["light", 1366, 768]] as const) {
      await page.setViewportSize({width, height});
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(card).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.getByTestId("live-register").locator("tbody tr").first()).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({path: info.outputPath("live-prose-" + theme + ".png")});
    }
    await ticket.press("Enter");
    await expect(page).toHaveURL(/\/incident\/ORIG-004\?ns=original/);
  } finally {
    release(); await page.close(); await app.close(); await db.close();
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
    const outputs = {
      overdue: {observation: "Срок решения заявки уже прошёл.", action: "Уточните у команды, когда она сможет назвать новый срок.", refs: ["deadline"]},
      soon: {observation: "До срока решения осталось не более 15 минут.", action: "Уточните, успевает ли команда завершить работы.", refs: ["deadline"]},
      missingDeadline: {observation: "В заявке не указан срок решения.", action: "Уточните, когда появится оценка срока.", refs: ["deadline"]},
      progress: {observation: "За заявкой закреплена команда.", action: "Запросите время следующего обновления по заявке.", refs: ["assignedGroupName"]},
    };
    const reason = input.focus !== "deadline" ? "progress" : input.facts.deadline.includes("прошёл") ? "overdue" :
      input.facts.deadline.includes("15 минут") ? "soon" : "missingDeadline";
    const check = input.candidate ? {grounded: true, manual: true} : outputs[reason];
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
    const action = card.getByTestId("guidance-action");
    await expect(card.getByRole("link", {name: "Открыть заявку " + row.id, exact: true})).toBeVisible();
    await expect.poll(() => packets.length).toBe(1);
    const changed = page.waitForResponse(r => r.url().includes("/api/dashboard?"));
    await store.ingest(JSON.stringify([{...row, deadline: new Date(Date.now() - 60_000).toISOString()}]));
    await changed;
    await expect(action).toHaveCount(0);
    release();
    await expect(card).toHaveAttribute("data-origin", "model", {timeout: 18_000});
    await expect(card.getByRole("heading", {name: "Совет ИИ"})).toBeVisible();
    await expect(action).toContainText("Уточните у команды, когда она сможет назвать новый срок.");
    const expiry = Date.now() + 4200;
    await store.ingest(JSON.stringify([{...row, deadline: new Date(expiry).toISOString()}]));
    const unchangedRevision = store.revision;
    await expect(action).toContainText("15 минут");
    await expect(action).toContainText("уже прошёл", {timeout: 9000});
    expect(store.revision).toBe(unchangedRevision);
    await expect(card).toHaveAttribute("data-origin", "model");
    await page.screenshot({ path: testInfo.outputPath("live-guidance.png") });
    await page.getByRole("searchbox").fill("нет такой заявки");
    await expect(card).toHaveCount(0);
    const revisions: string[] = [];
    const decisionKeys: string[] = [];
    await page.route("**/analysis?**", async route => {
      const request = route.request();
      const params = new URL(request.url()).searchParams;
      if (params.get("ns") !== "original" || request.postDataJSON()?.purpose !== "liveStep") {
        await route.continue();
        return;
      }
      revisions.push(params.get("revision")!);
      decisionKeys.push(request.postDataJSON().decisionKey);
      if (revisions.length === 1) {
        const fresh = page.waitForResponse(r => r.url().includes("/api/dashboard?") &&
          new URL(r.url()).searchParams.get("ns") === "original");
        await original.ingest(JSON.stringify([{...row, id: "ORIG-002", deadline: null, header: "Уточнение темы"}]));
        await fresh;
        await route.fulfill({status: 409, json: {message: "Совет уже изменился."}});
      } else await route.continue();
    });
    await page.goto(origin + "/live?ns=original");
    await expect(action).toContainText("не указан срок");
    expect(revisions).toEqual(["1", "2"]);
    expect(decisionKeys[0]).toBe(decisionKeys[1]);
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
    await expect(page.getByRole("region", {name: "Уведомление об инциденте"})).toContainText("SIM-001");
    await page.screenshot({path: testInfo.outputPath("simulation-mobile.png"), animations: "disabled"});
    await page.setViewportSize({width: 1366, height: 768});
    await page.screenshot({path: testInfo.outputPath("simulation-desktop.png"), animations: "disabled"});
    await expect(card).toContainText("SIM-AUTH-01");
  } finally {
    release();
    await page.close();
    await app.close();
    await db.close();
  }
});
