import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  getTodayReadModel,
  type AuthenticatedActor,
  type RepositoryResult,
  type TaskRecord,
  type TaskScopeRecord,
  type TasksRepository,
} from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

const TASK: TaskRecord = {
  id: "task-today",
  title: "Today task",
  description: null,
  blockedReason: null,
  status: "todo",
  priority: "medium",
  dueDate: "2026-08-10",
  estimateMinutes: 20,
  projectId: "project-1",
  goalId: null,
  plannedForDate: "2026-08-10",
  focusRank: 1,
  archivedAt: null,
  updatedAt: "2026-08-10T10:00:00.000Z",
  reminders: [],
  recurrence: null,
};

class TodayRepository implements TasksRepository {
  query: unknown;
  async getScope(_actor: AuthenticatedActor): Promise<RepositoryResult<TaskScopeRecord>> {
    return ok({ projectIds: ["project-1"], goals: [] });
  }
  async listTasks(_actor: AuthenticatedActor, query?: unknown) {
    this.query = query;
    return ok([TASK]);
  }
  async getTask() { return ok<TaskRecord | null>(null); }
  async createTask() { return ok(TASK); }
  async updateTask() { return ok(TASK); }
  async setTaskArchived() { return ok(TASK); }
  async createReminder() { return ok(TASK); }
  async cancelReminder() { return ok(TASK); }
}

test("Today read model requests the selected local date and summarizes active work", async () => {
  const repository = new TodayRepository();
  const result = await getTodayReadModel(
    createAuthenticatedActor("user-today"),
    repository,
    "2026-08-10",
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.tasks.length, 1);
  assert.deepEqual(result.data.summary, { total: 1, completed: 0, remaining: 1 });
  assert.deepEqual(repository.query, {
    plannedForDate: "2026-08-10",
    includeArchived: false,
  });
});
