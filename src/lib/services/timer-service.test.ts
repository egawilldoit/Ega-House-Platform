import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTimerAggregates,
  validateTimerSessionTimestampUpdateInput,
} from "./timer-service";

test("validates and normalizes timer session timestamp updates", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00Z",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.sessionId, "session-1");
  assert.equal(result.data?.startedAtIso, "2026-04-21T09:00:00.000Z");
  assert.equal(result.data?.endedAtIso, "2026-04-21T10:30:00.000Z");
  assert.equal(result.data?.durationSeconds, 5400);
});

test("rejects timestamps without explicit timezone", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T09:00:00",
    endedAt: "2026-04-21T10:30:00Z",
  });

  assert.equal(
    result.errorMessage,
    "Start timestamp must be a valid ISO value with timezone, for example 2026-04-21T10:15:00Z.",
  );
});

test("rejects ended_at values before started_at", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "session-1",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T10:59:59Z",
  });

  assert.equal(result.errorMessage, "End timestamp must be after the start timestamp.");
});

test("requires a session id", () => {
  const result = validateTimerSessionTimestampUpdateInput({
    sessionId: "   ",
    startedAt: "2026-04-21T11:00:00Z",
    endedAt: "2026-04-21T12:00:00Z",
  });

  assert.equal(result.errorMessage, "Session update request is invalid.");
});

test("corrected session on today updates today total and tracked total", () => {
  const baseline = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T09:20:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  const corrected = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(baseline.todayTotalDurationSeconds, 1200);
  assert.equal(corrected.todayTotalDurationSeconds, 5280);
  assert.equal(corrected.trackedTotalSeconds, 5280);
});

test("corrected session outside today does not change today total", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T09:00:00.000Z",
        ended_at: "2026-04-20T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.todayTotalDurationSeconds, 0);
  assert.equal(aggregates.trackedTotalSeconds, 5280);
});

test("longest session updates when correction makes a session longest", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-short",
        started_at: "2026-04-21T07:00:00.000Z",
        ended_at: "2026-04-21T07:30:00.000Z",
        duration_seconds: 1800,
        tasks: { title: "Short" },
      },
      {
        task_id: "task-corrected",
        started_at: "2026-04-21T08:00:00.000Z",
        ended_at: "2026-04-21T09:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Corrected" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.longestSessionSeconds, 5280);
  assert.equal(aggregates.longestSessionTaskTitle, "Corrected");
});

test("today bucket counts overlap within the local-day window after correction", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T23:30:00.000Z",
        ended_at: "2026-04-21T01:00:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Cross-day" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.todayTotalDurationSeconds, 3600);
  assert.equal(aggregates.sessionsTodayCount, 1);
});

test("aggregate helper uses corrected timestamps over stale duration field", () => {
  const aggregates = calculateTimerAggregates(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T10:28:00.000Z",
        duration_seconds: 1200,
        tasks: { title: "Fix timer" },
      },
    ],
    {
      nowIso: "2026-04-21T12:00:00.000Z",
      todayWindow: {
        startIso: "2026-04-21T00:00:00.000Z",
        endIso: "2026-04-21T12:00:00.000Z",
      },
    },
  );

  assert.equal(aggregates.trackedTotalSeconds, 5280);
  assert.equal(aggregates.todayTotalDurationSeconds, 5280);
});

test("aggregates keep corrected completed sessions fixed across later now values", () => {
  const completedSession = {
    task_id: "task-corrected",
    started_at: "2026-04-21T09:00:00.000Z",
    ended_at: "2026-04-21T10:28:00.000Z",
    duration_seconds: 1200,
    tasks: { title: "Corrected" },
  };

  const atNoon = calculateTimerAggregates([completedSession], {
    nowIso: "2026-04-21T12:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:00:00.000Z",
    },
  });

  const laterNow = calculateTimerAggregates([completedSession], {
    nowIso: "2026-04-21T15:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T15:00:00.000Z",
    },
  });

  assert.equal(atNoon.trackedTotalSeconds, 5280);
  assert.equal(laterNow.trackedTotalSeconds, 5280);
  assert.equal(atNoon.todayTotalDurationSeconds, 5280);
  assert.equal(laterNow.todayTotalDurationSeconds, 5280);
});

test("aggregates let active sessions grow across later now values", () => {
  const activeSession = {
    task_id: "task-active",
    started_at: "2026-04-21T09:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Active" },
  };

  const atNoon = calculateTimerAggregates([activeSession], {
    nowIso: "2026-04-21T12:00:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:00:00.000Z",
    },
  });

  const laterNow = calculateTimerAggregates([activeSession], {
    nowIso: "2026-04-21T12:15:00.000Z",
    todayWindow: {
      startIso: "2026-04-21T00:00:00.000Z",
      endIso: "2026-04-21T12:15:00.000Z",
    },
  });

  assert.equal(atNoon.trackedTotalSeconds, 10800);
  assert.equal(laterNow.trackedTotalSeconds, 11700);
  assert.equal(atNoon.todayTotalDurationSeconds, 10800);
  assert.equal(laterNow.todayTotalDurationSeconds, 11700);
});
