import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COMMAND_ROUTES,
  UTILITY_ROUTES,
  getShellRouteMeta,
} from "./shell-route-meta";

test("keeps the primary workspace destinations in the sidebar registry", () => {
  assert.deepEqual(
    COMMAND_ROUTES.map((route) => route.href),
    ["/today", "/tasks", "/tasks/projects", "/money", "/timer", "/review"],
  );
  for (const route of COMMAND_ROUTES) {
    assert.equal(route.group, "primary");
  }
});

test("keeps Goals available as a contextual destination", () => {
  assert.deepEqual(
    UTILITY_ROUTES.map((route) => route.href),
    ["/goals"],
  );
  for (const route of UTILITY_ROUTES) {
    assert.equal(route.group, "utility");
    assert.equal(
      new Set<string>(COMMAND_ROUTES.map((primary) => primary.href)).has(route.href),
      false,
      `${route.href} must not re-enter the primary sidebar set`,
    );
  }
});

test("resolves Goals and Timer metadata and keeps both deep links", () => {
  assert.equal(getShellRouteMeta("/goals").label, "Goals");
  assert.equal(getShellRouteMeta("/goals/deep-link").label, "Goals");
  assert.equal(getShellRouteMeta("/timer").label, "Timer");
  assert.equal(getShellRouteMeta("/timer/session/123").label, "Timer");

  const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
  // A config redirect would shadow the retained page and silently break goal
  // management, timer recovery, and every recorded deep link.
  assert.doesNotMatch(nextConfig, /source:\s*"\/goals"/);
  assert.doesNotMatch(nextConfig, /source:\s*"\/timer"/);
});
