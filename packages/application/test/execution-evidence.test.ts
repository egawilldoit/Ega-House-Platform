import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateExecutionEvidenceForWindow,
  calculateTotalTrackedSeconds,
  getExecutionEvidenceSessionOverlapSeconds,
  getOrderedSessionTransitions,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceWindow,
} from "../src/shared/execution-evidence";

const window: ExecutionEvidenceWindow = {
  startIso: "2026-04-20T00:00:00.000Z",
  endIso: "2026-04-27T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(overrides: Partial<ExecutionEvidenceSessionRow> & { task_id: string; started_at: string }): ExecutionEvidenceSessionRow {
  return {
    ended_at: "2026-04-20T10:00:00.000Z",
    duration_seconds: null,
    tasks: null,
    ...overrides,
  } as ExecutionEvidenceSessionRow;
}

// ---------------------------------------------------------------------------
// Overlap boundaries + clipping
// ---------------------------------------------------------------------------

test("clips sessions to the requested evidence window", () => {
  const seconds = getExecutionEvidenceSessionOverlapSeconds(
    row({
      task_id: "task-1",
      started_at: "2026-04-19T23:30:00.000Z",
      ended_at: "2026-04-20T00:45:00.000Z",
      duration_seconds: null,
    }),
    window,
    { nowIso: "2026-04-21T12:00:00.000Z", includeOpenSessions: true },
  );
  assert.equal(seconds, 2700);
});

test("does not count sessions that only touch a window boundary", () => {
  const summary = calculateExecutionEvidenceForWindow(
    [
      row({ task_id: "task-before", started_at: "2026-04-19T23:00:00.000Z", ended_at: "2026-04-20T00:00:00.000Z" }),
      row({ task_id: "task-after", started_at: "2026-04-27T00:00:00.000Z", ended_at: "2026-04-27T00:30:00.000Z" }),
    ],
    window,
    { nowIso: "2026-04-21T12:00:00.000Z", includeOpenSessions: true },
  );
  assert.equal(summary.totalTrackedSeconds, 0);
  assert.equal(summary.sessionCount, 0);
  assert.deepEqual(summary.taskTimeBuckets, []);
  assert.equal(summary.quality.quality, "insufficient");
});

test("zero data yields insufficient quality and empty aggregates", () => {
  const summary = calculateExecutionEvidenceForWindow([], window, { includeOpenSessions: false });
  assert.equal(summary.totalTrackedSeconds, 0);
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.quality.quality, "insufficient");
  assert.equal(summary.trackedSecondsByTask.size, 0);
  assert.equal(summary.trackedSecondsByProject.size, 0);
  assert.equal(summary.trackedSecondsByGoal.size, 0);
  assert.equal(summary.trackedSecondsByDay.size, 0);
  assert.deepEqual(summary.transitions, []);
});

// ---------------------------------------------------------------------------
// Open session policy — includeOnlyClosed by default, provisional if open.
// ---------------------------------------------------------------------------

test("open sessions excluded by default (includeOnlyClosed) and sufficient remains insufficient", () => {
  const session: ExecutionEvidenceSessionRow = {
    task_id: "task-open",
    started_at: "2026-04-22T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Active task" },
  };
  const excluded = calculateExecutionEvidenceForWindow([session], window, {
    nowIso: "2026-04-22T11:20:00.000Z",
  });
  // default => excluded
  assert.equal(excluded.totalTrackedSeconds, 0);
  assert.equal(excluded.sessionCount, 0);
  assert.equal(excluded.quality.quality, "insufficient");
  assert.equal(excluded.openSessionCount, 0);

  const included = calculateExecutionEvidenceForWindow([session], window, {
    nowIso: "2026-04-22T11:20:00.000Z",
    includeOpenSessions: true,
  });
  assert.equal(included.totalTrackedSeconds, 1200);
  assert.equal(included.sessionCount, 1);
  assert.equal(included.quality.quality, "provisional");
  assert.equal(included.openSessionCount, 1);
});

test("getExecutionEvidenceSessionOverlapSeconds respects includeOpenSessions default false in shared", () => {
  const session: ExecutionEvidenceSessionRow = {
    task_id: "task-open",
    started_at: "2026-04-22T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
  };
  const excluded = getExecutionEvidenceSessionOverlapSeconds(session, window, {
    nowIso: "2026-04-22T11:20:00.000Z",
  });
  assert.equal(excluded, 0);
  const included = getExecutionEvidenceSessionOverlapSeconds(session, window, {
    nowIso: "2026-04-22T11:20:00.000Z",
    includeOpenSessions: true,
  });
  assert.equal(included, 1200);
});

