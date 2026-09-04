import assert from "node:assert/strict";
import test from "node:test";

import { getNotificationTargetHref } from "./notification-target";

test("routes task notifications into the existing task workspace", () => {
  assert.equal(
    getNotificationTargetHref({ type: "task", id: "task-123" }),
    "/tasks?view=all#task-task-123",
  );
});

test("keeps notifications without a supported target in the notification center", () => {
  assert.equal(getNotificationTargetHref(null), "/notifications");
  assert.equal(getNotificationTargetHref({ type: "task", id: "   " }), "/notifications");
});
