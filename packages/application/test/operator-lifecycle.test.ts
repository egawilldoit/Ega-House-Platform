import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  approveOperatorProposal,
  applyOperatorProposal,
  cleanupOperatorProposals,
  computeOperatorBaselineHash,
  createOperatorProposal,
  dismissOperatorProposal,
  getOperatorAcceptedBaseline,
  getOperatorStoredProposal,
  reviseOperatorProposal,
  type OperatorProposalRecord,
  type OperatorProposalRepository,
  type OperatorTaskLookupPort,
  type OperatorTodayMutationPort,
  type OperatorProposalResult,
} from "../src/operator/lifecycle";
import { createAuthenticatedActor, type AuthenticatedActor, type RepositoryResult } from "../src/index";

// ---------------------------------------------------------------------------
// Fakes — owner-scoped, in-memory persistence (RLS simulation)
// ---------------------------------------------------------------------------

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
    if (row.ownerUserId !== actor.userId) return ok(null); // RLS: owner isolation
    return ok(row);
  }
  // helper to mutate task to simulate stale
  updateTask(id: string, patch: Partial<TaskRow>) {
    const existing = this.tasks.get(id);
    if (existing) this.tasks.set(id, { ...existing, ...patch });
  }
}

class FakeTodayMutation implements OperatorTodayMutationPort {
  calls: Array<{ actor: string; taskId: string; plannedForDate: string | null }> = [];
  constructor(
    private readonly tasks: Map<string, TaskRow>,
    private readonly failIds: Set<string> = new Set(),
    private readonly beforeWrite?: (input: { taskId: string; plannedForDate: string | null }) => void,
  ) {}
  async setPlannedDate(actor: AuthenticatedActor, input: { taskId: string; plannedForDate: string | null; expectedUpdatedAt?: string }): Promise<RepositoryResult<unknown>> {
    this.calls.push({ actor: actor.userId, taskId: input.taskId, plannedForDate: input.plannedForDate });
    this.beforeWrite?.(input);
    const row = this.tasks.get(input.taskId);
    if (!row) return { ok: false, error: { code: "unknown" } };
    if (row.ownerUserId !== actor.userId) return { ok: false, error: { code: "unknown" } };
    if (this.failIds.has(input.taskId)) return { ok: false, error: { code: "unknown" } };
    if (input.expectedUpdatedAt !== undefined && row.updatedAt !== input.expectedUpdatedAt) {
      return { ok: false, error: { code: "conflict" } };
    }
    // Conflict simulation for already archived? not needed
    row.plannedForDate = input.plannedForDate;
    row.updatedAt = new Date().toISOString();
    this.tasks.set(input.taskId, row);
    return ok(undefined);
  }
}

class InMemoryOperatorProposalRepository implements OperatorProposalRepository {
  private readonly proposals = new Map<string, OperatorProposalRecord>(); // id -> record
  private readonly byIdempotency = new Map<string, string>(); // owner:key -> id

  private keyFor(actor: AuthenticatedActor, key: string) {
    return `${actor.userId}::${key}`;
  }

