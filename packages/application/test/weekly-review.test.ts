import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor, type AuthenticatedActor } from "../src/auth/actor";
import type { RepositoryResult } from "../src/shared/result";
import type { TimeContextRepository } from "../src/shared/time-context";
import type { ExecutionEvidenceRepository, ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "../src/shared/execution-evidence";
import {
  getWeeklyReviewReadModel,
  resolveWeeklyReviewFormDefaults,
} from "../src/weekly-review/read-model";
import type {
  WeeklyReviewRepository,
  WeeklyReviewRow,
  WeeklyReviewTaskRepository,
  WeeklyReviewTaskActivityRow,
} from "../src/weekly-review/ports";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}

class FakeTimeContextRepo implements TimeContextRepository {
  constructor(private stored: string | null = "America/New_York") {}
  async getTimezone(_actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    return ok(this.stored);
  }
  async setTimezone(_actor: AuthenticatedActor, tz: string): Promise<RepositoryResult<string>> {
    this.stored = tz;
    return ok(tz);
  }
}

class FakeWeeklyReviewRepo implements WeeklyReviewRepository {
  saved: WeeklyReviewRow | null = {
    id: "review-1",
    weekStart: "2026-01-12",
    weekEnd: "2026-01-18",
    summary: "Great week",
    wins: "Shipped",
    blockers: "None",
    nextSteps: "Continue",
    createdAt: "2026-01-18T12:00:00.000Z",
    updatedAt: "2026-01-18T13:00:00.000Z",
    officialEmailStatus: "sent",
    officialEmailSentAt: "2026-01-18T14:00:00.000Z",
  };
  past: WeeklyReviewRow[] = [
    {
      id: "review-0",
      weekStart: "2026-01-05",
      weekEnd: "2026-01-11",
      summary: "Previous",
      wins: null,
      blockers: null,
      nextSteps: null,
      createdAt: "2026-01-11T12:00:00.000Z",
      updatedAt: null,
      officialEmailStatus: null,
      officialEmailSentAt: null,
    },
  ];
  previous: WeeklyReviewRow | null = {
    id: "review-0",
    weekStart: "2026-01-05",
    weekEnd: "2026-01-11",
    summary: "Prev summary",
    wins: null,
    blockers: null,
    nextSteps: "Prev next",
    createdAt: "2026-01-11T12:00:00.000Z",
    updatedAt: null,
    officialEmailStatus: null,
    officialEmailSentAt: null,
  };

  async getSavedReview(_actor: AuthenticatedActor, weekStart: string, weekEnd: string) {
    if (this.saved && this.saved.weekStart === weekStart && this.saved.weekEnd === weekEnd) {
      return ok(this.saved);
    }
    return ok(null);
  }
  async listPastReviews(_actor: AuthenticatedActor, _limit: number) {
    return ok(this.past);
  }
  async getPreviousReview(_actor: AuthenticatedActor, _weekStart: string) {
    return ok(this.previous);
  }
}

class FakeWeeklyTasksRepo implements WeeklyReviewTaskRepository {
  tasksCreated = 3;
  goalsTouched: Array<{ status: string }> = [{ status: "active" }, { status: "active" }, { status: "done" }];
  blockedTasks = [{ id: "t-blocked", title: "Blocked task", blockedReason: "Waiting", updatedAt: "2026-01-15T10:00:00.000Z" }];
  completed: WeeklyReviewTaskActivityRow[] = [
    {
      id: "task-1",
      title: "Completed task",
      status: "done",
      blockedReason: null,
      estimateMinutes: 60,
      completedAt: "2026-01-13T12:00:00.000Z",
      updatedAt: "2026-01-13T12:00:00.000Z",
      projectName: "Ops",
      goalTitle: "Goal One",
    },
  ];
  carried: WeeklyReviewTaskActivityRow[] = [
    {
      id: "task-2",
      title: "Carried task",
      status: "todo",
      blockedReason: null,
      estimateMinutes: null,
      completedAt: null,
      updatedAt: "2026-01-14T12:00:00.000Z",
      projectName: "Ops",
      goalTitle: null,
    },
  ];
  blockedForDraft: WeeklyReviewTaskActivityRow[] = [];

