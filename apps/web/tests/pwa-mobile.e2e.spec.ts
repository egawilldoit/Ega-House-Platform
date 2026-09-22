import { expect, test } from "@playwright/test";

import {
  clearSeededNotificationsForOwner,
  createPwaFixtures,
  hasPwaAuthCredentials,
} from "./pwa-fixtures";

const MIDDLEWARE_PROTECTED_PATHS = [
  "/today",
  "/dashboard",
  "/home",
  "/goals",
  "/tasks",
  "/timer",
  "/review",
  "/ideas",
  "/startup",
  "/shutdown",
] as const;

const SERVICE_GATED_PATHS = [
  "/notifications",
  "/work-analytics",
  "/friction",
  "/settings/account",
  "/apps",
  "/help",
] as const;

const PUBLIC_PATHS = ["/", "/login", "/signup"] as const;

const BASELINE_OVERFLOW_PX: Record<string, number> = {
  "/notifications": 0,
  "/work-analytics": 0,
  "/friction": 0,
  "/settings/account": 0,
  "/apps": 0,
  "/help": 0,
  "/": 0,
  "/login": 0,
  "/signup": 0,
};

function baselineAllowance(path: string): number {
  return BASELINE_OVERFLOW_PX[path] ?? 0;
}

async function horizontalOverflowPx(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const platformRootDomain = process.env.E2E_AUTH_PLATFORM_DOMAIN ?? "egawilldoit.online";
const loginHost = process.env.E2E_AUTH_LOGIN_HOST ?? `www.${platformRootDomain}`;

function isLocalBaseURL(): boolean {
  const baseURL = test.info().project.use.baseURL ?? "";
  const hostname = new URL(baseURL).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost";
}

test.describe("PWA mobile — unauthenticated route matrix", () => {
  test.describe("middleware login redirects (staging host only)", () => {
    test.skip(
      isLocalBaseURL,
      "proxy.ts only applies ROOT_HOSTS auth redirects on production hosts; run via test:pwa:auth.",
    );

    for (const path of MIDDLEWARE_PROTECTED_PATHS) {
      test(`${path} redirects to login with next at phone width`, async ({ page }) => {
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        const location = response.headers()["location"] ?? "";
        const target = new URL(location);
        expect(target.hostname).toBe(loginHost);
        expect(target.pathname).toBe("/login");
        const next = target.searchParams.get("next");
        expect(next, `expected ?next for ${path}`).toBeTruthy();
        expect(new URL(next ?? "").pathname).toBe(path);
      });
    }
  });

  for (const path of PUBLIC_PATHS) {
    test(`${path} renders at phone width without horizontal overflow`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
      expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(baselineAllowance(path));
    });
  }

  for (const path of SERVICE_GATED_PATHS) {
    test(`${path} renders or gates service data at phone width`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      const overflow = await horizontalOverflowPx(page);
      expect(overflow).toBeLessThanOrEqual(baselineAllowance(path));
      const bodyText = (await page.locator("body").textContent())?.trim() ?? "";
      expect(bodyText.length).toBeGreaterThan(10);
    });
  }
});

test.describe("PWA mobile — authenticated route baseline", () => {
  test.skip(
    () => !hasPwaAuthCredentials() || isLocalBaseURL(),
    "Set E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD (and E2E_SEED_DATABASE_URL for notification seeding) against the staging host to run authenticated PWA coverage.",
  );

  test("sign in lands on /today with usable mobile layout", async ({ page }) => {
    const fixtures = await createPwaFixtures(page);
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    expect(await horizontalOverflowPx(fixtures.page)).toBeLessThanOrEqual(0);
  });

  test("notification bell stays visible with 0 and 1 unread", async ({ page }) => {
    const fixtures = await createPwaFixtures(page);
    const { ownerA } = fixtures;
    const viewportWidth = test.info().project.use.viewport?.width ?? 1280;
    const topbarBell = page
      .locator(".workspace-topbar")
      .getByRole("link", { name: /^Notifications/ });
    try {
      for (const unread of [0, 1]) {
        await fixtures.setUnreadNotifications(unread);
        await page.goto("/today", { waitUntil: "domcontentloaded" });
        if (unread > 0 || viewportWidth > 420) {
          await expect(topbarBell).toBeVisible({ timeout: 20_000 });
        } else {
          await expect(topbarBell).toBeHidden();
        }
      }
    } finally {
      await clearSeededNotificationsForOwner(ownerA);
    }
  });

  test("protected routes render authenticated content at phone width", async ({ page }) => {
    await createPwaFixtures(page);
    for (const path of MIDDLEWARE_PROTECTED_PATHS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.waitForLoadState("load");
      expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);
    }
  });
});
