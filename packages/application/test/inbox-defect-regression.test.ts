import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  computeInboxFingerprint,
  convertInboxItemToTask,
  createAuthenticatedActor,
  createInboxItem,
  deterministicInboxIdForCapture,
  deterministicTaskIdForInboxConversion,
  type AuthenticatedActor,
  type CreateInboxRecordInput,
  type InboxRecord,
  type InboxRepository,
  type RepositoryResult,
  type TaskRecord,
  type TasksRepository,
} from "../src/index";

const ACTOR = createAuthenticatedActor("user-123");
const PROJECT_A = "11111111-1111-4111-8111-111111111111";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function conflict(): RepositoryResult<never> {
  return { ok: false, error: { code: "conflict" } };
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

// Barrier fake for Defect A: simulates note insert atomic PK, mapping delayed
class BarrierInboxRepo implements InboxRepository {
  notes = new Map<string, InboxRecord>();
  keyEntries = new Map<string, { inboxItemId: string; fingerprint: string | null }>();
  ownerMap = new Map<string, string>();
  // Barrier promise that first create will await after note insert
  barrierPromise: Promise<void> | null = null;
  barrierResolve: (() => void) | null = null;

  createBarrier() {
    let resolve!: () => void;
    this.barrierPromise = new Promise<void>((r) => {
      resolve = r;
    });
    this.barrierResolve = resolve;
  }
  releaseBarrier() {
    if (this.barrierResolve) this.barrierResolve();
    this.barrierPromise = null;
  }

  async getScope() {
    return ok({ projectIds: [PROJECT_A] });
  }
  async listInboxItems() {
    return ok([] as InboxRecord[]);
  }
  async listProjectOptions() {
    return ok([] as never);
  }
  async getInboxItem(actor: AuthenticatedActor, id: string) {
    const note = this.notes.get(id);
    if (!note) return ok(null);
    if (this.ownerMap.get(id) !== actor.userId) return ok(null);
    return ok(note);
  }
  async getInboxItemByIdempotencyKey(actor: AuthenticatedActor, key: string) {
    const entry = this.keyEntries.get(`${actor.userId}:${key}`);
    if (!entry) return ok(null);
    return this.getInboxItem(actor, entry.inboxItemId);
  }
  async getInboxIdempotencyEntry(actor: AuthenticatedActor, key: string) {
    const entry = this.keyEntries.get(`${actor.userId}:${key}`);
    if (!entry) return ok(null);
    return ok({ inboxItemId: entry.inboxItemId, fingerprint: entry.fingerprint });
  }
  async createInboxItem(actor: AuthenticatedActor, input: CreateInboxRecordInput) {
    const key = (input as unknown as { idempotencyKey?: string }).idempotencyKey
      ? String((input as unknown as { idempotencyKey?: string }).idempotencyKey)
      : null;
    const fingerprint = (input as unknown as { fingerprint?: string }).fingerprint
      ? String((input as unknown as { fingerprint?: string }).fingerprint)
      : null;
    const id = (input as unknown as { id?: string }).id
      ? String((input as unknown as { id?: string }).id)
      : `rand-${Math.random()}`;

    if (this.notes.has(id)) {
      return conflict() as unknown as RepositoryResult<InboxRecord>;
    }
    if (key && this.keyEntries.has(`${actor.userId}:${key}`)) {
      const existing = this.keyEntries.get(`${actor.userId}:${key}`)!;
      if (existing.fingerprint && fingerprint && existing.fingerprint !== fingerprint) {
        return conflict() as unknown as RepositoryResult<InboxRecord>;
      }
      return conflict() as unknown as RepositoryResult<InboxRecord>;
    }
    const record: InboxRecord = {
      id,
      title: input.title,
      body: input.body,
      status: "inbox",
      type: input.type,
      projectId: input.projectId,
      priority: input.priority,
      tags: input.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectName: null,
    };
    this.notes.set(id, record);
    this.ownerMap.set(id, actor.userId);
    // Simulate pause before mapping insertion (race window)
    if (key && this.barrierPromise) {
      await this.barrierPromise;
    }
    if (key) {
      // After barrier, check again if mapping was inserted concurrently
      if (this.keyEntries.has(`${actor.userId}:${key}`)) {
        // Another concurrent inserted mapping first, our note is orphan - but we already inserted note.
        // In real DB, mapping unique would fail, but note already exists. Our service should handle via note fingerprint.
        // For test, simulate that mapping insert would conflict, but note remains. We return conflict to trigger service retry.
        // However we already inserted note; to mimic real behavior where note insert is atomic, we keep note but mapping fails.
        // The service will then try to fetch by deterministic id and should detect mismatch/success.
        // For this fake, if mapping already exists, we treat as conflict.
        // To avoid double note, we keep first note and return conflict for second mapping attempt.
        // First caller after barrier will insert mapping successfully; second caller was already in conflict path before mapping.
        // So just insert if not exists.
        if (!this.keyEntries.has(`${actor.userId}:${key}`)) {
          this.keyEntries.set(`${actor.userId}:${key}`, { inboxItemId: id, fingerprint });
        }
      } else {
        this.keyEntries.set(`${actor.userId}:${key}`, { inboxItemId: id, fingerprint });
      }
    }
    return ok(record);
  }
  async updateInboxItem() {
    return ok(null as never);
  }
  async setInboxItemStatus() {
    return ok(null as never);
  }
  async getTaskIdForInboxItem() {
    return ok(null as string | null);
  }
  async createInboxTaskLink() {
    return ok(undefined);
  }
  async markInboxItemConverted() {
    return ok(null as never);
  }
}

// Defect A: concurrent different-payload with barrier must be CONFLICT not silent success
test("Defect A: concurrent same-key different-payload with barrier yields conflict (atomic fingerprint via deterministic PK)", async () => {
  const repo = new BarrierInboxRepo();
  const key = "barrier-key-diff";
  repo.createBarrier();

  const p1 = createInboxItem(ACTOR, repo, { title: "First payload", body: "body A", idempotencyKey: key });
  // Give event loop a tick to let p1 insert note but pause before mapping
  await new Promise((r) => setTimeout(r, 10));

  const p2 = createInboxItem(ACTOR, repo, { title: "Different payload", body: "body B", idempotencyKey: key });

  // Release barrier to let p1 complete mapping
  repo.releaseBarrier();

  const [r1, r2] = await Promise.all([p1, p2]);

  // One must succeed, other must be conflict
  const successes = [r1, r2].filter((r) => r.ok);
  const conflicts = [r1, r2].filter((r) => !r.ok && (r as unknown as { code?: string }).code === "conflict");

  assert.equal(successes.length, 1, "exactly one should succeed");
  assert.equal(conflicts.length, 1, "exactly one should be conflict for different payload");
  assert.equal(repo.notes.size, 1, "only one note must exist (atomic PK)");
  // The successful one should be the first payload (first-write-wins)
  const success = successes[0] as unknown as { data: InboxRecord };
  assert.equal(success.data.title, "First payload");
});

test("Defect A: concurrent same-key same-payload with barrier yields single note replay (no conflict)", async () => {
  const repo = new BarrierInboxRepo();
  const key = "barrier-key-same";
  repo.createBarrier();

  const p1 = createInboxItem(ACTOR, repo, { title: "Same payload", body: "same body", idempotencyKey: key });
  await new Promise((r) => setTimeout(r, 10));
  const p2 = createInboxItem(ACTOR, repo, { title: "Same payload", body: "same body", idempotencyKey: key });

  repo.releaseBarrier();

  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.equal(r1.data.id, r2.data.id, "same payload concurrent replay must resolve to same deterministic id");
  }
  assert.equal(repo.notes.size, 1);
});

