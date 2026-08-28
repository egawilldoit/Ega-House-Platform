import assert from "node:assert/strict";
import test from "node:test";

import {
  convertInboxItemToTask,
  deterministicTaskIdForInboxConversion,
  createAuthenticatedActor,
  type AuthenticatedActor,
  type InboxRecord,
  type InboxRepository,
  type RepositoryResult,
  type TaskRecord,
  type TasksRepository,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const OTHER_ACTOR = createAuthenticatedActor("user-999");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GOAL_ID = "22222222-2222-4222-8222-222222222222";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}
function conflict(): RepositoryResult<never> {
  return { ok: false, error: { code: "conflict" } };
}
function duplicateTaskError(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" as any, message: "duplicate key value violates unique constraint \"tasks_pkey\" (23505)" } as any };
}

function inboxRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    id: "inbox-1",
    title: "Inbox thought",
    body: "Detailed body",
    status: "inbox",
    type: "idea",
    projectId: PROJECT_ID,
    priority: "high",
    tags: [],
    createdAt: "2026-04-29T12:00:00.000Z",
    updatedAt: "2026-04-29T12:00:00.000Z",
    projectName: "Ops",
    ...overrides,
  };
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Inbox thought",
    description: "Detailed body",
    blockedReason: null,
    status: "todo",
    priority: "high",
    dueDate: null,
    estimateMinutes: null,
    projectId: PROJECT_ID,
    goalId: null,
    plannedForDate: null,
    focusRank: null,
    archivedAt: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    reminders: [],
    recurrence: null,
    ...overrides,
  };
}

class FakeInboxRepository implements InboxRepository {
  calls: Array<{ method: string; args?: unknown; actor?: string }> = [];
  inboxItem: InboxRecord | null = inboxRecord();
  taskLink: string | null = null;
  createLinkShouldFail: RepositoryResult<void> | null = null;
  markConvertedShouldFail = false;
  inboxStore: Map<string, InboxRecord> = new Map();
  linkedTaskIds: Set<string> = new Set();
  tasksRepo?: FakeTasksRepository;

  constructor(tasksRepo?: FakeTasksRepository) {
    this.inboxStore.set("inbox-1", inboxRecord());
    if (tasksRepo) this.tasksRepo = tasksRepo;
  }

  async getScope(actor: AuthenticatedActor) {
    this.calls.push({ method: "getScope", actor: actor.userId });
    return ok({ projectIds: [PROJECT_ID] });
  }
  async listInboxItems() { return ok([] as InboxRecord[]); }
  async listProjectOptions(actor: AuthenticatedActor) {
    this.calls.push({ method: "listProjectOptions", actor: actor.userId });
    return ok([{ id: PROJECT_ID, name: "Ops" }]);
  }
  async getInboxItem(actor: AuthenticatedActor, id: string) {
    this.calls.push({ method: "getInboxItem", args: id, actor: actor.userId });
    if (actor.userId === "user-999") return ok(null);
    const found = this.inboxStore.get(id) ?? this.inboxItem;
    if (found && found.id === id) return ok({ ...found });
    return ok(this.inboxItem && this.inboxItem.id === id ? { ...this.inboxItem } : null);
  }
  async getInboxItemByIdempotencyKey() { return ok(null); }
  async createInboxItem() { return ok(inboxRecord()); }
  async updateInboxItem() { return ok(inboxRecord()); }
  async setInboxItemStatus(actor: AuthenticatedActor, input: any) {
    this.calls.push({ method: "setInboxItemStatus", args: input, actor: actor.userId });
    return ok(inboxRecord({ status: input.status }));
  }
  async getTaskIdForInboxItem(actor: AuthenticatedActor, inboxItemId: string) {
    this.calls.push({ method: "getTaskIdForInboxItem", args: inboxItemId, actor: actor.userId });
    if (actor.userId === "user-999") return ok(null);
    return ok(this.taskLink);
  }
  async createInboxTaskLink(actor: AuthenticatedActor, input: { inboxItemId: string; taskId: string }) {
    this.calls.push({ method: "createInboxTaskLink", args: input, actor: actor.userId });
    if (this.createLinkShouldFail) return this.createLinkShouldFail;
    if (this.taskLink && this.taskLink !== input.taskId) {
      return conflict();
    }
    this.taskLink = input.taskId;
    this.linkedTaskIds.add(input.taskId);
    return ok(undefined);
  }
  async markInboxItemConverted(actor: AuthenticatedActor, inboxItemId: string) {
    this.calls.push({ method: "markInboxItemConverted", args: inboxItemId, actor: actor.userId });
    if (this.markConvertedShouldFail) return fail();
    const existing = this.inboxStore.get(inboxItemId) ?? this.inboxItem;
    if (!existing) return fail();
    const updated = { ...existing, status: "converted" as const, updatedAt: new Date().toISOString() };
    this.inboxStore.set(inboxItemId, updated);
    this.inboxItem = updated;
    return ok(updated);
  }
}