// ---------------------------------------------------------------------------
// Malformed ranges => suspect
// ---------------------------------------------------------------------------

test("malformed session timestamps yield suspect quality and no tracked time", () => {
  const malformed: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t-bad-date", started_at: "not-a-date", ended_at: "2026-04-20T10:00:00.000Z" }),
    row({ task_id: "t-end-before-start", started_at: "2026-04-20T11:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z" }),
    row({ task_id: "t-bad-end", started_at: "2026-04-20T09:00:00.000Z", ended_at: "also-bad" as unknown as string }),
  ];
  const summary = calculateExecutionEvidenceForWindow(malformed, window, { includeOpenSessions: true, nowIso: "2026-04-21T12:00:00.000Z" });
  assert.equal(summary.totalTrackedSeconds, 0);
  assert.equal(summary.sessionCount, 0);
  assert.equal(summary.malformedCount, 3);
  assert.equal(summary.quality.quality, "suspect");
  assert.match(summary.quality.reasons.join(","), /malformed/);
});

test("malformed window yields suspect quality even with valid sessions", () => {
  const badWindow: ExecutionEvidenceWindow = { startIso: "2026-04-27T00:00:00.000Z", endIso: "2026-04-20T00:00:00.000Z" };
  const sessions = [row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z" })];
  const summary = calculateExecutionEvidenceForWindow(sessions, badWindow, { includeOpenSessions: true });
  assert.equal(summary.quality.quality, "suspect");
  assert.equal(summary.totalTrackedSeconds, 0);
});

test("invalid window ISO yields suspect", () => {
  const badWindow: ExecutionEvidenceWindow = { startIso: "bad", endIso: "2026-04-27T00:00:00.000Z" };
  const sessions = [row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z" })];
  const summary = calculateExecutionEvidenceForWindow(sessions, badWindow, { includeOpenSessions: true });
  assert.equal(summary.quality.quality, "suspect");
});

// ---------------------------------------------------------------------------
// Overlap boundaries fine-grained
// ---------------------------------------------------------------------------

test("overlap boundaries: partial overlaps at start and end of window", () => {
  const s1 = row({ task_id: "t1", started_at: "2026-04-20T00:00:00.000Z", ended_at: "2026-04-20T01:00:00.000Z" });
  const s2 = row({ task_id: "t2", started_at: "2026-04-26T23:00:00.000Z", ended_at: "2026-04-27T01:00:00.000Z" });
  // s1 fully inside (1h)
  assert.equal(
    getExecutionEvidenceSessionOverlapSeconds(s1, window, { includeOpenSessions: true }),
    3600,
  );
  // s2 partially inside, only 1h (23:00-00:00)
  assert.equal(
    getExecutionEvidenceSessionOverlapSeconds(s2, window, { includeOpenSessions: true }),
    3600,
  );
});

// ---------------------------------------------------------------------------
// Cross-midnight splitting + no double-count
// ---------------------------------------------------------------------------

test("cross-midnight session splits correctly into day buckets without double-count", () => {
  // Session 22:00 on 20th to 02:00 on 21st UTC (4h = 14400s)
  const session: ExecutionEvidenceSessionRow = row({
    task_id: "t-cross",
    started_at: "2026-04-20T22:00:00.000Z",
    ended_at: "2026-04-21T02:00:00.000Z",
    tasks: { id: "t-cross", title: "Night task", projects: { id: "p1", name: "Ops" }, goals: { id: "g1", title: "Ship" } },
  });
  const summary = calculateExecutionEvidenceForWindow([session], window, { includeOpenSessions: true });
  assert.equal(summary.totalTrackedSeconds, 14400);
  // Day 2026-04-20 gets 2h, day 2026-04-21 gets 2h
  assert.equal(summary.trackedSecondsByDay.get("2026-04-20"), 7200);
  assert.equal(summary.trackedSecondsByDay.get("2026-04-21"), 7200);
  // Sum of day buckets equals total
  const daySum = Array.from(summary.trackedSecondsByDay.values()).reduce((a, b) => a + b, 0);
  assert.equal(daySum, summary.totalTrackedSeconds);
  // Day buckets array mirrors map
  assert.equal(summary.dayTimeBuckets.length, 2);
  const d20 = summary.dayTimeBuckets.find((b) => b.id === "2026-04-20");
  const d21 = summary.dayTimeBuckets.find((b) => b.id === "2026-04-21");
  assert.equal(d20?.trackedSeconds, 7200);
  assert.equal(d21?.trackedSeconds, 7200);
  // Verify window clipping: if window ends at 2026-04-21T00:00:00, only first day counts
  const narrowWindow: ExecutionEvidenceWindow = { startIso: "2026-04-20T00:00:00.000Z", endIso: "2026-04-21T00:00:00.000Z" };
  const narrow = calculateExecutionEvidenceForWindow([session], narrowWindow, { includeOpenSessions: true });
  assert.equal(narrow.totalTrackedSeconds, 7200);
  assert.equal(narrow.trackedSecondsByDay.get("2026-04-20"), 7200);
  assert.equal(narrow.trackedSecondsByDay.has("2026-04-21"), false);
});

test("multiple sessions that individually span midnight do not double-count totals", () => {
  const s1: ExecutionEvidenceSessionRow = row({ task_id: "t1", started_at: "2026-04-20T23:00:00.000Z", ended_at: "2026-04-21T01:00:00.000Z" });
  const s2: ExecutionEvidenceSessionRow = row({ task_id: "t2", started_at: "2026-04-21T00:30:00.000Z", ended_at: "2026-04-21T01:30:00.000Z" });
  // s1 contributes 2h (7200), s2 contributes 1h (3600) total 10800; even though they overlap in real time 00:30-01:00, we sum clips (shared does not deduplicate overlapping session intervals)
  const summary = calculateExecutionEvidenceForWindow([s1, s2], window, { includeOpenSessions: true });
  assert.equal(summary.totalTrackedSeconds, 10800);
  // Day split totals still sum correctly without double-count across days
  const daySum = Array.from(summary.trackedSecondsByDay.values()).reduce((a, b) => a + b, 0);
  assert.equal(daySum, summary.totalTrackedSeconds);
});

// ---------------------------------------------------------------------------
// Overlap windows — ensuring no double-count note (within single window)
// ---------------------------------------------------------------------------

test("overlapping windows do not double-count when calculated separately (caller must dedup)", () => {
  // Single session 09:00-11:00 on 20th
  const session = row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T11:00:00.000Z" });
  const winA: ExecutionEvidenceWindow = { startIso: "2026-04-20T08:00:00.000Z", endIso: "2026-04-20T10:00:00.000Z" };
  const winB: ExecutionEvidenceWindow = { startIso: "2026-04-20T10:00:00.000Z", endIso: "2026-04-20T12:00:00.000Z" };
  const a = getExecutionEvidenceSessionOverlapSeconds(session, winA, { includeOpenSessions: true });
  const b = getExecutionEvidenceSessionOverlapSeconds(session, winB, { includeOpenSessions: true });
  assert.equal(a, 3600); // 09:00-10:00
  assert.equal(b, 3600); // 10:00-11:00
  // Combined disjoint windows cover full session without overlap
  const full: ExecutionEvidenceWindow = { startIso: "2026-04-20T08:00:00.000Z", endIso: "2026-04-20T12:00:00.000Z" };
  const fullSec = getExecutionEvidenceSessionOverlapSeconds(session, full, { includeOpenSessions: true });
  assert.equal(fullSec, 7200);
  assert.equal(a + b, fullSec);
});

// ---------------------------------------------------------------------------
// Deterministic ordering for equal timestamps
// ---------------------------------------------------------------------------

test("ordered transitions are deterministic for equal timestamps (task_id then id)", () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ id: "s-b", task_id: "task-b", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    row({ id: "s-a", task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    row({ id: "s-c", task_id: "task-a", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    row({ task_id: "task-0", started_at: "2026-04-20T08:00:00.000Z", ended_at: "2026-04-20T08:30:00.000Z" }),
  ];
  const summary = calculateExecutionEvidenceForWindow(sessions, window, { includeOpenSessions: true });
  const idsInOrder = summary.transitions.map((t) => t.taskId);
  // Expect 08:00 first, then ordered among 09:00 ties: task-a before task-b, and among task-a ties, s-a before s-c (id)
  assert.deepEqual(idsInOrder, ["task-0", "task-a", "task-a", "task-b"]);
  // Also via direct helper
  const viaHelper = getOrderedSessionTransitions(sessions, window, { includeOpenSessions: true });
  assert.deepEqual(viaHelper.map((t) => t.index), [0, 1, 2, 3]);
  assert.deepEqual(viaHelper.map((t) => t.taskId), idsInOrder);
});

test("deterministic ordering persists across multiple invocations", () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "b", started_at: "2026-04-20T10:00:00.000Z", ended_at: "2026-04-20T10:10:00.000Z" }),
    row({ task_id: "a", started_at: "2026-04-20T10:00:00.000Z", ended_at: "2026-04-20T10:10:00.000Z" }),
  ];
  const first = calculateExecutionEvidenceForWindow(sessions, window, { includeOpenSessions: true }).transitions.map((t) => t.taskId);
  const second = calculateExecutionEvidenceForWindow([...sessions].reverse(), window, { includeOpenSessions: true }).transitions.map((t) => t.taskId);
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["a", "b"]);
});

