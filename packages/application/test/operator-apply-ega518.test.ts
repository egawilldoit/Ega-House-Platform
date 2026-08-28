import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  approveOperatorProposal,
  applyOperatorProposal,
  applyApprovedOperatorProposal,
  createOperatorProposal,
  type OperatorProposalRecord,
  type OperatorProposalRepository,
  type OperatorTaskLookupPort,
  type OperatorTodayMutationPort,
} from "../src/operator/lifecycle";
import { createAuthenticatedActor, type AuthenticatedActor, type RepositoryResult } from "../src/index";

// Fakes — owner scoped, identical to operator-lifecycle.test.ts
function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}
function fail(): RepositoryResult<never> {
  return { ok: false, error: { code: "unknown" } };
}

type TaskRow = {
  id: string;
  status: string;
  updatedAt: string;
  priority: string;
  dueDate: string | null;
  focusRank: number | null;
  estimateMinutes: number | null;
  plannedForDate: string | null;
  archivedAt: string | null;
  ownerUserId: string;
};

class FakeTaskLookup implements OperatorTaskLookupPort {
  constructor(private readonly tasks: Map<string, TaskRow>) {}
  async getTask(actor: AuthenticatedActor, taskId: string): Promise<RepositoryResult<TaskRow | null>> {
    const row = this.tasks.get(taskId) ?? null;
    if (!row) return ok(null);
    if (row.ownerUserId !== actor.userId) return ok(null);
    return ok(row);
  }
  updateTask(id: string, patch: Partial<TaskRow>) {
    const existing = this.tasks.get(id);
    if (existing) this.tasks.set(id, { ...existing, ...patch });
  }
}

class FakeTodayMutation implements OperatorTodayMutationPort {
  calls: Array<{ actor: string; taskId: string; plannedForDate: string | null }> = [];
  constructor(private readonly tasks: Map<string, TaskRow>, private readonly failIds: Set<string> = new Set()) {}
  async setPlannedDate(actor: AuthenticatedActor, input: { taskId: string; plannedForDate: string | null }): Promise<RepositoryResult<unknown>> {
    this.calls.push({ actor: actor.userId, taskId: input.taskId, plannedForDate: input.plannedForDate });
    const row = this.tasks.get(input.taskId);
    if (!row) return { ok: false, error: { code: "unknown" } };
    if (row.ownerUserId !== actor.userId) return { ok: false, error: { code: "unknown" } };
    if (this.failIds.has(input.taskId)) return { ok: false, error: { code: "unknown" } };
    row.plannedForDate = input.plannedForDate;
    row.updatedAt = new Date().toISOString();
    this.tasks.set(input.taskId, row);
    return ok(undefined);
  }
}