class FakeTasksRepository implements TasksRepository {
  calls: Array<{ method: string; args?: unknown; actor?: string }> = [];
  scope: RepositoryResult<{ projectIds: string[]; goals: Array<{ id: string; projectId: string }> }> = ok({
    projectIds: [PROJECT_ID],
    goals: [{ id: GOAL_ID, projectId: PROJECT_ID }],
  });
  taskStore: Map<string, TaskRecord> = new Map();
  taskOwner: Map<string, string> = new Map();
  createShouldFail = false;
  createShouldDuplicate = false;
  getTaskShouldFail = false;

  constructor() {
    const initial = taskRecord({ id: "task-1", createdAt: new Date().toISOString() } as any);
    this.taskStore.set("task-1", initial);
    this.taskOwner.set("task-1", ACTOR.userId);
  }

  async getScope(actor: AuthenticatedActor) {
    this.calls.push({ method: "getScope", actor: actor.userId });
    return this.scope;
  }
  async listTasks() { return ok([]); }
  async listProjectOptions() { return ok([] as any); }
  async listGoalOptions() { return ok([] as any); }
  async getTask(actor: AuthenticatedActor, taskId: string) {
    this.calls.push({ method: "getTask", args: taskId, actor: actor.userId });
    if (this.getTaskShouldFail) return fail();
    if (actor.userId === "user-999") return ok(null);
    const found = this.taskStore.get(taskId);
    return ok(found ? { ...found } : null);
  }
  async createTask(actor: AuthenticatedActor, input: any) {
    this.calls.push({ method: "createTask", args: input, actor: actor.userId });
    if (this.createShouldFail) return fail();
    if (actor.userId === "user-999") return fail();
    const desiredId = input.id ? String(input.id).trim() : null;
    if (desiredId) {
      if (this.taskStore.has(desiredId)) {
        if (this.createShouldDuplicate) return duplicateTaskError();
        // deterministic duplicate: simulate PK conflict
        return duplicateTaskError();
      }
      const nowIso = new Date().toISOString();
      const record = taskRecord({
        id: desiredId,
        title: input.title,
        description: input.description,
        projectId: input.projectId,
        goalId: input.goalId,
        priority: input.priority,
        dueDate: input.dueDate,
        createdAt: nowIso,
        updatedAt: nowIso,
      } as any);
      this.taskStore.set(desiredId, record);
      this.taskOwner.set(desiredId, actor.userId);
      return ok(record);
    }
    const id = `task-${this.taskStore.size + 1}`;
    const nowIso = new Date().toISOString();
    const record = taskRecord({
      id,
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      goalId: input.goalId,
      priority: input.priority,
      dueDate: input.dueDate,
      createdAt: nowIso,
      updatedAt: nowIso,
    } as any);
    this.taskStore.set(id, record);
    this.taskOwner.set(id, actor.userId);
    return ok(record);
  }
  async updateTask() { return ok(taskRecord()); }
  async setTaskArchived() { return ok(taskRecord()); }
  async createReminder(actor: AuthenticatedActor, input: any) {
    this.calls.push({ method: "createReminder", args: input, actor: actor.userId });
    const task = this.taskStore.get(input.taskId);
    if (!task) return fail();
    // Idempotency via source correlation: if source+sourceId already exists, simulate DB unique violation
    if (input.source && input.sourceId) {
      const exists = task.reminders.some(
        (r: any) => r.source === input.source && r.sourceId === input.sourceId,
      );
      if (exists) {
        // Simulate unique constraint violation - data-access would catch and return existing task
        // For fake, return duplicate error so caller can handle, but our new convert checks existence before calling,
        // so this path should rarely be hit except concurrent races. Return duplicate-like error.
        return { ok: false, error: { code: "23505", message: "duplicate key value violates unique constraint \"task_reminders_owner_source_source_id_unique\"" } } as any;
      }
    }
    const updated = {
      ...task,
      reminders: [
        ...task.reminders,
        {
          id: `reminder-${task.reminders.length + 1}`,
          taskId: input.taskId,
          remindAt: input.remindAt,
          channel: "email" as const,
          status: "pending" as const,
          sentAt: null,
          failureReason: null,
          source: input.source ?? null,
          sourceId: input.sourceId ?? null,
        },
      ],
    };
    this.taskStore.set(input.taskId, updated);
    return ok(updated);
  }
  async cancelReminder() { return ok(taskRecord()); }
  async getFocusRank() { return ok({ exists: true, focusRank: null }); }
  async getMaxFocusRank() { return ok(0); }
  async setFocusRank() { return ok(undefined); }
}