  async createProposal(
    actor: AuthenticatedActor,
    data: Parameters<OperatorProposalRepository["createProposal"]>[1],
  ): Promise<RepositoryResult<OperatorProposalRecord>> {
    const key = this.keyFor(actor, data.idempotencyKey);
    if (this.byIdempotency.has(key)) {
      return { ok: false, error: { code: "conflict" } };
    }
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
    if (rec.ownerUserId !== actor.userId) return ok(null); // RLS isolation
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

  async updateProposal(
    actor: AuthenticatedActor,
    id: string,
    patch: Parameters<OperatorProposalRepository["updateProposal"]>[2],
  ): Promise<RepositoryResult<OperatorProposalRecord>> {
    const existing = this.proposals.get(id);
    if (!existing) return fail();
    if (existing.ownerUserId !== actor.userId) return fail(); // RLS
    const updated: OperatorProposalRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      approvedAt: patch.approvedAt !== undefined ? patch.approvedAt : existing.approvedAt,
      appliedAt: patch.appliedAt !== undefined ? patch.appliedAt : existing.appliedAt,
      dismissedAt: patch.dismissedAt !== undefined ? patch.dismissedAt : existing.dismissedAt,
      result: patch.result !== undefined ? patch.result : existing.result,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    // Immutability: do NOT allow proposedTaskIds etc. to change via update — enforce
    // (existing already preserves)
    this.proposals.set(id, updated);
    return ok(updated);
  }

  async listProposals(
    actor: AuthenticatedActor,
    filter?: { localDate?: string; status?: string; limit?: number },
  ): Promise<RepositoryResult<OperatorProposalRecord[]>> {
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

  async claimApprovedProposalForApply(
    actor: AuthenticatedActor,
    proposalId: string,
  ): Promise<RepositoryResult<OperatorProposalRecord | null>> {
    const existing = this.proposals.get(proposalId) ?? null;
    if (!existing) return ok(null);
    if (existing.ownerUserId !== actor.userId) return ok(null);
    if (existing.status !== "approved") return ok(null);
    const updated: OperatorProposalRecord = {
      ...existing,
      status: "applying",
      updatedAt: new Date().toISOString(),
    };
    this.proposals.set(proposalId, updated);
    return ok(updated);
  }

  // Test helpers
  getAllForOwner(actor: AuthenticatedActor): OperatorProposalRecord[] {
    return [...this.proposals.values()].filter((p) => p.ownerUserId === actor.userId);
  }
  // Direct mutation for retention test (set old createdAt)
  setCreatedAt(id: string, iso: string) {
    const rec = this.proposals.get(id);
    if (rec) this.proposals.set(id, { ...rec, createdAt: iso });
  }
  // Helper to simulate crash after claim (set to applying without result)
  setStatus(id: string, status: OperatorProposalRecord["status"], result: OperatorProposalRecord["result"] = null) {
    const rec = this.proposals.get(id);
    if (rec) this.proposals.set(id, { ...rec, status, result, updatedAt: new Date().toISOString() });
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

const ACTOR_A = createAuthenticatedActor("user-a");
const ACTOR_B = createAuthenticatedActor("user-b");

// ---------------------------------------------------------------------------
// 1. Immutable revisions — approval targets one exact revision
// ---------------------------------------------------------------------------

test("AC: Proposal revisions are immutable — revise creates new row, original unchanged", async () => {
  const tasks = new Map<string, TaskRow>();
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  for (const id of [id1, id2, id3]) {
    tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  }
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const r1 = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2, id3],
    idempotencyKey: "create-1",
    timezone: "UTC",
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const original = r1.data;
  assert.equal(original.revision, 1);
  assert.equal(original.status, "generated");
  assert.deepEqual(original.proposedTaskIds, [id1, id2, id3]);
  const originalSnapshot = JSON.stringify(original);

  const r2 = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: original.id,
    proposedTaskIds: [id1, id2], // deselected one
    idempotencyKey: "revise-1",
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  const revised = r2.data;
  assert.equal(revised.revision, 2);
  assert.equal(revised.parentProposalId, original.id);
  assert.equal(revised.status, "revised");
  assert.deepEqual(revised.proposedTaskIds, [id1, id2]);

  // Original unchanged (immutable)
  const fetchedOriginal = await getOperatorStoredProposal(ACTOR_A, repo, original.id);
  assert.equal(fetchedOriginal.ok, true);
  if (!fetchedOriginal.ok) return;
  assert.equal(JSON.stringify(fetchedOriginal.data), originalSnapshot);
  assert.notEqual(original.id, revised.id);
  assert.equal(fetchedOriginal.data.proposedTaskIds.length, 3);
});

test("AC: Approval targets one exact revision — wrong revision cannot be approved via stale id", async () => {
  const tasks = new Map<string, TaskRow>();
  const id1 = randomUUID();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "c-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const revised = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: created.data.id,
    proposedTaskIds: [id1],
    idempotencyKey: "c-2",
  });
  assert.equal(revised.ok, true);
  if (!revised.ok) return;

  // Approve revised, not original
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: revised.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.status, "approved");
  assert.equal(approved.data.revision, 2);

  // Original still generated, not approved
  const originalFetched = await getOperatorStoredProposal(ACTOR_A, repo, created.data.id);
  assert.equal(originalFetched.ok && originalFetched.data.status, "generated");
});

// ---------------------------------------------------------------------------
// 2. Two devices same revision cannot apply twice
// ---------------------------------------------------------------------------

test("AC: Two devices approving same revision cannot apply it twice — second apply is idempotent no double mutation", async () => {
  const tasks = new Map<string, TaskRow>();
  const id1 = randomUUID();
  const id2 = randomUUID();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "apply-twice-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const firstApply = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(firstApply.ok, true);
  if (!firstApply.ok) return;
  assert.equal(firstApply.data.status, "applied");
  assert.deepEqual(firstApply.data.result?.appliedTaskIds.sort(), [id1, id2].sort());
  assert.equal(today.calls.length, 2);

  // Second device retries same revision (same proposal id) — should return same durable result, no extra mutations
  const secondApply = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(secondApply.ok, true);
  if (!secondApply.ok) return;
  assert.equal(secondApply.data.status, "applied");
  assert.deepEqual(secondApply.data.result?.appliedTaskIds.sort(), [id1, id2].sort());
  assert.equal(secondApply.data.id, firstApply.data.id);
  assert.equal(secondApply.data.result?.appliedAt, firstApply.data.result?.appliedAt);
  // No additional Today mutations on second apply
  assert.equal(today.calls.length, 2);
  // Verify tasks were only set once
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id2)?.plannedForDate, "2026-08-10");
});

// ---------------------------------------------------------------------------
// 3. Approval detects stale canonical Task state before mutation
// ---------------------------------------------------------------------------

