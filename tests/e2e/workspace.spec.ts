import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generate } from "../../packages/domain/generator.ts";

import { createFixtureViewer } from "../../scripts/fixture-viewer.ts";
let viewer: Awaited<ReturnType<typeof createFixtureViewer>>;
const origin = "http://127.0.0.1:3228";
const fixture = generate(360);
let server: ChildProcess;
let source: string;

test.beforeAll(async () => {
  const dir = await mkdtemp(resolve(".runtime/workspace-e2e-"));
  viewer = await createFixtureViewer(dir);
  source = join(dir, "incidents.json");
  await writeFile(source, JSON.stringify(fixture.rows));
  server = spawn(process.execPath, ["--import", "tsx", "apps/server/main.ts"], {
    env: {
      ...process.env,
      PORT: "3228",
      ORIGIN: origin,
      USERS_FILE: viewer.path,
      SOURCE_FILE: source,
      DATA_DIR: dir,
    },
    windowsHide: true,
    stdio: "ignore",
  });
  await expect
    .poll(
      async () =>
        fetch(origin + "/health/ready").then(
          (r) => r.ok,
          () => false,
        ),
      { timeout: 20000 },
    )
    .toBe(true);
});
test.afterAll(() => {
  server?.kill();
});

test("queue keeps a selected ticket through search, source revision and reload; paginated groups contain each ID once", async ({
  page,
}) => {
  expect(
    (
      await page.request.post(origin + "/api/login", {
        data: viewer.credentials,
      })
    ).ok(),
  ).toBe(true);
  await page.goto(origin + "/workspace");
  const queue = page.getByRole("region", { name: "Инциденты" });
  const context = page.getByRole("complementary", { name: "Контекст разбора" });
  const search = queue.getByRole("searchbox");
  const chosen = "DEMO-42-00022";
  await search.fill(chosen);
  await queue.getByRole("checkbox", { name: "Выбрать " + chosen }).check();
  await expect(context).toContainText(chosen);
  await search.fill("несуществующее обращение");
  await expect(queue.getByRole("checkbox")).toHaveCount(0);
  await expect(context).toContainText(chosen);
  await search.fill("");
  await queue.getByRole("button", { name: "По команде" }).click();
  const more = queue.getByRole("button", { name: "Показать ещё" });
  await expect(more).toBeVisible();
  const expected = new Set(Object.values(fixture.manifest.expected).flat());
  const checkboxes = queue.getByRole("checkbox");
  let count = await checkboxes.count();
  while (count < expected.size) {
    await more.click();
    await expect.poll(() => checkboxes.count()).toBeGreaterThan(count);
    count = await checkboxes.count();
  }
  await expect(more).toHaveCount(0);
  const labels = await checkboxes.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label")),
  );
  expect(labels.length).toEqual(expected.size);
  expect(new Set(labels).size).toEqual(expected.size);
  const updated = fixture.rows.map((r) =>
    r.id === chosen ? { ...r, header: "Обновлённый заголовок" } : r,
  );
  await writeFile(source, JSON.stringify(updated));
  await queue.getByRole("button", { name: "Обновить очередь" }).click();
  await expect(context).toContainText(chosen);
  await page.reload();
  await expect(context).toContainText(chosen);
  await expect(
    context.getByRole("button", { name: "Сформировать сводку" }),
  ).toBeDisabled();
});
