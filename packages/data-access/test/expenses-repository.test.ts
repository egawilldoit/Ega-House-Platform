import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseExpenseRepository } from "../src/expenses/repository";

const ACTOR = createAuthenticatedActor("owner-expenses");
const ID = "00000000-0000-4000-8000-000000000001";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

const ROW = {
  id: ID,
  occurred_at: "2026-11-07T08:30:00+00:00",
  amount_minor: 2250,
  currency: "MAD",
  category: "coffee",
  note: "morning coffee",
  merchant: null,
  need_vs_want: "want",
  payment_method: "card",
  idempotency_key: "key-1",
  version: 1,
  deleted_at: null,
  created_at: "2026-11-07T08:31:00+00:00",
  updated_at: "2026-11-07T08:31:00+00:00",
};

class FakeBuilder {
  private readonly steps: string[] = [];

  constructor(
    private readonly queue: QueryResult[],
    private readonly calls: Array<{ steps: string[] }>,
  ) {}

  select(columns: string) {
    this.steps.push(`select:${columns}`);
    return this;
  }
  insert(payload: unknown) {
    this.steps.push(`insert:${JSON.stringify(payload)}`);
    return this;
  }
  update(payload: unknown) {
    this.steps.push(`update:${JSON.stringify(payload)}`);
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  is(column: string, value: unknown) {
    this.steps.push(`is:${column}=${String(value)}`);
    return this;
  }
  gte(column: string, value: unknown) {
    this.steps.push(`gte:${column}=${String(value)}`);
    return this;
  }
  lt(column: string, value: unknown) {
    this.steps.push(`lt:${column}=${String(value)}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.steps.push(`order:${column}:${String(options?.ascending)}`);
    return this;
  }
  range(from: number, to: number) {
    this.steps.push(`range:${from}-${to}`);
    return this;
  }
  maybeSingle() {
    return this.terminal("maybeSingle");
  }
  single() {
    return this.terminal("single");
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await").then(fulfilled, rejected);
  }
  private terminal(method: string) {
    this.steps.push(method);
    this.calls.push({ steps: [...this.steps] });
    return Promise.resolve(this.queue.shift() ?? { data: null, error: null });
  }
}

class FakeSupabase {
  readonly calls: Array<{ steps: string[] }> = [];
  constructor(private readonly queue: QueryResult[]) {}
  from(table: string) {
    assert.equal(table, "personal_expenses");
    return new FakeBuilder(this.queue, this.calls);
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseExpenseRepository(fake as unknown as SupabaseClient);
}

test("get scopes by owner, excludes deleted rows and maps snake_case", async () => {
  const fake = new FakeSupabase([{ data: ROW, error: null }]);
  const result = await repository(fake).get(ACTOR, ID);

  assert.equal(result.ok, true);
  if (result.ok && result.value) {
    assert.equal(result.value.amountMinor, 2250);
    assert.equal(result.value.needVsWant, "want");
    assert.equal(result.value.paymentMethod, "card");
    assert.equal(result.value.currency, "MAD");
  }
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-expenses"));
  assert.ok(steps.some((step) => step === `eq:id=${ID}`));
  assert.ok(steps.some((step) => step === "is:deleted_at=null"));
});

test("idempotency lookup includes soft-deleted rows for replay", async () => {
  const fake = new FakeSupabase([
    { data: { ...ROW, deleted_at: "2026-11-08T00:00:00+00:00" }, error: null },
  ]);
  const result = await repository(fake).findByIdempotencyKey(ACTOR, "key-1");

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value?.deletedAt, "2026-11-08T00:00:00+00:00");
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:idempotency_key=key-1"));
  assert.ok(!steps.some((step) => step.startsWith("is:deleted_at")));
});

test("create sends canonical snake_case values and maps unique violations to conflict", async () => {
  const created = await repository(
    new FakeSupabase([{ data: ROW, error: null }]),
  ).create(ACTOR, {
    occurredAt: "2026-11-07T08:30:00.000Z",
    amountMinor: 2250,
    category: "coffee",
    note: "morning coffee",
    merchant: null,
    needVsWant: "want",
    paymentMethod: "card",
    idempotencyKey: "key-1",
  });
  assert.equal(created.ok, true);

  const duplicate = await repository(
    new FakeSupabase([
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "personal_expenses_owner_idempotency_key_unique"',
        },
      },
    ]),
  ).create(ACTOR, {
    occurredAt: "2026-11-07T08:30:00.000Z",
    amountMinor: 2250,
    category: "coffee",
    note: null,
    merchant: null,
    needVsWant: "want",
    paymentMethod: null,
    idempotencyKey: "key-1",
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "conflict");
});

test("list applies owner, soft-delete, window, ordering and bounded range", async () => {
  const fake = new FakeSupabase([{ data: [ROW], error: null }]);
  const result = await repository(fake).list(ACTOR, {
    limit: 11,
    offset: 20,
    startUtcIso: "2026-11-01T00:00:00.000Z",
    endUtcExclusiveIso: "2026-11-08T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-expenses"));
  assert.ok(steps.some((step) => step === "is:deleted_at=null"));
  assert.ok(steps.some((step) => step === "gte:occurred_at=2026-11-01T00:00:00.000Z"));
  assert.ok(steps.some((step) => step === "lt:occurred_at=2026-11-08T00:00:00.000Z"));
  assert.ok(steps.some((step) => step === "order:occurred_at:false"));
  assert.ok(steps.some((step) => step === "order:id:false"));
  assert.ok(steps.some((step) => step === "range:20-30"));
});

test("update requires the expected version and increments it", async () => {
  const fake = new FakeSupabase([
    { data: { ...ROW, version: 4, amount_minor: 1990 }, error: null },
  ]);
  const result = await repository(fake).update(ACTOR, ID, {
    changes: { amountMinor: 1990 },
    expectedVersion: 3,
    updatedAt: "2026-11-07T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.version, 4);
  const step = fake.calls[0]?.steps.find((entry) => entry.startsWith("update:"));
  assert.ok(step?.includes('"amount_minor":1990'));
  assert.ok(step?.includes('"version":4'));
  assert.ok(step?.includes('"updated_at":"2026-11-07T10:00:00.000Z"'));
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((entry) => entry === "eq:version=3"));
  assert.ok(steps.some((entry) => entry === "is:deleted_at=null"));
});

test("update distinguishes a stale version from a missing/deleted row", async () => {
  const stale = new FakeSupabase([
    { data: null, error: null },
    { data: { version: 4, deleted_at: null }, error: null },
  ]);
  const staleResult = await repository(stale).update(ACTOR, ID, {
    changes: { note: "new" },
    expectedVersion: 3,
    updatedAt: "2026-11-07T10:00:00.000Z",
  });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, "conflict");

  const deleted = new FakeSupabase([
    { data: null, error: null },
    { data: { version: 4, deleted_at: "2026-11-08T00:00:00+00:00" }, error: null },
  ]);
  const deletedResult = await repository(deleted).update(ACTOR, ID, {
    changes: { note: "new" },
    expectedVersion: 3,
    updatedAt: "2026-11-07T10:00:00.000Z",
  });
  assert.equal(deletedResult.ok, false);
  if (!deletedResult.ok) assert.equal(deletedResult.error.code, "notFound");

  const missing = new FakeSupabase([
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const missingResult = await repository(missing).update(ACTOR, ID, {
    changes: { note: "new" },
    expectedVersion: 3,
    updatedAt: "2026-11-07T10:00:00.000Z",
  });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.error.code, "notFound");
});

test("soft delete stamps deleted_at, bumps version, and repeats idempotently", async () => {
  const deletedAt = "2026-11-07T10:00:00.000Z";
  const fresh = new FakeSupabase([
    { data: { version: 2, deleted_at: null }, error: null },
    { data: { id: ID, deleted_at: deletedAt }, error: null },
  ]);
  const first = await repository(fresh).softDelete(ACTOR, ID, deletedAt);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.value.alreadyDeleted, false);
    assert.equal(first.value.deletedAt, deletedAt);
  }
  const updateStep = fresh.calls[1]?.steps.find((entry) => entry.startsWith("update:"));
  assert.ok(updateStep?.includes(`"deleted_at":"${deletedAt}"`));
  assert.ok(updateStep?.includes('"version":3'));
  assert.ok(fresh.calls[1]?.steps.some((entry) => entry === "eq:version=2"));

  const repeat = new FakeSupabase([
    { data: { version: 3, deleted_at: deletedAt }, error: null },
  ]);
  const second = await repository(repeat).softDelete(ACTOR, ID, "2026-11-09T00:00:00.000Z");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.value.alreadyDeleted, true);
    assert.equal(second.value.deletedAt, deletedAt);
  }
  assert.equal(repeat.calls.length, 1, "repeat delete must not write again");
});

test("soft delete returns notFound for missing rows", async () => {
  const missing = new FakeSupabase([{ data: null, error: null }]);
  const result = await repository(missing).softDelete(ACTOR, ID, "2026-11-07T10:00:00.000Z");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "notFound");
});
