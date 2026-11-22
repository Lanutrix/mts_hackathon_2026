import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { createApp } from "../../apps/server/api.ts";
import { Auth } from "../../apps/server/auth.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";
import { PRIORITIES, STATES } from "../../packages/domain/index.ts";

for (const mode of ["batch", "stream"] as const) {
  for (const size of [10, 30, 800]) {
    test(`coordinator responds to ${size} arrivals by ${mode} from an empty shift`, async ({ page, context }, info) => {
      test.setTimeout(360_000);
      const db = await openDB(":memory:");
      const store = new Store(db, "demo");
      const auth = new Auth();
      auth.sessions.set(auth.digest("pressure"), {
        username: "дежурный", role: "coordinator", csrf: "test", expires: Date.now() + 600_000,
      });
      const app = await createApp({ stores: new Map([["demo", store]]), sources: new Map(), auth,
        origin: "", secure: false, publicDemo: false, staticDir: resolve("dist/web") });
      try {
        await store.ingest("[]");
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        await context.addCookies([{name: "wm_session", value: "pressure", url: origin}]);
        await page.setViewportSize({width: 1366, height: 768});
        await page.goto(origin + "/live");
        const empty = page.getByTestId("empty-shift");
        await expect(empty).toContainText("Новые заявки появятся здесь автоматически");
        await expect(page.getByTestId("live-guidance")).toHaveCount(0);
        const now = Date.now();
        const rows = generate(size).rows.map((row, i) => {
          const critical = i === 1 || i === 5;
          return { ...row, id: String(row.id), state: STATES[2].label, stateEnum: STATES[2].enum, stateId: 2,
            priorityId: critical ? 4 : 3, priority: PRIORITIES[critical ? 4 : 3],
            assignedGroupName: "Платформа", isNeedUp: false,
            deadline: new Date(now + (critical ? -15 : 60) * 60_000).toISOString() };
        });
        const count = page.getByTestId("live-count");
        const advice = page.getByTestId("live-guidance");
        const register = page.getByTestId("live-register");
        const ledger = register.locator("tbody tr");
        await count.evaluate(node => {
          node.setAttribute("data-observed", "");
          new MutationObserver(() => {
            const value = Number(node.textContent);
            if (value > 10 && value < 390) node.setAttribute("data-observed", String(value));
          }).observe(node, { childList: true, characterData: true, subtree: true });
        });
        let lastCommit = 0;
        if (mode === "batch") {
          await store.ingest(JSON.stringify(rows));
          lastCommit = Date.now();
        } else {
          for (let i = 0; i < rows.length; i++) {
            await store.ingest(JSON.stringify(rows.slice(0, i + 1)));
            lastCommit = Date.now();
            if (i === 0) {
              await expect(count).toHaveText("1");
              await expect(advice).toContainText(rows[0].id);
            }
            if (i === 5) {
              await expect(count).toHaveText("6");
              await advice.getByRole("button", { name: /Разобрать группу/ }).click();
              await expect(ledger).toHaveCount(2);
            }
            if (size === 800 && i === 399) {
              await expect(count).toHaveText("400");
              await expect(count).toHaveAttribute("data-observed", /[0-9]+/);
              await expect(ledger).toHaveCount(2);
              await expect(advice).toContainText(rows[1].id);
            }
          }
        }
        await expect(count).toHaveText(String(size));
        await expect(advice).toContainText(rows[1].id);
        await expect(advice.getByRole("status")).toContainText("Сервис ИИ не подключён");
        await expect(advice.getByTestId("guidance-action")).toHaveCount(0);
        console.log(JSON.stringify({ mode, size, revisions: store.revision - 1, finalPaintObservedMs: Date.now() - lastCommit }));
        if (mode === "batch") await advice.getByRole("button", { name: /Разобрать группу/ }).click();
        await expect(ledger).toHaveCount(2);
        await expect(ledger.first()).toHaveAttribute("data-testid", "card-" + rows[1].id);
        await expect(ledger.last()).toHaveAttribute("data-testid", "card-" + rows[5].id);
        const pinned = page.url();
        const board = await (await page.request.get(origin + "/api/dashboard?ns=demo&groupBy=response&register=1")).json();
        expect(board.triage.cases.map((c: { count: number }) => c.count)).toEqual([2, size - 2]);
        expect(board.register.total).toBe(size);
        const offset = Math.max(0, size - 4);
        const tail = await (await page.request.get(origin + "/api/dashboard?groupBy=response&register=1&offset=" + offset)).json();
        expect(tail.register.items.at(-1).id).toBe(rows.at(-1)?.id);
        await advice.getByRole("button", {name: "Подробнее"}).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", {name: "Сводка для передачи"}).click();
        await expect(dialog.getByRole("textbox")).toHaveValue(/Заявок в подборке: 2/);
        await expect(dialog.getByRole("textbox")).toHaveValue(new RegExp(rows[1].id));
        await dialog.getByRole("button", {name: "Закрыть разбор"}).click();
        if (size === 800 && mode === "batch") {
          await page.screenshot({path: info.outputPath("pressure-800.png")});
          await page.setViewportSize({ width: 390, height: 844 });
          await expect(ledger.first()).toBeInViewport();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        }
        await advice.getByRole("button", {name: "По симптомам и продуктам"}).click();
        await expect(count).toHaveText("2");
        await expect(page.getByLabel("Группировка инцидентов")).toHaveValue("symptomProduct");
        await expect(page.getByRole("button", {name: /Снять ограничение/})).toBeVisible();
        await expect(register.locator(".feed-pages")).toContainText("из 2");
        await expect(ledger.first()).toBeVisible();
        if (size === 800 && mode === "batch") {
          await page.getByRole("button", {name: /Снять ограничение/}).click();
          await expect(count).toHaveText("800");
          // A second wave gives every ticket the same urgent symptom. The full
          // group remains pageable and a single banner routes to all members.
          await store.ingest(JSON.stringify(rows.map(row => ({ ...row, priorityId: 4,
            priority: PRIORITIES[4], deadline: new Date(now - 60_000).toISOString() }))));
          const notice = page.getByRole("region", {name: "Уведомление об инциденте"});
          await expect(notice).toContainText("Срочные критические · 800");
          await notice.getByRole("button", {name: "Открыть подборку"}).click();
          await expect(register.locator(".feed-pages")).toContainText("из 800");
          const first = await ledger.first().getAttribute("data-testid");
          await register.getByRole("button", {name: "Следующая страница"}).click();
          await expect(ledger.first()).not.toHaveAttribute("data-testid", first!);
        }
        const expectedId = (await ledger.first().getAttribute("data-testid"))!.replace(/^card-/, "");
        await ledger.first().getByRole("button").click();
        await expect(page).toHaveURL(new RegExp("/incident/" + expectedId));
        if (size === 30 && mode === "stream") {
          await page.goto(pinned);
          await expect(ledger).toHaveCount(2);
          await store.ingest(JSON.stringify(rows.map((row, i) => i === 1 || i === 5
            ? { ...row, stateId: 7, state: STATES[7].label, stateEnum: STATES[7].enum } : row)));
          await expect(empty).toContainText("Подборка разобрана");
          await expect(advice).toHaveCount(0);
          await empty.getByRole("button", { name: "К очереди" }).click();
          await expect(count).toHaveText("28");
          await expect(ledger.first()).toBeVisible();
        }
      } finally {
        await page.close(); await app.close(); await db.close();
      }
    });
  }
}