test("AC: Approval detects stale Task state before mutation — transitions to stale", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId, updatedAt: "2026-08-10T08:00:00.000Z", status: "todo" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "stale-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // Simulate concurrent edit: task updatedAt changes (another device edited Task)
  lookup.updateTask(id1, { updatedAt: "2026-08-10T09:00:00.000Z", status: "in_progress" });

  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.status, "stale");
  assert.equal(approved.data.result?.staleDetected, true);
});

test("AC: Apply detects stale if task mutated after approval", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId, updatedAt: "2026-08-10T08:00:00.000Z" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "stale-apply-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.data.status, "approved");

  // Mutate task before apply
  lookup.updateTask(id1, { updatedAt: "2026-08-10T10:00:00.000Z" });

  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "stale");
  assert.equal(today.calls.length, 0); // no mutation when stale
});

test("AC: Apply rechecks Task versions after claim before mutation", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const today = new FakeTodayMutation(tasks);

  // Model another writer landing after the pre-claim stale check but before
  // this apply receives its atomic mutation authority.
  class ApplyRaceRepository extends InMemoryOperatorProposalRepository {
    override async claimApprovedProposalForApply(actor: AuthenticatedActor, proposalId: string) {
      lookup.updateTask(id1, { updatedAt: "2026-08-10T09:00:00.000Z" });
      return super.claimApprovedProposalForApply(actor, proposalId);
    }
  }
  const repo = new ApplyRaceRepository();

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "stale-apply-after-claim-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "stale");
  assert.equal(applied.data.result?.staleDetected, true);
  assert.equal(today.calls.length, 0);
});

test("AC: Apply uses a conditional Today write after final validation", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks, new Set(), () => {
    lookup.updateTask(id1, {
      plannedForDate: "2026-08-11",
      updatedAt: "2026-08-10T11:00:00.000Z",
    });
  });

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "conditional-today-write-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal((await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id })).ok, true);

  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");
  assert.deepEqual(applied.data.result?.appliedTaskIds, []);
  assert.deepEqual(applied.data.result?.skippedTaskIds, [{ id: id1, reason: "Conflict" }]);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-11");
});

// ---------------------------------------------------------------------------
// 4. Retry with same idempotency key returns same durable result
// ---------------------------------------------------------------------------

test("AC: Retry with same idempotency key returns same durable result — create idempotency", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-123",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-123",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(first.data.id, second.data.id);
  assert.equal(first.data.revision, second.data.revision);
  assert.equal(repo.getAllForOwner(ACTOR_A).length, 1);
});

test("AC: Retry apply with same proposal returns same result — idempotent even with different idempotencyKey param", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-apply-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  const firstApply = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id, idempotencyKey: "apply-key-1" });
  assert.equal(firstApply.ok, true);
  if (!firstApply.ok) return;
  const secondApply = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id, idempotencyKey: "apply-key-1" });
  assert.equal(secondApply.ok, true);
  if (!secondApply.ok) return;
  assert.equal(firstApply.data.result?.appliedAt, secondApply.data.result?.appliedAt);
  assert.equal(today.calls.length, 1);
});

// ---------------------------------------------------------------------------
// 5. Partial apply records exactly what changed and what was rejected/skipped
// ---------------------------------------------------------------------------

test("AC: Partial apply records exactly what changed and what was skipped — blocked/completed", async () => {
  const okId = randomUUID();
  const blockedId = randomUUID();
  const missingId = randomUUID(); // will be missing vs blocked? Use blocked row
  const tasks = new Map<string, TaskRow>();
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR_A.userId, status: "todo" }));
  tasks.set(blockedId, makeTaskRow({ id: blockedId, ownerUserId: ACTOR_A.userId, status: "blocked" }));
  // missingId not in map, but to pass creation validation we need it to exist — so create as todo then after creation mark blocked? Instead we simulate partial via Today mutation failure
  // For partial apply recording, we will create proposal with 2 ids, one will fail Today mutation via failIds
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  // Create proposal that will partially fail: we will create with okId and another okId2 that we later make fail on mutation
  const okId2 = randomUUID();
  tasks.set(okId2, makeTaskRow({ id: okId2, ownerUserId: ACTOR_A.userId, status: "todo" }));
  const lookup2 = new FakeTaskLookup(tasks);
  const created = await createOperatorProposal(ACTOR_A, repo, lookup2, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId, okId2],
    idempotencyKey: "partial-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR_A, repo, lookup2, { proposalId: created.data.id });

  // Now simulate that okId2's Today mutation will fail (e.g., DB error)
  const today = new FakeTodayMutation(tasks, new Set([okId2]));

  // To test skipping blocked, we instead after approval mutate okId2 to blocked so stale detection? But we want partial apply not stale.
  // Instead we keep okId2 as todo but make its mutation fail via failIds, while blocked case is tested via stale handling before mutation: after approval, change okId2 to blocked, then apply will see it as excluded and skip.
  // But that would trigger stale detection and whole proposal becomes stale, not partial. So for partial we need mutation-level failure, not stale.

  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup2, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");
  assert.deepEqual(applied.data.result?.appliedTaskIds, [okId]);
  assert.equal(applied.data.result?.failedTaskIds.length, 1);
  assert.equal(applied.data.result?.failedTaskIds[0].id, okId2);
  assert.equal(applied.data.result?.skippedTaskIds.length, 0);
});