// Defect B: converted reminder replay cases

class FakeInboxForConvert implements InboxRepository {
  inbox: InboxRecord = inboxRecord();
  taskLink: string | null = null;
  async getScope() {
    return ok({ projectIds: [PROJECT_A] });
  }
  async listInboxItems() {
    return ok([] as InboxRecord[]);
  }
  async listProjectOptions() {
    return ok([] as never);
  }
  async getInboxItem(_actor: AuthenticatedActor, id: string) {
    if (id === this.inbox.id) return ok({ ...this.inbox });
    return ok(null);
  }
  async getInboxItemByIdempotencyKey() {
    return ok(null);
  }
  async getInboxIdempotencyEntry() {
    return ok(null);
  }
  async createInboxItem() {
    return ok(this.inbox);
  }
  async updateInboxItem() {
    return ok(this.inbox);
  }
  async setInboxItemStatus() {
    return ok(this.inbox);
  }
  async getTaskIdForInboxItem() {
    return ok(this.taskLink);
  }
  async createInboxTaskLink(_actor: AuthenticatedActor, input: { inboxItemId: string; taskId: string }) {
    if (this.taskLink && this.taskLink !== input.taskId) return conflict() as unknown as RepositoryResult<void>;
    this.taskLink = input.taskId;
    return ok(undefined);
  }
  async markInboxItemConverted(_actor: AuthenticatedActor, id: string) {
    const updated = { ...this.inbox, status: "converted" as const };
    this.inbox = updated;
    return ok(updated);
  }
}

