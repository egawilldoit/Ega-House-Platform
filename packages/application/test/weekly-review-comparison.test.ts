import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor } from "../src/auth/actor";
import type { RepositoryResult } from "../src/shared/result";
import type { TimeContextRepository } from "../src/shared/time-context";
import type {
  ExecutionEvidenceRepository,
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
} from "../src/shared/execution-evidence";
import { getWeeklyReviewReadModel } from "../src/weekly-review/read-model";
import {
  buildWeeklyReviewComparison,
  createMetricComparison,
  getPreviousExecutionWindow,
  getPreviousWeekWindow,
} from "../src/weekly-review/comparison";
import type {
  WeeklyReviewRepository,
  WeeklyReviewRow,
  WeeklyReviewTaskRepository,
  WeeklyReviewTaskActivityRow,
} from "../src/weekly-review/ports";
import { getWeekWindow } from "@ega/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null = "UTC") {}
  async getTimezone(_actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    return ok(this.stored);
  }
  async setTimezone(_actor: AuthenticatedActor, tz: string): Promise<RepositoryResult<string>> {
    this.stored = tz;
    return ok(tz);
  }
}

class FakeWeeklyReviewRepo implements WeeklyReviewRepository {
  async getSavedReview(): Promise<RepositoryResult<WeeklyReviewRow | null>> {
    return ok(null);
  }
  async listPastReviews(): Promise<RepositoryResult<WeeklyReviewRow[]>> {
    return ok([]);
  }
  async getPreviousReview(): Promise<RepositoryResult<WeeklyReviewRow | null>> {
    return ok(null);
  }
}

class WindowAwareFakeTasksRepo implements WeeklyReviewTaskRepository {
  // maps startIso -> value
  currentWindowStart: string | null = null;
  // values for current and previous
  current: { tasksCreated: number; goalsTouched: Array<{ status: string }>; completed: WeeklyReviewTaskActivityRow[] };
  previous: { tasksCreated: number; goalsTouched: Array<{ status: string }>; completed: WeeklyReviewTaskActivityRow[] };

  constructor(current: typeof WindowAwareFakeTasksRepo.prototype.current, previous: typeof WindowAwareFakeTasksRepo.prototype.previous) {
    this.current = current;
    this.previous = previous;
  }

  // capture first window as current for comparison
  private isPrevious(window: ExecutionEvidenceWindow): boolean {
    // if currentWindowStart not yet captured, we can't differentiate by start
    // Use heuristic: if previous is 0 and current is non-zero, previous start will be earlier
    // For test simplicity, we track both windows via explicit mapping by checking which window's start matches known previous vs current.
    // We'll compare against known UTC starts derived via getWeekWindow.
    // Simpler: we will be called first with current window, then previous. Capture order.
    // First call's start is current, second is previous.
    if (this.currentWindowStart === null) {
      this.currentWindowStart = window.startIso;
      return false;
    }
    // If already captured, previous window's start !== currentWindowStart
    return window.startIso !== this.currentWindowStart;
  }

  async countTasksCreatedForWindow(_actor: AuthenticatedActor, window: ExecutionEvidenceWindow) {
    return ok(this.isPrevious(window) ? this.previous.tasksCreated : this.current.tasksCreated);
  }
  async listGoalsTouchedForWindow(_actor: AuthenticatedActor, window: ExecutionEvidenceWindow) {
    return ok(this.isPrevious(window) ? this.previous.goalsTouched : this.current.goalsTouched);
  }
  async listBlockedTasks() {
    return ok([]);
  }
  async listCompletedTasksForWindow(_actor: AuthenticatedActor, window: ExecutionEvidenceWindow) {
    return ok(this.isPrevious(window) ? this.previous.completed : this.current.completed);
  }
  async listCarriedTasksForWindow() {
    return ok([]);
  }
  async listBlockedTasksForWindow() {
    return ok([]);
  }
}

class WindowAwareEvidenceRepo implements ExecutionEvidenceRepository {
  currentWindowStart: string | null = null;
  currentSessions: ExecutionEvidenceSessionRow[];
  previousSessions: ExecutionEvidenceSessionRow[];

  constructor(currentSessions: ExecutionEvidenceSessionRow[], previousSessions: ExecutionEvidenceSessionRow[]) {
    this.currentSessions = currentSessions;
    this.previousSessions = previousSessions;
  }

  private isPrevious(window: ExecutionEvidenceWindow): boolean {
    if (this.currentWindowStart === null) {
      this.currentWindowStart = window.startIso;
      return false;
    }
    return window.startIso !== this.currentWindowStart;
  }