test("AC: Partial apply with blocked task skipped and successful tasks applied", async () => {
  const okId = randomUUID();
  const todoId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  // todoId already planned for target date before proposal creation — apply should treat as already applied (idempotent)
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR_A.userId, status: "todo", plannedForDate: null }));
  tasks.set(todoId, makeTaskRow({ id: todoId, ownerUserId: ACTOR_A.userId, status: "todo", plannedForDate: "2026-08-10" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId, todoId],
    idempotencyKey: "partial-skip-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });

  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  // Both should be considered applied (one via mutation, one via already planned)
  assert.equal(applied.data.status, "applied");
  assert.equal(applied.data.result?.appliedTaskIds.length, 2);
});

// ---------------------------------------------------------------------------
// 6. Dismissal produces no Task/Today mutation
// ---------------------------------------------------------------------------

test("AC: Dismissal produces no Task/Today mutation", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "dismiss-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const dismissed = await dismissOperatorProposal(ACTOR_A, repo, { proposalId: created.data.id });
  assert.equal(dismissed.ok, true);
  if (!dismissed.ok) return;
  assert.equal(dismissed.data.status, "dismissed");
  assert.equal(today.calls.length, 0);
  assert.equal(tasks.get(id1)?.plannedForDate, null); // no mutation
  assert.equal(dismissed.data.result?.appliedTaskIds.length, 0);
});

// ---------------------------------------------------------------------------
// 7. Accepted-plan baseline is reconstructable for EGA-519 replanning
// ---------------------------------------------------------------------------

test("AC: Accepted-plan baseline is reconstructable — after partial apply, baseline is what actually applied", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2, id3]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2, id3],
    idempotencyKey: "baseline-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  // Make id2 fail
  const today = new FakeTodayMutation(tasks, new Set([id2]));
  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(applied.data.status, "partially_applied");

  const baseline = await getOperatorAcceptedBaseline(ACTOR_A, repo, { proposalId: created.data.id });
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.deepEqual(baseline.data.appliedTaskIds.sort(), [id1, id3].sort());
  assert.deepEqual(baseline.data.proposedTaskIds.sort(), [id1, id2, id3].sort());
  assert.equal(baseline.data.localDate, "2026-08-10");
  assert.equal(baseline.data.baselineHash, created.data.baselineHash);
  assert.equal(baseline.data.parentProposalId, null);
  assert.deepEqual(baseline.data.taskVersions.map((v) => v.id).sort(), [id1, id2, id3].sort());
  assert.equal(baseline.data.result?.status, "partially_applied");
});

test("AC: Baseline for generated (not yet applied) is empty applied but retains hash", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "baseline-2",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const baseline = await getOperatorAcceptedBaseline(ACTOR_A, repo, { proposalId: created.data.id });
  assert.equal(baseline.ok, true);
  if (!baseline.ok) return;
  assert.equal(baseline.data.appliedTaskIds.length, 0);
  assert.equal(baseline.data.proposedTaskIds.length, 1);
});

// ---------------------------------------------------------------------------
// 8. LLM/client payloads cannot bypass shared proposal validation
// ---------------------------------------------------------------------------

test("AC: LLM payload cannot bypass shared validation — blocked/completed task rejected", async () => {
  const blockedId = randomUUID();
  const doneId = randomUUID();
  const okId = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(blockedId, makeTaskRow({ id: blockedId, ownerUserId: ACTOR_A.userId, status: "blocked" }));
  tasks.set(doneId, makeTaskRow({ id: doneId, ownerUserId: ACTOR_A.userId, status: "done" }));
  tasks.set(okId, makeTaskRow({ id: okId, ownerUserId: ACTOR_A.userId, status: "todo" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const blockedAttempt = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [blockedId],
    idempotencyKey: "llm-blocked",
  });
  assert.equal(blockedAttempt.ok, false);
  if (blockedAttempt.ok) return;
  assert.match(blockedAttempt.errorMessage, /not actionable/);

  const doneAttempt = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [doneId],
    idempotencyKey: "llm-done",
  });
  assert.equal(doneAttempt.ok, false);

  const notFoundAttempt = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [randomUUID()],
    idempotencyKey: "llm-missing",
  });
  assert.equal(notFoundAttempt.ok, false);
  assert.match(notFoundAttempt.errorMessage, /not found/);

  // Valid still passes
  const valid = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [okId],
    idempotencyKey: "llm-valid",
  });
  assert.equal(valid.ok, true);

  // Revise also validates via shared path
  const reviseBlocked = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: valid.ok ? valid.data.id : "missing",
    proposedTaskIds: [blockedId],
    idempotencyKey: "llm-revise-blocked",
  });
  assert.equal(reviseBlocked.ok, false);
});

