import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { MoneyImportApproval } from "@ega/domain/money-import";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMoneyImportRepository } from "../src/money/import-repository";

const ACTOR = createAuthenticatedActor("00000000-0000-4000-8000-0000000000aa");
const SNAPSHOT_ID = "nov-2026-synthetic";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

class FakeBuilder {
  readonly steps: string[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
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
  gte(column: string, value: unknown) {
    this.steps.push(`gte:${column}=${String(value)}`);
    return this;
  }
  lte(column: string, value: unknown) {
    this.steps.push(`lte:${column}=${String(value)}`);
    return this;
  }
  lt(column: string, value: unknown) {
    this.steps.push(`lt:${column}=${String(value)}`);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.steps.push(`in:${column}=${values.map(String).join(",")}`);
    return this;
  }
  is(column: string, value: unknown) {
    this.steps.push(`is:${column}=${String(value)}`);
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
  limit(value: number) {
    this.steps.push(`limit:${value}`);
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
    this.fake.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(this.fake.pop(this.table));
  }
}

class FakeSupabase {
  readonly calls: Array<{ table: string; steps: string[] }> = [];
  private readonly queues = new Map<string, QueryResult[]>();

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseMoneyImportRepository(fake as unknown as SupabaseClient);
}

const APPROVAL: MoneyImportApproval = {
  status: "approved",
  manifestDigest: "a".repeat(64),
  snapshotDigest: "b".repeat(64),
  ownerId: ACTOR.userId,
  environment: "test",
  approvedAt: "2026-11-23T10:00:00.000Z",
  approvedBy: ACTOR.userId,
  acknowledgedDiscrepancyIds: [],
};

const SNAPSHOT = {
  version: "money-001-november-v1",
  snapshotId: SNAPSHOT_ID,
  workbookId: "synthetic",
  sourceIdentity: "synthetic://workbook",
  retrievedAt: "2026-11-23T09:00:00.000Z",
  extractionDate: "2026-11-23",
  month: "2026-11",
  timezone: "Africa/Casablanca",
  currency: "MAD",
  rows: [],
  tabs: ["Ledger"],
};

const MANIFEST = {
  version: "money-001-november-v1",
  snapshotId: SNAPSHOT_ID,
  sourceIdentity: "synthetic://workbook",
  target: { ownerId: ACTOR.userId, environment: "test" },
  period: {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-01",
    opening: { amountMinor: 10_000, cutoffDate: "2026-11-01", evidence: "source:x" },
  },
  openingStrategy: "verified_cutover_opening",
  cutover: {
    date: "2026-11-01",
    reportedBalanceMinor: 10_000,
    verified: true,
    evidenceRef: "synthetic",
    uncoveredDates: [],
  },
  targetBaseline: { movements: [], obligations: [], coffeeVisits: [] },
  candidates: [],
  summary: {
    rowCounts: {},
    kindTotals: {},
    categoryTotals: {},
    dayTotals: {},
    cashEquation: {},
    linkCoverage: {},
    unknowns: 0,
  },
  discrepancies: [],
  blockers: [],
};

const ADOPTION_ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_user_id: ACTOR.userId,
  snapshot_id: SNAPSHOT_ID,
  snapshot_digest: "b".repeat(64),
  manifest_digest: "a".repeat(64),
  source_identity: "synthetic://workbook",
  target_environment: "test",
  opening_strategy: "verified_cutover_opening",
  cutover_date: "2026-11-01",
  status: "adopted",
  snapshot: SNAPSHOT,
  manifest: MANIFEST,
  approval: APPROVAL,
  applied_counts: { ledgerInserted: 6 },
  post_reconciliation: { complete: true, periodId: "period-1" },
  created_at: "2026-11-23T09:00:00.000Z",
  updated_at: "2026-11-23T10:00:00.000Z",
  applied_at: "2026-11-23T10:00:00.000Z",
};

const MOVEMENT_ROW = {
  id: "00000000-0000-4000-8000-000000000002",
  idempotency_key: "mi-mv:nov:L4",
  kind: "expense",
  direction: "out",
  amount_minor: 1000,
  category: "coffee",
  note: "Coffee",
  merchant: "Cafe Atlas",
  booking_date: "2026-11-03",
  deleted_at: null,
};

test("adoption reads filter owner and map the stored receipt", async () => {
  const fake = new FakeSupabase();
  fake.push("money_import_adoptions", { data: ADOPTION_ROW, error: null });
  const result = await repository(fake).getAdoption(ACTOR, SNAPSHOT_ID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value?.status, "adopted");
    assert.equal(result.value?.snapshotDigest, "b".repeat(64));
    assert.equal(result.value?.manifestDigest, "a".repeat(64));
    assert.equal(result.value?.postReconciliation?.complete, true);
    assert.equal(result.value?.appliedCounts?.ledgerInserted, 6);
  }
  const steps = fake.calls[0]!.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes(`eq:snapshot_id=${SNAPSHOT_ID}`));
});

