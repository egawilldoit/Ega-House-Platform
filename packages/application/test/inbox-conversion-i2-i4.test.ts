import assert from "node:assert/strict";
import test from "node:test";

import {
  convertInboxItemToTask,
  deterministicTaskIdForInboxConversion,
  createAuthenticatedActor,
  type InboxRepository,
  type TasksRepository,
  type InboxRecord,
  type TaskRecord,
  type RepositoryResult,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const GOAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GOAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}

function inboxRecord(overrides: Partial<InboxRecord> = {}): InboxRecord {
  return {
    id: "inbox-1",
    title: "Thought",
    body: null,
    status: "inbox",
    type: "idea",
    projectId: PROJECT_A,
    priority: "medium",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectName: null,
    ...overrides,
  };
}
function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Thought",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    projectId: PROJECT_A,
    goalId: null,
    plannedForDate: null,
    focusRank: null,
    archivedAt: null,
    updatedAt: new Date().toISOString(),
    reminders: [],
    recurrence: null,
    ...overrides,
  };
}

class FakeInbox implements InboxRepository {
  inbox: InboxRecord = inboxRecord();
  taskLink: string | null = null;
  async getScope() { return ok({ projectIds: [PROJECT_A, PROJECT_B] }); }
  async listInboxItems() { return ok([] as InboxRecord[]); }
  async listProjectOptions() { return ok([] as any); }
  async getInboxItem(_actor: any, id: string) {
    if (id === this.inbox.id) return ok({ ...this.inbox });
    return ok(null);
  }
  async getInboxItemByIdempotencyKey() { return ok(null); }
  async getInboxIdempotencyEntry() { return ok(null); }
  async createInboxItem() { return ok(this.inbox); }
  async updateInboxItem() { return ok(this.inbox); }
  async setInboxItemStatus() { return ok(this.inbox); }
  async getTaskIdForInboxItem() { return ok(this.taskLink); }
  async createInboxTaskLink(_actor: any, input: { inboxItemId: string; taskId: string }) {
    if (this.taskLink && this.taskLink !== input.taskId) return { ok: false, error: { code: "conflict" } } as any;
    this.taskLink = input.taskId;
    return ok(undefined);
  }
  async markInboxItemConverted(_actor: any, id: string) {
    const updated = { ...this.inbox, status: "converted" as const };
    this.inbox = updated;
    return ok(updated);
  }
}

