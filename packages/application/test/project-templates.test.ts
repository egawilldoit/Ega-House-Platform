import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_GOAL_STATUS,
  PROJECT_TEMPLATE_IDS,
  createAuthenticatedActor,
  createProjectFromTemplate,
  isProjectTemplateId,
  resolveProjectTemplatePreview,
  toCreateProjectFromTemplateRecord,
  type AuthenticatedActor,
  type CreateProjectFromTemplateRecordInput,
  type CreateProjectFromTemplateRecordResult,
  type ProjectsRepository,
  type RepositoryResult,
  type TimeContextRepository,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const OPERATION_ID = "3f1c9d0e-7b2a-4c5d-8e9f-0a1b2c3d4e5f";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeProjectsRepository implements ProjectsRepository {
  calls: Array<{ method: string; actorUserId: string; input?: unknown }> = [];
  result: RepositoryResult<CreateProjectFromTemplateRecordResult> = ok({
    projectId: "project-1",
    slug: "job-sprint",
    goalCount: 2,
    taskCount: 7,
    replayed: false,
  });

  listProjects(): never {
    throw new Error("not used");
  }
  listProjectStatuses(): never {
    throw new Error("not used");
  }
  listTasksForProjects(): never {
    throw new Error("not used");
  }
  getProjectBySlug(): never {
    throw new Error("not used");
  }
  getProjectById(): never {
    throw new Error("not used");
  }
  listGoalsForProject(): never {
    throw new Error("not used");
  }
  createProject(): never {
    throw new Error("not used");
  }
  updateProjectStatus(): never {
    throw new Error("not used");
  }
  deleteArchivedProject(): never {
    throw new Error("not used");
  }
  updateProjectArchiveState(): never {
    throw new Error("not used");
  }
  hasOpenTaskSessionForProject(): never {
    throw new Error("not used");
  }
  getProjectPurgePreview(): never {
    throw new Error("not used");
  }
  purgeArchivedProject(): never {
    throw new Error("not used");
  }

  async createProjectFromTemplate(
    actor: AuthenticatedActor,
    input: CreateProjectFromTemplateRecordInput,
  ) {
    this.calls.push({ method: "createProjectFromTemplate", actorUserId: actor.userId, input });
    return this.result;
  }
}

function fakeTimeContext(
  timezone: RepositoryResult<string | null> = ok("America/New_York"),
): TimeContextRepository {
  return {
    async getTimezone() {
      return timezone;
    },
    async setTimezone() {
      throw new Error("not used");
    },
  };
}

const NOW = new Date("2027-03-13T12:00:00.000Z"); // 07:00 in America/New_York, before DST.

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    templateId: "job-application-sprint",
    operationId: OPERATION_ID,
    name: "  Job sprint  ",
    slug: "Job Sprint",
    description: "Two weeks of applications",
    now: NOW,
    ...overrides,
  };
}

test("template ids are unique, blank is empty, and every other template creates work", () => {
  assert.equal(new Set(PROJECT_TEMPLATE_IDS).size, PROJECT_TEMPLATE_IDS.length);
  assert.equal(PROJECT_TEMPLATE_IDS[0], "blank");

  for (const definition of PROJECT_TEMPLATES) {
    assert.ok(isProjectTemplateId(definition.id), `${definition.id} must be a known id`);
    assert.ok(definition.name.trim().length > 0);
    assert.ok(definition.summary.trim().length > 0);

    if (definition.id === "blank") {
      assert.equal(definition.goals.length, 0);
      continue;
    }

    assert.ok(definition.goals.length >= 1, `${definition.id} needs at least one goal`);
    const titles = new Set<string>();
    for (const goal of definition.goals) {
      assert.ok(goal.title.trim().length > 0);
      assert.ok(goal.tasks.length >= 1, `${definition.id}/${goal.title} needs a task`);
      for (const task of goal.tasks) {
        assert.ok(task.title.trim().length > 0);
        assert.ok(titles.add(task.title), `${definition.id} repeats task title ${task.title}`);
        assert.ok(["low", "medium", "high", "urgent"].includes(task.priority));
        assert.ok(Number.isInteger(task.dueOffsetDays) && task.dueOffsetDays >= 0);
      }
    }
  }
});

