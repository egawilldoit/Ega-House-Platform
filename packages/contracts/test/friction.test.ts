import assert from "node:assert/strict";
import test from "node:test";

import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
  FRICTION_CONTEXT_SWITCH_THRESHOLD,
  FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD,
  FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES,
  FRICTION_ESTIMATE_PERCENT_THRESHOLD,
  FRICTION_STALE_THRESHOLD_DAYS,
  type FrictionRadarResponse,
} from "../src/friction";
import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD as DOMAIN_CTX_HIGH,
  FRICTION_CONTEXT_SWITCH_THRESHOLD as DOMAIN_CTX,
  FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD as DOMAIN_EST_HIGH,
  FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES as DOMAIN_EST_MIN,
  FRICTION_ESTIMATE_PERCENT_THRESHOLD as DOMAIN_EST,
  FRICTION_STALE_THRESHOLD_DAYS as DOMAIN_THRESHOLD,
} from "@ega/domain/friction";

test("friction contract threshold matches domain and is 7 days", () => {
  assert.equal(FRICTION_STALE_THRESHOLD_DAYS, 7);
  assert.equal(FRICTION_STALE_THRESHOLD_DAYS, DOMAIN_THRESHOLD);
  assert.equal(FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES, DOMAIN_EST_MIN);
  assert.equal(FRICTION_ESTIMATE_PERCENT_THRESHOLD, DOMAIN_EST);
  assert.equal(FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD, DOMAIN_EST_HIGH);
  assert.equal(FRICTION_CONTEXT_SWITCH_THRESHOLD, DOMAIN_CTX);
  assert.equal(FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD, DOMAIN_CTX_HIGH);
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
    estimateSignals: [
      {
        id: "task-3",
        title: "Estimate miss",
        projectId: "proj-1",
        goalId: null,
        estimateMinutes: 60,
        actualMinutes: 120,
        deltaMinutes: 60,
        percentError: 100,
        severity: "medium",
        status: "over",
      },
    ],
    contextSwitch: {
      switchCount: 7,
      threshold: FRICTION_CONTEXT_SWITCH_THRESHOLD,
      highThreshold: FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
      severity: "medium",
      isFriction: true,
      transitionsCount: 8,
      distinctTaskCount: 4,
      window: { startIso: "2026-08-18T00:00:00.000Z", endIso: "2026-08-25T00:00:00.000Z" },
    },
    evidenceWindow: { startIso: "2026-08-18T00:00:00.000Z", endIso: "2026-08-25T00:00:00.000Z" },
  };

  assert.equal(response.ok, true);
  assert.equal(response.thresholdDays, 7);
  assert.equal(response.blocked.length, 1);
  assert.equal(response.blocked[0].blockedReason, "waiting");
  assert.equal(response.staleTasks[0].ageDays, 8);
  assert.equal(response.staleGoals[0].ageDays, 10);
  assert.equal(response.estimateSignals[0].severity, "medium");
  assert.equal(response.contextSwitch.switchCount, 7);
});

test("empty friction radar response is valid", () => {
  const response: FrictionRadarResponse = {
    ok: true,
    generatedAt: "2026-08-27T12:00:00.000Z",
    thresholdDays: 7,
    blocked: [],
    staleTasks: [],
    staleGoals: [],
    estimateSignals: [],
    contextSwitch: {
      switchCount: 0,
      threshold: FRICTION_CONTEXT_SWITCH_THRESHOLD,
      highThreshold: FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
      severity: "none",
      isFriction: false,
      transitionsCount: 0,
      distinctTaskCount: 0,
      window: { startIso: "2026-08-27T00:00:00.000Z", endIso: "2026-08-27T12:00:00.000Z" },
    },
    evidenceWindow: null,
  };
  assert.deepEqual(response.blocked, []);
  assert.deepEqual(response.staleTasks, []);
  assert.deepEqual(response.staleGoals, []);
  assert.deepEqual(response.estimateSignals, []);
  assert.equal(response.contextSwitch.switchCount, 0);
  assert.equal(response.contextSwitch.isFriction, false);
});
