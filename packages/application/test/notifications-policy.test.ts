import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationEventKey,
  getNotificationTypePolicy,
  isNotificationTypeCritical,
  isTerminalDeliveryStatus,
  isWithinQuietHours,
  normalizeNotificationEventKey,
  normalizeNotificationTarget,
  sanitizeNotificationCopy,
} from "../src/notifications/policy";

test("canonical policy table marks direct mentions critical and finance private", () => {
  assert.equal(isNotificationTypeCritical("task_comment_mention"), true);
  assert.equal(getNotificationTypePolicy("task_comment_mention").quietHours, "bypass");

  for (const type of [
    "task_reminder",
    "timer_state_change",
    "routine_reminder",
    "money_threshold",
    "daily_review",
    "weekly_review",
    "job_search_reminder",
  ] as const) {
    assert.equal(isNotificationTypeCritical(type), false, `${type} should be noncritical`);
    assert.equal(getNotificationTypePolicy(type).quietHours, "suppress");
  }

  assert.equal(getNotificationTypePolicy("money_threshold").privacyClass, "private_finance");
});

test("terminal delivery statuses exclude queued/sending/retry states", () => {
  assert.equal(isTerminalDeliveryStatus("suppressed"), true);
  assert.equal(isTerminalDeliveryStatus("provider_accepted"), true);
  assert.equal(isTerminalDeliveryStatus("invalid_endpoint"), true);
  assert.equal(isTerminalDeliveryStatus("failed"), true);
  assert.equal(isTerminalDeliveryStatus("queued"), false);
  assert.equal(isTerminalDeliveryStatus("sending"), false);
  assert.equal(isTerminalDeliveryStatus("retry_scheduled"), false);
});

test("quiet hours handle same-day ranges in the owner timezone", () => {
  // 2026-01-15T12:00:00Z is 13:00 in Africa/Casablanca (UTC+1).
  const now = new Date("2026-01-15T12:00:00.000Z");
  assert.equal(
    isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "09:00", end: "17:00" }),
    true,
  );
  assert.equal(
    isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "13:00", end: "17:00" }),
    true,
  );
  assert.equal(
    isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "14:00", end: "17:00" }),
    false,
  );
});

test("overnight quiet hours cross the local midnight boundary", () => {
  // Casablanca local 23:30 => inside 22:00–07:00.
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-01-15T22:30:00.000Z"),
      timezone: "Africa/Casablanca",
      start: "22:00",
      end: "07:00",
    }),
    true,
  );
  // Casablanca local 12:00 => outside.
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-01-15T11:00:00.000Z"),
      timezone: "Africa/Casablanca",
      start: "22:00",
      end: "07:00",
    }),
    false,
  );
});

test("the same instant can be quiet in one owner timezone and allowed in another", () => {
  // 2026-01-15T06:30:00Z:
  //  - America/Los_Angeles (UTC-8) => 22:30 on Jan 14 (quiet)
  //  - Africa/Casablanca (UTC+1)   => 07:30 (outside the 22:00–07:00 window)
  const now = new Date("2026-01-15T06:30:00.000Z");
  assert.equal(
    isWithinQuietHours({ now, timezone: "America/Los_Angeles", start: "22:00", end: "07:00" }),
    true,
  );
  assert.equal(
    isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "22:00", end: "07:00" }),
    false,
  );
});

test("quiet hours remain correct across a DST transition wall-clock", () => {
  // America/New_York springs forward at 2026-03-08 02:00 local.
  // 06:30Z is 01:30 EST (inside 01:00–02:00); 07:30Z is 03:30 EDT (outside).
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-03-08T06:30:00.000Z"),
      timezone: "America/New_York",
      start: "01:00",
      end: "02:00",
    }),
    true,
  );
  assert.equal(
    isWithinQuietHours({
      now: new Date("2026-03-08T07:30:00.000Z"),
      timezone: "America/New_York",
      start: "01:00",
      end: "02:00",
    }),
    false,
  );
});

