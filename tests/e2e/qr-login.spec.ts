import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Auth, issueQrLoginToken } from "../../apps/server/auth.ts";
import { createApp } from "../../apps/server/api.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";
import { generate } from "../../packages/domain/generator.ts";

test("opening a QR link in a fresh browser lands on the authorized live register", async ({ page }) => {
  const db = await openDB(":memory:");
  try {
    const store = await new Store(db, "demo").load();
    await store.ingest(JSON.stringify(generate(4).rows));
    const auth = new Auth();
    auth.users.push({ username: "Жюри", role: "viewer", salt: "", hash: "" });
    const secret = randomBytes(32).toString("hex");
    const app = await createApp({
      stores: new Map([["demo", store]]),
      sources: new Map(),
      auth,
      publicDemo: false,
      secure: false,
      origin: "",
      qrLoginSecret: secret,
    });
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      await page.goto(origin + "/qr-login.html#" + issueQrLoginToken("Жюри", 5, secret));
      await expect(page).toHaveURL(origin + "/live");
      await expect(page.getByRole("button", { name: "Профиль: Жюри" })).toBeVisible();
      await expect(page.getByTestId("live-register")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: "Профиль: Жюри" })).toBeVisible();
    } finally {
      await page.close();
      await app.close();
    }
  } finally {
    await db.close();
  }
});