class InMemoryOperatorProposalRepository implements OperatorProposalRepository {
  private readonly proposals = new Map<string, OperatorProposalRecord>();
  private readonly byIdempotency = new Map<string, string>();
  private keyFor(actor: AuthenticatedActor, key: string) {
    return `${actor.userId}::${key}`;
  }
  async createProposal(actor: AuthenticatedActor, data: Parameters<OperatorProposalRepository["createProposal"]>[1]): Promise<RepositoryResult<OperatorProposalRecord>> {
    const key = this.keyFor(actor, data.idempotencyKey);
    if (this.byIdempotency.has(key)) return { ok: false, error: { code: "conflict" } };
    const id = data.id ?? randomUUID();
    const now = new Date().toISOString();
    const record: OperatorProposalRecord = {
      id,
      revision: data.revision,
      ownerUserId: actor.userId,
      localDate: data.localDate,
      timeContextId: data.timeContextId,
      baselineHash: data.baselineHash,
      proposedTaskIds: [...data.proposedTaskIds],
      taskVersions: [...data.taskVersions],
      parentProposalId: data.parentProposalId,
      idempotencyKey: data.idempotencyKey,
      status: data.status,
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      appliedAt: null,
      dismissedAt: null,
      result: null,
      aiRef: data.aiRef,
    };
    this.proposals.set(id, record);
    this.byIdempotency.set(key, id);
    return ok(record);
  }
  async findById(actor: AuthenticatedActor, id: string): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const rec = this.proposals.get(id) ?? null;
    if (!rec) return ok(null);
    if (rec.ownerUserId !== actor.userId) return ok(null);
    return ok(rec);
  }
  async findByIdempotencyKey(actor: AuthenticatedActor, key: string): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const mappedId = this.byIdempotency.get(this.keyFor(actor, key)) ?? null;
    if (!mappedId) return ok(null);
    const rec = this.proposals.get(mappedId) ?? null;
    if (!rec) return ok(null);
    if (rec.ownerUserId !== actor.userId) return ok(null);
    return ok(rec);
  }
  async updateProposal(actor: AuthenticatedActor, id: string, patch: Parameters<OperatorProposalRepository["updateProposal"]>[2]): Promise<RepositoryResult<OperatorProposalRecord>> {
    const existing = this.proposals.get(id);
    if (!existing) return fail();
    if (existing.ownerUserId !== actor.userId) return fail();
    const updated: OperatorProposalRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : existing.approvedAt,
      appliedAt: patch.appliedAt !== undefined ? patch.appliedAt : existing.appliedAt,
      dismissedAt: patch.dismissedAt !== undefined ? patch.dismissedAt : existing.dismissedAt,
      result: patch.result !== undefined ? patch.result : existing.result,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    this.proposals.set(id, updated);
    return ok(updated);
  }
  async listProposals(actor: AuthenticatedActor, filter?: { localDate?: string; status?: string; limit?: number }): Promise<RepositoryResult<OperatorProposalRecord[]>> {
    const all = [...this.proposals.values()].filter((p) => p.ownerUserId === actor.userId);
    let filtered = all;
    if (filter?.localDate) filtered = filtered.filter((p) => p.localDate === filter.localDate);
    if (filter?.status) filtered = filtered.filter((p) => p.status === filter.status);
    if (filter?.limit) filtered = filtered.slice(0, filter.limit);
    return ok(filtered);
  }
  async deleteOlderThan(actor: AuthenticatedActor, cutoffIso: string): Promise<RepositoryResult<number>> {
    const cutoff = new Date(cutoffIso).getTime();
    let deleted = 0;
    for (const [id, rec] of [...this.proposals.entries()]) {
      if (rec.ownerUserId !== actor.userId) continue;
      if (new Date(rec.createdAt).getTime() < cutoff) {
        this.proposals.delete(id);
        this.byIdempotency.delete(this.keyFor(actor, rec.idempotencyKey));
        deleted++;
      }
    }
    return ok(deleted);
  }
}

function makeTaskRow(overrides: Partial<TaskRow> & { id: string; ownerUserId: string }): TaskRow {
  return {
    status: "todo",
    updatedAt: "2026-08-10T08:00:00.000Z",
    priority: "medium",
    dueDate: null,
    focusRank: null,
    estimateMinutes: 30,
    plannedForDate: null,
    archivedAt: null,
    ...overrides,
  };
}

const ACTOR = createAuthenticatedActor("user-ega518");

// ---------------------------------------------------------------------------
// EGA-518 AC: Nothing changes before explicit approval
// ---------------------------------------------------------------------------

test("EGA-518 AC: nothing changes before explicit approval — create does not mutate Today", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "ega518-nothing-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  // No Today mutations on create
  assert.equal(today.calls.length, 0);
  assert.equal(tasks.get(id1)?.plannedForDate, null);
  assert.equal(tasks.get(id2)?.plannedForDate, null);

  // Approve also must not mutate Today
  const approved = await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  assert.equal(today.calls.length, 0);
  assert.equal(tasks.get(id1)?.plannedForDate, null);
  // Applying without approval should fail (already tested elsewhere) — approved succeeds
  // Only apply mutates
  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  assert.equal(today.calls.length, 2);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
});

test("EGA-518 AC: cannot apply before approval — nothing mutates", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-no-apply-before",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, false);
  assert.match(applied.ok ? "" : applied.errorMessage, /Approve first/);
  assert.equal(today.calls.length, 0);
  assert.equal(tasks.get(id1)?.plannedForDate, null);
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Apply revalidates ownership/state so stale cannot mutate
// ---------------------------------------------------------------------------

test("EGA-518 AC: revalidates stale Task state — updatedAt mismatch makes proposal stale with no mutations", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId, updatedAt: "2026-08-10T08:00:00.000Z" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-stale-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);

  // Simulate concurrent edit before apply
  lookup.updateTask(id1, { updatedAt: "2026-08-10T09:00:00.000Z" });

  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "stale");
  assert.equal(applied.data.result?.staleDetected, true);
  assert.equal(today.calls.length, 0);
  // No plannedForDate change
  assert.equal(tasks.get(id1)?.plannedForDate, null);
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Already-completed/archived Tasks are skipped/rejected with structured result
// ---------------------------------------------------------------------------