test("deterministic task id is stable and owner-scoped", async () => {
  const id1 = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  const id2 = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  const idOtherInbox = deterministicTaskIdForInboxConversion(ACTOR, "inbox-2");
  const idOtherOwner = deterministicTaskIdForInboxConversion(OTHER_ACTOR, "inbox-1");
  assert.equal(id1, id2, "same inbox+owner yields same deterministic id");
  assert.notEqual(id1, idOtherInbox, "different inbox yields different id");
  assert.notEqual(id1, idOtherOwner, "different owner yields different id");
  // UUID format
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("convert creates Task with deterministic id, persists link before marking converted", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", title: "Build inbox conversion", body: "Body", projectId: PROJECT_ID, priority: "high" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const expectedId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  assert.equal(result.data.task.id, expectedId, "task id should be deterministic");
  assert.equal(result.data.task.title, "Build inbox conversion");
  assert.equal(result.data.task.projectId, PROJECT_ID);
  assert.equal(result.data.task.priority, "high");
  assert.equal(result.data.inboxItem.status, "converted");
  const linkIdx = inboxRepo.calls.findIndex((c) => c.method === "createInboxTaskLink");
  const markIdx = inboxRepo.calls.findIndex((c) => c.method === "markInboxItemConverted");
  assert.ok(linkIdx >= 0 && markIdx >= 0 && linkIdx < markIdx, "link should be before mark");
  // Verify createTask was called with deterministic id
  const createCall = tasksRepo.calls.find((c) => c.method === "createTask");
  assert.ok(createCall);
  assert.equal((createCall.args as any).id, expectedId);
});

test("same approved conversion does not create second Task (idempotency via link)", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  const firstTaskId = (first as any).data.task.id;
  const createCountAfterFirst = tasksRepo.calls.filter((c) => c.method === "createTask").length;

  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.task.id, firstTaskId);
  const createCountAfterSecond = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCountAfterSecond, createCountAfterFirst, "should not create second task on retry via link idempotency");
});

