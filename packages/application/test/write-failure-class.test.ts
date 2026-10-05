import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveGoal,
  archiveProject,
  clearCompletedToday,
  createAuthenticatedActor,
  createGoal,
  createProject,
  planTaskForToday,
  removeTaskFromToday,
  startTaskSession,
  stopTaskSession,
  unarchiveGoal,
  unarchiveProject,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
  updateProjectStatus,
  updateTodayTaskStatus,
  type CreateGoalRecordInput,
  type CreateProjectRecordInput,
  type GoalsRepository,
  type ProjectsRepository,
  type RepositoryResult,
  type StartableTask,
  type TaskRecord,
  type TimerSessionRecord,
  type TimerSessionRepository,
  type TodayTaskRepository,
} from "../src/index";

/**
 * The MCP write transport decides whether a failed mutation is retryable from
 * the CLASS the use case asserts on its ApplicationResult, and nothing else.
 * Every use case an advertised ega_* write tool delegates to therefore has to
 * forward the repository's class. When it did not, every dependency failure
 * looked like a validation rejection, and 0058 froze it as a FAILED_FINAL
 * receipt that replays forever under the same operationId.
 *
 * These assertions are at the canonical layer on purpose: fixing only the
 * transport would leave the class absent here, so the same freeze would return
 * the first time a use case was reached from anywhere else.
 */

const ACTOR = createAuthenticatedActor("user-123");

function unknownFailure<T = never>(): RepositoryResult<T> {
  return { ok: false, error: { code: "unknown" } };
}

function conflictFailure<T = never>(): RepositoryResult<T> {
  return { ok: false, error: { code: "conflict" } };
}

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function classOf(result: { ok: boolean; code?: string }): string | undefined {
  return result.ok ? undefined : result.code;
}

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------

class FakeProjectsRepository {
  calls: Array<{ method: string }> = [];
  createResult: RepositoryResult<null> = ok(null);
  updateResult: RepositoryResult<null> = ok(null);

  async listProjects() { return ok([]); }
  async listProjectStatuses() { return ok([]); }
  async createProject(_actor: unknown, _input: CreateProjectRecordInput) {
    this.calls.push({ method: "createProject" });
    return this.createResult;
  }
  async updateProjectStatus(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "updateProjectStatus" });
    return this.updateResult;
  }
}

test("project mutations forward the repository class, not a bare message", async () => {
  const fake = new FakeProjectsRepository();
  const repository = fake as unknown as ProjectsRepository;
  fake.createResult = unknownFailure();
  fake.updateResult = unknownFailure();

  const created = await createProject(ACTOR, repository, {
    name: "A project",
    slug: "a-project",
    description: "",
    mcpOperationId: "op-1",
    mcpClientId: "client-1",
  });
  assert.equal(classOf(created as { ok: boolean; code?: string }), "unknown");

  const updated = await updateProjectStatus(ACTOR, repository, { projectId: "project-1", status: "paused" });
  assert.equal(classOf(updated as { ok: boolean; code?: string }), "unknown");

  fake.createResult = conflictFailure();
  const conflict = await createProject(ACTOR, repository, {
    name: "A project",
    slug: "a-project",
    description: "",
    mcpOperationId: "op-2",
    mcpClientId: "client-1",
  });
  assert.equal(classOf(conflict as { ok: boolean; code?: string }), "conflict");
});

test("project archive and unarchive forward the repository class", async () => {
  const fake = new FakeProjectsRepository();
  const repository = fake as unknown as ProjectsRepository;
  fake.updateResult = unknownFailure();

  const archived = await archiveProject(ACTOR, repository, { projectId: "project-1" });
  assert.equal(classOf(archived as { ok: boolean; code?: string }), "unknown");

  const unarchived = await unarchiveProject(ACTOR, repository, { projectId: "project-1" });
  assert.equal(classOf(unarchived as { ok: boolean; code?: string }), "unknown");
});