  async listSessionsForWindow(_actor: AuthenticatedActor, window: ExecutionEvidenceWindow) {
    return ok(this.isPrevious(window) ? this.previousSessions : this.currentSessions);
  }
}

const ACTOR = createAuthenticatedActor("user-123");

// ---------------------------------------------------------------------------
// Unit: createMetricComparison
// ---------------------------------------------------------------------------

test("createMetricComparison: zero denominator safe (percent null, delta current)", () => {
  const c = createMetricComparison(3600, 0);
  assert.equal(c.current, 3600);
  assert.equal(c.previous, 0);
  assert.equal(c.delta, 3600);
  assert.equal(c.percentChange, null);
});

test("createMetricComparison: normal percent", () => {
  const c = createMetricComparison(150, 100);
  assert.equal(c.delta, 50);
  assert.equal(c.percentChange, 50);
});

test("createMetricComparison: negative delta", () => {
  const c = createMetricComparison(80, 100);
  assert.equal(c.delta, -20);
  assert.equal(c.percentChange, -20);
});

test("createMetricComparison: missing previous null", () => {
  const c = createMetricComparison(100, null);
  assert.equal(c.previous, null);
  assert.equal(c.delta, null);
  assert.equal(c.percentChange, null);
});

test("createMetricComparison: both zero => percent null, delta 0", () => {
  const c = createMetricComparison(0, 0);
  assert.equal(c.delta, 0);
  assert.equal(c.percentChange, null);
});

// ---------------------------------------------------------------------------
// Unit: adjacent windows no gap/overlap with identical boundary rules
// ---------------------------------------------------------------------------

test("adjacent windows identical boundary rules UTC no gap", () => {
  const currentRaw = getWeekWindow("UTC", "2026-01-12");
  const currentWindow = {
    weekOf: "2026-01-12",
    weekStart: currentRaw.weekStart,
    weekEnd: currentRaw.weekEnd,
    weekStartUtc: currentRaw.weekStartUtcIso,
    weekEndExclusiveUtc: currentRaw.weekEndExclusiveUtcIso,
    timezone: currentRaw.timezone,
    requestedTimezone: currentRaw.requestedTimezone,
    fallback: currentRaw.fallback as "none",
  };
  const prev = getPreviousWeekWindow(currentWindow);
  // Adjacent
  assert.equal(prev.weekEndExclusiveUtc, currentWindow.weekStartUtc);
  assert.equal(prev.weekStart, "2026-01-05");
  assert.equal(prev.weekEnd, "2026-01-11");
  // No overlap, no gap: previous end == current start, and using identical rules (same timezone)
  // Verify previous execution window matches
  const prevExec = getPreviousExecutionWindow(prev);
  assert.equal(prevExec.startIso, prev.weekStartUtc);
  assert.equal(prevExec.endIso, prev.weekEndExclusiveUtc);
  assert.equal(prevExec.endIso, currentWindow.weekStartUtc);
});

test("adjacent windows New York no gap DST normal", () => {
  const currentRaw = getWeekWindow("America/New_York", "2026-01-12");
  const currentWindow = {
    weekOf: "2026-01-12",
    weekStart: currentRaw.weekStart,
    weekEnd: currentRaw.weekEnd,
    weekStartUtc: currentRaw.weekStartUtcIso,
    weekEndExclusiveUtc: currentRaw.weekEndExclusiveUtcIso,
    timezone: currentRaw.timezone,
    requestedTimezone: currentRaw.requestedTimezone,
    fallback: currentRaw.fallback as "none",
  };
  const prev = getPreviousWeekWindow(currentWindow);
  assert.equal(prev.weekEndExclusiveUtc, currentWindow.weekStartUtc);
  assert.equal(prev.timezone, "America/New_York");
});

test("adjacent windows DST spring forward week still adjacent", () => {
  // Week of 2026-03-08 is DST transition in NY (Mar 8 is Sunday, week Mon Mar 2 - Sun Mar 8)
  const currentRaw = getWeekWindow("America/New_York", "2026-03-09"); // Mon after DST
  const currentWindow = {
    weekOf: "2026-03-09",
    weekStart: currentRaw.weekStart,
    weekEnd: currentRaw.weekEnd,
    weekStartUtc: currentRaw.weekStartUtcIso,
    weekEndExclusiveUtc: currentRaw.weekEndExclusiveUtcIso,
    timezone: currentRaw.timezone,
    requestedTimezone: currentRaw.requestedTimezone,
    fallback: currentRaw.fallback as "none",
  };
  const prev = getPreviousWeekWindow(currentWindow);
  // Must still be adjacent even though DST week has 167h vs 168h
  assert.equal(prev.weekEndExclusiveUtc, currentWindow.weekStartUtc);
  // Verify duration reflects DST (prev week is DST week with 167h)
  const prevDurationMs = new Date(prev.weekEndExclusiveUtc).getTime() - new Date(prev.weekStartUtc).getTime();
  assert.equal(prevDurationMs, 7 * 24 * 3600000 - 3600000);
});