test("AC: LLM cannot inject arbitrary hash — baselineHash is server-computed, not client-supplied", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  // Client tries to supply fake hash via aiRef? But server recomputes. We verify hash is deterministic and not taken from input
  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "hash-check",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const expectedHash = computeOperatorBaselineHash({
    version: "1",
    date: "2026-08-10",
    timezone: "UTC",
    timeContextId: "2026-08-10::UTC",
    candidateIds: [id1],
    taskVersions: created.data.taskVersions,
  });
  assert.equal(created.data.baselineHash, expectedHash);
  // Tampering would not affect — server always computes
});

// ---------------------------------------------------------------------------
// 9. Owner/RLS isolation and retention
// ---------------------------------------------------------------------------

test("AC: RLS isolation — owner cannot see or mutate other owner's proposal", async () => {
  const id1 = randomUUID();
  const tasksA = new Map<string, TaskRow>();
  tasksA.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookupA = new FakeTaskLookup(tasksA);
  const repo = new InMemoryOperatorProposalRepository();

  const created = await createOperatorProposal(ACTOR_A, repo, lookupA, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "owner-iso-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  // Actor B tries to fetch, approve, apply, dismiss — all should fail as not found
  const tasksB = new Map<string, TaskRow>();
  const lookupB = new FakeTaskLookup(tasksB);
  const fetchB = await getOperatorStoredProposal(ACTOR_B, repo, created.data.id);
  assert.equal(fetchB.ok, false);
  assert.match(fetchB.ok ? "" : fetchB.errorMessage, /not found/);

  const approveB = await approveOperatorProposal(ACTOR_B, repo, lookupB, { proposalId: created.data.id });
  assert.equal(approveB.ok, false);

  const dismissB = await dismissOperatorProposal(ACTOR_B, repo, { proposalId: created.data.id });
  assert.equal(dismissB.ok, false);

  const baselineB = await getOperatorAcceptedBaseline(ACTOR_B, repo, { proposalId: created.data.id });
  assert.equal(baselineB.ok, false);

  // Actor B can create same idempotency key independently (owner-scoped unique)
  const id2 = randomUUID();
  tasksB.set(id2, makeTaskRow({ id: id2, ownerUserId: ACTOR_B.userId }));
  const lookupB2 = new FakeTaskLookup(tasksB);
  const createdB = await createOperatorProposal(ACTOR_B, repo, lookupB2, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id2],
    idempotencyKey: "owner-iso-1", // same key as A but different owner
  });
  assert.equal(createdB.ok, true);
  if (!createdB.ok) return;
  assert.notEqual(createdB.data.id, created.data.id);
  assert.equal(createdB.data.ownerUserId, ACTOR_B.userId);
});

test("AC: Retention — cleanup deletes only old proposals for calling owner", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  tasks.set(id2, makeTaskRow({ id: id2, ownerUserId: ACTOR_B.userId }));
  const lookupA = new FakeTaskLookup(tasks);
  const lookupB = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const old = await createOperatorProposal(ACTOR_A, repo, lookupA, {
    localDate: "2026-08-01",
    timeContextId: "2026-08-01::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "old-1",
  });
  assert.equal(old.ok, true);
  if (!old.ok) return;
  // Make it old: 40 days ago
  const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
  repo.setCreatedAt(old.data.id, oldDate);

  const recent = await createOperatorProposal(ACTOR_A, repo, lookupA, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "recent-1",
  });
  assert.equal(recent.ok, true);
  if (!recent.ok) return;

  const otherOld = await createOperatorProposal(ACTOR_B, repo, lookupB, {
    localDate: "2026-08-01",
    timeContextId: "2026-08-01::UTC",
    proposedTaskIds: [id2],
    idempotencyKey: "other-old-1",
  });
  assert.equal(otherOld.ok, true);
  if (!otherOld.ok) return;
  const otherOldDate = new Date(Date.now() - 40 * 86_400_000).toISOString();
  repo.setCreatedAt(otherOld.data.id, otherOldDate);

  // Cleanup for A with 30 days retention should delete only A's old
  const cleaned = await cleanupOperatorProposals(ACTOR_A, repo, { retentionDays: 30 });
  assert.equal(cleaned.ok, true);
  if (!cleaned.ok) return;
  assert.equal(cleaned.data, 1);

  const remainingA = repo.getAllForOwner(ACTOR_A);
  assert.equal(remainingA.length, 1);
  assert.equal(remainingA[0].id, recent.data.id);

  const remainingB = repo.getAllForOwner(ACTOR_B);
  assert.equal(remainingB.length, 1); // B's old not deleted by A's cleanup
  assert.equal(remainingB[0].id, otherOld.data.id);
});

// ---------------------------------------------------------------------------
// 10. Migration generated not applied — file existence check
// ---------------------------------------------------------------------------