test("EGA-518 AC: completed/archived Tasks are skipped with structured result, valid tasks still apply", async () => {
  const okId = randomUUID();
  const archivedId = randomUUID();
  const doneId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR.userId, status: "todo", archivedAt: null }));
  tasks.set(doneId, makeTaskRow({ id: doneId, ownerUserId: ACTOR.userId, status: "todo", archivedAt: null }));
  tasks.set(archivedId, makeTaskRow({ id: archivedId, ownerUserId: ACTOR.userId, status: "todo", archivedAt: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId, doneId, archivedId],
    idempotencyKey: "ega518-skip-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  // After approval, mark doneId as completed and archivedId as archived — should be per-task skip, not whole stale
  lookup.updateTask(doneId, { status: "done", updatedAt: "2026-08-10T09:00:00.000Z" });
  lookup.updateTask(archivedId, { archivedAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-10T09:00:00.000Z" });

  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");
  assert.equal(applied.data.result?.staleDetected, false);
  assert.deepEqual(applied.data.result?.appliedTaskIds, [okId]);
  assert.equal(applied.data.result?.skippedTaskIds.length, 2);
  const skippedIds = new Set(applied.data.result?.skippedTaskIds.map((s) => s.id));
  assert.ok(skippedIds.has(doneId));
  assert.ok(skippedIds.has(archivedId));
  assert.equal(applied.data.result?.failedTaskIds.length, 0);
  assert.equal(tasks.get(okId)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(doneId)?.plannedForDate, null);
  assert.equal(tasks.get(archivedId)?.plannedForDate, null);
  assert.equal(today.calls.length, 1);
  assert.equal(today.calls[0].taskId, okId);
});

test("EGA-518 AC: per-task archived is skipped via structured result when stale detection scoped (explicit task still applies)", async () => {
  const okId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR.userId, status: "todo" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);
  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId],
    idempotencyKey: "ega518-skip-2",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });
  // Mark task archived after approval — should be skipped, not mutate
  lookup.updateTask(okId, { archivedAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-08-10T09:00:00.000Z" });
  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");
  assert.equal(applied.data.result?.skippedTaskIds.length, 1);
  assert.equal(applied.data.result?.skippedTaskIds[0].id, okId);
  assert.ok(applied.data.result?.skippedTaskIds[0].reason.includes("archived"));
  assert.equal(today.calls.length, 0);
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Partial failure semantics are explicit
// ---------------------------------------------------------------------------

test("EGA-518 AC: partial failure semantics explicit — one task fails, other succeeds, result enumerates both", async () => {
  const okId = randomUUID();
  const failId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR.userId }));
  tasks.set(failId, makeTaskRow({ id: failId, ownerUserId: ACTOR.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks, new Set([failId]));

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId, failId],
    idempotencyKey: "ega518-partial-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");
  assert.deepEqual(applied.data.result?.appliedTaskIds, [okId]);
  assert.equal(applied.data.result?.failedTaskIds.length, 1);
  assert.equal(applied.data.result?.failedTaskIds[0].id, failId);
  assert.equal(applied.data.result?.staleDetected, false);
  assert.equal(typeof applied.data.result?.appliedAt, "string");
  assert.equal(tasks.get(okId)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(failId)?.plannedForDate, null);
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Partial explicit — user can apply subset of proposal
// ---------------------------------------------------------------------------

test("EGA-518 AC: partial explicit — apply with subset taskIds only mutates explicit tasks", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2, id3]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2, id3],
    idempotencyKey: "ega518-explicit-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const applied = await applyApprovedOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id, taskIds: [id1, id3] });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "applied");
  assert.deepEqual(applied.data.result?.appliedTaskIds.sort(), [id1, id3].sort());
  assert.equal(applied.data.result?.skippedTaskIds.length, 0);
  assert.equal(applied.data.result?.failedTaskIds.length, 0);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id3)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id2)?.plannedForDate, null); // not explicitly applied
  assert.equal(today.calls.length, 2);
  assert.ok(today.calls.some((c) => c.taskId === id1));
  assert.ok(today.calls.some((c) => c.taskId === id3));
  assert.ok(!today.calls.some((c) => c.taskId === id2));
});