// ---------------------------------------------------------------------------
// Aggregations: Task / Project / Goal / Day
// ---------------------------------------------------------------------------

test("aggregates tracked seconds, buckets, touched projects, and touched goals", () => {
  const summary = calculateExecutionEvidenceForWindow(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T09:00:00.000Z",
        ended_at: "2026-04-20T10:00:00.000Z",
        duration_seconds: 60,
        tasks: {
          id: "task-1",
          title: "Draft review",
          projects: { id: "project-1", name: "Ops" },
          goals: { id: "goal-1", title: "Tighter review loop" },
        },
      },
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T09:30:00.000Z",
        duration_seconds: 1800,
        tasks: {
          id: "task-1",
          title: "Draft review",
          projects: { id: "project-1", name: "Ops" },
          goals: { id: "goal-1", title: "Tighter review loop" },
        },
      },
      {
        task_id: "task-2",
        started_at: "2026-04-22T11:00:00.000Z",
        ended_at: "2026-04-22T11:15:00.000Z",
        duration_seconds: 900,
        tasks: {
          id: "task-2",
          title: "Clear queue",
          projects: { id: "project-2", name: "Inbox" },
          goals: null,
        },
      },
    ],
    window,
    { nowIso: "2026-04-22T12:00:00.000Z", includeOpenSessions: true },
  );

  assert.equal(summary.totalTrackedSeconds, 6300);
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.trackedSecondsByTask.get("task-1"), 5400);
  assert.equal(summary.trackedSecondsByTask.get("task-2"), 900);
  assert.equal(summary.quality.quality, "sufficient");
  assert.deepEqual(summary.taskTimeBuckets, [
    { id: "task-1", label: "Draft review", trackedSeconds: 5400, sessionCount: 2 },
    { id: "task-2", label: "Clear queue", trackedSeconds: 900, sessionCount: 1 },
  ]);
  assert.deepEqual(summary.projectTimeBuckets, [
    { id: "project-1", label: "Ops", trackedSeconds: 5400, sessionCount: 2 },
    { id: "project-2", label: "Inbox", trackedSeconds: 900, sessionCount: 1 },
  ]);
  // Goal bucket + byGoal map
  assert.equal(summary.trackedSecondsByGoal.get("goal-1"), 5400);
  assert.equal(summary.goalTimeBuckets.length, 1);
  assert.equal(summary.goalTimeBuckets[0].id, "goal-1");
  assert.equal(summary.goalTimeBuckets[0].trackedSeconds, 5400);
  assert.deepEqual(summary.touchedProjectNames, ["Ops", "Inbox"]);
  assert.deepEqual(summary.touchedGoalTitles, ["Tighter review loop"]);
  // Day buckets: 20th 1h, 21st 0.5h, 22nd 0.25h
  assert.equal(summary.trackedSecondsByDay.get("2026-04-20"), 3600);
  assert.equal(summary.trackedSecondsByDay.get("2026-04-21"), 1800);
  assert.equal(summary.trackedSecondsByDay.get("2026-04-22"), 900);
});

