import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const page = readFileSync(path.join(process.cwd(), "src", "app", "notifications", "page.tsx"), "utf8");
const actions = readFileSync(
  path.join(process.cwd(), "src", "app", "notifications", "actions.ts"),
  "utf8",
);
const service = readFileSync(
  path.join(process.cwd(), "src", "lib", "services", "notification-service.ts"),
  "utf8",
);

test("notifications page exposes history, empty state, and actionable feedback", () => {
  assert.match(page, /Notification history/);
  assert.match(page, /No notifications yet/);
  assert.match(page, /role="alert"/);
  assert.match(page, /Open task/);
  assert.match(page, /Mark all read/);
});

test("notification actions use the application-backed service and canonical task target", () => {
  assert.match(actions, /markWebNotificationOpened/);
  assert.match(actions, /markWebNotificationRead/);
  assert.match(actions, /markAllWebNotificationsRead/);
  assert.match(actions, /getNotificationTargetHref\(result\.data\.target\)/);
  assert.match(service, /requireAuthenticatedUser/);
  assert.match(service, /SupabaseNotificationRepository/);
  assert.match(service, /listNotifications/);
});