test("a project validation rejection stays unclassed, so it stays permanent", async () => {
  const fake = new FakeProjectsRepository();
  const repository = fake as unknown as ProjectsRepository;

  const result = await updateProjectStatus(ACTOR, repository, { projectId: "project-1", status: "sideways" });

  assert.equal(result.ok, false);
  assert.equal(classOf(result as { ok: boolean; code?: string }), undefined);
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------

class FakeGoalsRepository {
  calls: Array<{ method: string }> = [];
  createResult: RepositoryResult<null> = ok(null);
  updateResult: RepositoryResult<null> = ok(null);

  async listProjectOptions() { return ok([]); }
  async listGoals() { return ok([]); }
  async listGoalTasks() { return ok([]); }
  async listGoalStatuses() { return ok([]); }
  async createGoal(_actor: unknown, _input: CreateGoalRecordInput) {
    this.calls.push({ method: "createGoal" });
    return this.createResult;
  }
  async updateGoalStatus(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "updateGoalStatus" });
    return this.updateResult;
  }
  async updateGoalHealth(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "updateGoalHealth" });
    return this.updateResult;
  }
  async updateGoalNextStep(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "updateGoalNextStep" });
    return this.updateResult;
  }
}

test("goal mutations forward the repository class, not a bare message", async () => {
  const fake = new FakeGoalsRepository();
  const repository = fake as unknown as GoalsRepository;
  fake.createResult = unknownFailure();
  fake.updateResult = unknownFailure();

  const created = await createGoal(ACTOR, repository, {
    title: "A goal",
    projectId: "project-1",
    description: "",
    nextStep: "",
    health: "",
    status: "draft",
    slug: "",
    mcpOperationId: "op-1",
    mcpClientId: "client-1",
  });
  assert.equal(classOf(created as { ok: boolean; code?: string }), "unknown");

  assert.equal(classOf(await updateGoalStatus(ACTOR, repository, { goalId: "goal-1", status: "active" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await updateGoalHealth(ACTOR, repository, { goalId: "goal-1", health: "on_track" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await updateGoalNextStep(ACTOR, repository, { goalId: "goal-1", nextStep: "step" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await archiveGoal(ACTOR, repository, { goalId: "goal-1" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await unarchiveGoal(ACTOR, repository, { goalId: "goal-1" }) as { ok: boolean; code?: string }), "unknown");

  fake.createResult = conflictFailure();
  const conflict = await createGoal(ACTOR, repository, {
    title: "A goal",
    projectId: "project-1",
    description: "",
    nextStep: "",
    health: "",
    status: "draft",
    slug: "",
    mcpOperationId: "op-2",
    mcpClientId: "client-1",
  });
  assert.equal(classOf(conflict as { ok: boolean; code?: string }), "conflict");
});

test("a goal validation rejection stays unclassed, so it stays permanent", async () => {
  const fake = new FakeGoalsRepository();
  const repository = fake as unknown as GoalsRepository;

  const result = await updateGoalStatus(ACTOR, repository, { goalId: "goal-1", status: "sideways" });

  assert.equal(result.ok, false);
  assert.equal(classOf(result as { ok: boolean; code?: string }), undefined);
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// today
// ---------------------------------------------------------------------------

class FakeTodayRepository {
  calls: Array<{ method: string }> = [];
  plannedResult: RepositoryResult<TaskRecord> = ok({} as TaskRecord);
  statusResult: RepositoryResult<TaskRecord> = ok({} as TaskRecord);
  clearResult: RepositoryResult<number> = ok(0);

  async setPlannedDate(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "setPlannedDate" });
    return this.plannedResult;
  }
  async setStatus(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "setStatus" });
    return this.statusResult;
  }
  async clearCompletedPlannedDate(_actor: unknown, _input: unknown) {
    this.calls.push({ method: "clearCompletedPlannedDate" });
    return this.clearResult;
  }
}

test("today mutations forward the repository class", async () => {
  const fake = new FakeTodayRepository();
  const repository = fake as unknown as TodayTaskRepository;
  fake.plannedResult = unknownFailure();
  fake.statusResult = unknownFailure();
  fake.clearResult = unknownFailure();

  assert.equal(classOf(await planTaskForToday(ACTOR, repository, { taskId: "task-1", date: "2026-09-02" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await removeTaskFromToday(ACTOR, repository, { taskId: "task-1" }) as { ok: boolean; code?: string }), "unknown");
  assert.equal(classOf(await updateTodayTaskStatus(ACTOR, repository, { taskId: "task-1", status: "done" }) as { ok: boolean; code?: string }), "unknown");

  fake.clearResult = conflictFailure();
  const conflict = await clearCompletedToday(ACTOR, repository, { date: "2026-09-02" });
  assert.equal(classOf(conflict as { ok: boolean; code?: string }), "conflict");
});

test("a today validation rejection stays unclassed, so it stays permanent", async () => {
  const fake = new FakeTodayRepository();
  const repository = fake as unknown as TodayTaskRepository;

  const result = await planTaskForToday(ACTOR, repository, { taskId: "task-1", date: "not-a-date" });

  assert.equal(result.ok, false);
  assert.equal(classOf(result as { ok: boolean; code?: string }), undefined);
  assert.equal(fake.calls.length, 0);
});

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------

class FakeTimerRepository {
  sessions: TimerSessionRecord[] = [];
  openListResult: RepositoryResult<TimerSessionRecord[]> = ok([]);
  startableTask: StartableTask | null = { eligible: true, reason: null, taskTitle: "Seeded task" };
  finalizeResult: RepositoryResult<boolean> = ok(true);

  async listOpenSessions() { return this.openListResult; }
  async listRecentSessions() { return ok([]); }
  async getStartableTask() { return ok(this.startableTask); }
  async findSessionByOperation() { return ok(null); }
  async insertOpenSession() { return unknownFailure<TimerSessionRecord>(); }
  async finalizeOpenSession() { return this.finalizeResult; }
}

class FakeTimeContextRepository {
  async resolveTimezone() { return ok("UTC"); }
  async setTimezone(_actor: unknown, timezone: string) { return ok(timezone); }
}

test("timer start and stop forward the repository class", async () => {
  const fake = new FakeTimerRepository();
  const repository = fake as unknown as TimerSessionRepository;

  const started = await startTaskSession(ACTOR, repository, {
    taskId: "task-1",
    mcpOperationId: "op-1",
    mcpClientId: "client-1",
  });
  assert.equal(classOf(started as { ok: boolean; code?: string }), "unknown");

  fake.openListResult = unknownFailure();
  const stopped = await stopTaskSession(ACTOR, repository, { sessionId: "session-1" });
  assert.equal(classOf(stopped as { ok: boolean; code?: string }), "unknown");
});

test("a timer business outcome is classed, not left to message matching", async () => {
  const fake = new FakeTimerRepository();
  const repository = fake as unknown as TimerSessionRepository;

  fake.startableTask = null;
  const unavailable = await startTaskSession(ACTOR, repository, { taskId: "task-1" });
  assert.equal(classOf(unavailable as { ok: boolean; code?: string }), "notFound");

  fake.startableTask = { eligible: false, reason: "Task is archived.", taskTitle: "Seeded task" };
  const ineligible = await startTaskSession(ACTOR, repository, { taskId: "task-1" });
  assert.equal(classOf(ineligible as { ok: boolean; code?: string }), "validation");

  const noSession = await stopTaskSession(ACTOR, repository, { sessionId: "session-1" });
  assert.equal(classOf(noSession as { ok: boolean; code?: string }), "notFound");

  fake.openListResult = ok([
    { id: "session-1", taskId: "task-1", startedAt: "2026-09-02T08:00:00.000Z", endedAt: null, durationSeconds: null, taskTitle: "Seeded task" },
  ]);
  fake.finalizeResult = ok(false);
  const closed = await stopTaskSession(ACTOR, repository, { sessionId: "session-1" });
  assert.equal(classOf(closed as { ok: boolean; code?: string }), "conflict");
});

test("a timer validation rejection is classed as validation, so it stays permanent", async () => {
  const repository = new FakeTimerRepository() as unknown as TimerSessionRepository;

  const result = await startTaskSession(ACTOR, repository, { taskId: "" });

  assert.equal(result.ok, false);
  assert.equal(classOf(result as { ok: boolean; code?: string }), "validation");
});