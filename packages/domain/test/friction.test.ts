import assert from "node:assert/strict";
import test from "node:test";

import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
  FRICTION_CONTEXT_SWITCH_THRESHOLD,
  FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD,
  FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES,
  FRICTION_ESTIMATE_PERCENT_THRESHOLD,
  FRICTION_NEGLECTED_GOAL_WINDOW_DAYS,
  FRICTION_NEGLECTED_GOAL_WINDOW_MS,
  FRICTION_STALE_THRESHOLD_DAYS,
  FRICTION_STALE_THRESHOLD_MS,
  FRICTION_WORKLOAD_IMBALANCE_HIGH_SHARE_THRESHOLD,
  FRICTION_WORKLOAD_IMBALANCE_MIN_FOR_HIGH_MINUTES,
  FRICTION_WORKLOAD_IMBALANCE_MIN_TOTAL_MINUTES,
  FRICTION_WORKLOAD_IMBALANCE_SHARE_THRESHOLD,
  getFrictionAgeDays,
  getFrictionAgeMs,
  getFrictionContextSwitchCount,
  getFrictionContextSwitchSeverity,
  getFrictionEstimatePercentError,
  getFrictionEstimateSeverity,
  getFrictionNeglectedDaysSinceActivity,
  getFrictionWorkloadImbalanceSeverity,
  getFrictionWorkloadSharePercent,
  isActiveFrictionGoal,
  isActiveFrictionTask,
  isBlockedFrictionTask,
  isFrictionContextSwitchFriction,
  isFrictionEstimateMismatch,
  isFrictionStale,
  isFrictionWorkloadImbalance,
  isMeaningfulFrictionEstimate,
  isStaleFrictionGoal,
  isStaleFrictionTask,
} from "../src/friction/index";

const NOW = new Date("2026-08-27T12:00:00.000Z");

test("friction stale threshold is deterministic 7 days", () => {
  assert.equal(FRICTION_STALE_THRESHOLD_DAYS, 7);
  assert.equal(FRICTION_STALE_THRESHOLD_MS, 7 * 24 * 60 * 60 * 1000);
});

test("getFrictionAgeDays computes floor days", () => {
  const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000 - 1000).toISOString();
  assert.equal(getFrictionAgeDays(sixDaysAgo, NOW), 6);
  assert.equal(getFrictionAgeDays(sevenDaysAgo, NOW), 7);
  assert.equal(getFrictionAgeDays(eightDaysAgo, NOW), 8);
  assert.equal(getFrictionAgeMs(sixDaysAgo, NOW), 6 * 24 * 60 * 60 * 1000);
  // future updated_at clamps to 0
  const future = new Date(NOW.getTime() + 1000).toISOString();
  assert.equal(getFrictionAgeDays(future, NOW), 0);
});

test("isFrictionStale respects 7d threshold deterministically", () => {
  const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysPlus1Sec = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1000).toISOString();
  assert.equal(isFrictionStale(sixDaysAgo, NOW), false);
  assert.equal(isFrictionStale(sevenDaysAgo, NOW), true);
  assert.equal(isFrictionStale(sevenDaysPlus1Sec, NOW), true);
});

