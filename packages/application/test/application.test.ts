import assert from "node:assert/strict";
import test from "node:test";

import { GOAL_ARCHIVE_STATUS, PROJECT_ARCHIVE_STATUS } from "@ega/domain";
import type { GoalViewFilter, ProjectViewFilter } from "@ega/domain";

import {
  archiveGoal,
  archiveProject,
  createAuthenticatedActor,
  createGoal,
  createProject,
  deleteArchivedProject,
  getGoalsReadModel,
  getProjectIdentityReadModel,
  getProjectPurgePreview,
  getProjectsReadModel,
  purgeArchivedProject,
  unarchiveGoal,
  unarchiveProject,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
  updateProjectStatus,
  type AuthenticatedActor,
  type CreateGoalRecordInput,
  type CreateProjectRecordInput,
  type DeleteArchivedProjectResult,
  type GoalRecord,
  type GoalTaskContextRecord,
  type GoalsRepository,
  type ProjectGoalRecord,
  type ProjectPurgePreview,
  type ProjectRecord,
  type ProjectsRepository,
  type ProjectTaskContextRecord,
  type PurgeArchivedProjectResult,
  type RepositoryResult,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

function okResult<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function unknownFailure<T = never>(): RepositoryResult<T> {
  return { ok: false, error: { code: "unknown" } };
}

class FakeProjectsRepository implements ProjectsRepository {
  calls: Array<{ method: string; actorUserId: string; args: Record<string, unknown> }> = [];
  createResult: RepositoryResult<null> = okResult(null);
  listResult: RepositoryResult<ProjectRecord[]> = okResult([]);
  statusesResult: RepositoryResult<string[]> = okResult([]);
  tasksResult: RepositoryResult<ProjectTaskContextRecord[]> = okResult([]);
  slugResult: RepositoryResult<ProjectRecord | null> = okResult(null);
  idResult: RepositoryResult<ProjectRecord | null> = okResult(null);
  goalsResult: RepositoryResult<ProjectGoalRecord[]> = okResult([]);
  updateResult: RepositoryResult<null> = okResult(null);
  deleteResult: RepositoryResult<DeleteArchivedProjectResult> = okResult({ deleted: true });
  previewResult: RepositoryResult<ProjectPurgePreview | null> = okResult(null);
  purgeResult: RepositoryResult<PurgeArchivedProjectResult> = okResult({
    status: "purged",
    tasksDeleted: 0,
    goalsDeleted: 0,
    sessionsDeleted: 0,
    externalRefsDeleted: 0,
    notificationsDeleted: 0,
    calendarDeleteJobsEnqueued: 0,
  });

  private record(method: string, actorUserId: string, args: Record<string, unknown>) {
    this.calls.push({ method, actorUserId, args });
  }

  async listProjects(actor: AuthenticatedActor, view: ProjectViewFilter) {
    this.record("listProjects", actor.userId, { view });
    return this.listResult;
  }
  async listProjectStatuses(actor: AuthenticatedActor) {
    this.record("listProjectStatuses", actor.userId, {});
    return this.statusesResult;
  }
  async listTasksForProjects(actor: AuthenticatedActor, projectIds: string[]) {
    this.record("listTasksForProjects", actor.userId, { projectIds });
    return this.tasksResult;
  }
  async getProjectBySlug(actor: AuthenticatedActor, slug: string) {
    this.record("getProjectBySlug", actor.userId, { slug });
    return this.slugResult;
  }
  async getProjectById(actor: AuthenticatedActor, projectId: string) {
    this.record("getProjectById", actor.userId, { projectId });
    return this.idResult;
  }
  async listGoalsForProject(actor: AuthenticatedActor, projectId: string) {
    this.record("listGoalsForProject", actor.userId, { projectId });
    return this.goalsResult;
  }
  async createProject(actor: AuthenticatedActor, input: CreateProjectRecordInput) {
    this.record("createProject", actor.userId, input);
    return this.createResult;
  }
  async updateProjectStatus(
    actor: AuthenticatedActor,
    input: { projectId: string; status: string; updatedAt: string },
  ) {
    this.record("updateProjectStatus", actor.userId, input);
    return this.updateResult;
  }
  async deleteArchivedProject(
    actor: AuthenticatedActor,
    input: { projectId: string },
  ) {
    this.record("deleteArchivedProject", actor.userId, input);
    return this.deleteResult;
  }
  async getProjectPurgePreview(actor: AuthenticatedActor, projectId: string) {
    this.record("getProjectPurgePreview", actor.userId, { projectId });
    return this.previewResult;
  }
  async purgeArchivedProject(
    actor: AuthenticatedActor,
    input: { projectId: string; confirmationName: string; expectedTaskCount: number; expectedGoalCount: number },
  ) {
    this.record("purgeArchivedProject", actor.userId, input);
    return this.purgeResult;
  }
}

class FakeGoalsRepository implements GoalsRepository {
  calls: Array<{ method: string; actorUserId: string; args: Record<string, unknown> }> = [];
  createResult: RepositoryResult<GoalRecord | null> = okResult(null);
  updateResult: RepositoryResult<null> = okResult(null);
  projectOptionsResult: RepositoryResult<{ id: string; name: string }[]> = okResult([]);
  listResult: RepositoryResult<GoalRecord[]> = okResult([]);
  tasksResult: RepositoryResult<GoalTaskContextRecord[]> = okResult([]);
  statusesResult: RepositoryResult<string[]> = okResult([]);

  private record(method: string, actorUserId: string, args: Record<string, unknown>) {
    this.calls.push({ method, actorUserId, args });
  }

  async listProjectOptions(actor: AuthenticatedActor) {
    this.record("listProjectOptions", actor.userId, {});
    return this.projectOptionsResult;
  }
  async listGoals(actor: AuthenticatedActor, view: GoalViewFilter) {
    this.record("listGoals", actor.userId, { view });
    return this.listResult;
  }
  async listGoalTasks(actor: AuthenticatedActor) {
    this.record("listGoalTasks", actor.userId, {});
    return this.tasksResult;
  }
  async listGoalStatuses(actor: AuthenticatedActor) {
    this.record("listGoalStatuses", actor.userId, {});
    return this.statusesResult;
  }
  async createGoal(actor: AuthenticatedActor, input: CreateGoalRecordInput) {
    this.record("createGoal", actor.userId, input);
    return this.createResult;
  }
  async updateGoalStatus(
    actor: AuthenticatedActor,
    input: { goalId: string; status: string; updatedAt: string },
  ) {
    this.record("updateGoalStatus", actor.userId, input);
    return this.updateResult;
  }
  async updateGoalHealth(
    actor: AuthenticatedActor,
    input: { goalId: string; health: string | null; updatedAt: string },
  ) {
    this.record("updateGoalHealth", actor.userId, input);
    return this.updateResult;
  }
  async updateGoalNextStep(
    actor: AuthenticatedActor,
    input: { goalId: string; nextStep: string | null; updatedAt: string },
  ) {
    this.record("updateGoalNextStep", actor.userId, input);
    return this.updateResult;
  }
}

const PROJECT_ROW: ProjectRecord = {
  id: "project-1",
  name: "Home Renovation",
  slug: "home-renovation",
  description: "Kitchen and bathroom",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

const GOAL_ROW: GoalRecord = {
  id: "goal-1",
  projectId: "project-1",
  title: "Ship the app",
  slug: "ship-the-app",
  description: "Notes",
  nextStep: "Send build",
  health: "on_track",
  status: "active",
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

test("createProject normalizes the slug and passes the actor to the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = await createProject(ACTOR, repository, {
    name: "  My Cool Project!  ",
    slug: "  My Cool Project!  ",
    description: "  A description.  ",
  });

  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].method, "createProject");
  assert.equal(repository.calls[0].actorUserId, "user-123");
  assert.deepEqual(repository.calls[0].args, {
    name: "My Cool Project!",
    slug: "my-cool-project",
    description: "A description.",
  });
});

