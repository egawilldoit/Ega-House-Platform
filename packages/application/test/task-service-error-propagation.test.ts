import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  createTask,
  type TasksRepository,
  type RepositoryResult,
  type TaskRecord,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

test("I1: repository conflict code propagates through createTask not erased to generic", async () => {
  const repo: TasksRepository = {
    async getScope() {
      return ok({ projectIds: ["proj-1"], goals: [] });
    },
    async listTasks() { return ok([] as any); },
    async listProjectOptions() { return ok([] as any); },
    async listGoalOptions() { return ok([] as any); },
    async getTask() { return ok(null); },
    async createTask() {
      // Simulate PK duplicate due to deterministic id collision
      return { ok: false, error: { code: "conflict" } };
    },
    async updateTask() { return ok(null as any); },
    async setTaskArchived() { return ok(null as any); },
    async createReminder() { return ok(null as any); },
    async cancelReminder() { return ok(null as any); },
    async getFocusRank() { return ok({ exists: true, focusRank: null }); },
    async getMaxFocusRank() { return ok(null); },
    async setFocusRank() { return ok(undefined); },
  } as unknown as TasksRepository;

  const result = await createTask(ACTOR, repo, { title: "Dup", projectId: "proj-1" }, { preallocatedId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code?: string }).code, "conflict", "error code should be conflict not erased");
  assert.match((result as unknown as { errorMessage: string }).errorMessage, /Unable to create task/);
});

test("I1: validation error for project has validation code not generic", async () => {
  const repo: TasksRepository = {
    async getScope() {
      return ok({ projectIds: ["proj-1"], goals: [] });
    },
    async listTasks() { return ok([] as any); },
    async listProjectOptions() { return ok([] as any); },
    async listGoalOptions() { return ok([] as any); },
    async getTask() { return ok(null); },
    async createTask() { return ok({} as any); },
    async updateTask() { return ok(null as any); },
    async setTaskArchived() { return ok(null as any); },
    async createReminder() { return ok(null as any); },
    async cancelReminder() { return ok(null as any); },
    async getFocusRank() { return ok({ exists: true, focusRank: null }); },
    async getMaxFocusRank() { return ok(null); },
    async setFocusRank() { return ok(undefined); },
  } as unknown as TasksRepository;

  const result = await createTask(ACTOR, repo, { title: "Bad", projectId: "unknown-proj" });
  assert.equal(result.ok, false);
  assert.equal((result as unknown as { code?: string }).code, "validation");
});
