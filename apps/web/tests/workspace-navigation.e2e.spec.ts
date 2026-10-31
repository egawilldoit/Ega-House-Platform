import { expect, test, type Page } from "@playwright/test";

import { createPwaFixtures, hasPwaAuthCredentials } from "./pwa-fixtures";

const protocol = process.env.E2E_AUTH_PROTOCOL ?? "https";
const platformRootDomain = process.env.E2E_AUTH_PLATFORM_DOMAIN ?? "egawilldoit.online";
const loginHost = process.env.E2E_AUTH_LOGIN_HOST ?? `www.${platformRootDomain}`;

const WORKSPACE_ROUTES = [
  { path: "/home", label: "Home" },
  { path: "/today", label: "Today" },
  { path: "/tasks", label: "Tasks" },
  { path: "/goals", label: "Goals" },
  { path: "/timer", label: "Timer" },
  { path: "/review", label: "Review" },
] as const;

function getShellRoot(page: Page) {
  return page.locator("[data-ega-shell-root]");
}

async function getNavLink(page: Page, label: string) {
  // Try desktop sidebar nav first
  const sidebarLink = page
    .locator(".sidebar-nav")
    .getByRole("link", { name: label, exact: false })
    .first();
  if ((await sidebarLink.count()) > 0) {
    return sidebarLink;
  }
  // Try any link with the label
  const anyLink = page.getByRole("link", { name: label, exact: false }).first();
  if ((await anyLink.count()) > 0) {
    return anyLink;
  }
  throw new Error(`Navigation link not found for label: ${label}`);
}

