import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveTask,
  cancelTaskReminder,
  createAuthenticatedActor,
  createTask,
  createTaskReminder,
  getTaskReadModel,
  getTasksReadModel,
  unarchiveTask,
  updateTask,
  type AuthenticatedActor,
  type CreateTaskRecordInput,
  type RepositoryResult,
  type TaskRecord,
  type TaskScopeRecord,
  type TasksRepository,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const NOW = new Date("2026-08-10T12:00:00.000Z");

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

class FakeTasksRepository implements TasksRepository {
  calls: Array<{ method: string; actor: string; input?: unknown }> = [];
  scope: RepositoryResult<TaskScopeRecord> = ok({
    projectIds: ["project-1"],
    goals: [{ id: "goal-1", projectId: "project-1" }],
  });
  list: RepositoryResult<TaskRecord[]> = ok([]);
  task: RepositoryResult<TaskRecord | null> = ok(null);
  reminder: RepositoryResult<TaskRecord | null> = ok(null);
  mutation: RepositoryResult<TaskRecord> = ok({
    id: "task-1",
    title: "Ship Wave 2",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "high",
    dueDate: null,
    estimateMinutes: null,
    projectId: "project-1",
    goalId: null,
    plannedForDate: null,
    focusRank: null,
    archivedAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    reminders: [],
    recurrence: null,
  });

  async getScope(actor: AuthenticatedActor) {
    this.calls.push({ method: "getScope", actor: actor.userId });
    return this.scope;
  }
  async listTasks(actor: AuthenticatedActor) {
    this.calls.push({ method: "listTasks", actor: actor.userId });
    return this.list;
  }
  async listProjectOptions(actor: AuthenticatedActor) {
    this.calls.push({ method: "listProjectOptions", actor: actor.userId });
    return ok([{ id: "project-1", name: "Platform", slug: "platform" }]);
  }
  async listGoalOptions(actor: AuthenticatedActor) {
    this.calls.push({ method: "listGoalOptions", actor: actor.userId });
    return ok([]);
  }
  async getFocusRank(actor: AuthenticatedActor, taskId: string) {
    this.calls.push({ method: "getFocusRank", actor: actor.userId, input: taskId });
    return ok({ exists: true, focusRank: null });
  }
  async getMaxFocusRank(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "getMaxFocusRank", actor: actor.userId, input });
    return ok(0);
  }
  async setFocusRank(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "setFocusRank", actor: actor.userId, input });
    return ok(undefined);
  }
  async getTask(actor: AuthenticatedActor, taskId: string) {
    this.calls.push({ method: "getTask", actor: actor.userId, input: taskId });
    return this.task;
  }
  async createTask(actor: AuthenticatedActor, input: CreateTaskRecordInput) {
    this.calls.push({ method: "createTask", actor: actor.userId, input });
    return this.mutation;
  }
  async updateTask(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "updateTask", actor: actor.userId, input });
    return this.mutation;
  }
  async setTaskArchived(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "setTaskArchived", actor: actor.userId, input });
    return this.mutation;
  }
  async createReminder(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "createReminder", actor: actor.userId, input });
    return this.mutation;
  }
  async findReminderByOperation(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "findReminderByOperation", actor: actor.userId, input });
    return this.reminder;
  }
  async cancelReminder(actor: AuthenticatedActor, input: unknown) {
    this.calls.push({ method: "cancelReminder", actor: actor.userId, input });
    return this.mutation;
  }
}

test("createTask validates scope and delegates normalized task data with the trusted actor", async () => {
  const repository = new FakeTasksRepository();
  const result = await createTask(ACTOR, repository, {
    title: "  Ship Wave 2  ",
    projectId: "project-1",
    goalId: "goal-1",
    description: "  core task  ",
    blockedReason: "",
    status: "todo",
    priority: "high",
    dueDate: null,
    estimateMinutes: 30,
  });

  assert.equal(result.ok, true);
  assert.equal(repository.calls[0]?.method, "getScope");
  assert.equal(repository.calls[0]?.actor, "user-123");
  assert.equal(repository.calls[1]?.method, "createTask");
  assert.deepEqual(repository.calls[1]?.input, {
    title: "Ship Wave 2",
    projectId: "project-1",
    goalId: "goal-1",
    description: "core task",
    blockedReason: null,
    status: "todo",
    priority: "high",
    dueDate: null,
    estimateMinutes: 30,
  });
});

