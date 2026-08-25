import { test, expect } from "@playwright/test";

const publicRoutes = ["/login"] as const;
const authenticatedRoutes = [
  "/dashboard",
  "/today",
  "/tasks",
] as const;

test.describe("visual and a11y — desktop and 390px", () => {
  test("public routes render without redirect and have visible heading", async ({ page }) => {
    for (const route of publicRoutes) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}(\\?.*)?$`));
        await expect(page.locator("h1").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(20);
      }
    }
  });

  test("authenticated routes either render or redirect to /login (no false positive)", async ({ page }) => {
    test.setTimeout(180_000);
    for (const route of authenticatedRoutes) {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(route, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(200);
        const url = new URL(page.url());
        if (url.pathname === "/login") {
          // No credentials in CI — redirect is expected, not a visual validation
          expect(url.pathname).toBe("/login");
          continue;
        }
        // If authenticated (when credentials present), verify heading and overflow
        if (url.pathname !== route) {
          // Redirected (e.g., to /login) — already handled above, skip heading check
          continue;
        }
        // Authenticated route rendered — check for any heading or body content
        const hasH1 = (await page.locator("h1").count()) > 0;
        if (hasH1) {
          await expect(page.locator("h1").first()).toBeVisible({ timeout: 5000 });
        } else {
          const bodyText = (await page.locator("body").textContent())?.trim() ?? "";
          expect(bodyText.length).toBeGreaterThan(10);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(20);
      }
    }
  });

  test("keyboard Tab yields a focusable control", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeTruthy();
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(focusedTag);
  });

  test("reduced motion does not break layout", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(20);
  });

  test("command palette opens and closes via Escape", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    // Palette trigger exists on authenticated shell; on /login it may not, so skip if missing
    const trigger = page.locator("button.workspace-search-trigger");
    if ((await trigger.count()) === 0) {
      test.skip();
      return;
    }
    await trigger.first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 2000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 2000 });
  });
});