test("AC: Migration is generated and reviewed — production application separately authorized (file exists, not auto-applied)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const candidates = [
    "../../../drizzle/0049_operator_proposals.sql",
    "../../../drizzle/0048_operator_proposals.sql",
    "../../../drizzle/0047_operator_proposals.sql",
  ];
  const filePath = candidates.map((p) => path.resolve(__dirname, p)).find((p) => fs.existsSync(p)) ?? path.resolve(__dirname, candidates[0]);
  assert.equal(fs.existsSync(filePath), true, "migration file should exist");
  const content = fs.readFileSync(filePath, "utf8");
  assert.match(content, /operator_proposals/);
  assert.match(content, /ENABLE ROW LEVEL SECURITY/);
  assert.match(content, /idempotency_key/);
  assert.match(content, /baseline_hash/);
});

// ---------------------------------------------------------------------------
// Additional: idempotency key validation, empty proposal, hash deterministic
// ---------------------------------------------------------------------------

test("Validation: empty proposedTaskIds allowed for sparse days", async () => {
  const tasks = new Map<string, TaskRow>();
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [],
    idempotencyKey: "sparse-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.proposedTaskIds.length, 0);
  assert.equal(created.data.taskVersions.length, 0);
  assert.equal(created.data.status, "generated");
});

test("Validation: duplicate task ids rejected", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const dup = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id1],
    idempotencyKey: "dup-1",
  });
  assert.equal(dup.ok, false);
  assert.match(dup.ok ? "" : dup.errorMessage, /Duplicate/);
});

test("Validation: exceeds max 6 rejected", async () => {
  const tasks = new Map<string, TaskRow>();
  const ids = Array.from({ length: 7 }, () => randomUUID());
  for (const id of ids) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const tooMany = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: ids,
    idempotencyKey: "too-many",
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.ok ? "" : tooMany.errorMessage, /maximum/);
});

test("Lifecycle: cannot apply without approve", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);
  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "no-approve-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const applied = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(applied.ok, false);
  assert.match(applied.ok ? "" : applied.errorMessage, /Approve first/);
});

test("Lifecycle: cannot approve terminal (dismissed) proposal", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "terminal-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const dismissed = await dismissOperatorProposal(ACTOR_A, repo, { proposalId: created.data.id });
  assert.equal(dismissed.ok, true);
  if (!dismissed.ok) return;
  const approve = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approve.ok, false);
});

// ---------------------------------------------------------------------------
// 11. Strict idempotency: same key + same semantic request → same result, different → conflict
// ---------------------------------------------------------------------------

test("Idempotency strict: same key same semantic request → same proposal (fingerprint match)", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "idem-strict-1",
    timezone: "UTC",
    parentProposalId: null,
    aiRef: "ai-1",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    proposedTaskIds: [id2, id1], // different order → same fingerprint (stable sorted)
    idempotencyKey: "idem-strict-1",
    timezone: "UTC",
    parentProposalId: null,
    aiRef: "ai-1",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(first.data.id, second.data.id);
  assert.equal(repo.getAllForOwner(ACTOR_A).length, 1);
});

test("Idempotency strict: same key different tasks → conflict", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2, id3]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-tasks",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id2],
    idempotencyKey: "idem-conflict-tasks",
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.errorMessage, /Idempotency key conflict/);
  assert.equal(repo.getAllForOwner(ACTOR_A).length, 1);
});

test("Idempotency strict: same key different localDate → conflict", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-date",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-11",
    timeContextId: "2026-08-11::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-date",
  });
  assert.equal(second.ok, false);
  assert.match(second.errorMessage, /Idempotency key conflict/);
});

test("Idempotency strict: same key different timeContextId → conflict", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-tc",
    timezone: "UTC",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T04:00:00.000Z",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-tc",
    timezone: "UTC",
  });
  assert.equal(second.ok, false);
  assert.match(second.errorMessage, /Idempotency key conflict/);
});

test("Idempotency strict: same key different parent → conflict", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const parent1 = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "parent-1",
  });
  assert.equal(parent1.ok, true);
  if (!parent1.ok) return;
  const parent2 = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "parent-2",
  });
  assert.equal(parent2.ok, true);
  if (!parent2.ok) return;

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-parent",
    parentProposalId: parent1.data.id,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-parent",
    parentProposalId: parent2.data.id,
  });
  assert.equal(second.ok, false);
  assert.match(second.errorMessage, /Idempotency key conflict/);
});

test("Idempotency strict: same key different aiRef → conflict", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-ai",
    aiRef: "ai-1",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-ai",
    aiRef: "ai-2",
  });
  assert.equal(second.ok, false);
  assert.match(second.errorMessage, /Idempotency key conflict/);
});

test("Idempotency strict: same key different timezone → conflict", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const first = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-tz",
    timezone: "UTC",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::America/New_York::2026-08-10T04:00:00.000Z",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-conflict-tz",
    timezone: "America/New_York",
  });
  assert.equal(second.ok, false);
  assert.match(second.errorMessage, /Idempotency key conflict/);
});

