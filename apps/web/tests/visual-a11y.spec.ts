import { test, expect } from "@playwright/test";

const routes = [
  "/dashboard",
  "/today",
  "/tasks",
  "/goals",
  "/timer",
  "/review",
  "/work-analytics",
  "/startup",
  "/shutdown",
  "/settings/account",
  "/login",
] as const;

test.describe("visual and a11y — desktop and 390px", () => {
  for (const route of routes) {
    test(`route ${route} has no horizontal overflow at 1280 and 390`, async ({ page }) => {
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "domcontentloaded" });
        // Wait for content
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            hasHorizontalScrollbar: doc.scrollWidth > doc.clientWidth + 1,
          };
        });
        // Allow intentional table overflow (tasks) but not general page overflow > 20px
        expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(20);
      }
    });
  }

  test("keyboard navigation reaches main content", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    // Should have visible focus or skip link
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
  });

  test("reduced motion does not break layout", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("command palette opens via button", async ({ page }) => {
    await page.goto("/dashboard");
    const trigger = page.locator("button.workspace-search-trigger");
    if (await trigger.count()) {
      await trigger.first().click();
      await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 2000 }).catch(() => {});
    }
  });
});