test("createProject rejects a missing name without touching the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = await createProject(ACTOR, repository, {
    name: " ",
    slug: "my-slug",
    description: "",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Project name is required.");
  assert.equal(repository.calls.length, 0);
});

test("createProject defensively normalizes exotic slug input before the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = await createProject(ACTOR, repository, {
    name: "My Project",
    slug: "My_Project!!!",
    description: "",
  });

  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].args.slug, "my-project");
});

test("duplicate project slug maps to the safe UI error", async () => {
  const repository = new FakeProjectsRepository();
  repository.createResult = { ok: false, error: { code: "conflict" } };

  const result = await createProject(ACTOR, repository, {
    name: "Duplicate",
    slug: "duplicate",
    description: "",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok || result.errorMessage,
    "That slug is already in use. Choose a different slug.",
  );
});

test("unknown repository failure does not leak the raw persistence error", async () => {
  const repository = new FakeProjectsRepository();
  repository.createResult = unknownFailure();

  const result = await createProject(ACTOR, repository, {
    name: "Boom",
    slug: "boom",
    description: "",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok || result.errorMessage,
    "Unable to create project right now. Please try again.",
  );
});

test("updateProjectStatus passes the actor and validates before the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = await updateProjectStatus(ACTOR, repository, {
    projectId: "project-1",
    status: "paused",
    now: new Date("2026-03-01T00:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].actorUserId, "user-123");
  assert.deepEqual(repository.calls[0].args, {
    projectId: "project-1",
    status: "paused",
    updatedAt: "2026-03-01T00:00:00.000Z",
  });
});

test("invalid project status never reaches the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = await updateProjectStatus(ACTOR, repository, {
    projectId: "project-1",
    status: "sideways",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Project update request is invalid.");
  assert.equal(repository.calls.length, 0);
});

test("project update failure is sanitized", async () => {
  const repository = new FakeProjectsRepository();
  repository.updateResult = unknownFailure();

  const result = await updateProjectStatus(ACTOR, repository, {
    projectId: "project-1",
    status: "paused",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Unable to update project right now.");
});

test("project archive and unarchive use canonical domain statuses", async () => {
  const repository = new FakeProjectsRepository();

  await archiveProject(ACTOR, repository, { projectId: "project-1" });
  await unarchiveProject(ACTOR, repository, { projectId: "project-1" });

  assert.equal(repository.calls.length, 2);
  assert.equal(repository.calls[0].args.status, PROJECT_ARCHIVE_STATUS);
  assert.equal(repository.calls[1].args.status, "active");
});

const ARCHIVED_PROJECT_ROW: ProjectRecord = { ...PROJECT_ROW, status: "archived" };

// Valid v4-shaped UUID used by every permanent-delete test: the use case
// rejects non-UUID ids before the repository, so legacy "project-1" style
// ids must not appear in success-path fixtures.
const DELETE_PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";
const ARCHIVED_DELETE_ROW: ProjectRecord = { ...ARCHIVED_PROJECT_ROW, id: DELETE_PROJECT_ID };

function archivedRepository() {
  const repository = new FakeProjectsRepository();
  repository.idResult = okResult(ARCHIVED_DELETE_ROW);
  return repository;
}

function failureMessage(result: { ok: boolean }) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  return result as { ok: false; errorMessage: string; code?: string };
}

test("deleteArchivedProject rejects a missing id without touching the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: "  " }));

  assert.equal(result.errorMessage, "Project delete request is invalid.");
  assert.equal(result.code, "validation");
  assert.equal(repository.calls.length, 0);
});

test("deleteArchivedProject rejects malformed ids before the repository", async () => {
  for (const projectId of ["not-a-uuid", "project-1", "123", "../../etc/passwd", "z".repeat(36)]) {
    const repository = new FakeProjectsRepository();

    const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId }));

    assert.equal(result.errorMessage, "Project delete request is invalid.");
    assert.equal(result.code, "validation");
    assert.equal(repository.calls.length, 0);
  }
});