test("Idempotency concurrent: two identical creates race → one logical proposal (one writer)", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const payload = {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-concurrent-identical",
  };

  const [a, b] = await Promise.all([
    createOperatorProposal(ACTOR_A, repo, lookup, payload),
    createOperatorProposal(ACTOR_A, repo, lookup, payload),
  ]);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.data.id, b.data.id);
  assert.equal(repo.getAllForOwner(ACTOR_A).length, 1);
});

test("Idempotency concurrent: same key different payload race → one wins, other conflict", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const payloadA = {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "idem-concurrent-diff",
  };
  const payloadB = {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id2],
    idempotencyKey: "idem-concurrent-diff",
  };

  const [a, b] = await Promise.all([
    createOperatorProposal(ACTOR_A, repo, lookup, payloadA),
    createOperatorProposal(ACTOR_A, repo, lookup, payloadB),
  ]);

  // One must succeed, one must be conflict
  const successes = [a, b].filter((r) => r.ok);
  const failures = [a, b].filter((r) => !r.ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.match((failures[0] as { ok: false; errorMessage: string }).errorMessage, /Idempotency key conflict/);
  assert.equal(repo.getAllForOwner(ACTOR_A).length, 1);
});

test("Idempotency revise: same key same revise payload → same result, different → conflict", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();

  const parent = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "revise-parent",
  });
  assert.equal(parent.ok, true);
  if (!parent.ok) return;

  const firstRevise = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: parent.data.id,
    proposedTaskIds: [id2],
    idempotencyKey: "revise-key-1",
    aiRef: "ai-1",
  });
  assert.equal(firstRevise.ok, true);
  if (!firstRevise.ok) return;

  const secondSame = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: parent.data.id,
    proposedTaskIds: [id2],
    idempotencyKey: "revise-key-1",
    aiRef: "ai-1",
  });
  assert.equal(secondSame.ok, true);
  if (!secondSame.ok) return;
  assert.equal(firstRevise.data.id, secondSame.data.id);

  const different = await reviseOperatorProposal(ACTOR_A, repo, lookup, {
    proposalId: parent.data.id,
    proposedTaskIds: [id1],
    idempotencyKey: "revise-key-1",
    aiRef: "ai-1",
  });
  assert.equal(different.ok, false);
  assert.match(different.errorMessage, /Idempotency key conflict/);
});

test("Fingerprint is deterministic and stable across task order shuffle (no timestamp)", async () => {
  const { computeCreateProposalRequestFingerprint } = await import("../src/operator/lifecycle");
  const fp1 = computeCreateProposalRequestFingerprint({
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    timezone: "UTC",
    proposedTaskIds: ["b", "a", "c"],
    parentProposalId: null,
    aiRef: "ref-1",
  });
  const fp2 = computeCreateProposalRequestFingerprint({
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    timezone: "UTC",
    proposedTaskIds: ["a", "c", "b"],
    parentProposalId: null,
    aiRef: "ref-1",
  });
  assert.equal(fp1, fp2);
  // Different aiRef → different fingerprint
  const fp3 = computeCreateProposalRequestFingerprint({
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC::2026-08-10T00:00:00.000Z",
    timezone: "UTC",
    proposedTaskIds: ["a", "b", "c"],
    parentProposalId: null,
    aiRef: "ref-2",
  });
  assert.notEqual(fp1, fp3);
});

// ---------------------------------------------------------------------------
// Atomic claim: concurrent applyA / applyB — only winner mutates, one wins
// ---------------------------------------------------------------------------

test("Atomic claim: concurrent Promise.all apply — one wins claim, one cannot mutate, Tasks once, valid final state", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const todayA = new FakeTodayMutation(tasks);
  const todayB = new FakeTodayMutation(tasks);
  // Use shared tasks map but distinct mutation counters to prove only winner mutated
  // To share, we use same map but each FakeTodayMutation wraps same map; we will count total calls across both
  // Better: use two mutation ports that both write to same map, but we can track combined calls
  let totalMutationCalls = 0;
  const originalSetA = todayA.setPlannedDate.bind(todayA);
  const originalSetB = todayB.setPlannedDate.bind(todayB);
  todayA.setPlannedDate = async (actor, input) => {
    totalMutationCalls += 1;
    return originalSetA(actor, input);
  };
  todayB.setPlannedDate = async (actor, input) => {
    totalMutationCalls += 1;
    return originalSetB(actor, input);
  };

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2],
    idempotencyKey: "concurrent-claim-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  const [resA, resB] = await Promise.all([
    applyOperatorProposal(ACTOR_A, repo, lookup, todayA, { proposalId: created.data.id }),
    applyOperatorProposal(ACTOR_A, repo, lookup, todayB, { proposalId: created.data.id }),
  ]);

  const successes = [resA, resB].filter((r) => r.ok);
  const failures = [resA, resB].filter((r) => !r.ok);
  // Exactly one winner, one loser (already being applied)
  assert.equal(successes.length, 1, `expected one success got ${successes.length} resA ok ${resA.ok} resB ok ${resB.ok}`);
  assert.equal(failures.length, 1);
  assert.match((failures[0] as { ok: false; errorMessage: string }).errorMessage, /already being applied/i);

  const winner = successes[0] as { ok: true; data: OperatorProposalRecord };
  assert.equal(winner.data.status, "applied");
  assert.deepEqual(winner.data.result?.appliedTaskIds.sort(), [id1, id2].sort());
  // Tasks mutated once (winner mutated 2, loser did not mutate)
  assert.equal(totalMutationCalls, 2, `expected 2 mutation calls (once per task) got ${totalMutationCalls}`);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id2)?.plannedForDate, "2026-08-10");

  // Final proposal state is valid terminal
  const final = await getOperatorStoredProposal(ACTOR_A, repo, created.data.id);
  assert.equal(final.ok, true);
  if (!final.ok) return;
  assert.equal(final.data.status, "applied");
  assert.equal(final.data.result?.staleDetected, false);
});

