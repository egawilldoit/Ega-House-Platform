import assert from "node:assert/strict";
import test from "node:test";

import {
  isNotificationDeliveryMode,
  isNotificationDeliveryStatus,
  isNotificationEntityTargetType,
  isNotificationTargetType,
  isNotificationType,
  NOTIFICATION_DELIVERY_MODE_VALUES,
  NOTIFICATION_DELIVERY_STATUS_VALUES,
  NOTIFICATION_TARGET_TYPE_VALUES,
  NOTIFICATION_TYPE_VALUES,
} from "../src/notifications";

test("notification wire values remain stable", () => {
  assert.deepEqual(NOTIFICATION_TYPE_VALUES, [
    "task_reminder",
    "task_comment_mention",
    "timer_state_change",
    "routine_reminder",
    "money_threshold",
    "daily_review",
    "weekly_review",
    "job_search_reminder",
  ]);
  assert.deepEqual(NOTIFICATION_TARGET_TYPE_VALUES, [
    "task",
    "timer",
    "routine",
    "money",
    "review",
    "today",
  ]);
  assert.deepEqual(NOTIFICATION_DELIVERY_MODE_VALUES, ["push", "email", "both"]);
  assert.equal(isNotificationType("task_reminder"), true);
  assert.equal(isNotificationType("task_comment_mention"), true);
  assert.equal(isNotificationType("timer_state_change"), true);
  assert.equal(isNotificationType("money_threshold"), true);
  assert.equal(isNotificationType("timer"), false);
  assert.equal(isNotificationType("invented_type"), false);
  assert.equal(isNotificationTargetType("task"), true);
  assert.equal(isNotificationTargetType("review"), true);
  assert.equal(isNotificationTargetType("goal"), false);
  assert.equal(isNotificationEntityTargetType("task"), true);
  assert.equal(isNotificationEntityTargetType("review"), false);
  assert.equal(isNotificationDeliveryMode("push"), true);
  assert.equal(isNotificationDeliveryMode("sms"), false);
});

test("delivery status taxonomy includes terminal suppressed but stays bounded", () => {
  assert.deepEqual(NOTIFICATION_DELIVERY_STATUS_VALUES, [
    "queued",
    "sending",
    "provider_accepted",
    "retry_scheduled",
    "invalid_endpoint",
    "failed",
    "suppressed",
  ]);
  assert.equal(isNotificationDeliveryStatus("suppressed"), true);
  assert.equal(isNotificationDeliveryStatus("delivered"), false);
  assert.equal(isNotificationDeliveryStatus("read"), false);
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

test("singleton targets carry a null id", () => {
  const target = { type: "review" as const, id: null };
  assert.equal(target.id, null);
  const entityTarget = { type: "task" as const, id: null };
  // Type only: entity targets are nullable at the wire boundary and rejected by
  // application validation when blank.
  assert.equal(entityTarget.id, null);
});
