import assert from "node:assert/strict";
import test from "node:test";

import {
  convertInboxItemToTask,
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

// Helpers for inbox/task records
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
  // For orphan reconciliation: track linked ids and reference to tasks repo
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
    // Owner scoping: if actor is OTHER, return null to simulate not found
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
      // Simulate duplicate
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
  async findRecentOrphanTaskId(
    actor: AuthenticatedActor,
    input: { title: string; projectId: string | null; sinceIso: string },
  ): Promise<RepositoryResult<string | null>> {
    this.calls.push({ method: "findRecentOrphanTaskId", args: input, actor: actor.userId });
    // Owner-scoped: other actor sees nothing
    if (actor.userId === "user-999") return ok(null);
    const repo = this.tasksRepo;
    if (!repo) return ok(null);
    const title = String(input.title ?? "").trim();
    const projectId = input.projectId ? String(input.projectId).trim() : null;
    const sinceIso = String(input.sinceIso ?? "").trim();
    if (!title || !sinceIso) return ok(null);
    const sinceMs = Date.parse(sinceIso);
    if (Number.isNaN(sinceMs)) return ok(null);
    let candidates: Array<{ id: string; createdAt: string }> = [];
    for (const [id, rec] of repo.taskStore.entries()) {
      const owner = repo.taskOwner.get(id);
      if (owner && owner !== actor.userId) continue;
      // Owner-scoped via taskOwner, but also ensure title/project match
      if (rec.title !== title) continue;
      if (projectId) {
        if (rec.projectId !== projectId) continue;
      } else {
        if (rec.projectId) continue;
      }
      const createdAt = (rec as any).createdAt ?? (rec as any).updatedAt ?? new Date().toISOString();
      const createdMs = Date.parse(String(createdAt));
      if (Number.isNaN(createdMs) || createdMs <= sinceMs) continue;
      if (this.linkedTaskIds.has(id) || this.taskLink === id) continue;
      candidates.push({ id, createdAt: String(createdAt) });
    }
    if (candidates.length === 0) return ok(null);
    candidates.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return ok(candidates[0].id);
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
    // Simulate creation with generated id and owner/time tracking for orphan test
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
    const updated = {
      ...task,
      reminders: [
        ...task.reminders,
        {
          id: "reminder-1",
          taskId: input.taskId,
          remindAt: input.remindAt,
          channel: "email" as const,
          status: "pending" as const,
          sentAt: null,
          failureReason: null,
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

test("convert creates Task, persists link before marking converted, validates via canonical Task rules", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1", title: "Build inbox conversion", body: "Body", projectId: PROJECT_ID, priority: "high" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.task.title, "Build inbox conversion");
  assert.equal(result.data.task.projectId, PROJECT_ID);
  assert.equal(result.data.task.priority, "high");
  assert.equal(result.data.inboxItem.status, "converted");
  // Verify link was created before marking
  const linkIdx = inboxRepo.calls.findIndex((c) => c.method === "createInboxTaskLink");
  const markIdx = inboxRepo.calls.findIndex((c) => c.method === "markInboxItemConverted");
  assert.ok(linkIdx >= 0 && markIdx >= 0 && linkIdx < markIdx, "link should be before mark");
  assert.ok(tasksRepo.calls.some((c) => c.method === "createTask"), "should reuse canonical createTask");
});

test("same approved conversion does not create second Task (idempotency)", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-1" });
  inboxRepo.inboxStore.set("inbox-1", inboxRepo.inboxItem);

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  const firstTaskId = (first as any).data.task.id;
  const createCountAfterFirst = tasksRepo.calls.filter((c) => c.method === "createTask").length;

  // Second conversion with same inbox id
  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.task.id, firstTaskId);
  const createCountAfterSecond = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCountAfterSecond, createCountAfterFirst, "should not create second task on retry");
});

test("failed link leaves inbox recoverable and reports reason; retry reconciles to existing Task", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  // Simulate link failure on first attempt
  inboxRepo.createLinkShouldFail = fail();

  const first = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(first.ok, false);
  assert.match((first as any).errorMessage, /link/i);
  // Inbox should still not be converted (recoverable)
  const afterFail = inboxRepo.inboxStore.get("inbox-2")!;
  assert.equal(afterFail.status !== "converted", true);
  const createCountAfterFirst = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCountAfterFirst, 1);
  // Capture orphan id (the task created despite link failure)
  const orphanTaskId = Array.from(tasksRepo.taskStore.keys()).find((id) => id !== "task-1" && !inboxRepo.linkedTaskIds.has(id))!;
  assert.ok(orphanTaskId, "orphan task should exist after link failure");

  // Second attempt: link should succeed now; should reconcile to orphan, not create second task (EGA-507)
  inboxRepo.createLinkShouldFail = null;
  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.inboxItem.status, "converted");
  assert.equal((second as any).data.task.id, orphanTaskId, "retry should reuse orphan task id, not create second");
  const createCountAfterSecond = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCountAfterSecond, createCountAfterFirst, "should not create second task when orphan exists");
  assert.equal(inboxRepo.taskLink, orphanTaskId);
});