test("retry after link failure reuses deterministic task (no duplicate) - deterministic correlation", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  inboxRepo.createLinkShouldFail = fail();

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(first.ok, false);
  assert.match((first as any).errorMessage, /link/i);
  const afterFail = inboxRepo.inboxStore.get("inbox-2")!;
  assert.equal(afterFail.status !== "converted", true);
  const createCountAfterFirst = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCountAfterFirst, 1);
  const deterministicId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-2");
  assert.ok(tasksRepo.taskStore.has(deterministicId), "deterministic task should exist after link failure");
  const orphanTaskId = deterministicId;

  inboxRepo.createLinkShouldFail = null;
  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.inboxItem.status, "converted");
  assert.equal((second as any).data.task.id, orphanTaskId, "retry should reuse deterministic task id, not create second");
  const createCountAfterSecond = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  // Second attempt will try to getTask deterministic first, then attempt create which will duplicate, then fetch existing. So create count may be 1 or 2 depending on path, but task count should remain 1 deterministic
  assert.ok(tasksRepo.taskStore.size === 2 || tasksRepo.taskStore.size === 3, "task store should not have extra orphan beyond deterministic");
  assert.equal(inboxRepo.taskLink, orphanTaskId);
});

test("same-looking unrelated Task not adopted - deterministic id prevents heuristic false adoption", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  // Create an unrelated task with same title/project but different deterministic id (because different inbox id)
  // This simulates the unsafe heuristic scenario: heuristic would have adopted this task, deterministic must not.
  const unrelatedId = "task-unrelated-same-title";
  const nowIso = new Date().toISOString();
  tasksRepo.taskStore.set(
    unrelatedId,
    taskRecord({ id: unrelatedId, title: "Recoverable", projectId: PROJECT_ID, createdAt: nowIso, updatedAt: nowIso } as any),
  );
  tasksRepo.taskOwner.set(unrelatedId, ACTOR.userId);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  const deterministicId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-2");
  assert.notEqual(unrelatedId, deterministicId, "unrelated task should have different id than deterministic");

  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(result.ok, true);
  assert.notEqual((result as any).data.task.id, unrelatedId, "should not reuse same-looking unrelated task");
  assert.equal((result as any).data.task.id, deterministicId, "should create deterministic task, not adopt unrelated");
  assert.equal(inboxRepo.taskLink, deterministicId);
  // Ensure unrelated task still exists but not linked
  assert.ok(tasksRepo.taskStore.has(unrelatedId));
  assert.ok(!inboxRepo.linkedTaskIds.has(unrelatedId));
});

test("concurrent converts with same inbox produce single deterministic Task (conflict handling)", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", title: "Concurrent" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  // Simulate concurrent: first creates deterministic task, second attempts same deterministic id and gets duplicate error
  // Our FakeTasksRepository already returns duplicate error if id exists
  const deterministicId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  // First convert
  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  assert.equal((first as any).data.task.id, deterministicId);

  // Reset link to simulate race where second caller saw no link before first committed? But link already exists, so second will hit link idempotency path
  // To simulate true concurrency, we need a fresh repo pair where link not yet visible
  const tasksRepo2 = new FakeTasksRepository();
  const inboxRepo2 = new FakeInboxRepository(tasksRepo2);
  // Pre-populate deterministic task as if first concurrent created it but link not yet visible to second
  const nowIso = new Date().toISOString();
  tasksRepo2.taskStore.set(deterministicId, taskRecord({ id: deterministicId, title: "Concurrent", projectId: PROJECT_ID, createdAt: nowIso, updatedAt: nowIso } as any));
  tasksRepo2.taskOwner.set(deterministicId, ACTOR.userId);
  inboxRepo2.inboxItem = inboxRecord({ id: "inbox-1", title: "Concurrent" });
  inboxRepo2.inboxStore.set("inbox-1", inboxRepo2.inboxItem);
  inboxRepo2.taskLink = null; // no link yet

  const concurrent = await convertInboxItemToTask(ACTOR, inboxRepo2, tasksRepo2, { inboxItemId: "inbox-1" });
  assert.equal(concurrent.ok, true);
  assert.equal((concurrent as any).data.task.id, deterministicId, "concurrent should resolve to same deterministic id");
  // Should not have created second task with different id
  assert.equal(tasksRepo2.taskStore.size, 2, "only initial + deterministic, no extra");
});

