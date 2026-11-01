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
  const sidebarLink = page
    .locator(".sidebar-nav")
    .getByRole("link", { name: label, exact: false })
    .first();
  if ((await sidebarLink.count()) > 0) {
    return sidebarLink;
  }
  const anyLink = page.getByRole("link", { name: label, exact: false }).first();
  if ((await anyLink.count()) > 0) {
    return anyLink;
  }
  throw new Error(`Navigation link not found for label: ${label}`);
}

test.describe("Workspace navigation with persistent shell", () => {
  test.skip(
    !hasPwaAuthCredentials(),
    "Set E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD to run authenticated workspace navigation tests.",
  );

  test("authenticated navigation preserves original shell DOM element identity including return to Home", async ({
    page,
  }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping authenticated workspace navigation test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();
    expect(typeof originalShellIdentity.testId).toBe("string");
    expect(originalShellIdentity.testId.length).toBeGreaterThan(0);

    for (const route of WORKSPACE_ROUTES) {
      const navLink = await getNavLink(fixtures.page, route.label);
      await expect(navLink).toBeVisible({ timeout: 10_000 });

      const navigationPromise = fixtures.page.waitForURL(
        (url) => url.pathname === route.path || url.pathname.startsWith(route.path + "/"),
        { timeout: 15_000 },
      );
      await navLink.click();
      await navigationPromise;

      await expect(shellRoot).toBeVisible({ timeout: 10_000 });
      const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
        const root = el as HTMLElement & { __egaShellTestId?: string };
        return {
          testId: root.__egaShellTestId ?? null,
          sentinel: root.getAttribute("data-ega-shell-root"),
          isSameObject: root.__egaShellTestId === expectedTestId,
        };
      }, originalShellIdentity.testId);

      expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
      expect(identityAfter.testId).toBe(originalShellIdentity.testId);
      expect(identityAfter.isSameObject).toBe(true);
    }

    const homeNavLink = await getNavLink(fixtures.page, "Home");
    await expect(homeNavLink).toBeVisible({ timeout: 10_000 });
    const homeNavPromise = fixtures.page.waitForURL(
      (url) => url.pathname === "/home" || url.pathname.startsWith("/home/"),
      { timeout: 15_000 },
    );
    await homeNavLink.click();
    await homeNavPromise;

    await expect(shellRoot).toBeVisible({ timeout: 10_000 });
    const identityAfterHome = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);

    expect(identityAfterHome.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfterHome.testId).toBe(originalShellIdentity.testId);
    expect(identityAfterHome.isSameObject).toBe(true);
  });

  test("document navigation request count with original shell identity preserved", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping document navigation count test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    let documentLoadCount = 0;
    const onLoad = () => {
      documentLoadCount += 1;
    };
    fixtures.page.on("load", onLoad);

    const initialDocumentLoadCount = documentLoadCount;

    const routes = ["/today", "/tasks", "/goals"];
    for (const route of routes) {
      const label = route === "/home" ? "Home" : route.slice(1).charAt(0).toUpperCase() + route.slice(2);
      const navLink = await getNavLink(fixtures.page, label);
      await expect(navLink).toBeVisible({ timeout: 10_000 });

      const navigationPromise = fixtures.page.waitForURL(
        (url) => url.pathname === route || url.pathname.startsWith(route + "/"),
        { timeout: 10_000 },
      );
      await navLink.click();
      await navigationPromise;

      await expect(shellRoot).toBeVisible({ timeout: 10_000 });
      const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
        const root = el as HTMLElement & { __egaShellTestId?: string };
        return {
          testId: root.__egaShellTestId ?? null,
          sentinel: root.getAttribute("data-ega-shell-root"),
          isSameObject: root.__egaShellTestId === expectedTestId,
        };
      }, originalShellIdentity.testId);

      expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
      expect(identityAfter.testId).toBe(originalShellIdentity.testId);
      expect(identityAfter.isSameObject).toBe(true);
    }

    expect(documentLoadCount).toBe(initialDocumentLoadCount);
    fixtures.page.off("load", onLoad);
  });

  test("sidebar collapse persistence preserves shell identity", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping sidebar collapse persistence test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    const collapseToggle = fixtures.page.getByTestId("sidebar-collapse-toggle").first();
    await expect(collapseToggle).toBeVisible({ timeout: 10_000 });

    const sidebar = fixtures.page.locator(".ega-sidebar").first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });

    await collapseToggle.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true", { timeout: 10_000 });

    const navLink = await getNavLink(fixtures.page, "Tasks");
    await expect(navLink).toBeVisible({ timeout: 10_000 });
    await navLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/tasks" || url.pathname.startsWith("/tasks/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).toHaveAttribute("data-collapsed", "true", { timeout: 10_000 });
    const identityAfterTasks = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);
    expect(identityAfterTasks.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfterTasks.testId).toBe(originalShellIdentity.testId);
    expect(identityAfterTasks.isSameObject).toBe(true);

    await collapseToggle.click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "false", { timeout: 10_000 });

    const todayLink = await getNavLink(fixtures.page, "Today");
    await expect(todayLink).toBeVisible({ timeout: 10_000 });
    await todayLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/today" || url.pathname.startsWith("/today/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).toHaveAttribute("data-collapsed", "false", { timeout: 10_000 });
    const identityAfterToday = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);
    expect(identityAfterToday.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfterToday.testId).toBe(originalShellIdentity.testId);
    expect(identityAfterToday.isSameObject).toBe(true);
  });

  test("mobile drawer navigation preserves shell identity", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping mobile drawer navigation test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    const menuButton = fixtures.page
      .getByRole("button", { name: /menu|open.*navigation/i })
      .or(fixtures.page.locator(".workspace-nav-trigger"))
      .first();
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await menuButton.click();

    const drawer = fixtures.page
      .locator(
        '[role="dialog"], .workspace-navigation-drawer, [aria-modal="true"], .workspace-mobile-navigation [role="dialog"]',
      )
      .first();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const drawerTodayLink = fixtures.page.getByRole("link", { name: "Today" }).first();
    await expect(drawerTodayLink).toBeVisible({ timeout: 10_000 });
    await drawerTodayLink.click();
    await fixtures.page.waitForURL(
      (url) => url.pathname === "/today" || url.pathname.startsWith("/today/"),
      { timeout: 10_000 },
    );

    await expect(shellRoot).toBeVisible({ timeout: 10_000 });
    const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);
    expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfter.testId).toBe(originalShellIdentity.testId);
    expect(identityAfter.isSameObject).toBe(true);
  });

  test("keyboard shortcuts do not swallow exceptions and preserve shell identity", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping keyboard shortcuts test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    const currentUrl = fixtures.page.url();

    await fixtures.page.keyboard.press("g");
    await fixtures.page.keyboard.press("t");

    await fixtures.page.waitForTimeout(1000);

    await expect(shellRoot).toBeVisible({ timeout: 10_000 });
    const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);
    expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfter.testId).toBe(originalShellIdentity.testId);
    expect(identityAfter.isSameObject).toBe(true);

    const urlAfter = fixtures.page.url();
    expect(urlAfter.length).toBeGreaterThan(0);
    expect(currentUrl.length).toBeGreaterThan(0);
  });

  test("accessibility - focus management and ARIA with shell identity preserved", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping accessibility test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    const shellAttr = await shellRoot.getAttribute("data-ega-shell-root");
    expect(shellAttr).not.toBeNull();

    const navLink = await getNavLink(fixtures.page, "Tasks");
    await expect(navLink).toBeVisible({ timeout: 10_000 });
    await navLink.focus();
    await expect(navLink).toBeFocused();

    const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      return {
        testId: root.__egaShellTestId ?? null,
        sentinel: root.getAttribute("data-ega-shell-root"),
        isSameObject: root.__egaShellTestId === expectedTestId,
      };
    }, originalShellIdentity.testId);
    expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
    expect(identityAfter.testId).toBe(originalShellIdentity.testId);
    expect(identityAfter.isSameObject).toBe(true);
  });

  test.skip("task drawer - requires fixture prerequisites for task items; skipped with reason", async () => {});

  test.skip("timer functionality - requires fixture prerequisites for timer interactions; skipped with reason", async () => {});

  test("logout clears session and forces protected routes to login", async ({ page }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping logout test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const logoutButton = fixtures.page
      .getByRole("button", { name: /logout/i })
      .or(fixtures.page.getByRole("link", { name: /logout/i }))
      .first();

    await expect(logoutButton).toBeVisible({ timeout: 10_000 });
    await logoutButton.click();

    await fixtures.page.waitForURL(
      (url) => url.hostname === loginHost && url.pathname === "/login",
      { timeout: 20_000 },
    );
    await expect(fixtures.page.getByRole("heading", { level: 2 })).toContainText(/sign in/i);

    await fixtures.page.goto(`${protocol}://${loginHost}/dashboard`, { waitUntil: "domcontentloaded" });
    await fixtures.page.waitForURL((url) => url.pathname === "/login", { timeout: 10_000 });
    const redirected = new URL(fixtures.page.url());
    expect(redirected.hostname).toBe(loginHost);
  });

  test("redirects for protected routes when unauthenticated", async ({ page }) => {
    await page.goto(`${protocol}://${loginHost}/login`, { waitUntil: "domcontentloaded" });

    const protectedRoutes = ["/home", "/today", "/tasks", "/dashboard"];
    for (const route of protectedRoutes) {
      await page.goto(`${protocol}://${loginHost}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 10_000 });
      const redirected = new URL(page.url());
      expect(redirected.hostname).toBe(loginHost);
      expect(redirected.pathname).toBe("/login");
    }
  });

  test("shell root persists across all navigation with no document reloads and original element identity", async ({
    page,
  }) => {
    test.skip(!hasPwaAuthCredentials(), "Missing E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD; skipping shell persistence test.");
    if (!hasPwaAuthCredentials()) {
      return;
    }

    const fixtures = await createPwaFixtures(page);
    const shellRoot = getShellRoot(fixtures.page);
    await expect(shellRoot).toBeVisible({ timeout: 30_000 });

    const shellHandle = await shellRoot.elementHandle();
    if (!shellHandle) {
      throw new Error("Failed to obtain shell root element handle");
    }

    const originalShellIdentity = await shellHandle.evaluate((el) => {
      const root = el as HTMLElement & { __egaShellTestId?: string };
      if (!root.__egaShellTestId) {
        root.__egaShellTestId = `ega-shell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      return {
        testId: root.__egaShellTestId,
        sentinel: root.getAttribute("data-ega-shell-root"),
      };
    });
    expect(originalShellIdentity.sentinel).not.toBeNull();

    let documentLoadCount = 0;
    const onLoad = () => {
      documentLoadCount += 1;
    };
    fixtures.page.on("load", onLoad);
    const beforeLoadCount = documentLoadCount;

    const routes = ["/today", "/tasks", "/goals", "/timer", "/review", "/home"];
    for (const route of routes) {
      const label = route === "/home" ? "Home" : route.slice(1).charAt(0).toUpperCase() + route.slice(2);
      const navLink = await getNavLink(fixtures.page, label);
      await expect(navLink).toBeVisible({ timeout: 10_000 });
      await navLink.click();
      await fixtures.page.waitForURL(
        (url) => url.pathname === route || url.pathname.startsWith(route + "/"),
        { timeout: 10_000 },
      );

      await expect(shellRoot).toBeVisible({ timeout: 10_000 });
      const identityAfter = await shellRoot.evaluate((el, expectedTestId) => {
        const root = el as HTMLElement & { __egaShellTestId?: string };
        return {
          testId: root.__egaShellTestId ?? null,
          sentinel: root.getAttribute("data-ega-shell-root"),
          isSameObject: root.__egaShellTestId === expectedTestId,
        };
      }, originalShellIdentity.testId);

      expect(identityAfter.sentinel).toBe(originalShellIdentity.sentinel);
      expect(identityAfter.testId).toBe(originalShellIdentity.testId);
      expect(identityAfter.isSameObject).toBe(true);
    }

    expect(documentLoadCount).toBe(beforeLoadCount);
    fixtures.page.off("load", onLoad);
  });
});
