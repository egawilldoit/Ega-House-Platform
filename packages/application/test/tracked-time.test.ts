import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTIMATE_ACCURACY_TOLERANCE_PERCENT,
  aggregateEstimateVsActual,
  calculateTrackedTimeByTask,
  compareEstimateToTracked,
  type TrackedTaskSessionRow,
} from "../src/timer/tracked-time";
import {
  calculateTotalTrackedSeconds,
  type ExecutionEvidenceSessionRow,
} from "../src/shared/execution-evidence";

const NOW_ISO = "2026-04-20T12:00:00.000Z";

function session(over: Partial<TrackedTaskSessionRow> & { taskId: string }): TrackedTaskSessionRow {
  return {
    startedAt: "2026-04-20T09:00:00.000Z",
    endedAt: "2026-04-20T10:00:00.000Z",
    durationSeconds: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tracked-time totals — same policy as the Timer surface
// ---------------------------------------------------------------------------

test("sums canonical session durations per task, including a running session up to now", () => {
  const summary = calculateTrackedTimeByTask(
    [
      session({ taskId: "task-a" }),
      session({
        taskId: "task-a",
        startedAt: "2026-04-20T10:00:00.000Z",
        endedAt: "2026-04-20T10:30:00.000Z",
      }),
      session({
        taskId: "task-b",
        startedAt: "2026-04-20T11:30:00.000Z",
        endedAt: null,
      }),
      // Midnight crossing is a lifetime total: it is not day-clipped.
      session({
        taskId: "task-f",
        startedAt: "2026-04-19T23:30:00.000Z",
        endedAt: "2026-04-20T00:30:00.000Z",
      }),
    ],
    { nowIso: NOW_ISO },
  );

  assert.equal(summary.trackedSecondsByTask.get("task-a"), 5400);
  assert.equal(summary.trackedSecondsByTask.get("task-b"), 1800);
  assert.equal(summary.trackedSecondsByTask.get("task-f"), 3600);
  assert.equal(summary.totalTrackedSeconds, 10800);
  assert.deepEqual([...summary.openSessionTaskIds], ["task-b"]);
  assert.equal(summary.hasOpenSessions, true);
});

test("reports the same total as the canonical timer total helper for the same sessions", () => {
  const rows = [
    session({ taskId: "task-a" }),
    session({ taskId: "task-b", startedAt: "2026-04-20T10:00:00.000Z", endedAt: "2026-04-20T10:45:00.000Z" }),
    session({ taskId: "task-b", startedAt: "2026-04-20T11:00:00.000Z", endedAt: "2026-04-20T11:20:00.000Z" }),
    session({ taskId: "task-c", startedAt: "2026-04-20T11:30:00.000Z", endedAt: null }),
  ];

  const summary = calculateTrackedTimeByTask(rows, { nowIso: NOW_ISO });
  const timerRows: ExecutionEvidenceSessionRow[] = rows.map((row) => ({
    task_id: row.taskId,
    started_at: row.startedAt,
    ended_at: row.endedAt,
    duration_seconds: row.durationSeconds,
  }));

  // Timer page "tracked total" uses this helper; the estimate comparison must
  // not fork session-duration semantics.
  assert.equal(
    summary.totalTrackedSeconds,
    calculateTotalTrackedSeconds(timerRows, NOW_ISO),
  );
  assert.equal(
    [...summary.trackedSecondsByTask.values()].reduce((sum, seconds) => sum + seconds, 0),
    summary.totalTrackedSeconds,
  );
});

test("malformed or inverted intervals use the canonical duration_seconds fallback", () => {
  const summary = calculateTrackedTimeByTask(
    [
      session({
        taskId: "inverted",
        startedAt: "2026-04-20T11:00:00.000Z",
        endedAt: "2026-04-20T10:00:00.000Z",
        durationSeconds: 600,
      }),
      session({
        taskId: "invalid-start",
        startedAt: "not-a-date",
        endedAt: "2026-04-20T10:00:00.000Z",
        durationSeconds: 120,
      }),
      session({
        taskId: "no-fallback",
        startedAt: "not-a-date",
        endedAt: null,
        durationSeconds: null,
      }),
    ],
    { nowIso: NOW_ISO },
  );

  assert.equal(summary.trackedSecondsByTask.get("inverted"), 600);
  assert.equal(summary.trackedSecondsByTask.get("invalid-start"), 120);
  assert.equal(summary.trackedSecondsByTask.get("no-fallback"), 0);
  assert.equal(summary.totalTrackedSeconds, 720);
});

test("ignores blank task ids and returns an empty summary for no sessions", () => {  const summary = calculateTrackedTimeByTask(
    [session({ taskId: "   " }), session({ taskId: "task-a" })],
    { nowIso: NOW_ISO },
  );
  assert.deepEqual([...summary.trackedSecondsByTask.keys()], ["task-a"]);
  assert.equal(summary.openSessionTaskIds.size, 0);

  const empty = calculateTrackedTimeByTask([], { nowIso: NOW_ISO });
  assert.equal(empty.totalTrackedSeconds, 0);
  assert.equal(empty.trackedSecondsByTask.size, 0);
  assert.equal(empty.hasOpenSessions, false);
});

// ---------------------------------------------------------------------------
// Comparison states and no-division-by-zero policy
// ---------------------------------------------------------------------------

test("compares estimate minutes with tracked seconds and signs the rounded percent", () => {
  const comparison = compareEstimateToTracked({
    estimateMinutes: 120,
    trackedSeconds: 11400,
    hasOpenSession: true,
  });

  assert.ok(comparison);
  assert.equal(comparison.estimateMinutes, 120);
  assert.equal(comparison.estimateSeconds, 7200);
  assert.equal(comparison.trackedSeconds, 11400);
  assert.equal(comparison.deltaSeconds, 4200);
  assert.equal(comparison.deltaMinutes, 70);
  assert.equal(comparison.percent, 58);
  assert.equal(comparison.state, "over");
  assert.equal(comparison.hasOpenSession, true);
});

test("exact and under estimates are distinct states", () => {
  const exact = compareEstimateToTracked({ estimateMinutes: 60, trackedSeconds: 3600 });
  assert.ok(exact);
  assert.equal(exact.percent, 0);
  assert.equal(exact.state, "on_target");

  const under = compareEstimateToTracked({ estimateMinutes: 60, trackedSeconds: 3000 });
  assert.ok(under);
  assert.equal(under.percent, -17);
  assert.equal(under.state, "under");
  assert.equal(under.deltaMinutes, -10);
});

test("a zero estimate never divides by zero and keeps tracked time honest", () => {
  const over = compareEstimateToTracked({ estimateMinutes: 0, trackedSeconds: 300 });
  assert.ok(over);
  assert.equal(over.percent, null);
  assert.equal(over.state, "over");
  assert.equal(over.trackedSeconds, 300);
  assert.equal(over.deltaMinutes, 5);

  const idle = compareEstimateToTracked({ estimateMinutes: 0, trackedSeconds: 0 });
  assert.ok(idle);
  assert.equal(idle.percent, null);
  assert.equal(idle.state, "on_target");
  assert.equal(idle.hasTrackedTime, false);
});

test("no estimate means no comparison rather than an invented one", () => {
  for (const estimate of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -5, "60"]) {
    assert.equal(
      compareEstimateToTracked({ estimateMinutes: estimate, trackedSeconds: 3600 }),
      null,
      `estimate ${String(estimate)} must not produce a comparison`,
    );
  }
});

test("normalizes fractional and invalid tracked seconds", () => {
  const fractional = compareEstimateToTracked({ estimateMinutes: 2.9, trackedSeconds: 150 });
  assert.ok(fractional);
  assert.equal(fractional.estimateMinutes, 2);
  assert.equal(fractional.percent, 25);
  assert.equal(fractional.state, "over");

  const invalidTracked = compareEstimateToTracked({ estimateMinutes: 60, trackedSeconds: -1 });
  assert.ok(invalidTracked);
  assert.equal(invalidTracked.trackedSeconds, 0);
  assert.equal(invalidTracked.state, "under");
});

// ---------------------------------------------------------------------------
// Aggregates — no invented estimates, honest coverage
// ---------------------------------------------------------------------------

test("aggregates only estimated tasks for the estimate comparison and reports coverage", () => {
  const aggregate = aggregateEstimateVsActual([
    { taskId: "a", title: "Alpha", estimateMinutes: 60, trackedSeconds: 3600 },
    { taskId: "b", title: "Beta", estimateMinutes: 60, trackedSeconds: 7200 },
    {
      taskId: "c",
      title: "Carried",
      estimateMinutes: 60,
      trackedSeconds: 3000,
      hasOpenSession: true,
    },
    { taskId: "d", title: "Zero estimate", estimateMinutes: 0, trackedSeconds: 600 },
    { taskId: "e", title: "No estimate", estimateMinutes: null, trackedSeconds: 3600 },
  ]);

  assert.equal(aggregate.taskCount, 5);
  assert.equal(aggregate.estimatedTaskCount, 4);
  assert.equal(aggregate.trackedTaskCount, 5);
  assert.equal(aggregate.estimateMinutes, 180);
  // Only the four estimated tasks contribute; task e has no estimate.
  assert.equal(aggregate.trackedSeconds, 14400);
  assert.equal(aggregate.trackedSecondsOnAllTasks, 18000);

  assert.ok(aggregate.comparison);
  assert.equal(aggregate.comparison.estimateMinutes, 180);
  assert.equal(aggregate.comparison.percent, 33);
  assert.equal(aggregate.comparison.state, "over");
  assert.equal(aggregate.comparison.hasOpenSession, true);

  assert.equal(aggregate.overTaskCount, 2);
  assert.equal(aggregate.underTaskCount, 1);
  assert.equal(aggregate.onTargetTaskCount, 1);

  // Accuracy excludes the zero-estimate task (no usable ratio) and the task
  // without an estimate.
  assert.equal(aggregate.evaluatedTaskCount, 3);
  assert.equal(aggregate.onTargetEvaluatedTaskCount, 2);
  assert.equal(aggregate.accuracyPercent, 67);
  assert.equal(ESTIMATE_ACCURACY_TOLERANCE_PERCENT, 20);

  assert.deepEqual(
    aggregate.topOverRuns.map((run) => run.taskId),
    ["b", "d"],
  );
  assert.equal(aggregate.topOverRuns[0]?.comparison.deltaSeconds, 3600);
  assert.equal(aggregate.hasOpenSessions, true);
});

test("limits and orders over-runs deterministically", () => {
  const aggregate = aggregateEstimateVsActual(
    [
      { taskId: "z", title: "Same", estimateMinutes: 60, trackedSeconds: 7200 },
      { taskId: "a", title: "Same", estimateMinutes: 60, trackedSeconds: 7200 },
      { taskId: "m", title: "Bigger", estimateMinutes: 60, trackedSeconds: 10800 },
    ],
    { topOverRunLimit: 2 },
  );

  assert.deepEqual(
    aggregate.topOverRuns.map((run) => run.taskId),
    ["m", "a"],
  );
});

test("returns no comparison or ratio when nothing is estimated", () => {
  const aggregate = aggregateEstimateVsActual([
    { taskId: "a", title: "Alpha", estimateMinutes: null, trackedSeconds: 3600 },
    { taskId: "b", title: "Beta", estimateMinutes: null, trackedSeconds: 0 },
  ]);

  assert.equal(aggregate.estimatedTaskCount, 0);
  assert.equal(aggregate.comparison, null);
  assert.equal(aggregate.accuracyPercent, null);
  assert.equal(aggregate.evaluatedTaskCount, 0);
  assert.deepEqual(aggregate.topOverRuns, []);
  assert.equal(aggregate.trackedSecondsOnAllTasks, 3600);
});

test("empty input is a safe aggregate", () => {
  const aggregate = aggregateEstimateVsActual([], { topOverRunLimit: 0 });
  assert.equal(aggregate.taskCount, 0);
  assert.equal(aggregate.comparison, null);
  assert.equal(aggregate.accuracyPercent, null);
  assert.deepEqual(aggregate.topOverRuns, []);
  assert.equal(aggregate.trackedSecondsOnAllTasks, 0);
});