test("adjacent windows DST fall back still adjacent", () => {
  const currentRaw = getWeekWindow("America/New_York", "2026-11-02");
  const currentWindow = {
    weekOf: "2026-11-02",
    weekStart: currentRaw.weekStart,
    weekEnd: currentRaw.weekEnd,
    weekStartUtc: currentRaw.weekStartUtcIso,
    weekEndExclusiveUtc: currentRaw.weekEndExclusiveUtcIso,
    timezone: currentRaw.timezone,
    requestedTimezone: currentRaw.requestedTimezone,
    fallback: currentRaw.fallback as "none",
  };
  const prev = getPreviousWeekWindow(currentWindow);
  assert.equal(prev.weekEndExclusiveUtc, currentWindow.weekStartUtc);
  const prevDurationMs = new Date(prev.weekEndExclusiveUtc).getTime() - new Date(prev.weekStartUtc).getTime();
  assert.equal(prevDurationMs, 7 * 24 * 3600000 + 3600000);
});

// ---------------------------------------------------------------------------
// Integration: getWeeklyReviewReadModel comparison adjacent, historical, zero-den
// ---------------------------------------------------------------------------

test("comparison windows are adjacent and use identical timezone/boundary", async () => {
  const timeRepo = new FakeTimeContextRepo("UTC");
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 5, goalsTouched: [{ status: "active" }], completed: [{ id: "c1", title: "Done", status: "done", blockedReason: null, estimateMinutes: null, completedAt: "2026-01-13T10:00:00.000Z", updatedAt: "2026-01-13T10:00:00.000Z", projectName: null, goalTitle: null }] },
    { tasksCreated: 3, goalsTouched: [{ status: "active" }], completed: [] },
  );
  const evidenceRepo = new WindowAwareEvidenceRepo(
    [
      { id: "s1", task_id: "task-1", started_at: "2026-01-13T10:00:00.000Z", ended_at: "2026-01-13T11:00:00.000Z", duration_seconds: 3600, tasks: { id: "task-1", title: "Task" } },
    ],
    [],
  );

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: timeRepo,
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: tasksRepo,
      executionEvidence: evidenceRepo,
    },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const comp = result.data.comparison;
  assert.equal(comp.currentWindow.weekStart, "2026-01-12");
  assert.equal(comp.previousWindow.weekStart, "2026-01-05");
  assert.equal(comp.previousWindow.weekEndExclusiveUtc, comp.currentWindow.weekStartUtc);
  assert.equal(comp.currentWindow.timezone, "UTC");
  assert.equal(comp.previousWindow.timezone, "UTC");
  // Identical boundary rules: both derived via same getWeekWindow with same timezone
  assert.equal(comp.currentWindow.fallback, comp.previousWindow.fallback);
});

test("comparison metrics use same evidence source (canonical clipping)", async () => {
  // Session overlapping boundary: started before current window ends inside (30m inside)
  // Should be clipped, not counted fully, for both windows
  const evidenceRepo = new WindowAwareEvidenceRepo(
    [
      { id: "s-clip", task_id: "task-1", started_at: "2026-01-11T23:30:00.000Z", ended_at: "2026-01-12T00:30:00.000Z", duration_seconds: 3600, tasks: { id: "task-1", title: "Clip" } },
    ],
    [
      { id: "s-prev", task_id: "task-1", started_at: "2026-01-06T10:00:00.000Z", ended_at: "2026-01-06T11:00:00.000Z", duration_seconds: 3600, tasks: { id: "task-1", title: "Prev" } },
    ],
  );
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 2, goalsTouched: [], completed: [] },
    { tasksCreated: 1, goalsTouched: [], completed: [] },
  );

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Current window 2026-01-12T00:00Z to 2026-01-19T00:00Z, clipped session should be 30m = 1800s
  assert.equal(result.data.evidence.totalTrackedSeconds, 1800);
  assert.equal(result.data.comparison.metrics.trackedSeconds.current, 1800);
  // Previous window's evidence should be 1h = 3600
  assert.equal(result.data.comparison.metrics.trackedSeconds.previous, 3600);
  assert.equal(result.data.comparison.metrics.trackedSeconds.delta, -1800);
});

