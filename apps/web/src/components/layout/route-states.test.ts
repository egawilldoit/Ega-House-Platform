import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

// Authenticated workspace routes audited for EGA-799. Auth/public routes keep
// their own recovery surfaces and are intentionally out of this set.
const WORKSPACE_ROUTES = [
  "app/dashboard",
  "app/today",
  "app/tasks",
  "app/tasks/projects",
  "app/tasks/projects/[slug]",
  "app/tasks/projects/new",
  "app/tasks/projects/[slug]/delete",
  "app/review",
  "app/review/[reviewId]",
  "app/goals",
  "app/timer",
  "app/work-analytics",
  "app/notifications",
  "app/backlog",
  "app/startup",
  "app/shutdown",
  "app/help",
  "app/settings/account",
  "app/apps",
  "app/apps/[workspace]",
  "app/agents",
  "app/agents/[id]",
  "app/friction",
];

test("every audited workspace route has a loading boundary", () => {
  const missing = WORKSPACE_ROUTES.filter(
    (route) => !existsSync(resolve(ROOT, "src", route, "loading.tsx")),
  );
  assert.deepEqual(missing, []);
});

test("every audited workspace route has an error boundary", () => {
  const missing = WORKSPACE_ROUTES.filter(
    (route) => !existsSync(resolve(ROOT, "src", route, "error.tsx")),
  );
  assert.deepEqual(missing, []);
});
