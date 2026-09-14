import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(...segments: string[]) {
  return readFileSync(path.join(process.cwd(), "src", ...segments), "utf8");
}

test("EGA-653: authenticated root entry redirects to /home, public root stays public", () => {
  const rootPage = read("app", "page.tsx");
  assert.match(rootPage, /redirect\("\/home"\)/);
  assert.doesNotMatch(rootPage, /redirect\("\/today"\)/);
  // Public marketing Home is still rendered for unauthenticated visitors.
  assert.match(rootPage, /HomePage/);
});

test("EGA-653: /home is auth-protected and treated as a global app route", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /const GLOBAL_APP_ROUTES[\s\S]*?"\/home"/);
  assert.match(proxy, /const PROTECTED_ROOT_PATH_PREFIXES[\s\S]*?"\/home"/);
});

test("EGA-653: shell navigation and metadata know about /home", () => {
  const routeMeta = read("components", "layout", "shell-route-meta.ts");
  assert.match(routeMeta, /href: "\/home"/);
  assert.match(routeMeta, /label: "Home"/);

  const sidebarNavigation = read("components", "layout", "sidebar-navigation.tsx");
  assert.match(sidebarNavigation, /"\/home": House/);
});

test("EGA-653: an authenticated /home route exists and composes canonical owners", () => {
  const homeRoute = read("app", "home", "page.tsx");
  assert.match(homeRoute, /getOperatorSnapshotData/);
  assert.match(homeRoute, /getWorkspaceShellMetrics/);
  assert.match(homeRoute, /buildHomeModel/);
  // Must not import the marketing home component tree.
  assert.doesNotMatch(homeRoute, /from "\.\/home-page"/);
});