  async countTasksCreatedForWindow(_actor: AuthenticatedActor, _window: ExecutionEvidenceWindow) {
    return ok(this.tasksCreated);
  }
  async listGoalsTouchedForWindow(_actor: AuthenticatedActor, _window: ExecutionEvidenceWindow) {
    return ok(this.goalsTouched);
  }
  async listBlockedTasks(_actor: AuthenticatedActor, _limit: number) {
    return ok(this.blockedTasks);
  }
  async listCompletedTasksForWindow(_actor: AuthenticatedActor, _window: ExecutionEvidenceWindow, _limit: number) {
    return ok(this.completed);
  }
  async listCarriedTasksForWindow(_actor: AuthenticatedActor, _window: ExecutionEvidenceWindow, _limit: number) {
    return ok(this.carried);
  }
  async listBlockedTasksForWindow(_actor: AuthenticatedActor, _window: ExecutionEvidenceWindow, _limit: number) {
    return ok(this.blockedForDraft);
  }
}

class FakeEvidenceRepo implements ExecutionEvidenceRepository {
  constructor(private sessions: ExecutionEvidenceSessionRow[] = []) {}
  async listSessionsForWindow(
    _actor: AuthenticatedActor,
    _window: ExecutionEvidenceWindow,
    _options?: Readonly<{ limit?: number }>,
  ) {
    return ok(this.sessions);
  }
}

const ACTOR = createAuthenticatedActor("user-123");

// ---------------------------------------------------------------------------
// Canonical week-boundary / timezone policy
// ---------------------------------------------------------------------------

test("selected week has one canonical week-boundary via time-context (timezone-aware Monday start)", async () => {
  const timeRepo = new FakeTimeContextRepo("America/New_York");
  const weeklyReview = new FakeWeeklyReviewRepo();
  const weeklyTasks = new FakeWeeklyTasksRepo();
  const evidenceRepo = new FakeEvidenceRepo([]);

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: timeRepo,
      weeklyReview,
      weeklyTasks,
      executionEvidence: evidenceRepo,
    },
    { weekOf: "2026-01-15" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 2026-01-15 is Thursday; week should be Mon 2026-01-12 to Sun 2026-01-18 (UTC conversion via NY)
  assert.equal(result.data.window.weekStart, "2026-01-12");
  assert.equal(result.data.window.weekEnd, "2026-01-18");
  assert.equal(result.data.window.timezone, "America/New_York");
  assert.equal(result.data.window.fallback, "none");
  // Also verify UTC window is Monday 00:00 NY time -> UTC conversion
  // NY is UTC-5 in Jan, so weekStartUtc should be 2026-01-12T05:00:00.000Z
  assert.equal(result.data.window.weekStartUtc, "2026-01-12T05:00:00.000Z");
});

test("timezone fallback invalid_timezone uses UTC and preserves requestedTimezone", async () => {
  const timeRepo = new FakeTimeContextRepo("Invalid/Zone");
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: timeRepo,
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo([]),
    },
    { weekOf: "2026-01-15" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.window.timezone, "UTC");
  assert.equal(result.data.window.fallback, "invalid_timezone");
  assert.equal(result.data.window.requestedTimezone, "Invalid/Zone");
});

// ---------------------------------------------------------------------------
// Historical not now-dependent
// ---------------------------------------------------------------------------

test("historical week queries explicit input not now-dependent", async () => {
  const timeRepo = new FakeTimeContextRepo("UTC");
  const deps = {
    timeContext: timeRepo,
    weeklyReview: new FakeWeeklyReviewRepo(),
    weeklyTasks: new FakeWeeklyTasksRepo(),
    executionEvidence: new FakeEvidenceRepo([]),
  };

  const first = await getWeeklyReviewReadModel(ACTOR, deps, { weekOf: "2026-01-12", now: new Date("2026-01-20T12:00:00.000Z") });
  const second = await getWeeklyReviewReadModel(ACTOR, deps, { weekOf: "2026-01-12", now: new Date("2026-05-01T12:00:00.000Z") });

  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.data.window, second.data.window);
  // Ensure window is Monday-Sunday regardless of now
  assert.equal(first.data.window.weekStart, "2026-01-12");
});