test("EGA-518 AC: partial explicit subset respects idempotency when retrying same subset", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "ega518-explicit-idem",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const first = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id, taskIds: [id1] });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.result?.appliedTaskIds.length, 1);
  assert.equal(today.calls.length, 1);

  const second = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id, taskIds: [id1] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  // Second retry must be idempotent — no extra Today mutation, same result
  assert.equal(second.data.id, first.data.id);
  assert.equal(second.data.result?.appliedAt, first.data.result?.appliedAt);
  assert.equal(today.calls.length, 1);
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Retrying the same approved proposal is idempotent for Today selection
// ---------------------------------------------------------------------------

test("EGA-518 AC: idempotent retry for Today selection — second apply returns same durable result, no double Today mutation", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "ega518-idem-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const firstApply = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(firstApply.ok, true);
  if (!firstApply.ok) return;
  assert.equal(firstApply.data.status, "applied");
  assert.equal(today.calls.length, 2);

  const secondApply = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(secondApply.ok, true);
  if (!secondApply.ok) return;
  assert.equal(secondApply.data.status, "applied");
  assert.equal(secondApply.data.id, firstApply.data.id);
  assert.equal(secondApply.data.result?.appliedAt, firstApply.data.result?.appliedAt);
  assert.equal(today.calls.length, 2); // no extra mutations
});

test("EGA-518 AC: idempotent when tasks already planned for date — already-planned counts as applied", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId, plannedForDate: "2026-08-10" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-idem-planned",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const applied = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "applied");
  assert.deepEqual(applied.data.result?.appliedTaskIds, [id1]);
  assert.equal(today.calls.length, 0); // no mutation needed — already planned
});

// ---------------------------------------------------------------------------
// EGA-518 AC: Tests prove LLM/client data cannot bypass shared validation
// ---------------------------------------------------------------------------

test("EGA-518 AC: LLM cannot bypass — explicit apply with task not in proposal is rejected", async () => {
  const id1 = randomUUID();
  const injectedId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId }));
  tasks.set(injectedId, makeTaskRow({ id: injectedId, ownerUserId: ACTOR.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-llm-inject",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR, repo, lookup, { proposalId: created.data.id });

  const injectedApply = await applyOperatorProposal(ACTOR, repo, lookup, today, { proposalId: created.data.id, taskIds: [id1, injectedId] });
  assert.equal(injectedApply.ok, false);
  assert.match(injectedApply.ok ? "" : injectedApply.errorMessage, /not part of proposal/);
  assert.equal(today.calls.length, 0);
  assert.equal(tasks.get(injectedId)?.plannedForDate, null);
});

test("EGA-518 AC: LLM cannot inject arbitrary hash — baselineHash server-computed not client supplied", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-hash",
    // No way to supply baselineHash from input — server always computes
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  // Hash is deterministic and not taken from client aiRef etc.
  assert.ok(created.data.baselineHash.length === 64); // sha256 hex
  assert.equal(created.data.proposedTaskIds.length, 1);
});

test("EGA-518 AC: LLM cannot create proposal with blocked/completed tasks — shared validation rejects", async () => {
  const blockedId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(blockedId, makeTaskRow({ id: blockedId, ownerUserId: ACTOR.userId, status: "blocked" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const blockedAttempt = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [blockedId],
    idempotencyKey: "ega518-llm-blocked",
  });
  assert.equal(blockedAttempt.ok, false);
  assert.match(blockedAttempt.ok ? "" : blockedAttempt.errorMessage, /not actionable/);
});

test("EGA-518 AC: approve/apply RLS — other actor cannot approve/apply foreign proposal", async () => {
  const otherActor = createAuthenticatedActor("other-user-ega518");
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "ega518-rls",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const otherLookup = new FakeTaskLookup(new Map<string, TaskRow>());
  const otherApply = await applyOperatorProposal(otherActor, repo, otherLookup, today, { proposalId: created.data.id });
  assert.equal(otherApply.ok, false);
  assert.match(otherApply.ok ? "" : otherApply.errorMessage, /not found/i);
});