test("orphan reconciliation is owner-scoped: other owner's task not reused", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  const otherTaskId = "task-other";
  const nowIso = new Date().toISOString();
  tasksRepo.taskStore.set(
    otherTaskId,
    taskRecord({ id: otherTaskId, title: "Recoverable", projectId: PROJECT_ID, createdAt: nowIso, updatedAt: nowIso } as any),
  );
  tasksRepo.taskOwner.set(otherTaskId, OTHER_ACTOR.userId);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(result.ok, true);
  assert.notEqual((result as any).data.task.id, otherTaskId, "should not reuse other owner's orphan");
  // Ensure a new task was created for ACTOR
  const createdForActor = tasksRepo.calls.filter((c) => c.method === "createTask" && c.actor === ACTOR.userId).length;
  assert.equal(createdForActor, 1);
});

test("orphan reconciliation is time-bounded: old tasks not reused", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  const oldId = "task-old";
  const oldIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  tasksRepo.taskStore.set(
    oldId,
    taskRecord({ id: oldId, title: "Recoverable", projectId: PROJECT_ID, createdAt: oldIso, updatedAt: oldIso } as any),
  );
  tasksRepo.taskOwner.set(oldId, ACTOR.userId);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  const now = new Date();
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" }, { now });
  assert.equal(result.ok, true);
  assert.notEqual((result as any).data.task.id, oldId, "old orphan beyond 5m window should not be reused");
  assert.ok(tasksRepo.calls.some((c) => c.method === "createTask"), "should create new task when only old orphan exists");
});

test("orphan scan is narrowly scoped by title: different title not reused", async () => {
  const tasksRepo = new FakeTasksRepository();
  const inboxRepo = new FakeInboxRepository(tasksRepo);
  const otherTitleId = "task-other-title";
  const nowIso = new Date().toISOString();
  tasksRepo.taskStore.set(
    otherTitleId,
    taskRecord({ id: otherTitleId, title: "Different title", projectId: PROJECT_ID, createdAt: nowIso, updatedAt: nowIso } as any),
  );
  tasksRepo.taskOwner.set(otherTitleId, ACTOR.userId);
  inboxRepo.inboxItem = inboxRecord({ id: "inbox-2", title: "Recoverable" });
  inboxRepo.inboxStore.set("inbox-2", inboxRepo.inboxItem);
  const result = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-2" });
  assert.equal(result.ok, true);
  assert.notEqual((result as any).data.task.id, otherTitleId);
});

test("archive/keep transitions remain explicit and owner-scoped", async () => {
  const inboxRepo = new FakeInboxRepository();
  // Archive
  const archiveResult = await inboxRepo.setInboxItemStatus(ACTOR, { id: "inbox-1", status: "archived" });
  // Check that owner scoping is via actor
  assert.equal(inboxRepo.calls[0].actor, "user-123");
  // Conversion of archived should be blocked
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
  // Ensure no task was created for other actor
  assert.equal(tasksRepo.calls.filter((c) => c.method === "createTask" && c.actor === "user-999").length, 0);
});

test("manual fallback creates Task without AI, validating existing Project/Goal", async () => {
  const inboxRepo = new FakeInboxRepository();
  const tasksRepo = new FakeTasksRepository();
  // Inbox without project, manual supplies project
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

  // Goal belonging to different project should be rejected
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

  // Simulate status failed after link: manually reset inbox status to inbox but keep link
  inboxRepo.inboxStore.set("inbox-1", inboxRecord({ id: "inbox-1", status: "inbox" }));
  inboxRepo.taskLink = taskId;
  // Ensure markConverted fails next time? Actually next conversion should find link and try to mark, and succeed
  inboxRepo.markConvertedShouldFail = false;

  const second = await convertInboxItemToTask(ACTOR, inboxRepo, tasksRepo, { inboxItemId: "inbox-1" });
  assert.equal(second.ok, true);
  assert.equal((second as any).data.task.id, taskId);
  const createCount = tasksRepo.calls.filter((c) => c.method === "createTask").length;
  assert.equal(createCount, 1, "should not create second task when link already exists");
});