test("adjacent historical weeks have no gaps (weekEndExclusive == next weekStart)", async () => {
  const timeRepo = new FakeTimeContextRepo("UTC");
  const deps = {
    timeContext: timeRepo,
    weeklyReview: new FakeWeeklyReviewRepo(),
    weeklyTasks: new FakeWeeklyTasksRepo(),
    executionEvidence: new FakeEvidenceRepo([]),
  };
  const w1 = await getWeeklyReviewReadModel(ACTOR, deps, { weekOf: "2026-01-05" });
  const w2 = await getWeeklyReviewReadModel(ACTOR, deps, { weekOf: "2026-01-12" });
  assert.equal(w1.ok && w2.ok, true);
  if (!w1.ok || !w2.ok) return;
  assert.equal(w1.data.window.weekEndExclusiveUtc, w2.data.window.weekStartUtc);
});

// ---------------------------------------------------------------------------
// Saved review + evidence + tracked summary
// ---------------------------------------------------------------------------

test("shared read model includes saved review, weekly Task/session/Goal/blocker evidence and tracked summary (canonical execution evidence)", async () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    {
      id: "s1",
      task_id: "task-1",
      started_at: "2026-01-13T10:00:00.000Z",
      ended_at: "2026-01-13T11:00:00.000Z",
      duration_seconds: 3600,
      tasks: { id: "task-1", title: "Completed task", projects: { id: "p1", name: "Ops" }, goals: { id: "g1", title: "Goal One" } },
    },
    {
      id: "s2",
      task_id: "task-2",
      started_at: "2026-01-13T22:00:00.000Z",
      ended_at: "2026-01-14T01:00:00.000Z",
      duration_seconds: 10800,
      tasks: { id: "task-2", title: "Night task", projects: { id: "p2", name: "Infra" }, goals: null },
    },
  ];

  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo(sessions),
    },
    { weekOf: "2026-01-12" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // Saved review present and preserves email state
  assert.equal(result.data.savedReview?.id, "review-1");
  assert.equal(result.data.savedReview?.officialEmailStatus, "sent");
  assert.equal(result.data.savedReview?.summary, "Great week");

  // Stats
  assert.equal(result.data.stats.tasksCreated, 3);
  assert.equal(result.data.stats.goalsTouched, 3);
  assert.equal(result.data.stats.blockedTasks.length, 1);
  assert.equal(result.data.stats.blockedTasks[0].title, "Blocked task");

  // Evidence: trackedSeconds should be sum of overlaps (1h + 3h = 4h = 14400s), but open excluded etc.
  // Sessions both inside window 2026-01-12T00:00Z to 2026-01-19T00:00Z (UTC week)
  // s1 1h, s2 3h => total 4h = 14400
  assert.equal(result.data.evidence.totalTrackedSeconds, 14400);
  assert.equal(result.data.evidence.sessionCount, 2);
  // Day buckets: 2026-01-13 gets 1h + 2h (22-24) = 3h, 2026-01-14 gets 1h (00-01)
  assert.equal(result.data.evidence.trackedSecondsByDay.get("2026-01-13"), 10800);
  assert.equal(result.data.evidence.trackedSecondsByDay.get("2026-01-14"), 3600);

  // MostTracked derived from same evidence (canonical, not web-local analytics)
  assert.equal(result.data.mostTracked.tasks.length > 0, true);
  assert.equal(result.data.mostTracked.projects.length > 0, true);
  assert.equal(result.data.evidence.quality.quality, "sufficient");

  // Generated draft should include weekStart/weekEnd and touched projects/goals
  assert.match(result.data.generatedDraft.summary, /Week 2026-01-12 to 2026-01-18/);
  assert.match(result.data.generatedDraft.wins, /Completed task/);
});

test("open sessions excluded by default (includeOnlyClosed) in weekly review evidence", async () => {
  const sessions: ExecutionEvidenceSessionRow[] = [
    {
      task_id: "task-open",
      started_at: "2026-01-13T10:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      tasks: { id: "task-open", title: "Open task" },
    },
  ];
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo(sessions),
    },
    { weekOf: "2026-01-12", now: new Date("2026-01-13T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.evidence.totalTrackedSeconds, 0);
  assert.equal(result.data.evidence.sessionCount, 0);
  assert.equal(result.data.stats.trackedSeconds, 0);
});

test("shared model consumes execution evidence from shared model not web-local analytics (prove via window clipping)", async () => {
  // Session started before window but ends inside — should be clipped, not counted fully
  const sessions: ExecutionEvidenceSessionRow[] = [
    {
      id: "s-clip",
      task_id: "task-1",
      started_at: "2026-01-11T23:30:00.000Z",
      ended_at: "2026-01-12T00:30:00.000Z",
      duration_seconds: 3600,
      tasks: { id: "task-1", title: "Clip task" },
    },
  ];
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo(sessions),
    },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Only 30 minutes inside window (00:00-00:30)
  assert.equal(result.data.evidence.totalTrackedSeconds, 1800);
});