test("deleteArchivedProject maps a missing project to notFound", async () => {
  const repository = new FakeProjectsRepository();
  repository.idResult = okResult(null);

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(result.errorMessage, "Project not found.");
  assert.equal(result.code, "notFound");
});

test("deleteArchivedProject rejects every non-archived status", async () => {
  for (const status of ["planned", "active", "done", "paused"]) {
    const repository = new FakeProjectsRepository();
    repository.idResult = okResult({ ...PROJECT_ROW, id: DELETE_PROJECT_ID, status });

    const result = failureMessage(
      await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }),
    );

    assert.equal(result.errorMessage, "Only archived projects can be permanently deleted.");
    assert.equal(result.code, "validation");
    assert.deepEqual(
      repository.calls.map((call) => call.method),
      ["getProjectById"],
    );
  }
});

test("deleteArchivedProject deletes an archived project without dependencies", async () => {
  const repository = archivedRepository();

  const result = await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID });

  assert.equal(result.ok, true);
  assert.deepEqual(
    repository.calls.map((call) => call.method),
    ["getProjectById", "listTasksForProjects", "listGoalsForProject", "deleteArchivedProject"],
  );
  for (const call of repository.calls) {
    assert.equal(call.actorUserId, "user-123");
  }
  assert.deepEqual(repository.calls[3].args, { projectId: DELETE_PROJECT_ID });
});

test("deleteArchivedProject blocks an archived project with linked tasks", async () => {
  const repository = archivedRepository();
  repository.tasksResult = okResult([
    { id: "task-1", projectId: DELETE_PROJECT_ID, title: "Paint", status: "todo", priority: "high", updatedAt: "2026-02-02T00:00:00.000Z" },
  ]);

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(
    result.errorMessage,
    "This project still has linked tasks. Move or remove them before permanently deleting the project.",
  );
  assert.equal(result.code, "conflict");
  assert.ok(!repository.calls.some((call) => call.method === "deleteArchivedProject"));
});

