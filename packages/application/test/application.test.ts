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
  getGoalsReadModel,
  getProjectIdentityReadModel,
  getProjectsReadModel,
  unarchiveGoal,
  unarchiveProject,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
  updateProjectStatus,
  type AuthenticatedActor,
  type CreateGoalRecordInput,
  type CreateProjectRecordInput,
  type GoalRecord,
  type GoalTaskContextRecord,
  type GoalsRepository,
  type ProjectGoalRecord,
  type ProjectRecord,
  type ProjectsRepository,
  type ProjectTaskContextRecord,
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
  goalsResult: RepositoryResult<ProjectGoalRecord[]> = okResult([]);
  updateResult: RepositoryResult<null> = okResult(null);

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
}

class FakeGoalsRepository implements GoalsRepository {
  calls: Array<{ method: string; actorUserId: string; args: Record<string, unknown> }> = [];
  createResult: RepositoryResult<null> = okResult(null);
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