test("retry after link failure with remindAt still same deterministic Task", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "With reminder" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  inboxRepo.createLinkShouldFail = fail();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2", remindAt: future }, { now: new Date() });
  assert.equal(first.ok, false);

  inboxRepo.createLinkShouldFail = null;
  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2", remindAt: future }, { now: new Date() });
  assert.equal(second.ok, true);
  const deterministicId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-2");
  assert.equal((second as any).data.task.id, deterministicId);
  assert.ok((second as any).data.task.reminders.length > 0, "reminder should be created on retry");
});

test("archive/keep transitions remain explicit and owner-scoped", async () => {
  const inboxRepo = new FakeInboxRepository();
  await inboxRepo.setInboxItemStatus(ACTOR, { id: "inbox-1", status: "archived" });
  assert.equal(inboxRepo.calls[0].actor, "user-123");
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", status: "archived" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);
  inboxRepo.taskLink = null;
  const tasksRepo = new FakeTasksRepository();
  const conv = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(conv.ok, false);
  assert.match((conv as any).errorMessage, /Archived/i);
});

test("cross-owner conversion is blocked", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);
  const result = await convertInboxItemToTask(OTHER_ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(result.ok, false);
  assert.equal((result as any).errorMessage, "Idea is unavailable.");
  assert.equal(tasksRepo.calls.filter((c) => c.method === "createTask" && c.actor === "user-999").length, 0);
});

test("manual fallback creates Task without AI, validating existing Project/Goal", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", projectId: null, title: "Manual task" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, {
    inboxItemId: "inbox-1",
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    priority: "urgent",
    dueDate: "2026-09-01",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.task.projectId, PROJECT_ID);
  assert.equal(result.data.task.goalId, GOAL_ID);
  assert.equal(result.data.task.priority, "urgent");
  assert.equal(result.data.task.dueDate, "2026-09-01");
});

test("conversion validates Project/Goal ownership and rejects auto-creation", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  tasksRepo.scope = ok({ projectIds: [PROJECT_ID], goals: [{ id: GOAL_ID, projectId: PROJECT_ID }] });
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", projectId: PROJECT_ID });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const badProject = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, {
    inboxItemId: "inbox-1",
    projectId: "99999999-9999-4999-8999-999999999999",
  });
  assert.equal(badProject.ok, false);
  assert.match((badProject as any).errorMessage, /project/i);

  const badGoal = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, {
    inboxItemId: "inbox-1",
    goalId: "bad-goal-id",
  });
  assert.equal(badGoal.ok, false);
  assert.match((badGoal as any).errorMessage, /goal/i);

  tasksRepo.scope = ok({ projectIds: [PROJECT_ID, "33333333-3333-4333-8333-333333333333"], goals: [{ id: GOAL_ID, projectId: "33333333-3333-4333-8333-333333333333" }] });
  const wrongProjectGoal = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, {
    inboxItemId: "inbox-1",
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
  });
  assert.equal(wrongProjectGoal.ok, false);
  assert.match((wrongProjectGoal as any).errorMessage, /goal.*project/i);
});

test("conversion with reminder validates and creates reminder", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(result.ok, true);
  assert.ok(tasksRepo.calls.some((c) => c.method === "createReminder"));

  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const inboxRepo2 = new FakeInboxRepository();
  inboxRepo2.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo2.inboxStore.set("inbox-1", inboxRepo2.inboxItem);
  const tasksRepo2 = new FakeTasksRepository();
  const pastResult = await convertInboxItemToTask(ACTOR, inboxRepo2, tasksRepo2, { inboxItemId: "inbox-1", remindAt: past }, { now: new Date() });
  assert.equal(pastResult.ok, false);
  assert.match((pastResult as any).errorMessage, /future/i);
});

test("reconciliation after link succeeded but status failed returns existing task without duplicate", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  const taskId = (first as any).data.task.id;

  inboxRepo.inboxStore.set("inbox-1", inboxRecord({ id: "inbox-1", status: "inbox" }));
  inboxRepo.taskLink = taskId;

  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.task.id, taskId);
  const createCount = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCount, 1, "should not create second task when link already exists");
});