test("deleteArchivedProject blocks an archived project with linked goals", async () => {
  const repository = archivedRepository();
  repository.goalsResult = okResult([{ id: "goal-1", title: "Finish kitchen", projectId: DELETE_PROJECT_ID }]);

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(
    result.errorMessage,
    "This project still has linked goals. Move or remove them before permanently deleting the project.",
  );
  assert.equal(result.code, "conflict");
  assert.ok(!repository.calls.some((call) => call.method === "deleteArchivedProject"));
});

test("deleteArchivedProject blocks an archived project with linked tasks and goals", async () => {
  const repository = archivedRepository();
  repository.tasksResult = okResult([
    { id: "task-1", projectId: DELETE_PROJECT_ID, title: "Paint", status: "todo", priority: "high", updatedAt: "2026-02-02T00:00:00.000Z" },
  ]);
  repository.goalsResult = okResult([{ id: "goal-1", title: "Finish kitchen", projectId: DELETE_PROJECT_ID }]);

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(
    result.errorMessage,
    "This project still has linked tasks and goals. Move or remove them before permanently deleting the project.",
  );
  assert.equal(result.code, "conflict");
  assert.ok(!repository.calls.some((call) => call.method === "deleteArchivedProject"));
});

test("deleteArchivedProject sanitizes a pre-read failure", async () => {
  const repository = new FakeProjectsRepository();
  repository.idResult = unknownFailure();

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(result.errorMessage, "Unable to load project right now.");
  assert.equal(result.code, "unknown");
});

test("deleteArchivedProject sanitizes dependency read failures", async () => {
  const tasksFail = archivedRepository();
  tasksFail.tasksResult = unknownFailure();

  const tasksResult = failureMessage(
    await deleteArchivedProject(ACTOR, tasksFail, { projectId: DELETE_PROJECT_ID }),
  );
  assert.equal(tasksResult.errorMessage, "Unable to verify linked records right now.");

  const goalsFail = archivedRepository();
  goalsFail.goalsResult = unknownFailure();

  const goalsResult = failureMessage(
    await deleteArchivedProject(ACTOR, goalsFail, { projectId: DELETE_PROJECT_ID }),
  );
  assert.equal(goalsResult.errorMessage, "Unable to verify linked records right now.");
  assert.ok(!goalsFail.calls.some((call) => call.method === "deleteArchivedProject"));
});

test("deleteArchivedProject sanitizes a persistence failure", async () => {
  const repository = archivedRepository();
  repository.deleteResult = unknownFailure();

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(result.errorMessage, "Unable to delete project right now.");
  assert.equal(result.code, "unknown");
});

test("deleteArchivedProject maps a foreign-key race to the dependency conflict", async () => {
  const repository = archivedRepository();
  repository.deleteResult = { ok: false, error: { code: "conflict" } };

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(
    result.errorMessage,
    "This project still has linked tasks or goals. Move or remove them before permanently deleting the project.",
  );
  assert.equal(result.code, "conflict");
});

test("deleteArchivedProject treats a zero-row delete as a safe failure", async () => {
  const repository = archivedRepository();
  repository.deleteResult = okResult({ deleted: false });

  const result = failureMessage(await deleteArchivedProject(ACTOR, repository, { projectId: DELETE_PROJECT_ID }));

  assert.equal(result.errorMessage, "Unable to delete project right now.");
  assert.equal(result.code, "unknown");
});

const PURGE_PROJECT_ROW: ProjectRecord = {
  ...ARCHIVED_DELETE_ROW,
  name: "Stage CGI",
};

const PURGE_PREVIEW: ProjectPurgePreview = {
  projectId: DELETE_PROJECT_ID,
  projectName: "Stage CGI",
  taskCount: 38,
  goalCount: 7,
  sessionCount: 143,
  activeSessionCount: 1,
  reminderCount: 12,
  recurrenceCount: 4,
  externalRefCount: 2,
  taskNotificationCount: 6,
  calendarEventCount: 3,
};

function purgeRepository() {
  const repository = new FakeProjectsRepository();
  repository.idResult = okResult(PURGE_PROJECT_ROW);
  repository.previewResult = okResult(PURGE_PREVIEW);
  return repository;
}

function purgeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: DELETE_PROJECT_ID,
    confirmationName: "Stage CGI",
    expectedTaskCount: 38,
    expectedGoalCount: 7,
    ...overrides,
  };
}

test("getProjectPurgePreview rejects malformed ids without touching the repository", async () => {
  const repository = new FakeProjectsRepository();

  const result = failureMessage(
    await getProjectPurgePreview(ACTOR, repository, { projectId: "not-a-uuid" }),
  );

  assert.equal(result.errorMessage, "Project purge preview request is invalid.");
  assert.equal(result.code, "validation");
  assert.equal(repository.calls.length, 0);
});