class FakeTasksForConvert implements TasksRepository {
  scope: RepositoryResult<{ projectIds: string[]; goals: Array<{ id: string; projectId: string }> }> = ok({
    projectIds: [PROJECT_A],
    goals: [],
  });
  store = new Map<string, TaskRecord>();
  async getScope() {
    return this.scope;
  }
  async listTasks() {
    return ok([] as never);
  }
  async listProjectOptions() {
    return ok([] as never);
  }
  async listGoalOptions() {
    return ok([] as never);
  }
  async getTask(_actor: AuthenticatedActor, id: string) {
    const v = this.store.get(id);
    return ok(v ? { ...v } : null);
  }
  async createTask(_actor: AuthenticatedActor, input: Record<string, unknown>) {
    const id = (input.id as string) ?? `task-${this.store.size + 1}`;
    if (this.store.has(id)) return conflict() as unknown as RepositoryResult<TaskRecord>;
    const rec = taskRecord({
      id,
      title: input.title as string,
      projectId: input.projectId as string,
      goalId: (input.goalId as string) ?? null,
      priority: ((input.priority as string) ?? "medium") as TaskRecord["priority"],
      dueDate: (input.dueDate as string) ?? null,
      description: (input.description as string) ?? null,
    });
    this.store.set(id, rec);
    return ok(rec);
  }
  async updateTask() {
    return ok(taskRecord());
  }
  async setTaskArchived() {
    return ok(taskRecord());
  }
  async createReminder(_actor: AuthenticatedActor, input: Record<string, unknown>) {
    const task = this.store.get(input.taskId as string);
    if (!task) return fail() as unknown as RepositoryResult<TaskRecord>;
    if (input.source && input.sourceId) {
      const exists = task.reminders.some((r: unknown) => (r as { source: string; sourceId: string }).source === input.source && (r as { source: string; sourceId: string }).sourceId === input.sourceId);
      if (exists) return conflict() as unknown as RepositoryResult<TaskRecord>;
    }
    const updated = {
      ...task,
      reminders: [
        ...task.reminders,
        {
          id: `rem-${task.reminders.length + 1}`,
          taskId: input.taskId as string,
          remindAt: input.remindAt as string,
          channel: "email" as const,
          status: "pending" as const,
          sentAt: null,
          failureReason: null,
          source: input.source as string,
          sourceId: input.sourceId as string,
        },
      ],
    };
    this.store.set(input.taskId as string, updated);
    return ok(updated);
  }
  async cancelReminder() {
    return ok(taskRecord());
  }
  async getFocusRank() {
    return ok({ exists: true, focusRank: null });
  }
  async getMaxFocusRank() {
    return ok(null);
  }
  async setFocusRank() {
    return ok(undefined);
  }
}

test("Defect B: converted without reminder -> later same item + remindAt must reconcile (create reminder) not silent success", async () => {
  const inbox = new FakeInboxForConvert();
  const tasks = new FakeTasksForConvert();
  // First conversion without reminder
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1" });
  assert.equal(first.ok, true);
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-1");
  assert.equal(inbox.inbox.status, "converted");
  const taskAfterFirst = tasks.store.get(detId)!;
  assert.equal(taskAfterFirst.reminders.length, 0, "first converted without reminder has no reminder");

  // Second call with same inbox but requesting reminder -> must not silently succeed without reminder
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(second.ok, true, "should reconcile and succeed with reminder created");
  if (second.ok) {
    assert.equal(second.data.task.reminders.length, 1, "reconciled reminder must exist exactly once");
    assert.equal(second.data.task.reminders[0].remindAt, future);
    assert.equal(second.data.task.reminders[0].source, "smart_inbox_conversion");
  }
  // Ensure no duplicate on retry with same reminder
  const third = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(third.ok, true);
  assert.equal(tasks.store.get(detId)!.reminders.length, 1, "retry with same remindAt must remain exactly once");
});