test("project aggregation is owner-scoped and bounded (window clipping)", () => {
  const session: ExecutionEvidenceSessionRow = {
    task_id: "t1",
    started_at: "2026-04-19T23:30:00.000Z",
    ended_at: "2026-04-20T00:30:00.000Z",
    duration_seconds: null,
    tasks: { id: "t1", title: "T", projects: { id: "p1", name: "Ops" } },
  };
  const summary = calculateExecutionEvidenceForWindow([session], window, { includeOpenSessions: true });
  // Only 30 minutes inside window
  assert.equal(summary.totalTrackedSeconds, 1800);
  assert.equal(summary.trackedSecondsByProject.get("p1"), 1800);
  assert.equal(summary.projectTimeBuckets[0].trackedSeconds, 1800);
});

test("goal buckets include only sessions with goal, still counts task", () => {
  const withGoal: ExecutionEvidenceSessionRow = {
    task_id: "t1",
    started_at: "2026-04-20T09:00:00.000Z",
    ended_at: "2026-04-20T09:30:00.000Z",
    duration_seconds: null,
    tasks: { id: "t1", title: "T1", goals: { id: "g1", title: "Goal One" }, projects: { id: "p1", name: "P1" } },
  };
  const withoutGoal: ExecutionEvidenceSessionRow = {
    task_id: "t2",
    started_at: "2026-04-20T10:00:00.000Z",
    ended_at: "2026-04-20T10:30:00.000Z",
    duration_seconds: null,
    tasks: { id: "t2", title: "T2", projects: { id: "p1", name: "P1" } },
  };
  const summary = calculateExecutionEvidenceForWindow([withGoal, withoutGoal], window, { includeOpenSessions: true });
  assert.equal(summary.trackedSecondsByGoal.size, 1);
  assert.equal(summary.trackedSecondsByGoal.get("g1"), 1800);
  assert.equal(summary.goalTimeBuckets.length, 1);
  assert.equal(summary.trackedSecondsByTask.get("t1"), 1800);
  assert.equal(summary.trackedSecondsByTask.get("t2"), 1800);
});

