import assert from "node:assert/strict";
import test from "node:test";

import { FRICTION_STALE_THRESHOLD_DAYS, type FrictionRadarResponse } from "../src/friction";
import { FRICTION_STALE_THRESHOLD_DAYS as DOMAIN_THRESHOLD } from "@ega/domain/friction";

test("friction contract threshold matches domain and is 7 days", () => {
  assert.equal(FRICTION_STALE_THRESHOLD_DAYS, 7);
  assert.equal(FRICTION_STALE_THRESHOLD_DAYS, DOMAIN_THRESHOLD);
});

test("friction radar response shape carries shared signals", () => {
  const response: FrictionRadarResponse = {
    ok: true,
    generatedAt: "2026-08-27T12:00:00.000Z",
    thresholdDays: FRICTION_STALE_THRESHOLD_DAYS,
    blocked: [
      {
        id: "task-1",
        title: "Blocked",
        blockedReason: "waiting",
        ageDays: 3,
        updatedAt: "2026-08-24T12:00:00.000Z",
        projectId: "proj-1",
        goalId: null,
        status: "blocked",
      },
    ],
    staleTasks: [
      {
        id: "task-2",
        title: "Stale task",
        ageDays: 8,
        updatedAt: "2026-08-19T12:00:00.000Z",
        status: "todo",
        projectId: "proj-1",
        goalId: null,
      },
    ],
    staleGoals: [
      {
        id: "goal-1",
        title: "Stale goal",
        ageDays: 10,
        updatedAt: "2026-08-17T12:00:00.000Z",
        status: "active",
        projectId: "proj-1",
      },
    ],
  };

  assert.equal(response.ok, true);
  assert.equal(response.thresholdDays, 7);
  assert.equal(response.blocked.length, 1);
  assert.equal(response.blocked[0].blockedReason, "waiting");
  assert.equal(response.staleTasks[0].ageDays, 8);
  assert.equal(response.staleGoals[0].ageDays, 10);
});

test("empty friction radar response is valid", () => {
  const response: FrictionRadarResponse = {
    ok: true,
    generatedAt: "2026-08-27T12:00:00.000Z",
    thresholdDays: 7,
    blocked: [],
    staleTasks: [],
    staleGoals: [],
  };
  assert.deepEqual(response.blocked, []);
  assert.deepEqual(response.staleTasks, []);
  assert.deepEqual(response.staleGoals, []);
});