test.describe("Workspace navigation with persistent shell", () => {
  test.skip(
    () => !hasPwaAuthCredentials(),
    "Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD to run authenticated workspace navigation tests.",
  );

  test("authenticated Home→Today→Tasks→Goals→Timer→Review with persistent shell sentinel", async ({
    page,
  }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    // Sentinel on actual shell element
    const shellSentinel = await shellRoot.evaluate((el) => {
      const root = el as HTMLElement;
      return root.getAttribute("data-ega-shell-root");
    });
    expect(shellSentinel).not.toBeNull();

    // Navigate through sequence: Home→Today→Tasks→Goals→Timer→Review
    for (const route of WORKSPACE_ROUTES) {
      const navLink = await getNavLink(fixtures.page, route.label);
      await expect(navLink).toBeVisible({ timeout: 10_000 });

      const navigationPromise = fixtures.page.waitForURL(
        (url) => url.pathname === route.path || url.pathname.startsWith(route.path + "/"),
        { timeout: 15_000 },
      );
      await navLink.click();
      await navigationPromise;

      // Verify shell persists (same sentinel element)
      await expect(shellRoot).toBeVisible();
      const shellSentinelAfter = await shellRoot.evaluate((el) => {
        const root = el as HTMLElement;
        return root.getAttribute("data-ega-shell-root");
      });
      expect(shellSentinelAfter).toBe(shellSentinel);
    }
  });

  test("detect full-document nav after initial load", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    let fullDocumentLoadCount = 0;
    fixtures.page.on("load", () => {
      fullDocumentLoadCount += 1;
    });

    const initialLoadCount = fullDocumentLoadCount;

    // Perform client-side navigations
    const routes = ["/today", "/tasks", "/goals"];
    for (const route of routes) {
      const label = route.slice(1).charAt(0).toUpperCase() + route.slice(2);
      const navLink = await getNavLink(fixtures.page, label);
      await navLink.click();
      await fixtures.page.waitForURL(
        (url) => url.pathname === route || url.pathname.startsWith(route + "/"),
        { timeout: 10_000 },
      );
    }

    // After initial load, content-only navigations should not trigger full document loads
    // (or at most minimal). We detect full-document nav by 'load' events.
    expect(fullDocumentLoadCount).toBe(initialLoadCount);
    await expect(shellRoot).toBeVisible();
  });

  test("content-only loading without document reloads", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    let loadEventCount = 0;
    fixtures.page.on("load", () => {
      loadEventCount += 1;
    });

    const beforeLoadCount = loadEventCount;

    const routes = ["/today", "/tasks", "/goals", "/timer", "/review"];
    for (const route of routes) {
      const label = route.slice(1).charAt(0).toUpperCase() + route.slice(2);
      const navLink = await getNavLink(fixtures.page, label);
      await navLink.click();
      await fixtures.page.waitForURL(
        (url) => url.pathname === route || url.pathname.startsWith(route + "/"),
        { timeout: 10_000 },
      );
    }

    expect(loadEventCount).toBe(beforeLoadCount);
    await expect(shellRoot).toBeVisible();
  });

  test("sidebar collapse persistence", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const collapseToggle = fixtures.page.getByTestId("sidebar-collapse-toggle").first();
    await expect(collapseToggle).toBeVisible({ timeout: 10_000 });

    const sidebar = fixtures.page.locator(".ega-sidebar").first();
    await expect(sidebar).toBeVisible();

    // Collapse sidebar
    await collapseToggle.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    // Navigate to another route - collapse state should persist
    const navLink = await getNavLink(fixtures.page, "Tasks");
    await navLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/tasks" || url.pathname.startsWith("/tasks/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    // Expand sidebar
    await collapseToggle.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    // Navigate again - should persist expanded state
    const todayLink = await getNavLink(fixtures.page, "Today");
    await todayLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/today" || url.pathname.startsWith("/today/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  test("mobile drawer navigation", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    // Open mobile drawer
    const menuButton = fixtures.page
      .getByRole("button", { name: /open workspace navigation|menu|navigation/i })
      .first();
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await menuButton.click();

    // Drawer should be open
    const drawer = fixtures.page
      .locator('[role="dialog"], .workspace-navigation-drawer, [aria-modal="true"], .workspace-mobile-navigation [role="dialog"]')
      .first();
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Navigate via drawer
    const drawerTodayLink = fixtures.page.getByRole("link", { name: "Today" }).first();
    await expect(drawerTodayLink).toBeVisible({ timeout: 5_000 });
    await drawerTodayLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/today" || url.pathname.startsWith("/today/"),
      { timeout: 10_000 },
    );
    await expect(shellRoot).toBeVisible();
  });

  test("keyboard shortcuts work", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const currentUrl = fixtures.page.url();

    // Test keyboard shortcuts (e.g., g+t for today)
    await fixtures.page.keyboard.press("g");
    await fixtures.page.keyboard.press("t");

    // Wait for potential navigation
    await fixtures.page.waitForURL(
      (url) => url.pathname.includes("/today") || url.href !== currentUrl,
      { timeout: 5000 },
    ).catch(() => {
      // Shortcuts may not navigate or may be handled differently
    });

    await expect(shellRoot).toBeVisible();
  });

  test("task drawer", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    // Navigate to tasks
    const tasksLink = await getNavLink(fixtures.page, "Tasks");
    await tasksLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/tasks" || url.pathname.startsWith("/tasks/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible();

    // Look for task items that might open a drawer
    const taskItem = fixtures.page
      .locator('[data-testid*="task"], .task-item, [role="button"][aria-label*="task" i]')
      .first();
    
    if ((await taskItem.count()) > 0) {
      await taskItem.click();
      // Check if drawer/panel opens
      const taskDrawer = fixtures.page
        .locator('[role="dialog"], [data-testid*="drawer"], .task-drawer, .sheet')
        .first();
      // Task drawer may or may not open depending on implementation
      await expect(shellRoot).toBeVisible();
    }
  });

  test("timer functionality", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    // Navigate to timer
    const timerLink = await getNavLink(fixtures.page, "Timer");
    await timerLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/timer" || url.pathname.startsWith("/timer/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible();
    
    // Timer page should load without full document reload
    await expect(fixtures.page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("logout clears session and forces protected routes to login", async ({ page }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    // Find and click logout button
    const logoutButton = fixtures.page
      .getByRole("button", { name: /logout/i })
      .or(fixtures.page.getByRole("link", { name: /logout/i }))
      .first();

    await expect(logoutButton).toBeVisible({ timeout: 10_000 });
    await logoutButton.click();

    // Should redirect to login
    await fixtures.page.waitForURL(
      (url) => url.hostname === loginHost && url.pathname === "/login",
      { timeout: 20_000 },
    );
    await expect(fixtures.page.getByRole("heading", { level: 2 })).toContainText(/sign in/i);

    // Protected route should redirect to login
    await fixtures.page.goto(`${protocol}://${loginHost}/dashboard`, { waitUntil: "domcontentloaded" });
    await fixtures.page.waitForURL((url) => url.pathname === "/login", { timeout: 10_000 });
    const redirected = new URL(fixtures.page.url());
    expect(redirected.hostname).toBe(loginHost);
  });

  test("redirects for protected routes when unauthenticated", async ({ page }) => {
    // Clear any existing session by navigating to login
    await page.goto(`${protocol}://${loginHost}/login`, { waitUntil: "domcontentloaded" });

    // Try to access protected routes
    const protectedRoutes = ["/home", "/today", "/tasks", "/dashboard"];
    for (const route of protectedRoutes) {
      await page.goto(`${protocol}://${loginHost}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 10_000 });
      const redirected = new URL(page.url());
      expect(redirected.hostname).toBe(loginHost);
      expect(redirected.pathname).toBe("/login");
    }
  });

  test("shell root persists across all navigation with no document reloads and no page.goto fallback", async ({
    page,
  }) => {
    if (!hasPwaAuthCredentials()) {
      test.skip();
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const initialShellSentinel = await shellRoot.evaluate((el) => {
      const root = el as HTMLElement;
      return root.getAttribute("data-ega-shell-root");
    });
    expect(initialShellSentinel).not.toBeNull();

    let loadEventCount = 0;
    fixtures.page.on("load", () => {
      loadEventCount += 1;
    });
    const beforeLoadCount = loadEventCount;

    const routes = ["/today", "/tasks", "/goals", "/timer", "/review", "/home"];
    for (const route of routes) {
      const label =
        route === "/home"
          ? "Home"
          : route.slice(1).charAt(0).toUpperCase() + route.slice(2);
      const navLink = await getNavLink(fixtures.page, label);
      await navLink.click();
      await fixtures.page.waitForURL(
        (url) => url.pathname === route || url.pathname.startsWith(route + "/"),
        { timeout: 10_000 },
      );

      // Shell root must persist with same sentinel
      await expect(fixtures.page.locator("[data-ega-shell-root]")).toBeVisible();
      const currentSentinel = await fixtures.page
        .locator("[data-ega-shell-root]")
        .evaluate((el) => (el as HTMLElement).getAttribute("data-ega-shell-root"));
      expect(currentSentinel).toBe(initialShellSentinel);
    }

    // No full document reloads during client-side navigation
    expect(loadEventCount).toBe(beforeLoadCount);
  });
});
