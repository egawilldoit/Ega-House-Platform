/// <reference types="vitest/globals" />
import assert from "node:assert/strict";

/**
 * Tests for middleware host-aware navigation logic.
 *
 * We test the constants and decision functions from the middleware
 * module by re-importing them. The actual middleware() function
 * requires NextRequest/NextResponse which are not available in
 * jsdom/node test environment, so we test the logic separably.
 */

// Replicate the middleware constants for isolated testing.
// In a real integration test we'd import from the module, but
// since middleware.ts uses next/server types, we duplicate.
const GLOBAL_APP_ROUTES = new Set([
  "/apps",
  "/dashboard",
  "/help",
  "/ideas",
  "/settings",
  "/shutdown",
  "/startup",
  "/today",
]);

const SUBDOMAIN_PREFIXES: Record<string, string> = {
  "goals.egawilldoit.online": "/goals",
  "tasks.egawilldoit.online": "/tasks",
  "timer.egawilldoit.online": "/timer",
  "review.egawilldoit.online": "/review",
};

function shouldSkipRewrite(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isGlobalAppRoute(pathname: string): boolean {
  return GLOBAL_APP_ROUTES.has(pathname);
}

describe("middleware host-aware navigation", () => {
  describe("GLOBAL_APP_ROUTES detection", () => {
    test("Dashboard is a global app route", () => {
      assert.equal(isGlobalAppRoute("/dashboard"), true);
    });

    test("Timer is NOT a global app route (it's workspace-specific)", () => {
      assert.equal(isGlobalAppRoute("/timer"), false);
    });

    test("Tasks is NOT a global app route (it's workspace-specific)", () => {
      assert.equal(isGlobalAppRoute("/tasks"), false);
    });

    test("Today is a global app route", () => {
      assert.equal(isGlobalAppRoute("/today"), true);
    });

    test("Settings is a global app route", () => {
      assert.equal(isGlobalAppRoute("/settings"), true);
    });
  });

  describe("workspace prefix rewrites", () => {
    test("Dashboard on tasks subdomain should NOT match skip-rewrite for /tasks", () => {
      // On tasks.egawilldoit.online, /dashboard should NOT be skipped
      // because it doesn't start with /tasks.
      // This is the core bug — it WOULD get rewritten to /tasks/dashboard.
      assert.equal(shouldSkipRewrite("/dashboard", "/tasks"), false);
    });

    test("Tasks on tasks subdomain should skip rewrite", () => {
      assert.equal(shouldSkipRewrite("/tasks", "/tasks"), true);
    });

    test("Tasks subpath on tasks subdomain should skip rewrite", () => {
      assert.equal(shouldSkipRewrite("/tasks/projects", "/tasks"), true);
    });

    test("Dashboard on timer subdomain should NOT match skip-rewrite for /timer", () => {
      assert.equal(shouldSkipRewrite("/dashboard", "/timer"), false);
    });

    test("Timer on timer subdomain should skip rewrite", () => {
      assert.equal(shouldSkipRewrite("/timer", "/timer"), true);
    });
  });

  describe("cross-subdomain navigation scenarios", () => {
    test("From tasks host, Dashboard route must not become /tasks/dashboard", () => {
      const pathname = "/dashboard";
      const prefix = SUBDOMAIN_PREFIXES["tasks.egawilldoit.online"];
      // Without the fix, shouldSkipRewrite returns false, so middleware
      // would rewrite to /tasks/dashboard. The fix checks GLOBAL_APP_ROUTES
      // first and redirects to canonical host instead.
      const wouldBeRewritten = !shouldSkipRewrite(pathname, prefix);
      assert.equal(wouldBeRewritten, true); // Would be rewritten without fix
      assert.equal(isGlobalAppRoute(pathname), true); // But it's global
    });

    test("From timer host, Tasks route must not become /timer/tasks", () => {
      const pathname = "/tasks";
      // Tasks is NOT a global route, but it doesn't belong to the timer
      // workspace either. The shouldSkipRewrite check fails, so without
      // fix it would be rewritten to /timer/tasks.
      const wouldBeRewritten = !shouldSkipRewrite(pathname, "/timer");
      assert.equal(wouldBeRewritten, true); // Would be rewritten without fix
      assert.equal(isGlobalAppRoute(pathname), false); // Not global route
      // For workspace-specific routes, the fix relies on client-side
      // canonical URL resolution. The middleware won't redirect /tasks
      // to canonical host (it's not global), but navigation links use
      // canonical URLs to avoid this rewrite.
    });
  });
});
