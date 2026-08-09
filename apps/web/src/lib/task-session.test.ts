import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
} from "./task-session";

test("prefers timestamp-derived duration for completed sessions", () => {
  const durationSeconds = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: 120,
    },
    "2026-04-16T11:00:00.000Z",
  );

  assert.equal(durationSeconds, 3600);
});

test("completed session duration stays fixed when recomputed at a later now", () => {
  const firstDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: null,
    },
    "2026-04-16T10:30:00.000Z",
  );

  const laterDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: "2026-04-16T10:00:00.000Z",
      duration_seconds: null,
    },
    "2026-04-16T13:30:00.000Z",
  );

  assert.equal(firstDuration, 3600);
  assert.equal(laterDuration, 3600);
});

test("active session duration increases when recomputed at a later now", () => {
  const firstDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    "2026-04-16T10:00:00.000Z",
  );

  const laterDuration = getTaskSessionDurationSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    "2026-04-16T10:15:00.000Z",
  );

  assert.equal(firstDuration, 3600);
  assert.equal(laterDuration, 4500);
});

test("computes overlap for an open session within a day window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-16T01:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T03:00:00.000Z",
    },
    "2026-04-16T03:00:00.000Z",
  );

  assert.equal(seconds, 7200);
});

test("clips session duration to the selected window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-15T23:30:00.000Z",
      ended_at: "2026-04-16T00:30:00.000Z",
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T23:59:59.000Z",
    },
  );

  assert.equal(seconds, 1800);
});

test("returns zero when session does not overlap the selected window", () => {
  const seconds = getSessionDurationWithinWindowSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-15T09:00:00.000Z",
      ended_at: "2026-04-15T09:30:00.000Z",
      duration_seconds: null,
    },
    {
      startIso: "2026-04-16T00:00:00.000Z",
      endIso: "2026-04-16T23:59:59.000Z",
    },
  );

  assert.equal(seconds, 0);
});