test("target movement reads page until exhaustion and keep the owner filter", async () => {
  const fake = new FakeSupabase();
  const pageOne = Array.from({ length: 500 }, (_, index) => ({
    ...MOVEMENT_ROW,
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    idempotency_key: `mi-mv:page:${index}`,
  }));
  fake.push("personal_expenses", { data: pageOne, error: null });
  fake.push("personal_expenses", { data: [MOVEMENT_ROW], error: null });
  const result = await repository(fake).listTargetMovements(ACTOR, {
    startDate: "2026-10-01",
    endDate: "2026-11-30",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 501);
    assert.equal(result.value[500]?.idempotencyKey, "mi-mv:nov:L4");
  }
  assert.equal(fake.calls.length, 2);
  assert.ok(fake.calls[0]!.steps.includes("range:0-499"));
  assert.ok(fake.calls[1]!.steps.includes("range:500-999"));
  assert.ok(fake.calls[0]!.steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(fake.calls[0]!.steps.includes("is:deleted_at=null"));
  assert.ok(fake.calls[0]!.steps.includes("gte:booking_date=2026-10-01"));
  assert.ok(fake.calls[0]!.steps.includes("lte:booking_date=2026-11-30"));
});

test("pre-cutover movement reads are owner-scoped, newest-first and bounded", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: [
      {
        ...MOVEMENT_ROW,
        id: "00000000-0000-4000-8000-000000000099",
        idempotency_key: "old-pre-cutover",
        booking_date: "2026-09-15",
      },
    ],
    error: null,
  });
  const result = await repository(fake).listTargetMovementsBefore(
    ACTOR,
    "2026-11-01",
    50,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]?.bookingDate, "2026-09-15");
  }
  const steps = fake.calls[0]!.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes("lt:booking_date=2026-11-01"));
  assert.ok(steps.includes("is:deleted_at=null"));
  assert.ok(steps.includes("order:booking_date:false"));
  assert.ok(steps.includes("limit:50"));
});

test("obligation and coffee target reads map their canonical shapes", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", {
    data: [
      {
        id: "obligation-1",
        description: "Internet",
        amount_minor: 700,
        due_date: "2026-11-09",
        period_start: "2026-11-01",
        period_end: "2026-11-30",
        state: "paid",
        payment_expense_id: "expense-1",
      },
    ],
    error: null,
  });
  fake.push("money_coffee_visits", {
    data: [
      {
        id: "visit-1",
        visit_key: "visit-key",
        local_date: "2026-11-03",
        lines: [{ expense_id: "expense-1" }, { expense_id: "expense-2" }],
      },
    ],
    error: null,
  });
  const repo = repository(fake);
  const obligations = await repo.listTargetObligations(ACTOR, {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
  const visits = await repo.listTargetCoffeeVisits(ACTOR, {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
  });
  assert.equal(obligations.ok, true);
  if (obligations.ok) {
    assert.equal(obligations.value[0]?.paymentExpenseId, "expense-1");
    assert.equal(obligations.value[0]?.state, "paid");
  }
  assert.equal(visits.ok, true);
  if (visits.ok) {
    assert.deepEqual(visits.value[0]?.expenseIds, ["expense-1", "expense-2"]);
    assert.equal(visits.value[0]?.localDate, "2026-11-03");
  }
  assert.ok(fake.calls[0]!.steps.includes("order:due_date:true"));
  assert.ok(fake.calls[1]!.steps.includes("order:local_date:true"));
});

test("begin stores owner-scoped snapshot/manifest/approval evidence", async () => {
  const fake = new FakeSupabase();
  fake.push("money_import_adoptions", { data: ADOPTION_ROW, error: null });
  const result = await repository(fake).beginAdoption(ACTOR, {
    snapshotId: SNAPSHOT_ID,
    snapshotDigest: "b".repeat(64),
    manifestDigest: "a".repeat(64),
    sourceIdentity: "synthetic://workbook",
    targetEnvironment: "test",
    openingStrategy: "verified_cutover_opening",
    cutoverDate: "2026-11-01",
    status: "applying",
    snapshot: SNAPSHOT as never,
    manifest: MANIFEST as never,
    approval: APPROVAL,
    appliedCounts: null,
    postReconciliation: null,
    createdAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T09:00:00.000Z",
    appliedAt: null,
  });
  assert.equal(result.ok, true);
  const steps = fake.calls[0]!.steps;
  assert.ok(steps.some((step) => step.startsWith("insert:")));
  const insert = steps.find((step) => step.startsWith("insert:"))!;
  assert.ok(insert.includes(`"owner_user_id":"${ACTOR.userId}"`));
  assert.ok(insert.includes(`"snapshot_id":"${SNAPSHOT_ID}"`));
  assert.ok(insert.includes('"status":"applying"'));
});