// ---------------------------------------------------------------------------
// No double-count across overlapping session intervals (sum, not merged)
// but day sums equal total.
// ---------------------------------------------------------------------------

test("no double-count: sum of per-task and per-day equals total", () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z", tasks: { id: "t1", title: "T1" } }),
    row({ task_id: "t2", started_at: "2026-04-20T09:30:00.000Z", ended_at: "2026-04-20T10:30:00.000Z", tasks: { id: "t2", title: "T2" } }),
  ];
  const summary = calculateExecutionEvidenceForWindow(sessions, window, { includeOpenSessions: true });
  const taskSum = Array.from(summary.trackedSecondsByTask.values()).reduce((a, b) => a + b, 0);
  const daySum = Array.from(summary.trackedSecondsByDay.values()).reduce((a, b) => a + b, 0);
  assert.equal(taskSum, summary.totalTrackedSeconds);
  assert.equal(daySum, summary.totalTrackedSeconds);
  assert.equal(summary.totalTrackedSeconds, 7200); // 1h+1h even though they overlap 30m
});

// ---------------------------------------------------------------------------
// Sufficient / insufficient / provisional / suspect upper-level
// ---------------------------------------------------------------------------

test("quality sufficient when closed sessions contribute and no issues", () => {
  const sessions = [row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" })];
  const summary = calculateExecutionEvidenceForWindow(sessions, window, { includeOpenSessions: false });
  assert.equal(summary.quality.quality, "sufficient");
});

test("quality suspect outranks provisional when both malformed and open", () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t-good", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T09:30:00.000Z" }),
    row({ task_id: "t-bad", started_at: "bad", ended_at: "2026-04-20T10:00:00.000Z" }),
    { task_id: "t-open", started_at: "2026-04-21T09:00:00.000Z", ended_at: null, duration_seconds: null, tasks: null },
  ];
  const summary = calculateExecutionEvidenceForWindow(sessions, window, { nowIso: "2026-04-21T10:00:00.000Z", includeOpenSessions: true });
  assert.equal(summary.quality.quality, "suspect");
  assert.equal(summary.quality.malformedCount, 1);
  assert.equal(summary.quality.openSessionCount, 1);
});

// ---------------------------------------------------------------------------
// calculateTotalTrackedSeconds legacy helper
// ---------------------------------------------------------------------------

test("calculateTotalTrackedSeconds sums durations and handles open sessions via now", () => {
  const nowIso = "2026-04-20T11:00:00.000Z";
  const sessions: ExecutionEvidenceSessionRow[] = [
    row({ task_id: "t1", started_at: "2026-04-20T09:00:00.000Z", ended_at: "2026-04-20T10:00:00.000Z", duration_seconds: 9999 }),
    row({ task_id: "t2", started_at: "2026-04-20T10:00:00.000Z", ended_at: null, duration_seconds: null }),
  ];
  const total = calculateTotalTrackedSeconds(sessions, nowIso);
  assert.equal(total, 3600 + 3600);
});

// ---------------------------------------------------------------------------
// Window inclusivity semantics (half-open)
// ---------------------------------------------------------------------------

test("window is half-open [start, end)", () => {
  // Using half-open means a session exactly at window end is outside
  const sStart: ExecutionEvidenceSessionRow = row({ task_id: "t", started_at: window.startIso, ended_at: "2026-04-20T01:00:00.000Z" });
  const sEnd: ExecutionEvidenceSessionRow = row({ task_id: "t", started_at: window.endIso, ended_at: "2026-04-27T01:00:00.000Z" });
  assert.equal(getExecutionEvidenceSessionOverlapSeconds(sStart, window, { includeOpenSessions: true }), 3600);
  assert.equal(getExecutionEvidenceSessionOverlapSeconds(sEnd, window, { includeOpenSessions: true }), 0);
});