test("zero denominator safe: previous zero yields delta but percent null (not fake 0%)", async () => {
  const evidenceRepo = new WindowAwareEvidenceRepo(
    [
      { id: "s1", task_id: "t1", started_at: "2026-01-13T10:00:00.000Z", ended_at: "2026-01-13T11:00:00.000Z", duration_seconds: 3600, tasks: { id: "t1", title: "Task" } },
    ],
    [],
  );
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 4, goalsTouched: [{ status: "active" }, { status: "done" }], completed: [{ id: "c1", title: "Done", status: "done", blockedReason: null, estimateMinutes: null, completedAt: "2026-01-13T10:00:00.000Z", updatedAt: "2026-01-13T10:00:00.000Z", projectName: null, goalTitle: null }] },
    { tasksCreated: 0, goalsTouched: [], completed: [] },
  );

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const m = result.data.comparison.metrics;
  // trackedSeconds previous 0 => percent null explicitly, not 0%
  assert.equal(m.trackedSeconds.previous, 0);
  assert.equal(m.trackedSeconds.delta, 3600);
  assert.equal(m.trackedSeconds.percentChange, null);
  // tasksCreated previous 0
  assert.equal(m.tasksCreated.previous, 0);
  assert.equal(m.tasksCreated.delta, 4);
  assert.equal(m.tasksCreated.percentChange, null);
  // goalsTouched previous 0
  assert.equal(m.goalsTouched.previous, 0);
  assert.equal(m.goalsTouched.percentChange, null);
  // sessionCount previous 0
  assert.equal(m.sessionCount.previous, 0);
  assert.equal(m.sessionCount.percentChange, null);
});

test("first-week/no-data: previous all zero, current also zero still percent null", async () => {
  const evidenceRepo = new WindowAwareEvidenceRepo([], []);
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 0, goalsTouched: [], completed: [] },
    { tasksCreated: 0, goalsTouched: [], completed: [] },
  );
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const m = result.data.comparison.metrics;
  assert.equal(m.trackedSeconds.current, 0);
  assert.equal(m.trackedSeconds.previous, 0);
  assert.equal(m.trackedSeconds.delta, 0);
  assert.equal(m.trackedSeconds.percentChange, null);
});

test("historical reviews compare against own previous week not current calendar week", async () => {
  const timeRepo = new FakeTimeContextRepo("UTC");
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 7, goalsTouched: [], completed: [] },
    { tasksCreated: 5, goalsTouched: [], completed: [] },
  );
  const evidenceRepo = new WindowAwareEvidenceRepo([], []);

  const nowCurrent = new Date("2026-05-01T12:00:00.000Z");
  const historicalWeek = "2026-01-12";

  const result1 = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: timeRepo, weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: historicalWeek, now: nowCurrent },
  );
  assert.equal(result1.ok, true);
  if (!result1.ok) return;
  assert.equal(result1.data.comparison.currentWindow.weekStart, "2026-01-12");
  assert.equal(result1.data.comparison.previousWindow.weekStart, "2026-01-05");

  // With a different now but same weekOf, previous must still be same
  const nowLater = new Date("2026-06-15T08:00:00.000Z");
  // Need fresh repos because window-aware fakes capture state per call
  const tasksRepo2 = new WindowAwareFakeTasksRepo(
    { tasksCreated: 7, goalsTouched: [], completed: [] },
    { tasksCreated: 5, goalsTouched: [], completed: [] },
  );
  const evidenceRepo2 = new WindowAwareEvidenceRepo([], []);
  const result2 = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: new FakeTimeContextRepo("UTC"), weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo2, executionEvidence: evidenceRepo2 },
    { weekOf: historicalWeek, now: nowLater },
  );
  assert.equal(result2.ok, true);
  if (!result2.ok) return;
  assert.deepEqual(result1.data.comparison.currentWindow, result2.data.comparison.currentWindow);
  assert.deepEqual(result1.data.comparison.previousWindow, result2.data.comparison.previousWindow);
});

test("timezone boundary: America/New_York week windows adjacent correctly via comparison", async () => {
  const timeRepo = new FakeTimeContextRepo("America/New_York");
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 2, goalsTouched: [], completed: [] },
    { tasksCreated: 1, goalsTouched: [], completed: [] },
  );
  const evidenceRepo = new WindowAwareEvidenceRepo([], []);

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: timeRepo, weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: "2026-01-15" }, // Thursday, should resolve to week 2026-01-12
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const comp = result.data.comparison;
  assert.equal(comp.currentWindow.weekStart, "2026-01-12");
  assert.equal(comp.currentWindow.timezone, "America/New_York");
  assert.equal(comp.previousWindow.timezone, "America/New_York");
  assert.equal(comp.previousWindow.weekEndExclusiveUtc, comp.currentWindow.weekStartUtc);
  // NY offset in Jan is -5, so weekStartUtc should be 05:00Z
  assert.equal(comp.currentWindow.weekStartUtc, "2026-01-12T05:00:00.000Z");
  assert.equal(comp.previousWindow.weekEndExclusiveUtc, "2026-01-12T05:00:00.000Z");
  assert.equal(comp.previousWindow.weekStartUtc, "2026-01-05T05:00:00.000Z");
});

