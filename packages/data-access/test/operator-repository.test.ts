import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseOperatorProposalRepository } from "../src/operator/repository";

const ACTOR_A = createAuthenticatedActor("user-a");
const ACTOR_B = createAuthenticatedActor("user-b");

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };

class FakeOperatorSupabase {
  public calls: Array<{ table: string; steps: string[] }> = [];
  private current: { table: string; steps: string[] } | null = null;
  constructor(private readonly results: QueryResult[]) {}

  from(table: string) {
    const entry = { table, steps: [] as string[] };
    this.calls.push(entry);
    this.current = entry;
    return this as unknown as SupabaseClient;
  }
  select(columns: string) {
    this.current?.steps.push(`select:${columns}`);
    return this;
  }
  insert(payload: unknown) {
    this.current?.steps.push(`insert:${JSON.stringify(payload)}`);
    return this;
  }
  update(payload: unknown) {
    this.current?.steps.push(`update:${JSON.stringify(payload)}`);
    return this;
  }
  delete() {
    this.current?.steps.push(`delete`);
    return this;
  }
  eq(column: string, value: unknown) {
    this.current?.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  lt(column: string, value: unknown) {
    this.current?.steps.push(`lt:${column}=${String(value)}`);
    return this;
  }
  order(column: string, opts?: { ascending: boolean }) {
    this.current?.steps.push(`order:${column}:${String(opts?.ascending)}`);
    return this;
  }
  limit(n: number) {
    this.current?.steps.push(`limit:${n}`);
    return this;
  }
  single() {
    this.current?.steps.push(`single`);
    return this;
  }
  maybeSingle() {
    this.current?.steps.push(`maybeSingle`);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const result = this.results.shift();
    if (!result) throw new Error("No queued result for operator query");
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

function repo(fake: FakeOperatorSupabase) {
  return new SupabaseOperatorProposalRepository(fake as unknown as SupabaseClient);
}

test("operator create scopes to owner_user_id and validates RLS insert", async () => {
  const fake = new FakeOperatorSupabase([
    { data: { id: "prop-1", revision: 1, owner_user_id: "user-a", local_date: "2026-08-10", time_context_id: "2026-08-10::UTC", baseline_hash: "abc", proposed_task_ids: [], task_versions: [], parent_proposal_id: null, idempotency_key: "k1", status: "generated", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), approved_at: null, applied_at: null, dismissed_at: null, result: null, ai_ref: null }, error: null },
  ]);
  const result = await repo(fake).createProposal(ACTOR_A, {
    revision: 1,
    localDate: "2026-08-10",
    timeContextId: "2026-08-10::UTC",
    baselineHash: "abc",
    proposedTaskIds: [],
    taskVersions: [],
    parentProposalId: null,
    idempotencyKey: "k1",
    status: "generated",
    aiRef: null,
  });
  assert.equal(result.ok, true);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s.includes(`"owner_user_id":"user-a"`)), `expected owner_user_id in insert, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s.includes(`idempotency_key`)));
});

test("operator findById scopes to owner_user_id", async () => {
  const fake = new FakeOperatorSupabase([{ data: null, error: null }]);
  await repo(fake).findById(ACTOR_A, "prop-1");
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"), `expected owner filter, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s === "eq:id=prop-1"));
});

test("operator findByIdempotencyKey owner isolation", async () => {
  const fakeA = new FakeOperatorSupabase([{ data: null, error: null }]);
  const fakeB = new FakeOperatorSupabase([{ data: null, error: null }]);
  await repo(fakeA).findByIdempotencyKey(ACTOR_A, "key-1");
  await repo(fakeB).findByIdempotencyKey(ACTOR_B, "key-1");
  assert.ok(fakeA.calls[0].steps.includes("eq:owner_user_id=user-a"));
  assert.ok(fakeB.calls[0].steps.includes("eq:owner_user_id=user-b"));
  assert.equal(fakeA.calls[0].steps.includes("eq:owner_user_id=user-b"), false);
});

test("operator update scopes to owner_user_id", async () => {
  const fake = new FakeOperatorSupabase([
    { data: { id: "prop-1", revision: 1, owner_user_id: "user-a", local_date: "2026-08-10", time_context_id: "2026-08-10::UTC", baseline_hash: "abc", proposed_task_ids: [], task_versions: [], parent_proposal_id: null, idempotency_key: "k1", status: "approved", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), approved_at: new Date().toISOString(), applied_at: null, dismissed_at: null, result: null, ai_ref: null }, error: null },
  ]);
  await repo(fake).updateProposal(ACTOR_A, "prop-1", { status: "approved", approvedAt: new Date().toISOString() });
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"));
  assert.ok(steps.some((s) => s === "eq:id=prop-1"));
  assert.ok(steps.some((s) => s.startsWith("update:")));
});

test("operator list scopes to owner and supports filter", async () => {
  const fake = new FakeOperatorSupabase([{ data: [], error: null }]);
  await repo(fake).listProposals(ACTOR_A, { localDate: "2026-08-10", status: "generated", limit: 10 });
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"));
  assert.ok(steps.some((s) => s === "eq:local_date=2026-08-10"));
  assert.ok(steps.some((s) => s === "eq:status=generated"));
  assert.ok(steps.includes("limit:10"));
});

test("operator list applies a bounded default when no limit is supplied", async () => {
  const fake = new FakeOperatorSupabase([{ data: [], error: null }]);
  await repo(fake).listProposals(ACTOR_A);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.includes("limit:50"));
});

test("operator deleteOlderThan scopes to owner and uses lt on created_at", async () => {
  const fake = new FakeOperatorSupabase([{ data: null, error: null, count: 2 }]);
  await repo(fake).deleteOlderThan(ACTOR_A, "2026-07-01T00:00:00.000Z");
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"));
  assert.ok(steps.some((s) => s === "lt:created_at=2026-07-01T00:00:00.000Z"));
  assert.ok(steps.includes("delete"));
});

test("operator claim atomically scopes to owner and status approved", async () => {
  const fake = new FakeOperatorSupabase([
    { data: { id: "prop-1", revision: 1, owner_user_id: "user-a", local_date: "2026-08-10", time_context_id: "2026-08-10::UTC", baseline_hash: "abc", proposed_task_ids: [], task_versions: [], parent_proposal_id: null, idempotency_key: "k1", status: "applying", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), approved_at: new Date().toISOString(), applied_at: null, dismissed_at: null, result: null, ai_ref: null }, error: null },
  ]);
  const result = await repo(fake).claimApprovedProposalForApply(ACTOR_A, "prop-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value?.status, "applying");
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((s) => s === "eq:id=prop-1"), `expected eq id, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s === "eq:owner_user_id=user-a"), `expected owner filter, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s === "eq:status=approved"), `expected status approved filter, got ${steps.join(",")}`);
  assert.ok(steps.some((s) => s.startsWith(`update:{"status":"applying"`)), `expected update to applying, got ${steps.join(",")}`);
  assert.ok(steps.includes("maybeSingle"), `expected maybeSingle for atomic claim, got ${steps.join(",")}`);
});

test("operator claim returns null when already applying (lost race)", async () => {
  const fake = new FakeOperatorSupabase([{ data: null, error: null }]);
  const result = await repo(fake).claimApprovedProposalForApply(ACTOR_A, "prop-1");
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test("operator repository returns unknown on persistence error", async () => {
  const fake = new FakeOperatorSupabase([{ data: null, error: { message: "boom" } }]);
  const result = await repo(fake).findById(ACTOR_A, "prop-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unknown");
});
