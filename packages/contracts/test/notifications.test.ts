import assert from "node:assert/strict";
import test from "node:test";

import {
  isNotificationDeliveryMode,
  isNotificationTargetType,
  isNotificationType,
  NOTIFICATION_DELIVERY_MODE_VALUES,
  NOTIFICATION_TARGET_TYPE_VALUES,
  NOTIFICATION_TYPE_VALUES,
} from "../src/notifications";

test("notification wire values remain stable", () => {
  assert.deepEqual(NOTIFICATION_TYPE_VALUES, ["task_reminder"]);
  assert.deepEqual(NOTIFICATION_TARGET_TYPE_VALUES, ["task"]);
  assert.deepEqual(NOTIFICATION_DELIVERY_MODE_VALUES, ["push", "email", "both"]);
  assert.equal(isNotificationType("task_reminder"), true);
  assert.equal(isNotificationType("timer"), false);
  assert.equal(isNotificationTargetType("task"), true);
  assert.equal(isNotificationTargetType("goal"), false);
  assert.equal(isNotificationDeliveryMode("push"), true);
  assert.equal(isNotificationDeliveryMode("sms"), false);
});

test("notification payload contains typed target without raw router path", () => {
  const payload = {
    notificationId: "notif-1",
    type: "task_reminder" as const,
    targetType: "task" as const,
    targetId: "task-123",
  };
  assert.equal(payload.notificationId, "notif-1");
  assert.equal(payload.targetType, "task");
  // Must not contain Expo raw path
  assert.ok(!("route" in payload) && !("path" in payload));
});