test("timezone fallback preserves requestedTimezone in both windows", async () => {
  const timeRepo = new FakeTimeContextRepo("Invalid/Zone");
  const tasksRepo = new WindowAwareFakeTasksRepo(
    { tasksCreated: 1, goalsTouched: [], completed: [] },
    { tasksCreated: 0, goalsTouched: [], completed: [] },
  );
  const evidenceRepo = new WindowAwareEvidenceRepo([], []);
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    { timeContext: timeRepo, weeklyReview: new FakeWeeklyReviewRepo(), weeklyTasks: tasksRepo, executionEvidence: evidenceRepo },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.comparison.currentWindow.fallback, "invalid_timezone");
  assert.equal(result.data.comparison.previousWindow.fallback, "invalid_timezone");
  assert.equal(result.data.comparison.currentWindow.requestedTimezone, "Invalid/Zone");
  assert.equal(result.data.comparison.previousWindow.requestedTimezone, "Invalid/Zone");
  assert.equal(result.data.comparison.currentWindow.timezone, "UTC");
  assert.equal(result.data.comparison.previousWindow.timezone, "UTC");
});

test("buildWeeklyReviewComparison helper zero-den and normal", () => {
  const currentWindow = {
    weekOf: "2026-01-12",
    weekStart: "2026-01-12",
    weekEnd: "2026-01-18",
    weekStartUtc: "2026-01-12T00:00:00.000Z",
    weekEndExclusiveUtc: "2026-01-19T00:00:00.000Z",
    timezone: "UTC",
    requestedTimezone: null,
    fallback: "none" as const,
  };
  const previousWindow = {
    weekOf: "2026-01-05",
    weekStart: "2026-01-05",
    weekEnd: "2026-01-11",
    weekStartUtc: "2026-01-05T00:00:00.000Z",
    weekEndExclusiveUtc: "2026-01-12T00:00:00.000Z",
    timezone: "UTC",
    requestedTimezone: null,
    fallback: "none" as const,
  };
  const comp = buildWeeklyReviewComparison({
    currentWindow,
    previousWindow,
    current: { trackedSeconds: 7200, sessionCount: 3, tasksCreated: 5, goalsTouched: 2, completedTasks: 4 },
    previous: { trackedSeconds: 3600, sessionCount: 2, tasksCreated: 5, goalsTouched: 0, completedTasks: 2 },
  });
  assert.equal(comp.metrics.trackedSeconds.delta, 3600);
  assert.equal(comp.metrics.trackedSeconds.percentChange, 100);
  assert.equal(comp.metrics.tasksCreated.delta, 0);
  assert.equal(comp.metrics.tasksCreated.percentChange, 0);
  assert.equal(comp.metrics.goalsTouched.previous, 0);
  assert.equal(comp.metrics.goalsTouched.percentChange, null);
});

test("missing previous null represented explicitly (delta/percent null)", () => {
  const currentWindow = {
    weekOf: "2026-01-12",
    weekStart: "2026-01-12",
    weekEnd: "2026-01-18",
    weekStartUtc: "2026-01-12T00:00:00.000Z",
    weekEndExclusiveUtc: "2026-01-19T00:00:00.000Z",
    timezone: "UTC",
    requestedTimezone: null,
    fallback: "none" as const,
  };
  const previousWindow = {
    weekOf: "2026-01-05",
    weekStart: "2026-01-05",
    weekEnd: "2026-01-11",
    weekStartUtc: "2026-01-05T00:00:00.000Z",
    weekEndExclusiveUtc: "2026-01-12T00:00:00.000Z",
    timezone: "UTC",
    requestedTimezone: null,
    fallback: "none" as const,
  };
  const comp = buildWeeklyReviewComparison({
    currentWindow,
    previousWindow,
    current: { trackedSeconds: 100, sessionCount: 1, tasksCreated: 1, goalsTouched: 1, completedTasks: 1 },
    previous: null,
  });
  assert.equal(comp.metrics.trackedSeconds.previous, null);
  assert.equal(comp.metrics.trackedSeconds.delta, null);
  assert.equal(comp.metrics.trackedSeconds.percentChange, null);
});