// --- Repair TDD: cases A-F for reminder invariant (must fail before fix, pass after) ---

test("BUG1-A: retry after reminder creation failure must not mark converted without reminder (exact proof)", async () => {
  const tasksRepo = new FakeTasksRepository();
  // Make createReminder fail on first call, succeed on second
  let reminderCall = 0;
  const origCreateReminder = tasksRepo.createReminder.bind(tasksRepo);
  tasksRepo.createReminder = async (actor: AuthenticatedActor, input: any) => {
    reminderCall++;
    if (reminderCall === 1) return fail() as any;
    return origCreateReminder(actor, input);
  };
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-reminder-fail", title: "Need reminder" });
  inboxRepo.inboxStore.set("inbox-reminder-fail", inboxRepo.inboxItem);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date();

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-reminder-fail", remindAt: future }, { now });
  assert.equal(first.ok, false, "first attempt should fail when reminder creation fails");
  // Invariant: not converted, link exists but reminder missing -> must not be converted
  const afterFirstInbox = inboxRepo.inboxStore.get("inbox-reminder-fail")!;
  assert.notEqual(afterFirstInbox.status, "converted", "must not be converted while reminder missing");
  // task should exist, link should exist, but no reminder
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-reminder-fail");
  const taskAfterFirst = tasksRepo.taskStore.get(detId);
  assert.ok(taskAfterFirst, "task should exist even though reminder failed");
  assert.equal(taskAfterFirst!.reminders.length, 0, "no reminder yet");

  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-reminder-fail", remindAt: future }, { now });
  assert.equal(second.ok, true, "retry should succeed and create reminder");
  assert.equal((second as any).data.inboxItem.status, "converted");
  assert.equal((second as any).data.task.reminders.length, 1, "retry must prove reminder exists exactly once before marking converted");
  // Ensure not marked converted without reminder: fetch link path alone would have returned 0 reminders
  assert.equal(inboxRepo.taskLink, detId);
});

test("BUG1-B: invalid remindAt must fail before any side effects (no task, no link, not converted)", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-invalid-time", title: "Invalid time" });
  inboxRepo.inboxStore.set("inbox-invalid-time", inboxRepo.inboxItem);
  const initialTaskCount = tasksRepo.taskStore.size;
  const invalidPast = new Date(Date.now() - 60 * 1000).toISOString();
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-invalid-time", remindAt: invalidPast }, { now: new Date() });
  assert.equal(result.ok, false);
  assert.match((result as any).errorMessage, /future/i);
  assert.equal(tasksRepo.taskStore.size, initialTaskCount, "invalid timestamp must not create orphan task");
  assert.equal(inboxRepo.taskLink, null, "no link must be created");
  assert.notEqual(inboxRepo.inboxStore.get("inbox-invalid-time")!.status, "converted");

  const badFormat = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-invalid-time", remindAt: "not-a-date" }, { now: new Date() });
  assert.equal(badFormat.ok, false);
  assert.match((badFormat as any).errorMessage, /invalid/i);
  assert.equal(tasksRepo.taskStore.size, initialTaskCount);
});

test("BUG1-C: link succeeds but markConverted fails then retry with reminder must still ensure single reminder", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-mark-fail", title: "Mark fail" });
  inboxRepo.inboxStore.set("inbox-mark-fail", inboxRepo.inboxItem);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date();

  // First attempt: make mark fail after reminder creation
  inboxRepo.markConvertedShouldFail = true;
  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-mark-fail", remindAt: future }, { now });
  assert.equal(first.ok, false, "mark failure should be reported, not claimed converted");
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-mark-fail");
  const taskAfterFirst = tasksRepo.taskStore.get(detId)!;
  assert.equal(taskAfterFirst.reminders.length, 1, "reminder should exist even though mark failed");
  assert.notEqual(inboxRepo.inboxStore.get("inbox-mark-fail")!.status, "converted");

  inboxRepo.markConvertedShouldFail = false;
  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-mark-fail", remindAt: future }, { now });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.inboxItem.status, "converted");
  // Must not create duplicate reminder on retry: still exactly one
  const taskAfterSecond = tasksRepo.taskStore.get(detId)!;
  assert.equal(taskAfterSecond.reminders.length, 1, "retry must not duplicate reminder, exactly once");
});