test("complete and review update only mutable receipt fields under applying status", async () => {
  const fake = new FakeSupabase();
  fake.push("money_import_adoptions", {
    data: { ...ADOPTION_ROW, status: "adopted" },
    error: null,
  });
  const record = {
    id: ADOPTION_ROW.id,
    snapshotId: SNAPSHOT_ID,
    snapshotDigest: "b".repeat(64),
    manifestDigest: "a".repeat(64),
    sourceIdentity: "synthetic://workbook",
    targetEnvironment: "test",
    openingStrategy: "verified_cutover_opening" as const,
    cutoverDate: "2026-11-01",
    status: "applying" as const,
    snapshot: SNAPSHOT as never,
    manifest: MANIFEST as never,
    approval: APPROVAL,
    appliedCounts: {
      totalSourceRows: 14,
      ledgerInserted: 6,
      ledgerLinked: 0,
      ledgerAlreadyApplied: 0,
      openingApplied: true,
      coffeeVisitsLinked: 1,
      paidBillsLinked: 1,
      unpaidBillsMetadata: 1,
      skippedRows: 6,
    },
    postReconciliation: null,
    createdAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T10:00:00.000Z",
    appliedAt: "2026-11-23T10:00:00.000Z",
  };
  const result = await repository(fake).completeAdoption(ACTOR, record);
  assert.equal(result.ok, true);
  const steps = fake.calls[0]!.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes(`eq:snapshot_id=${SNAPSHOT_ID}`));
  assert.ok(steps.includes("eq:status=applying"));
  assert.ok(steps.some((step) => step.startsWith("update:")));
  const update = steps.find((step) => step.startsWith("update:"))!;
  assert.ok(update.includes('"status":"adopted"'));
  assert.ok(update.includes('"applied_counts"'));
  assert.ok(!update.includes('"manifest"'));
});

test("key lookup chunking keeps batches bounded and owner-scoped", async () => {
  const fake = new FakeSupabase();
  for (let index = 0; index < 3; index += 1) {
    fake.push("personal_expenses", {
      data: [MOVEMENT_ROW],
      error: null,
    });
  }
  const keys = Array.from({ length: 250 }, (_, index) => `mi-mv:key:${index}`);
  const result = await repository(fake).listMovementsByKeys(ACTOR, keys);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.length, 3);
  assert.equal(fake.calls.length, 3);
  assert.ok(fake.calls[0]!.steps.some((step) => step.startsWith("in:idempotency_key=")));
  const firstIn = fake.calls[0]!.steps.find((step) => step.startsWith("in:"))!;
  assert.equal(firstIn.split(",").length, 100);
  const thirdIn = fake.calls[2]!.steps.find((step) => step.startsWith("in:"))!;
  assert.equal(thirdIn.split(",").length, 50);
  assert.ok(fake.calls[0]!.steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
});

test("adapter maps repository errors to the shared failure codes", async () => {
  const forbidden = new FakeSupabase();
  forbidden.push("money_import_adoptions", {
    data: null,
    error: { code: "42501", message: "denied" },
  });
  const forbiddenResult = await repository(forbidden).getAdoption(ACTOR, SNAPSHOT_ID);
  assert.equal(forbiddenResult.ok, false);
  if (!forbiddenResult.ok) assert.equal(forbiddenResult.error.code, "forbidden");

  const conflict = new FakeSupabase();
  conflict.push("money_import_adoptions", {
    data: null,
    error: { code: "23505", message: "duplicate" },
  });
  const conflictResult = await repository(conflict).beginAdoption(ACTOR, {
    snapshotId: SNAPSHOT_ID,
    snapshotDigest: "b".repeat(64),
    manifestDigest: "a".repeat(64),
    sourceIdentity: "synthetic://workbook",
    targetEnvironment: "test",
    openingStrategy: "verified_cutover_opening",
    cutoverDate: "2026-11-01",
    status: "applying",
    snapshot: SNAPSHOT as never,
    manifest: MANIFEST as never,
    approval: APPROVAL,
    appliedCounts: null,
    postReconciliation: null,
    createdAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T09:00:00.000Z",
    appliedAt: null,
  });
  assert.equal(conflictResult.ok, false);
  if (!conflictResult.ok) assert.equal(conflictResult.error.code, "conflict");
});
