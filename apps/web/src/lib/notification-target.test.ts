import assert from "node:assert/strict";
import test from "node:test";

import { getNotificationTargetHref } from "./notification-target";

test("routes task notifications into the existing task workspace", () => {
  assert.equal(
    getNotificationTargetHref({ type: "task", id: "task-123" }),
    "/tasks?view=all#task-task-123",
  );
});

test("encodes entity ids instead of interpolating raw path characters", () => {
  assert.equal(
    getNotificationTargetHref({ type: "task", id: "a b/c?d#e" }),
    "/tasks?view=all#task-a%20b%2Fc%3Fd%23e",
  );
});

test("maps existing singleton and timer targets to their real routes", () => {
  assert.equal(getNotificationTargetHref({ type: "timer", id: null }), "/timer");
  assert.equal(getNotificationTargetHref({ type: "review", id: null }), "/review");
  assert.equal(getNotificationTargetHref({ type: "today", id: null }), "/today");
});

test("leaves notifications without a dedicated screen inside the bell popover", () => {
  assert.equal(getNotificationTargetHref(null), null);
  assert.equal(getNotificationTargetHref({ type: "task", id: "   " }), null);
  assert.equal(getNotificationTargetHref({ type: "task", id: null }), null);
  assert.equal(getNotificationTargetHref({ type: "routine", id: "r1" }), null);
  assert.equal(getNotificationTargetHref({ type: "money", id: "m1" }), null);
  assert.equal(
    getNotificationTargetHref({ type: "goal" as never, id: "g1" }),
    null,
  );
});