test("createTask propagates the server-bound MCP operation identity", async () => {
  const repository = new FakeTasksRepository();
  const result = await createTask(ACTOR, repository, {
    title: "Ship Wave 2",
    projectId: "project-1",
    status: "todo",
    priority: "high",
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(repository.calls[1]?.input, {
    title: "Ship Wave 2",
    projectId: "project-1",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "high",
    dueDate: null,
    estimateMinutes: null,
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });
});

test("createTask rejects blocked tasks without a blocked reason before persistence", async () => {
  const repository = new FakeTasksRepository();
  const result = await createTask(ACTOR, repository, {
    title: "Blocked",
    projectId: "project-1",
    goalId: null,
    description: null,
    blockedReason: " ",
    status: "blocked",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Blocked reason is required when status is Blocked.");
  assert.equal(repository.calls.length, 0);
});

test("createTask rejects a goal outside the selected project", async () => {
  const repository = new FakeTasksRepository();
  repository.scope = ok({
    projectIds: ["project-1", "project-2"],
    goals: [{ id: "goal-2", projectId: "project-2" }],
  });

  const result = await createTask(ACTOR, repository, {
    title: "Wrong scope",
    projectId: "project-1",
    goalId: "goal-2",
    status: "todo",
    priority: "medium",
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok || result.errorMessage, "Selected goal does not belong to the chosen project.");
  assert.equal(repository.calls.filter((call) => call.method === "createTask").length, 0);
});

test("update/archive/unarchive use the shared task repository boundary", async () => {
  const repository = new FakeTasksRepository();

  assert.equal((await updateTask(ACTOR, repository, { taskId: "task-1", status: "done" })).ok, true);
  assert.equal((await archiveTask(ACTOR, repository, { taskId: "task-1", now: new Date("2026-08-10T12:00:00Z") })).ok, true);
  assert.equal((await unarchiveTask(ACTOR, repository, { taskId: "task-1" })).ok, true);

  assert.deepEqual(repository.calls.map((call) => call.method), [
    "updateTask",
    "setTaskArchived",
    "setTaskArchived",
  ]);
});

test("reminder policy rejects past times and delegates future reminder create/cancel", async () => {
  const repository = new FakeTasksRepository();
  const now = new Date("2026-08-10T12:00:00.000Z");

  const past = await createTaskReminder(ACTOR, repository, {
    taskId: "task-1",
    remindAt: "2026-08-10T11:59:00.000Z",
    now,
  });
  assert.equal(past.ok, false);
  assert.equal(past.ok || past.errorMessage, "Reminder time must be in the future.");

  const future = await createTaskReminder(ACTOR, repository, {
    taskId: "task-1",
    remindAt: "2026-08-10T13:00:00.000Z",
    now,
  });
  assert.equal(future.ok, true);

  const cancelled = await cancelTaskReminder(ACTOR, repository, {
    taskId: "task-1",
    reminderId: "reminder-1",
  });
  assert.equal(cancelled.ok, true);
  assert.deepEqual(repository.calls.map((call) => call.method), ["createReminder", "cancelReminder"]);
});

test("createTaskReminder propagates the server-bound MCP operation identity", async () => {
  const repository = new FakeTasksRepository();
  const result = await createTaskReminder(ACTOR, repository, {
    taskId: "task-1",
    remindAt: "2026-08-10T13:00:00.000Z",
    now: NOW,
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });

  assert.equal(result.ok, true);
  const reminderCall = repository.calls.find((call) => call.method === "createReminder");
  assert.deepEqual(reminderCall?.input, {
    taskId: "task-1",
    remindAt: "2026-08-10T13:00:00.000Z",
    channel: "email",
    status: "pending",
    deliveryMode: "email",
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });
});

test("createTaskReminder replays before time validation after a crash", async () => {
  const repository = new FakeTasksRepository();
  repository.reminder = repository.mutation;

  const result = await createTaskReminder(ACTOR, repository, {
    taskId: "task-1",
    remindAt: "2026-08-10T12:01:00.000Z",
    now: new Date("2026-08-10T12:10:00.000Z"),
    mcpOperationId: "550e8400-e29b-41d4-a716-446655440000",
    mcpClientId: "mcp-client-a",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(repository.calls.map((call) => call.method), ["findReminderByOperation"]);
});

test("task read models preserve actor scoping and missing-task semantics", async () => {
  const repository = new FakeTasksRepository();
  const mutation = repository.mutation;
  assert.equal(mutation.ok, true);
  if (!mutation.ok) return;
  repository.list = ok([mutation.value]);
  repository.task = ok(null);

  const list = await getTasksReadModel(ACTOR, repository);
  const missing = await getTaskReadModel(ACTOR, repository, "missing");

  assert.equal(list.ok, true);
  assert.equal(list.ok && list.data.tasks.length, 1);
  assert.equal(missing.ok, true);
  assert.equal(missing.ok && missing.data, null);
  assert.deepEqual(repository.calls.map((call) => call.actor), [
    "user-123",
    "user-123",
    "user-123",
    "user-123",
  ]);
});
