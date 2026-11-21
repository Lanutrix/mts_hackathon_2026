import { webkit } from "@playwright/test";
const browser = await webkit.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("console", m.text());
});
page.on("requestfailed", (r) =>
  console.log("failed", r.url(), r.failure()?.errorText),
);
try {
  await page.goto("http://127.0.0.1:3000/", { timeout: 10000 });
  console.log("http-ready", await page.title());
  console.log("body", await page.locator("body").innerText({ timeout: 5000 }));
  await page.screenshot({
    path: ".runtime/qa/webkit-debug.png",
    timeout: 5000,
  });
} catch (e) {
  console.log("failure", e.message);
} finally {
  await browser.close();
}