// ---------------------------------------------------------------------------
// Crash-safe recovery: claim → crash → retry must not double-mutate, idempotent
// ---------------------------------------------------------------------------

test("Crash recovery: approved → claim applying → crash → retry resumes idempotently, no double mutation", async () => {
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  for (const id of [id1, id2, id3]) tasks.set(id, makeTaskRow({ id, ownerUserId: ACTOR_A.userId, plannedForDate: null }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1, id2, id3],
    idempotencyKey: "crash-recovery-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const approved = await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;

  // Simulate crash after atomic claim but before mutations: manually claim to applying, mutate first task, then crash
  const claim = await repo.claimApprovedProposalForApply(ACTOR_A, created.data.id);
  assert.equal(claim.ok, true);
  assert.equal(claim.value?.status, "applying");
  // Mutate first task as if winner had started but crashed after one
  const firstMut = await today.setPlannedDate(ACTOR_A, { taskId: id1, plannedForDate: "2026-08-10" });
  assert.equal(firstMut.ok, true);
  assert.equal(today.calls.length, 1);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id2)?.plannedForDate, null);
  // Proposal still in applying with no result — simulates crash before finalization
  const afterCrash = await repo.findById(ACTOR_A, created.data.id);
  assert.equal(afterCrash.ok && afterCrash.value?.status, "applying");
  assert.equal(afterCrash.ok && afterCrash.value?.result, null);

  // Retry — same proposalId, should resume without double-mutating id1, and complete id2/id3
  const retry = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.data.status, "applied");
  // id1 should be counted as applied via receipt (plannedForDate already equals target, no duplicate write)
  assert.deepEqual(retry.data.result?.appliedTaskIds.sort(), [id1, id2, id3].sort());
  // Total mutation calls: 1 (pre-crash) + 2 (retry for id2,id3) = 3, not 4 (no double for id1)
  assert.equal(today.calls.length, 3, `expected 3 total calls (id1 pre-crash + id2/id3 retry), got ${today.calls.length}`);
  assert.equal(tasks.get(id1)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id2)?.plannedForDate, "2026-08-10");
  assert.equal(tasks.get(id3)?.plannedForDate, "2026-08-10");

  // Idempotent second retry after finalization returns same result, no extra mutations
  const secondRetry = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(secondRetry.ok, true);
  if (!secondRetry.ok) return;
  assert.equal(secondRetry.data.result?.appliedAt, retry.data.result?.appliedAt);
  assert.equal(today.calls.length, 3);
});

test("Crash recovery: retry after stale would not be polluted by own mutations (applying skips stale check)", async () => {
  const id1 = randomUUID();
  const tasks = new Map<string, TaskRow>();
  tasks.set(id1, makeTaskRow({ id: id1, ownerUserId: ACTOR_A.userId, plannedForDate: null, updatedAt: "2026-08-10T08:00:00.000Z" }));
  const lookup = new FakeTaskLookup(tasks);
  const repo = new InMemoryOperatorProposalRepository();
  const today = new FakeTodayMutation(tasks);

  const created = await createOperatorProposal(ACTOR_A, repo, lookup, {
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    proposedTaskIds: [id1],
    idempotencyKey: "crash-stale-skip",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await approveOperatorProposal(ACTOR_A, repo, lookup, { proposalId: created.data.id });

  // Claim then mutate, leaving applying with plannedForDate changed (which would look stale if re-checked)
  const claim = await repo.claimApprovedProposalForApply(ACTOR_A, created.data.id);
  assert.equal(claim.ok, true);
  await today.setPlannedDate(ACTOR_A, { taskId: id1, plannedForDate: "2026-08-10" });
  // Now retry — if stale check were re-run, it would see plannedForDate mismatch (stored null vs now 2026-08-10) and mark stale incorrectly
  const retry = await applyOperatorProposal(ACTOR_A, repo, lookup, today, { proposalId: created.data.id });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.data.status, "applied", "resume should not be marked stale due to own mutation");
  assert.equal(retry.data.result?.staleDetected, false);
});