test("preview resolves owner-local date-only due dates across midnight, DST, and month end", () => {
  // Casablanca is UTC+1 (no DST in 2026): 23:30Z is already the next local day.
  const casablanca = resolveProjectTemplatePreview({
    templateId: "job-application-sprint",
    localDate: "2026-10-29",
  });
  assert.equal(casablanca.ok, true);
  if (!casablanca.ok) return;
  const firstTask = casablanca.data.goals[0]?.tasks[0];
  assert.equal(firstTask?.dueDate, "2026-10-30");

  // US DST starts 2027-03-14; a date-only offset must not skip or repeat a day.
  const dst = resolveProjectTemplatePreview({
    templateId: "job-application-sprint",
    localDate: "2027-03-13",
  });
  assert.equal(dst.ok, true);
  if (!dst.ok) return;
  const dueDates = dst.data.goals.flatMap((goal) => goal.tasks.map((task) => task.dueDate));
  assert.ok(dueDates.includes("2027-03-14"));
  assert.ok(dueDates.includes("2027-03-18"));

  // End of a 31-day month rolls into the next month, not into a clamped day.
  const monthEnd = resolveProjectTemplatePreview({
    templateId: "feature-release",
    localDate: "2027-01-30",
  });
  assert.equal(monthEnd.ok, true);
  if (!monthEnd.ok) return;
  const monthEndDates = monthEnd.data.goals.flatMap((goal) => goal.tasks.map((task) => task.dueDate));
  assert.ok(monthEndDates.includes("2027-02-01"));
  assert.ok(monthEndDates.includes("2027-02-04"));
});

test("preview rejects an unknown template, a malformed local date, and never invents rows for blank", () => {
  const unknown = resolveProjectTemplatePreview({
    templateId: "not-a-template",
    localDate: "2027-01-01",
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.code, "validation");

  const badDate = resolveProjectTemplatePreview({
    templateId: "feature-release",
    localDate: "2027-02-30",
  });
  assert.equal(badDate.ok, false);

  const blank = resolveProjectTemplatePreview({ templateId: "blank", localDate: "2027-01-01" });
  assert.equal(blank.ok, true);
  if (!blank.ok) return;
  assert.equal(blank.data.goals.length, 0);
  assert.equal(blank.data.taskCount, 0);
});

test("create passes one atomic payload whose dates equal the preview the owner saw", async () => {
  const repository = new FakeProjectsRepository();
  const result = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    createInput(),
  );

  assert.equal(result.ok, true);
  assert.equal(repository.calls.length, 1);
  const call = repository.calls[0];
  assert.equal(call?.actorUserId, ACTOR.userId);
  const record = call?.input as CreateProjectFromTemplateRecordInput;

  assert.equal(record.operationId, OPERATION_ID);
  assert.equal(record.templateId, "job-application-sprint");
  assert.equal(record.name, "Job sprint");
  assert.equal(record.slug, "job-sprint");
  assert.equal(record.description, "Two weeks of applications");

  const preview = resolveProjectTemplatePreview({
    templateId: "job-application-sprint",
    localDate: "2027-03-13",
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  assert.equal(record.goals.length, preview.data.goalCount);
  assert.equal(record.tasks.length, preview.data.taskCount);
  assert.ok(record.goals.every((goal) => goal.status === PROJECT_TEMPLATE_GOAL_STATUS));

  const previewTasks = preview.data.goals.flatMap((goal, goalIndex) =>
    goal.tasks.map((task) => ({ ...task, goalIndex })),
  );
  assert.deepEqual(
    record.tasks.map((task) => ({
      title: task.title,
      dueDate: task.dueDate,
      goalIndex: task.goalIndex,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
    })),
    previewTasks.map((task) => ({
      title: task.title,
      dueDate: task.dueDate,
      goalIndex: task.goalIndex,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
    })),
  );
});

test("create validates the template and the retry token before any write", async () => {
  const repository = new FakeProjectsRepository();

  const unknownTemplate = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    createInput({ templateId: "template-that-does-not-exist" }),
  );
  assert.equal(unknownTemplate.ok, false);
  if (!unknownTemplate.ok) assert.equal(unknownTemplate.errorMessage, "Choose a project template.");

  const missingToken = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    createInput({ operationId: "not-a-uuid" }),
  );
  assert.equal(missingToken.ok, false);
  if (!missingToken.ok) assert.match(missingToken.errorMessage, /Reload the page/);

  const badName = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    createInput({ name: "   " }),
  );
  assert.equal(badName.ok, false);

  assert.equal(repository.calls.length, 0);
});

