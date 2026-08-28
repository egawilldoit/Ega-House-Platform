import assert from "node:assert/strict";
import test from "node:test";

import {
  FRICTION_STALE_THRESHOLD_DAYS,
  FRICTION_STALE_THRESHOLD_MS,
  getFrictionAgeDays,
  getFrictionAgeMs,
  isActiveFrictionGoal,
  isActiveFrictionTask,
  isBlockedFrictionTask,
  isFrictionStale,
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