test("Defect B: converted with reminder -> same remindAt replay is idempotent", async () => {
  const inbox = new FakeInboxForConvert();
  const tasks = new FakeTasksForConvert();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(first.ok, true);
  assert.equal(tasks.store.get(deterministicTaskIdForInboxConversion(ACTOR, "inbox-1"))!.reminders.length, 1);

  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future }, { now: new Date() });
  assert.equal(second.ok, true);
  assert.equal(tasks.store.get(deterministicTaskIdForInboxConversion(ACTOR, "inbox-1"))!.reminders.length, 1);
});

test("Defect B: converted with reminder -> different remindAt must be conflict", async () => {
  const inbox = new FakeInboxForConvert();
  const tasks = new FakeTasksForConvert();
  const future1 = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const future2 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const first = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future1 }, { now: new Date() });
  assert.equal(first.ok, true);

  const second = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-1", remindAt: future2 }, { now: new Date() });
  assert.equal(second.ok, false);
  assert.equal((second as unknown as { code?: string }).code, "conflict");
});

test("Defect B: legacy converted item missing reminder (no link vs missing task) -> different time conflict, same time reconciles", async () => {
  const inbox = new FakeInboxForConvert();
  // Simulate legacy: inbox already converted but we manually set link to task without reminder
  inbox.inbox = inboxRecord({ id: "inbox-legacy", status: "converted", projectId: PROJECT_A });
  const detId = deterministicTaskIdForInboxConversion(ACTOR, "inbox-legacy");
  const tasks = new FakeTasksForConvert();
  const taskWithoutReminder = taskRecord({ id: detId, projectId: PROJECT_A, reminders: [] });
  tasks.store.set(detId, taskWithoutReminder);
  inbox.taskLink = detId;

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const withReminder = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-legacy", remindAt: future }, { now: new Date() });
  assert.equal(withReminder.ok, true, "legacy converted without reminder should reconcile when reminder requested");
  assert.equal(tasks.store.get(detId)!.reminders.length, 1);

  // Now different time should conflict even for legacy
  const futureDiff = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const conflict = await convertInboxItemToTask(ACTOR, inbox, tasks, { inboxItemId: "inbox-legacy", remindAt: futureDiff }, { now: new Date() });
  assert.equal(conflict.ok, false);
  assert.equal((conflict as unknown as { code?: string }).code, "conflict");
});

test("Defect C: schema parity check constraint exists in src/db/schema.ts", () => {
  const candidates = [
    path.resolve(process.cwd(), "src/db/schema.ts"),
    path.resolve(process.cwd(), "../../src/db/schema.ts"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../src/db/schema.ts"),
    "/home/ubuntu/ega-house/.worktrees/smart-inbox/src/db/schema.ts",
  ];
  let content: string | null = null;
  for (const p of candidates) {
    try {
      content = fs.readFileSync(p, "utf8");
      break;
    } catch {}
  }
  assert.ok(content, "could not locate src/db/schema.ts");
  assert.ok(content!.includes("inbox_idempotency_keys_key_not_blank"), "schema must contain check constraint name");
  assert.ok(content!.includes("btrim"), "schema check must use btrim as in migration");
  assert.ok(content!.includes("length(btrim"), "schema check must mirror migration 0047 length(btrim(key)) > 0");
  assert.ok(content!.includes('check("inbox_idempotency_keys_key_not_blank"'), "schema must declare check via drizzle check()");
});

test("Defect A fingerprint deterministic and sorted tags", () => {
  const fp1 = computeInboxFingerprint({ title: " Hello ", body: " body ", projectId: null, tags: ["b", "a"], type: "idea" });
  const fp2 = computeInboxFingerprint({ title: "Hello", body: "body", projectId: null, tags: ["a", "b"], type: "idea" });
  assert.equal(fp1, fp2);
  const det1 = deterministicInboxIdForCapture(ACTOR, "key123");
  const det2 = deterministicInboxIdForCapture(ACTOR, "key123");
  assert.equal(det1, det2);
});