class FakeTasks implements TasksRepository {
  scope: RepositoryResult<{ projectIds: string[]; goals: Array<{ id: string; projectId: string }> }> = ok({
    projectIds: [PROJECT_A, PROJECT_B],
    goals: [
      { id: GOAL_A, projectId: PROJECT_A },
      { id: GOAL_B, projectId: PROJECT_B },
    ],
  });
  store = new Map<string, TaskRecord>();
  async getScope() { return this.scope; }
  async listTasks() { return ok([] as any); }
  async listProjectOptions() { return ok([] as any); }
  async listGoalOptions() { return ok([] as any); }
  async getTask(_actor: any, id: string) {
    const v = this.store.get(id);
    return ok(v ? { ...v } : null);
  }
  async createTask(_actor: any, input: any) {
    const id = input.id ?? `task-${this.store.size + 1}`;
    if (this.store.has(id)) return { ok: false, error: { code: "conflict" } } as any;
    const rec = taskRecord({
      id,
      title: input.title,
      projectId: input.projectId,
      goalId: input.goalId,
      priority: input.priority,
      dueDate: input.dueDate,
      description: input.description,
    } as any);
    this.store.set(id, rec);
    return ok(rec);
  }
  async updateTask() { return ok(taskRecord()); }
  async setTaskArchived() { return ok(taskRecord()); }
  async createReminder(_actor: any, input: any) {
    const task = this.store.get(input.taskId);
    if (!task) return fail() as any;
    if (input.source && input.sourceId) {
      const exists = task.reminders.some((r: any) => r.source === input.source && r.sourceId === input.sourceId);
      if (exists) return { ok: false, error: { code: "conflict" } } as any;
    }
    const updated = {
      ...task,
      reminders: [
        ...task.reminders,
        {
          id: `rem-${task.reminders.length + 1}`,
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
    this.store.set(input.taskId, updated);
    return ok(updated);
  }
  async findReminderByOperation() { return ok(null as TaskRecord | null); }
  async cancelReminder() { return ok(taskRecord()); }
  async getFocusRank() { return ok({ exists: true, focusRank: null }); }
  async getMaxFocusRank() { return ok(null); }
  async setFocusRank() { return ok(undefined); }
}

test("I2: reuse path with different projectId fails validation not silent return", async () => {
  const inbox = new FakeInbox();
  const tasks = new FakeTasks();
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  // First conversion creates task with PROJECT_A
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  // Reset inbox to inbox (not converted) but link already exists, task exists deterministic
  inbox.inbox = inboxRecord({ id: "inbox-1", status: "inbox", projectId: PROJECT_A });
  inbox.taskLink = detId;
  // Second call with different projectId should be validation failure, not silent reuse
  // Need fresh inbox repo with same link but we will call convert again; first step will load inbox (inbox) then attempt reuse
  // Simulate second caller: they provide different projectId
  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", projectId: PROJECT_B });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "validation");
  assert.match((second as unknown as { errorMessage: string }).errorMessage, /project/i);
});

test("I2: reuse path with different goalId fails validation", async () => {
  const inbox = new FakeInbox();
  const tasks = new FakeTasks();
  tasks.scope = ok({ projectIds: [PROJECT_A], goals: [{ id: GOAL_A, projectId: PROJECT_A }, { id: GOAL_B, projectId: PROJECT_A }] });
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", goalId: GOAL_A });
  assert.equal(first.ok, true);
  inbox.inbox = inboxRecord({ id: "inbox-1", status: "inbox", projectId: PROJECT_A });
  inbox.taskLink = detId;
  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", goalId: GOAL_B });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "validation");
});

test("I2: reuse path with different priority fails validation", async () => {
  const inbox = new FakeInbox();
  inbox.inbox = inboxRecord({ priority: "medium" });
  const tasks = new FakeTasks();
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", priority: "medium" });
  assert.equal(first.ok, true);
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  inbox.inbox = inboxRecord({ id: "inbox-1", status: "inbox", priority: "medium" });
  inbox.taskLink = detId;
  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", priority: "high" });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "validation");
});

test("I4: reminder mismatch returns conflict not silent success", async () => {
  const inbox = new FakeInbox();
  const tasks = new FakeTasks();
  const future1 = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const future2 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future1 }, { now: new Date() });
  assert.equal(first.ok, true);
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  // Reset inbox to allow retry (simulate link exists but not converted? Actually after first, inbox is converted. For test, create new inbox with same id but not converted, pre-populate task with reminder)
  const tasks2 = new FakeTasks();
  const taskWithReminder = taskRecord({ id: detId, reminders: [{ id: "r1", taskId: detId, remindAt: future1, channel: "email", deliveryMode: "email", status: "pending", sentAt: null, failureReason: null, source: "smart_inbox_conversion", sourceId: "inbox-1" } as any] });
  tasks2.store.set(detId, taskWithReminder);
  const inbox2 = new FakeInbox();
  inbox2.inbox = inboxRecord({ id: "inbox-1", status: "inbox" });
  inbox2.taskLink = null;
  // Ensure getTask returns the task with reminder
  const second = await convertInboxItemToTask(ACTOR, inbox2, tasks2, { inboxItemId: "inbox-1", remindAt: future2 }, { now: new Date() });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "conflict");
  assert.match((second as unknown as { errorMessage: string }).errorMessage, /Reminder.*conflict/i);
});

test("I4: same remindAt replay is idempotent not conflict", async () => {
  const inbox = new FakeInbox();
  const tasks = new FakeTasks();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(first.ok, true);
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  const inbox2 = new FakeInbox();
  inbox2.inbox = inboxRecord({ id: "inbox-1", status: "inbox" });
  // Pre-populate tasks2 with same task+reminder
  const tasks2 = new FakeTasks();
  tasks2.store.set(detId, tasks.store.get(detId)!);
  // second should be idempotent (same remindAt) -> success? But inbox still not converted, will try to reuse task and reminder
  const second = await convertInboxItemToTask(ACTOR, inbox2, tasks2, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(second.ok, true);
});
