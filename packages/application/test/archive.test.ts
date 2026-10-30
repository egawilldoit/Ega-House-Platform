import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHIVE_ITEM_LIMIT,
  createAuthenticatedActor,
  getArchiveReadModel,
  type ArchiveGoalRecord,
  type ArchiveListQuery,
  type ArchiveProjectRecord,
  type ArchiveRepository,
  type ArchiveSummary,
  type ArchiveTaskRecord,
  type RepositoryResult,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

function okResult<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

const FAILURE = { ok: false as const, error: { code: "unknown" as const } };

class FakeArchiveRepository implements ArchiveRepository {
  calls: Array<{ method: string; actorUserId: string; query?: ArchiveListQuery }> = [];
  summaryResult: RepositoryResult<ArchiveSummary> = okResult({
    tasks: 3,
    goals: 2,
    projects: 1,
  });
  tasksResult: RepositoryResult<ArchiveTaskRecord[]> = okResult([]);
  goalsResult: RepositoryResult<ArchiveGoalRecord[]> = okResult([]);
  projectsResult: RepositoryResult<ArchiveProjectRecord[]> = okResult([]);

  private record(method: string, actorUserId: string, query?: ArchiveListQuery) {
    this.calls.push({ method, actorUserId, query });
  }

  async getArchiveSummary(actor: { userId: string }) {
    this.record("getArchiveSummary", actor.userId);
    return this.summaryResult;
  }

  async listArchivedTasks(actor: { userId: string }, query: ArchiveListQuery) {
    this.record("listArchivedTasks", actor.userId, query);
    return this.tasksResult;
  }

  async listArchivedGoals(actor: { userId: string }, query: ArchiveListQuery) {
    this.record("listArchivedGoals", actor.userId, query);
    return this.goalsResult;
  }

  async listArchivedProjects(actor: { userId: string }, query: ArchiveListQuery) {
    this.record("listArchivedProjects", actor.userId, query);
    return this.projectsResult;
  }
}

const TASK: ArchiveTaskRecord = {
  id: "task-1",
  title: "Ship archive centre",
  status: "todo",
  priority: "medium",
  projectId: "project-1",
  projectName: "Platform",
  projectSlug: "platform",
  projectArchived: false,
  goalId: null,
  goalTitle: null,
  goalArchived: false,
  archivedAt: "2026-05-02T10:00:00.000Z",
  updatedAt: "2026-05-02T10:00:00.000Z",
};

test("archive read model lists only the requested tab and returns tab counts", async () => {
  const repository = new FakeArchiveRepository();
  repository.tasksResult = okResult([TASK]);

  const result = await getArchiveReadModel(ACTOR, repository, { tab: "tasks" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.tab, "tasks");
  assert.deepEqual(result.data.tasks, [TASK]);
  assert.deepEqual(result.data.goals, []);
  assert.deepEqual(result.data.projects, []);
  assert.deepEqual(result.data.summary, { tasks: 3, goals: 2, projects: 1 });
  assert.deepEqual(
    repository.calls.map((call) => call.method).sort(),
    ["getArchiveSummary", "listArchivedTasks"],
  );
  assert.equal(repository.calls.every((call) => call.actorUserId === "user-123"), true);
});

test("archive read model normalises unknown tabs, search whitespace and the row limit", async () => {
  const repository = new FakeArchiveRepository();

  const fallback = await getArchiveReadModel(ACTOR, repository, { tab: "unknown" });
  assert.equal(fallback.ok, true);
  if (fallback.ok) {
    assert.equal(fallback.data.tab, "tasks");
    assert.equal(fallback.data.search, "");
  }

  const searched = await getArchiveReadModel(ACTOR, repository, {
    tab: "goals",
    search: "  quarterly   review  ",
  });
  assert.equal(searched.ok, true);
  if (searched.ok) {
    assert.equal(searched.data.search, "quarterly review");
  }

  const goalCall = repository.calls.find((call) => call.method === "listArchivedGoals");
  assert.deepEqual(goalCall?.query, {
    search: "quarterly review",
    limit: ARCHIVE_ITEM_LIMIT,
  });
});

test("archive read model fails closed when any read fails", async () => {
  const summaryFailure = new FakeArchiveRepository();
  summaryFailure.summaryResult = FAILURE;

  const summaryResult = await getArchiveReadModel(ACTOR, summaryFailure, { tab: "tasks" });
  assert.equal(summaryResult.ok, false);
  assert.equal(summaryResult.ok || summaryResult.errorMessage, "Unable to load the archive right now.");

  const listFailure = new FakeArchiveRepository();
  listFailure.projectsResult = FAILURE;

  const listResult = await getArchiveReadModel(ACTOR, listFailure, { tab: "projects" });
  assert.equal(listResult.ok, false);
  assert.equal(listResult.ok || listResult.errorMessage, "Unable to load the archive right now.");
});