test("getProjectPurgePreview maps a missing project to notFound", async () => {
  const repository = new FakeProjectsRepository();
  repository.idResult = okResult(null);

  const result = failureMessage(
    await getProjectPurgePreview(ACTOR, repository, { projectId: DELETE_PROJECT_ID }),
  );

  assert.equal(result.errorMessage, "Project not found.");
  assert.equal(result.code, "notFound");
});

test("getProjectPurgePreview rejects every non-archived status", async () => {
  for (const status of ["planned", "active", "done", "paused"]) {
    const repository = new FakeProjectsRepository();
    repository.idResult = okResult({ ...PURGE_PROJECT_ROW, status });

    const result = failureMessage(
      await getProjectPurgePreview(ACTOR, repository, { projectId: DELETE_PROJECT_ID }),
    );

    assert.equal(result.errorMessage, "Only archived projects can be permanently deleted.");
    assert.equal(result.code, "validation");
    assert.deepEqual(
      repository.calls.map((call) => call.method),
      ["getProjectById"],
    );
  }
});

test("getProjectPurgePreview returns the impact counts for an archived project", async () => {
  const repository = purgeRepository();

  const result = await getProjectPurgePreview(ACTOR, repository, { projectId: DELETE_PROJECT_ID });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, PURGE_PREVIEW);
  assert.deepEqual(
    repository.calls.map((call) => call.method),
    ["getProjectById", "getProjectPurgePreview"],
  );
  for (const call of repository.calls) {
    assert.equal(call.actorUserId, "user-123");
  }
});

test("getProjectPurgePreview sanitizes a preview read failure", async () => {
  const repository = purgeRepository();
  repository.previewResult = unknownFailure();

  const result = failureMessage(
    await getProjectPurgePreview(ACTOR, repository, { projectId: DELETE_PROJECT_ID }),
  );

  assert.equal(result.errorMessage, "Unable to load deletion impact right now.");
  assert.equal(result.code, "unknown");
});

test("purgeArchivedProject rejects malformed ids without touching the repository", async () => {
  for (const projectId of ["not-a-uuid", "project-1", "  "]) {
    const repository = new FakeProjectsRepository();

    const result = failureMessage(await purgeArchivedProject(ACTOR, repository, purgeInput({ projectId })));

    assert.equal(result.errorMessage, "Project purge request is invalid.");
    assert.equal(result.code, "validation");
    assert.equal(repository.calls.length, 0);
  }
});

test("purgeArchivedProject rejects bad confirmation and counts without touching the repository", async () => {
  const badInputs = [
    purgeInput({ confirmationName: "  " }),
    purgeInput({ expectedTaskCount: -1 }),
    purgeInput({ expectedGoalCount: 1.5 }),
    purgeInput({ expectedTaskCount: "38" }),
    purgeInput({ expectedGoalCount: Number.NaN }),
  ];

  for (const input of badInputs) {
    const repository = new FakeProjectsRepository();

    const result = failureMessage(await purgeArchivedProject(ACTOR, repository, input));

    assert.equal(result.errorMessage, "Project purge request is invalid.");
    assert.equal(result.code, "validation");
    assert.equal(repository.calls.length, 0);
  }
});

test("purgeArchivedProject maps a missing project to notFound", async () => {
  const repository = new FakeProjectsRepository();
  repository.idResult = okResult(null);

  const result = failureMessage(await purgeArchivedProject(ACTOR, repository, purgeInput()));

  assert.equal(result.errorMessage, "Project not found.");
  assert.equal(result.code, "notFound");
});

test("purgeArchivedProject rejects every non-archived status", async () => {
  for (const status of ["planned", "active", "done", "paused"]) {
    const repository = new FakeProjectsRepository();
    repository.idResult = okResult({ ...PURGE_PROJECT_ROW, status });

    const result = failureMessage(await purgeArchivedProject(ACTOR, repository, purgeInput()));

    assert.equal(result.errorMessage, "Only archived projects can be permanently deleted.");
    assert.equal(result.code, "validation");
    assert.ok(!repository.calls.some((call) => call.method === "purgeArchivedProject"));
  }
});

test("purgeArchivedProject rejects a wrong confirmation name before purging", async () => {
  const repository = purgeRepository();

  const result = failureMessage(
    await purgeArchivedProject(ACTOR, repository, purgeInput({ confirmationName: "stage cgi" })),
  );

  assert.equal(result.errorMessage, "Project name confirmation does not match.");
  assert.equal(result.code, "validation");
  assert.ok(!repository.calls.some((call) => call.method === "purgeArchivedProject"));
});

