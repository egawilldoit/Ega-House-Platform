import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_HEALTH_VALUES,
  getGoalHealthLabel,
  getGoalHealthTone,
  isGoalHealth,
  normalizeGoalHealthInput,
  toGoalHealthOrNull,
  toGoalHealthWriteValue,
} from "./goal-health";

test("accepts each supported goal health value", () => {
  for (const value of GOAL_HEALTH_VALUES) {
    assert.equal(isGoalHealth(value), true);
  }
});

test("normalizes empty goal health to null", () => {
  assert.deepEqual(normalizeGoalHealthInput("   "), {
    value: null,
    error: null,
  });
});

test("keeps valid goal health value", () => {
  assert.deepEqual(normalizeGoalHealthInput("at_risk"), {
    value: "at_risk",
    error: null,
  });
});

test("trims goal health input before validation", () => {
  assert.deepEqual(normalizeGoalHealthInput("  off_track  "), {
    value: "off_track",
    error: null,
  });
});

test("rejects unknown goal health value", () => {
  assert.deepEqual(normalizeGoalHealthInput("critical"), {
    value: null,
    error: "Health must be one of: on_track, at_risk, off_track.",
  });
});

test("maps goal health from form data using primary key", () => {
  const formData = new FormData();
  formData.set("health", "off_track");

  assert.deepEqual(toGoalHealthWriteValue(formData), {
    value: "off_track",
    error: null,
  });
});

test("maps goal health from legacy form key", () => {
  const formData = new FormData();
  formData.set("goal_health", "on_track");

  assert.deepEqual(toGoalHealthWriteValue(formData), {
    value: "on_track",
    error: null,
  });
});

test("returns display mapping for all goal health values", () => {
  assert.equal(getGoalHealthLabel("on_track"), "On Track");
  assert.equal(getGoalHealthLabel("at_risk"), "At Risk");
  assert.equal(getGoalHealthLabel("off_track"), "Off Track");

  assert.equal(getGoalHealthTone("on_track"), "active");
  assert.equal(getGoalHealthTone("at_risk"), "warn");
  assert.equal(getGoalHealthTone("off_track"), "error");
});

test("converts arbitrary values to a narrowed goal health or null", () => {
  assert.equal(toGoalHealthOrNull("on_track"), "on_track");
  assert.equal(toGoalHealthOrNull("  at_risk  "), "at_risk");
  assert.equal(toGoalHealthOrNull("unknown"), null);
  assert.equal(toGoalHealthOrNull(null), null);
});
