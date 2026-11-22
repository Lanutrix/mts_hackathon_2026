import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Auth } from "../../apps/server/auth.ts";
import { createApp } from "../../apps/server/api.ts";
import { openDB } from "../../apps/server/db.ts";
import { Store } from "../../apps/worker/ingestion.ts";

test("a QR link opens the home page signed in to the configured account", async ({ page }) => {
  const db = await openDB(":memory:");
  try {
    const store = await new Store(db, "workspace").load();
    const auth = new Auth();
    auth.users.push({ username: "Тест", role: "coordinator", salt: "", hash: "" });
    const token = randomBytes(32).toString("base64url");
    const app = await createApp({
      stores: new Map([["workspace", store]]),
      sources: new Map(),
      auth,
      publicDemo: false,
      secure: false,
      origin: "",
      qrLogin: { username: "Тест", tokenHash: auth.digest(token), expires: Date.now() + 300_000 },
    });
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      await page.goto(origin + "/qr-login.html#" + token);
      await expect(page).toHaveURL(origin + "/");
      await expect(page.getByRole("link", { name: "Мой профиль" })).toBeVisible();
      const session = await page.request.get(origin + "/api/me").then((response) => response.json());
      expect(session.user).toMatchObject({ username: "Тест", role: "coordinator" });
      await page.reload();
      await expect(page.getByRole("link", { name: "Мой профиль" })).toBeVisible();
    } finally {
      await page.close();
      await app.close();
    }
  } finally {
    await db.close();
  }
});