test("purgeArchivedProject purges through the repository and preserves delete counts", async () => {
  const repository = purgeRepository();
  repository.purgeResult = okResult({
    status: "purged",
    tasksDeleted: 38,
    goalsDeleted: 7,
    sessionsDeleted: 143,
    externalRefsDeleted: 2,
    notificationsDeleted: 6,
    calendarDeleteJobsEnqueued: 3,
  });

  const result = await purgeArchivedProject(ACTOR, repository, purgeInput());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.data, {
    tasksDeleted: 38,
    goalsDeleted: 7,
    sessionsDeleted: 143,
    externalRefsDeleted: 2,
    notificationsDeleted: 6,
    calendarDeleteJobsEnqueued: 3,
  });
  assert.deepEqual(
    repository.calls.map((call) => call.method),
    ["getProjectById", "purgeArchivedProject"],
  );
  assert.deepEqual(repository.calls[1].args, {
    projectId: DELETE_PROJECT_ID,
    confirmationName: "Stage CGI",
    expectedTaskCount: 38,
    expectedGoalCount: 7,
  });
  assert.equal(repository.calls[1].actorUserId, "user-123");
});

test("purgeArchivedProject purges an empty archived project", async () => {
  const repository = purgeRepository();

  const result = await purgeArchivedProject(
    ACTOR,
    repository,
    purgeInput({ expectedTaskCount: 0, expectedGoalCount: 0 }),
  );

  assert.equal(result.ok, true);
});

test("purgeArchivedProject maps repository outcomes to safe errors", async () => {
  const cases = [
    {
      value: { status: "not_found" },
      errorMessage: "Project not found.",
      code: "notFound",
    },
    {
      value: { status: "not_archived" },
      errorMessage: "Only archived projects can be permanently deleted.",
      code: "validation",
    },
    {
      value: { status: "confirmation_mismatch" },
      errorMessage: "Project name confirmation does not match.",
      code: "validation",
    },
    {
      value: { status: "contents_changed" },
      errorMessage: "Project contents changed. Review the deletion impact and confirm again.",
      code: "conflict",
    },
  ] as const;

  for (const { value, errorMessage, code } of cases) {
    const repository = purgeRepository();
    repository.purgeResult = okResult(value);

    const result = failureMessage(await purgeArchivedProject(ACTOR, repository, purgeInput()));

    assert.equal(result.errorMessage, errorMessage);
    assert.equal(result.code, code);
  }
});

test("purgeArchivedProject sanitizes a persistence failure", async () => {
  const repository = purgeRepository();
  repository.purgeResult = unknownFailure();

  const result = failureMessage(await purgeArchivedProject(ACTOR, repository, purgeInput()));

  assert.equal(result.errorMessage, "Unable to purge project right now.");
  assert.equal(result.code, "unknown");
});

test("project read model preserves summary and progress behavior", async () => {
  const repository = new FakeProjectsRepository();
  repository.listResult = okResult([
    PROJECT_ROW,
    { ...PROJECT_ROW, id: "project-2", slug: "finished", status: "done" },
  ]);
  repository.statusesResult = okResult(["active", "done", "archived"]);
  repository.tasksResult = okResult([
    { id: "task-1", projectId: "project-1", title: "Paint", status: "done", priority: "high", updatedAt: "2026-02-02T00:00:00.000Z" },
    { id: "task-2", projectId: "project-1", title: "Tiles", status: "in_progress", priority: "medium", updatedAt: "2026-02-03T00:00:00.000Z" },
    { id: "task-3", projectId: "project-2", title: "Inspect", status: "done", priority: "low", updatedAt: "2026-01-20T00:00:00.000Z" },
  ]);

  const result = await getProjectsReadModel(ACTOR, repository, "active");

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.data.summary, { total: 3, active: 1, completed: 1, archived: 1 });
  assert.equal(result.data.projects.length, 2);

  const first = result.data.projects[0];
  assert.equal(first.taskCount, 2);
  assert.equal(first.completedTaskCount, 1);
  assert.equal(first.progressPercent, 50);
  assert.deepEqual(first.statusCounts, [
    { status: "done", count: 1 },
    { status: "in_progress", count: 1 },
  ]);
  assert.equal(first.recentTasks.length, 2);
});

test("project identity read model resolves project and goals by slug", async () => {
  const repository = new FakeProjectsRepository();
  repository.slugResult = okResult(PROJECT_ROW);
  repository.goalsResult = okResult([
    { id: "goal-1", title: "Finish kitchen", projectId: "project-1" },
    { id: "goal-2", title: "Finish bathroom", projectId: "project-1" },
  ]);

  const result = await getProjectIdentityReadModel(ACTOR, repository, "home-renovation");

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data?.project.slug, "home-renovation");
  assert.equal(result.data?.goals.length, 2);
  assert.equal(repository.calls[0].actorUserId, "user-123");
  assert.equal(repository.calls[1].args.projectId, "project-1");
});

