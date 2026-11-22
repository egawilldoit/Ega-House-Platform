import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();

// Authenticated workspace routes audited for EGA-799. Auth/public routes keep
// their own recovery surfaces and are intentionally out of this set.
const WORKSPACE_ROUTES = [
  "app/(workspace)/today",
  "app/(workspace)/tasks",
  "app/(workspace)/tasks/projects",
  "app/(workspace)/tasks/projects/[slug]",
  "app/(workspace)/tasks/projects/new",
  "app/(workspace)/tasks/projects/[slug]/delete",
  "app/(workspace)/review",
  "app/(workspace)/review/[reviewId]",
  "app/(workspace)/backlog",
  "app/(workspace)/settings",
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