test("invalid/missing timezone or clock values never suppress", () => {
  const now = new Date("2026-01-15T23:00:00.000Z");
  assert.equal(isWithinQuietHours({ now, timezone: null, start: "22:00", end: "07:00" }), false);
  assert.equal(isWithinQuietHours({ now, timezone: "Not/AZone", start: "22:00", end: "07:00" }), false);
  assert.equal(isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "25:00", end: "07:00" }), false);
  assert.equal(isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "22:00", end: "7:00" }), false);
  assert.equal(isWithinQuietHours({ now, timezone: "Africa/Casablanca", start: "22:00", end: "22:00" }), false);
});

test("private finance copy is generic and drops caller amounts/merchant text", () => {
  const copy = sanitizeNotificationCopy(
    "money_threshold",
    "Spent $4,312 at Acme Motors",
    "Account ending 9911 crossed your $3,000 threshold at Acme Motors.",
  );
  assert.equal(copy.title, "Finance update");
  assert.ok(copy.body);
  assert.doesNotMatch(copy.body ?? "", /4,?312|Acme|9911|3,?000/i);
  assert.doesNotMatch(copy.title, /Acme|\$|9911/);
});

test("standard copy is trimmed and length capped", () => {
  const copy = sanitizeNotificationCopy("task_reminder", "  Reminder  ", "  body text  ");
  assert.deepEqual(copy, { title: "Reminder", body: "body text" });

  const long = sanitizeNotificationCopy("task_reminder", "t".repeat(500), "b".repeat(900));
  assert.equal(long.title.length, 200);
  assert.equal(long.body?.length, 500);
});

test("target normalization requires UUIDs for entity targets and keeps singletons id-less", () => {
  const taskId = "22222222-2222-2222-2222-222222222222";
  assert.deepEqual(normalizeNotificationTarget("task", ` ${taskId} `), { type: "task", id: taskId });
  assert.deepEqual(normalizeNotificationTarget("timer", taskId), { type: "timer", id: taskId });
  assert.deepEqual(normalizeNotificationTarget("review", "ignored"), { type: "review", id: null });
  assert.deepEqual(normalizeNotificationTarget("today", null), { type: "today", id: null });
  assert.equal(normalizeNotificationTarget("goal", taskId), null);
  assert.equal(normalizeNotificationTarget("task", "   "), null);
  assert.equal(normalizeNotificationTarget("task", null), null);
  // Non-UUID ids would fail the uuid column with 22P02, so they degrade safely.
  assert.equal(normalizeNotificationTarget("task", "task-123"), null);
  assert.equal(normalizeNotificationTarget("task", "123"), null);
  assert.equal(normalizeNotificationTarget("task", "/tasks/abc"), null);
  assert.equal(normalizeNotificationTarget("task", "../abc"), null);
  assert.equal(normalizeNotificationTarget("timer", "abc?x=1"), null);
});

test("event identity is stable and bounded", () => {
  assert.equal(buildNotificationEventKey("task_reminder", "rem-1"), "task_reminder:rem-1");
  assert.equal(buildNotificationEventKey("task_reminder", " rem-1 "), "task_reminder:rem-1");
  assert.equal(buildNotificationEventKey("not_a_type", "rem-1"), null);
  assert.equal(buildNotificationEventKey("task_reminder", "bad id"), null);
  assert.equal(buildNotificationEventKey("task_reminder", ""), null);
});

test("provided event keys must match the canonical type prefix and canonicalize padding", () => {
  assert.equal(normalizeNotificationEventKey("task_reminder", "  task_reminder:rem-1  "), "task_reminder:rem-1");
  assert.equal(normalizeNotificationEventKey("task_reminder", "task_reminder:rem-1"), "task_reminder:rem-1");
  // A mismatched prefix cannot replay one event id under another taxonomy value.
  assert.equal(normalizeNotificationEventKey("money_threshold", "task_reminder:rem-1"), null);
  assert.equal(normalizeNotificationEventKey("task_reminder", "money_threshold:rem-1"), null);
  // Internal padding is malformed, not silently rewritten.
  assert.equal(normalizeNotificationEventKey("task_reminder", "task_reminder:rem 1"), null);
  assert.equal(normalizeNotificationEventKey("task_reminder", " task_reminder :rem-1 "), null);
  assert.equal(normalizeNotificationEventKey("not_a_type", "not_a_type:1"), null);
  assert.equal(normalizeNotificationEventKey("task_reminder", "task-reminder:rem-1"), "task-reminder:rem-1");
});