test("project identity read model returns null when the slug is unknown", async () => {
  const repository = new FakeProjectsRepository();
  repository.slugResult = okResult(null);

  const result = await getProjectIdentityReadModel(ACTOR, repository, "missing");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data, null);
});

test("project read model failures are sanitized", async () => {
  const repository = new FakeProjectsRepository();
  repository.listResult = unknownFailure();

  const result = await getProjectsReadModel(ACTOR, repository, "active");

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Unable to load projects right now.");
});

test("createGoal passes the actor and normalized values to the repository", async () => {
  const repository = new FakeGoalsRepository();

  const result = await createGoal(ACTOR, repository, {
    title: "  Ship the app  ",
    projectId: "project-1",
    description: "  Notes  ",
    nextStep: "Send build",
    health: "at_risk",
    status: "active",
    slug: "  Ship the App!  ",
  });

  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].actorUserId, "user-123");
  assert.deepEqual(repository.calls[0].args, {
    title: "Ship the app",
    projectId: "project-1",
    description: "Notes",
    nextStep: "Send build",
    health: "at_risk",
    status: "active",
    slug: "ship-the-app",
  });
});

test("createGoal propagates the server-bound MCP operation identity", async () => {
  const repository = new FakeGoalsRepository();
  repository.createResult = okResult(GOAL_ROW);

  const result = await createGoal(ACTOR, repository, {
    title: "Ship the app",
    projectId: "project-1",
    description: "Notes",
    nextStep: "Send build",
    health: "on_track",
    status: "active",
    slug: "ship-the-app",
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data, GOAL_ROW);
  assert.deepEqual(repository.calls[0]?.args, {
    title: "Ship the app",
    projectId: "project-1",
    description: "Notes",
    nextStep: "Send build",
    health: "on_track",
    status: "active",
    slug: "ship-the-app",
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });
});

test("createGoal validates title, project, status, health, and next step", async () => {
  const repository = new FakeGoalsRepository();

  const noTitle = await createGoal(ACTOR, repository, {
    title: " ", projectId: "project-1", description: "", nextStep: "", health: "", status: "draft", slug: "",
  });
  assert.equal(noTitle.ok, false);
  assert.equal(noTitle.ok || noTitle.errorMessage, "Goal title is required.");

  const noProject = await createGoal(ACTOR, repository, {
    title: "Goal", projectId: " ", description: "", nextStep: "", health: "", status: "draft", slug: "",
  });
  assert.equal(noProject.ok, false);
  assert.equal(noProject.ok || noProject.errorMessage, "Project is required.");

  const badStatus = await createGoal(ACTOR, repository, {
    title: "Goal", projectId: "project-1", description: "", nextStep: "", health: "", status: "sideways", slug: "",
  });
  assert.equal(badStatus.ok, false);
  assert.equal(
    badStatus.ok || badStatus.errorMessage,
    "Status must be one of: draft, active, done, paused.",
  );

  const badHealth = await createGoal(ACTOR, repository, {
    title: "Goal", projectId: "project-1", description: "", nextStep: "", health: "shiny", status: "draft", slug: "",
  });
  assert.equal(badHealth.ok, false);
  assert.equal(
    badHealth.ok || badHealth.errorMessage,
    "Health must be one of: on_track, at_risk, off_track.",
  );

  const longNextStep = await createGoal(ACTOR, repository, {
    title: "Goal", projectId: "project-1", description: "", nextStep: "x".repeat(161), health: "", status: "draft", slug: "",
  });
  assert.equal(longNextStep.ok, false);
  assert.equal(
    longNextStep.ok || longNextStep.errorMessage,
    "Next step must be 160 characters or fewer.",
  );

  assert.equal(repository.calls.length, 0);
});

test("goal repository failures do not leak raw persistence errors", async () => {
  const repository = new FakeGoalsRepository();
  repository.createResult = unknownFailure();
  repository.updateResult = unknownFailure();

  const created = await createGoal(ACTOR, repository, {
    title: "Goal", projectId: "project-1", description: "", nextStep: "", health: "", status: "draft", slug: "",
  });
  assert.equal(created.ok, false);
  assert.equal(created.ok || created.errorMessage, "Unable to create goal right now.");

  const updated = await updateGoalStatus(ACTOR, repository, { goalId: "goal-1", status: "done" });
  assert.equal(updated.ok, false);
  assert.equal(updated.ok || updated.errorMessage, "Unable to update goal right now.");
});

test("goal updates validate before touching the repository", async () => {
  const repository = new FakeGoalsRepository();

  const badStatus = await updateGoalStatus(ACTOR, repository, { goalId: "goal-1", status: "sideways" });
  assert.equal(badStatus.ok, false);
  assert.equal(badStatus.ok || badStatus.errorMessage, "Goal update request is invalid.");

  const badHealth = await updateGoalHealth(ACTOR, repository, { goalId: "goal-1", health: "shiny" });
  assert.equal(badHealth.ok, false);
  assert.equal(
    badHealth.ok || badHealth.errorMessage,
    "Health must be one of: on_track, at_risk, off_track.",
  );

  const longNextStep = await updateGoalNextStep(ACTOR, repository, { goalId: "goal-1", nextStep: "x".repeat(161) });
  assert.equal(longNextStep.ok, false);
  assert.equal(
    longNextStep.ok || longNextStep.errorMessage,
    "Next step must be 160 characters or fewer.",
  );

  assert.equal(repository.calls.length, 0);
});

test("goal health and next step updates pass the actor and normalized values", async () => {
  const repository = new FakeGoalsRepository();

  await updateGoalHealth(ACTOR, repository, {
    goalId: "goal-1",
    health: "off_track",
    now: new Date("2026-04-01T00:00:00.000Z"),
  });
  await updateGoalNextStep(ACTOR, repository, {
    goalId: "goal-1",
    nextStep: "  Call the architect  ",
    now: new Date("2026-04-01T00:00:00.000Z"),
  });

  assert.equal(repository.calls.length, 2);
  assert.equal(repository.calls[0].actorUserId, "user-123");
  assert.deepEqual(repository.calls[0].args, {
    goalId: "goal-1",
    health: "off_track",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(repository.calls[1].actorUserId, "user-123");
  assert.deepEqual(repository.calls[1].args, {
    goalId: "goal-1",
    nextStep: "Call the architect",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
});

test("goal archive and unarchive use canonical domain statuses", async () => {
  const repository = new FakeGoalsRepository();

  await archiveGoal(ACTOR, repository, { goalId: "goal-1" });
  await unarchiveGoal(ACTOR, repository, { goalId: "goal-1" });

  assert.equal(repository.calls.length, 2);
  assert.equal(repository.calls[0].method, "updateGoalStatus");
  assert.equal(repository.calls[0].args.status, GOAL_ARCHIVE_STATUS);
  assert.equal(repository.calls[1].args.status, "active");
});

test("goals read model preserves project names, progress, and summary", async () => {
  const repository = new FakeGoalsRepository();
  repository.projectOptionsResult = okResult([
    { id: "project-1", name: "Home Renovation" },
    { id: "project-2", name: "Garden" },
  ]);
  repository.listResult = okResult([
    {
      id: "goal-1",
      projectId: "project-1",
      title: "Finish kitchen",
      slug: "finish-kitchen",
      description: "All the cabinets",
      nextStep: "Order countertop",
      health: "on_track",
      status: "active",
      createdAt: "2026-01-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
    {
      id: "goal-2",
      projectId: "project-2",
      title: "Plant roses",
      slug: null,
      description: null,
      nextStep: null,
      health: "not-a-health",
      status: "done",
      createdAt: "2026-01-11T00:00:00.000Z",
      updatedAt: "2026-02-11T00:00:00.000Z",
    },
  ]);
  repository.tasksResult = okResult([
    { id: "task-1", title: "Paint", status: "done", goalId: "goal-1" },
    { id: "task-2", title: "Tiles", status: "in_progress", goalId: "goal-1" },
  ]);
  repository.statusesResult = okResult(["active", "done", "archived"]);

  const result = await getGoalsReadModel(ACTOR, repository, "active");

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.data.summary, { total: 3, active: 1, completed: 1, archived: 1 });
  assert.deepEqual(result.data.projects, [
    { id: "project-1", name: "Home Renovation" },
    { id: "project-2", name: "Garden" },
  ]);

  const first = result.data.goals[0];
  assert.equal(first.projectName, "Home Renovation");
  assert.equal(first.health, "on_track");
  assert.equal(first.linkedTasks.length, 2);
  assert.equal(first.progressPercent, 50);

  const second = result.data.goals[1];
  assert.equal(second.projectName, "Garden");
  assert.equal(second.health, null);
  assert.equal(second.progressPercent, 0);
});

test("goals read model failures are sanitized", async () => {
  const repository = new FakeGoalsRepository();
  repository.listResult = unknownFailure();

  const result = await getGoalsReadModel(ACTOR, repository, "active");

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Unable to load goals right now.");
});
