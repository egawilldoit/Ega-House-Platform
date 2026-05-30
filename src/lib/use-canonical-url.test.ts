import assert from "node:assert/strict";

import { GLOBAL_APP_ROUTES, routeBelongsToWorkspace } from "@/lib/use-canonical-url";

test("routeBelongsToWorkspace returns true for root host routes", () => {
  // On a non-workspace host, all routes belong.
  assert.equal(routeBelongsToWorkspace("/dashboard", "www.egawilldoit.online"), true);
  assert.equal(routeBelongsToWorkspace("/tasks", "www.egawilldoit.online"), true);
  assert.equal(routeBelongsToWorkspace("/timer", "www.egawilldoit.online"), true);
});

test("routeBelongsToWorkspace returns true for own workspace routes", () => {
  // On tasks.egawilldoit.online, /tasks and /tasks/* belong.
  assert.equal(routeBelongsToWorkspace("/tasks", "tasks.egawilldoit.online"), true);
  assert.equal(routeBelongsToWorkspace("/tasks/projects", "tasks.egawilldoit.online"), true);
  assert.equal(routeBelongsToWorkspace("/tasks/123", "tasks.egawilldoit.online"), true);
});

test("routeBelongsToWorkspace returns false for other workspace routes", () => {
  // On tasks.egawilldoit.online, /timer does NOT belong.
  assert.equal(routeBelongsToWorkspace("/timer", "tasks.egawilldoit.online"), false);
  assert.equal(routeBelongsToWorkspace("/goals", "tasks.egawilldoit.online"), false);
  assert.equal(routeBelongsToWorkspace("/review", "tasks.egawilldoit.online"), false);
});

test("routeBelongsToWorkspace returns false for global app routes on workspace", () => {
  // On tasks.egawilldoit.online, /dashboard does NOT belong.
  assert.equal(routeBelongsToWorkspace("/dashboard", "tasks.egawilldoit.online"), false);
  assert.equal(routeBelongsToWorkspace("/today", "tasks.egawilldoit.online"), false);
  assert.equal(routeBelongsToWorkspace("/ideas", "tasks.egawilldoit.online"), false);
});

test("GLOBAL_APP_ROUTES includes all known global app routes", () => {
  const expectedRoutes = [
    "/apps",
    "/dashboard",
    "/help",
    "/ideas",
    "/settings",
    "/shutdown",
    "/startup",
    "/today",
  ];
  for (const route of expectedRoutes) {
    assert.ok(GLOBAL_APP_ROUTES.has(route), `Missing global route: ${route}`);
  }
  // Workspace-specific routes are NOT global
  assert.equal(GLOBAL_APP_ROUTES.has("/tasks"), false);
  assert.equal(GLOBAL_APP_ROUTES.has("/timer"), false);
  assert.equal(GLOBAL_APP_ROUTES.has("/goals"), false);
  assert.equal(GLOBAL_APP_ROUTES.has("/review"), false);
});