test("isActiveFrictionTask excludes archived and completed", () => {
  assert.equal(isActiveFrictionTask({ status: "todo", archivedAt: null, updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionTask({ status: "in_progress", archivedAt: null, updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionTask({ status: "blocked", archivedAt: null, updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionTask({ status: "done", archivedAt: null, updatedAt: NOW.toISOString() }), false);
  assert.equal(isActiveFrictionTask({ status: "completed", archivedAt: null, updatedAt: NOW.toISOString() }), false);
  assert.equal(isActiveFrictionTask({ status: "todo", archivedAt: "2026-08-27T00:00:00Z", updatedAt: NOW.toISOString() }), false);
  assert.equal(isActiveFrictionTask({ status: "canceled", archivedAt: null, updatedAt: NOW.toISOString() }), false);
});

test("isBlockedFrictionTask requires blocked status and active", () => {
  assert.equal(isBlockedFrictionTask({ status: "blocked", archivedAt: null, updatedAt: NOW.toISOString() }), true);
  assert.equal(isBlockedFrictionTask({ status: "todo", archivedAt: null, updatedAt: NOW.toISOString() }), false);
  assert.equal(isBlockedFrictionTask({ status: "blocked", archivedAt: "2026-08-27T00:00:00Z", updatedAt: NOW.toISOString() }), false);
  assert.equal(isBlockedFrictionTask({ status: "done", archivedAt: null, updatedAt: NOW.toISOString() }), false);
});

test("isActiveFrictionGoal excludes archived and done", () => {
  assert.equal(isActiveFrictionGoal({ status: "active", updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionGoal({ status: "draft", updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionGoal({ status: "paused", updatedAt: NOW.toISOString() }), true);
  assert.equal(isActiveFrictionGoal({ status: "done", updatedAt: NOW.toISOString() }), false);
  assert.equal(isActiveFrictionGoal({ status: "archived", updatedAt: NOW.toISOString() }), false);
});

test("isStale helpers combine active + threshold", () => {
  const freshTask = { status: "todo", archivedAt: null, updatedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  const staleTask = { status: "todo", archivedAt: null, updatedAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString() };
  const archivedStaleTask = { status: "todo", archivedAt: "2026-08-20T00:00:00Z", updatedAt: staleTask.updatedAt };
  const staleGoal = { status: "active", updatedAt: staleTask.updatedAt };
  const archivedStaleGoal = { status: "archived", updatedAt: staleTask.updatedAt };
  assert.equal(isStaleFrictionTask(freshTask, NOW), false);
  assert.equal(isStaleFrictionTask(staleTask, NOW), true);
  assert.equal(isStaleFrictionTask(archivedStaleTask, NOW), false);
  assert.equal(isStaleFrictionGoal(staleGoal, NOW), true);
  assert.equal(isStaleFrictionGoal(archivedStaleGoal, NOW), false);
});

test("estimate thresholds are deterministic and owned in domain", () => {
  assert.equal(FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES, 5);
  assert.equal(FRICTION_ESTIMATE_PERCENT_THRESHOLD, 50);
  assert.equal(FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD, 100);
  assert.equal(isMeaningfulFrictionEstimate(5), true);
  assert.equal(isMeaningfulFrictionEstimate(4), false);
  assert.equal(isMeaningfulFrictionEstimate(null), false);
  assert.equal(isMeaningfulFrictionEstimate(undefined), false);
  assert.equal(isMeaningfulFrictionEstimate(0), false);
  assert.equal(getFrictionEstimatePercentError(90, 60), 50);
  assert.equal(getFrictionEstimatePercentError(120, 60), 100);
  assert.equal(getFrictionEstimatePercentError(180, 60), 200);
  assert.equal(getFrictionEstimatePercentError(30, 60), -50);
  assert.equal(getFrictionEstimatePercentError(60, 60), 0);
  assert.equal(getFrictionEstimateSeverity(50), "low");
  assert.equal(getFrictionEstimateSeverity(51), "medium");
  assert.equal(getFrictionEstimateSeverity(100), "medium");
  assert.equal(getFrictionEstimateSeverity(101), "high");
  assert.equal(getFrictionEstimateSeverity(-51), "medium");
  assert.equal(getFrictionEstimateSeverity(-101), "high");
  assert.equal(isFrictionEstimateMismatch(51), true);
  assert.equal(isFrictionEstimateMismatch(50), false);
  assert.equal(isFrictionEstimateMismatch(101), true);
});

test("context-switch thresholds are deterministic and owned in domain", () => {
  assert.equal(FRICTION_CONTEXT_SWITCH_THRESHOLD, 6);
  assert.equal(FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD, 10);
  assert.equal(getFrictionContextSwitchCount(["a", "a", "b", "b", "a"]), 2);
  assert.equal(getFrictionContextSwitchCount(["a"]), 0);
  assert.equal(getFrictionContextSwitchCount([]), 0);
  assert.equal(getFrictionContextSwitchCount(["a", "b", "c", "d", "e", "f", "g"]), 6);
  assert.equal(getFrictionContextSwitchSeverity(0), "none");
  assert.equal(getFrictionContextSwitchSeverity(5), "low");
  assert.equal(getFrictionContextSwitchSeverity(6), "medium");
  assert.equal(getFrictionContextSwitchSeverity(9), "medium");
  assert.equal(getFrictionContextSwitchSeverity(10), "high");
  assert.equal(getFrictionContextSwitchSeverity(12), "high");
  assert.equal(isFrictionContextSwitchFriction(5), false);
  assert.equal(isFrictionContextSwitchFriction(6), true);
  assert.equal(isFrictionContextSwitchFriction(10), true);
});

test("neglected-goal window and helpers are deterministic", () => {
  assert.equal(FRICTION_NEGLECTED_GOAL_WINDOW_DAYS, 14);
  assert.equal(FRICTION_NEGLECTED_GOAL_WINDOW_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(getFrictionNeglectedDaysSinceActivity(null, NOW), null);
  assert.equal(getFrictionNeglectedDaysSinceActivity(undefined, NOW), null);
  const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(getFrictionNeglectedDaysSinceActivity(twoDaysAgo, NOW), 2);
  const future = new Date(NOW.getTime() + 1000).toISOString();
  assert.equal(getFrictionNeglectedDaysSinceActivity(future, NOW), 0);
});

test("workload imbalance thresholds and share math deterministic", () => {
  assert.equal(FRICTION_WORKLOAD_IMBALANCE_SHARE_THRESHOLD, 60);
  assert.equal(FRICTION_WORKLOAD_IMBALANCE_HIGH_SHARE_THRESHOLD, 75);
  assert.equal(FRICTION_WORKLOAD_IMBALANCE_MIN_TOTAL_MINUTES, 120);
  assert.equal(FRICTION_WORKLOAD_IMBALANCE_MIN_FOR_HIGH_MINUTES, 240);
  // Share math
  assert.equal(getFrictionWorkloadSharePercent(0, 0), 0);
  assert.equal(getFrictionWorkloadSharePercent(0, 100), 0);
  assert.equal(getFrictionWorkloadSharePercent(60, 100), 60);
  assert.equal(getFrictionWorkloadSharePercent(75, 100), 75);
  assert.equal(getFrictionWorkloadSharePercent(100, 100), 100);
  assert.equal(getFrictionWorkloadSharePercent(1, 3), 33); // 33.33 -> 33
  assert.equal(getFrictionWorkloadSharePercent(2, 3), 67); // 66.66 -> 67
  assert.equal(getFrictionWorkloadSharePercent(50, 100), 50);
  // zero-data and single-project: projectCount guard
  assert.equal(getFrictionWorkloadImbalanceSeverity(100, 0, 0), "none"); // zero total
  assert.equal(getFrictionWorkloadImbalanceSeverity(100, 300, 1), "none"); // single project
  assert.equal(getFrictionWorkloadImbalanceSeverity(100, 60, 2), "none"); // sparse <120
  // thresholds
  assert.equal(getFrictionWorkloadImbalanceSeverity(59, 300, 2), "low");
  assert.equal(getFrictionWorkloadImbalanceSeverity(60, 300, 2), "medium");
  assert.equal(getFrictionWorkloadImbalanceSeverity(74, 300, 2), "medium");
  assert.equal(getFrictionWorkloadImbalanceSeverity(75, 300, 2), "high");
  // sparse guard: high requires 240, otherwise capped at medium
  assert.equal(getFrictionWorkloadImbalanceSeverity(90, 120, 2), "medium");
  assert.equal(getFrictionWorkloadImbalanceSeverity(90, 239, 2), "medium");
  assert.equal(getFrictionWorkloadImbalanceSeverity(90, 240, 2), "high");
  assert.equal(isFrictionWorkloadImbalance("high"), true);
  assert.equal(isFrictionWorkloadImbalance("medium"), true);
  assert.equal(isFrictionWorkloadImbalance("low"), false);
  assert.equal(isFrictionWorkloadImbalance("none"), false);
});