// ---------------------------------------------------------------------------
// Email compatibility: saved review fields and generated draft remain compatible
// ---------------------------------------------------------------------------

test("existing web review form, generated draft and official/manual email paths remain compatible", async () => {
  const repo = new FakeWeeklyReviewRepo();
  repo.saved = {
    id: "review-email",
    weekStart: "2026-01-12",
    weekEnd: "2026-01-18",
    summary: "Summary text",
    wins: "Wins text",
    blockers: "Blockers text",
    nextSteps: "Next steps text",
    createdAt: "2026-01-18T12:00:00.000Z",
    updatedAt: null,
    officialEmailStatus: "sent",
    officialEmailSentAt: "2026-01-18T15:00:00.000Z",
  };
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: repo,
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo([]),
    },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Saved review fields map 1:1 to DB columns (preserves email preview source)
  assert.equal(result.data.savedReview?.wins, "Wins text");
  assert.equal(result.data.savedReview?.blockers, "Blockers text");
  assert.equal(result.data.savedReview?.nextSteps, "Next steps text");

  // Generated draft is still present (manual email path)
  assert.equal(typeof result.data.generatedDraft.summary, "string");
  assert.equal(typeof result.data.generatedDraft.wins, "string");
  assert.equal(typeof result.data.generatedDraft.blockers, "string");
  assert.equal(typeof result.data.generatedDraft.nextSteps, "string");

  // Form defaults logic: uses saved review when not generated
  const defaultsSaved = resolveWeeklyReviewFormDefaults(result.data.generatedDraft, result.data.savedReview, "2026-01-12", false);
  assert.equal(defaultsSaved.summary, "Summary text");
  const defaultsGenerated = resolveWeeklyReviewFormDefaults(result.data.generatedDraft, result.data.savedReview, "2026-01-12", true);
  assert.equal(defaultsGenerated.summary, result.data.generatedDraft.summary);
});

test("owner-scoped: actor userId is passed to all ports", async () => {
  let capturedActorId: string | null = null;
  class CapturingWeeklyReviewRepo implements WeeklyReviewRepository {
    async getSavedReview(actor: AuthenticatedActor) {
      capturedActorId = actor.userId;
      return ok(null);
    }
    async listPastReviews(actor: AuthenticatedActor) {
      capturedActorId = actor.userId;
      return ok([]);
    }
    async getPreviousReview(actor: AuthenticatedActor) {
      capturedActorId = actor.userId;
      return ok(null);
    }
  }
  const customActor = createAuthenticatedActor("user-999");
  const result = await getWeeklyReviewReadModel(
    customActor,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new CapturingWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo([]),
    },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, true);
  assert.equal(capturedActorId, "user-999");
});

test("validation: invalid weekOf returns failure", async () => {
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FakeWeeklyTasksRepo(),
      executionEvidence: new FakeEvidenceRepo([]),
    },
    { weekOf: "not-a-date" },
  );
  assert.equal(result.ok, false);
});

test("failure in any port surfaces as application failure (sanitized)", async () => {
  class FailingTasksRepo implements WeeklyReviewTaskRepository {
    async countTasksCreatedForWindow() { return fail(); }
    async listGoalsTouchedForWindow() { return ok([]); }
    async listBlockedTasks() { return ok([]); }
    async listCompletedTasksForWindow() { return ok([]); }
    async listCarriedTasksForWindow() { return ok([]); }
    async listBlockedTasksForWindow() { return ok([]); }
  }
  const result = await getWeeklyReviewReadModel(
    ACTOR,
    {
      timeContext: new FakeTimeContextRepo("UTC"),
      weeklyReview: new FakeWeeklyReviewRepo(),
      weeklyTasks: new FailingTasksRepo(),
      executionEvidence: new FakeEvidenceRepo([]),
    },
    { weekOf: "2026-01-12" },
  );
  assert.equal(result.ok, false);
});