test("create fails closed when the owner time context cannot be read", async () => {
  const repository = new FakeProjectsRepository();
  const result = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext({ ok: false, error: { code: "unknown" } }),
    createInput(),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errorMessage, /time zone/);
  assert.equal(repository.calls.length, 0);
});

test("create surfaces a slug conflict and an unknown failure distinctly", async () => {
  const conflictRepository = new FakeProjectsRepository();
  conflictRepository.result = { ok: false, error: { code: "conflict" } };
  const conflict = await createProjectFromTemplate(
    ACTOR,
    conflictRepository,
    fakeTimeContext(),
    createInput(),
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.errorMessage, "That slug is already in use. Choose a different slug.");

  const unknownRepository = new FakeProjectsRepository();
  unknownRepository.result = { ok: false, error: { code: "unknown" } };
  const unknown = await createProjectFromTemplate(
    ACTOR,
    unknownRepository,
    fakeTimeContext(),
    createInput(),
  );
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.errorMessage, /Unable to create the project from this template/);
});

test("a retry with the same operation id reports the replayed project", async () => {
  const repository = new FakeProjectsRepository();
  repository.result = ok({
    projectId: "project-existing",
    slug: "job-sprint",
    goalCount: 2,
    taskCount: 7,
    replayed: true,
  });

  const result = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    createInput(),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.projectId, "project-existing");
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.goalCount, 2);
  assert.equal(result.data.taskCount, 7);
});

test("blank creates a project payload with no goals or tasks", async () => {
  const repository = new FakeProjectsRepository();
  repository.result = ok({
    projectId: "project-blank",
    slug: "blank-project",
    goalCount: 0,
    taskCount: 0,
    replayed: false,
  });

  const result = await createProjectFromTemplate(
    ACTOR,
    repository,
    fakeTimeContext(),
    {
      templateId: "blank",
      operationId: OPERATION_ID,
      name: "Blank project",
      slug: "blank-project",
      description: "",
      now: NOW,
    },
  );

  assert.equal(result.ok, true);
  const record = repository.calls[0]?.input as CreateProjectFromTemplateRecordInput;
  assert.equal(record.goals.length, 0);
  assert.equal(record.tasks.length, 0);
  assert.equal(record.description, null);
});

test("record mapping keeps goal indexes aligned with the goals it sends", () => {
  const preview = resolveProjectTemplatePreview({
    templateId: "weekly-review",
    localDate: "2027-01-01",
  });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  const record = toCreateProjectFromTemplateRecord({
    preview: preview.data,
    operationId: OPERATION_ID,
    name: "Weekly review",
    slug: "weekly-review",
    description: null,
  });

  assert.equal(record.goals.length, 1);
  assert.equal(record.tasks.length, preview.data.taskCount);
  assert.ok(record.tasks.every((task) => task.goalIndex === 0));
});