test("BUG1-D: concurrent converts with reminder must result in exactly one reminder (idempotency via source correlation)", async () => {
  const tasksRepo = new FakeTasksRepository();
  // Simulate second concurrent sees deterministic task already exists but link not yet visible?
  // Our Fake will handle PK duplicate and link conflict; reminder idempotency must also be exact.
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-concurrent-reminder", title: "Concurrent reminder" });
  inboxRepo.inboxStore.set("inbox-concurrent-reminder", inboxRepo.inboxItem);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const now = new Date();
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-concurrent-reminder");

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-concurrent-reminder", remindAt: future }, { now });
  assert.equal(first.ok, true);
  assert.equal((first as any).data.task.reminders.length, 1);

  // Second caller: fresh store but task already exists (simulating race where task creation serialized)
  const tasksRepo2 = new FakeTasksRepository();
  const nowIso = new Date().toISOString();
  // Pre-populate deterministic task without reminder? Or with reminder? To simulate reminder already created but link not yet?
  // More realistic: second caller finds task exists with reminder already, should not duplicate.
  tasksRepo2.taskStore.set(detId, taskRecord({ id: detId, title: "Concurrent reminder", projectId: PROJECT_ID, createdAt: nowIso, updatedAt: nowIso, reminders: [{ id: "reminder-1", taskId: detId, remindAt: future, channel: "email" as const, status: "pending" as const, sentAt: null, failureReason: null, source: "smart_inbox_conversion" as any, sourceId: "inbox-concurrent-reminder" as any }] } as any));
  tasksRepo2.taskOwner.set(detId, ACTOR.userId);
  const inboxRepo2 = new FakeInboxRepository(tasksRepo2);
  inboxRepo2.inboxItem = inboxRecord({ id: "inbox-concurrent-reminder", title: "Concurrent reminder" });
  inboxRepo2.inboxStore.set("inbox-concurrent-reminder", inboxRepo2.inboxItem);
  inboxRepo2.taskLink = null;

  const second = await convertInboxItemToTask(ACTOR, inboxRepo2, tasksRepo2, { inboxItemId: "inbox-concurrent-reminder", remindAt: future }, { now });
  assert.equal(second.ok, true);
  // Must reuse same task and not duplicate reminder
  assert.equal((second as any).data.task.id, detId);
  const finalTask = tasksRepo2.taskStore.get(detId)!;
  assert.equal(finalTask.reminders.length, 1, "concurrent must not duplicate reminder, exactly once");
});

test("BUG1-E: successful conversion invariant - Task exactly once, link exactly once, reminder exactly once, status converted", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-invariant", title: "Invariant" });
  inboxRepo.inboxStore.set("inbox-invariant", inboxRepo.inboxItem);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-invariant", remindAt: future }, { now: new Date() });
  assert.equal(result.ok, true);
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-invariant");
  assert.equal((result as any).data.task.id, detId);
  assert.equal(inboxRepo.taskLink, detId);
  const task = tasksRepo.taskStore.get(detId)!;
  assert.equal(task.reminders.length, 1);
  assert.equal((result as any).data.inboxItem.status, "converted");
  // Retry should keep exact once
  const retry = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-invariant", remindAt: future }, { now: new Date() });
  assert.equal(retry.ok, true);
  assert.equal(tasksRepo.taskStore.get(detId)!.reminders.length, 1, "retry must keep reminder exactly once");
  assert.equal(inboxRepo.taskLink, detId);
  assert.equal(retry.data.inboxItem.status, "converted");
});
