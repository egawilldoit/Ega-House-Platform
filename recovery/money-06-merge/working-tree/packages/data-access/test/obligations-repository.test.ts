import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseObligationRepository } from "../src/money/obligations-repository";

const ACTOR = createAuthenticatedActor("owner-obligations");
const ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = "0123456789abcdef".repeat(4);

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

const OCCURRENCE_ROW = {
  id: ID,
  template_id: null,
  kind: "bill",
  description: "Rent",
  amount_minor: 350000,
  currency: "MAD",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  due_date: "2026-11-05",
  need_vs_want: "need",
  purpose: "fixed",
  counts_in_daily: false,
  category: "bills",
  state: "pending",
  state_effective_date: "2026-11-01",
  state_reason: null,
  payment_expense_id: null,
  payment_evidence: null,
  idempotency_key: "occurrence-1",
  version: 1,
  created_at: "2026-11-01T09:00:00+00:00",
  updated_at: "2026-11-01T09:00:00+00:00",
};

const TEMPLATE_ROW = {
  id: TEMPLATE_ID,
  kind: "bill",
  description: "Internet",
  amount_minor: 29900,
  currency: "MAD",
  cadence: "monthly",
  due_day_of_month: 15,
  due_weekday: null,
  start_date: "2026-01-01",
  end_date: null,
  need_vs_want: "need",
  purpose: "flexible",
  counts_in_daily: true,
  category: "household",
  lifecycle: "active",
  idempotency_key: "template-1",
  version: 1,
  created_at: "2026-01-01T09:00:00+00:00",
  updated_at: "2026-01-01T09:00:00+00:00",
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
  gte(column: string, value: unknown) {
    this.steps.push(`gte:${column}=${String(value)}`);
    return this;
  }
  lte(column: string, value: unknown) {
    this.steps.push(`lte:${column}=${String(value)}`);
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
  readonly tables: string[] = [];
  readonly calls: Array<{ steps: string[] }> = [];
  constructor(private readonly queue: QueryResult[]) {}
  from(table: string) {
    this.tables.push(table);
    return new FakeBuilder(this.queue, this.calls);
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseObligationRepository(fake as unknown as SupabaseClient);
}

const CREATE_RECORD = {
  values: {
    kind: "bill" as const,
    description: "Rent",
    amountMinor: 350000,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    dueDate: "2026-11-05",
    needVsWant: "need" as const,
    purpose: "fixed" as const,
    countsInDaily: false,
    category: "bills" as const,
    stateEffectiveDate: "2026-11-01",
    templateId: null,
    idempotencyKey: "occurrence-1",
  },
  createFingerprint: FINGERPRINT,
};

test("get scopes by owner and maps the occurrence read shape", async () => {
  const fake = new FakeSupabase([{ data: OCCURRENCE_ROW, error: null }]);
  const result = await repository(fake).get(ACTOR, ID);

  assert.equal(result.ok, true);
  if (result.ok && result.value) {
    assert.equal(result.value.amountMinor, 350000);
    assert.equal(result.value.periodStart, "2026-11-01");
    assert.equal(result.value.dueDate, "2026-11-05");
    assert.equal(result.value.needVsWant, "need");
    assert.equal(result.value.state, "pending");
    assert.equal(result.value.currency, "MAD");
  }
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-obligations"));
  assert.ok(steps.some((step) => step === `eq:id=${ID}`));
});

test("historical import evidence maps explicitly and malformed evidence stays unclaimed", async () => {
  const mapped = await repository(
    new FakeSupabase([
      {
        data: {
          ...OCCURRENCE_ROW,
          state: "paid",
          payment_evidence: {
            kind: "reconciled_historical_import",
            reference: "workbook-2026-1",
            note: "Source row 42",
            importedAt: "2026-11-01T00:00:00.000Z",
          },
        },
        error: null,
      },
    ]),
  ).get(ACTOR, ID);
  assert.equal(mapped.ok, true);
  assert.deepEqual(
    mapped.ok && mapped.value?.paymentEvidence,
    {
      kind: "reconciled_historical_import",
      reference: "workbook-2026-1",
      note: "Source row 42",
      importedAt: "2026-11-01T00:00:00.000Z",
    },
  );

  const malformed = await repository(
    new FakeSupabase([
      {
        data: {
          ...OCCURRENCE_ROW,
          state: "paid",
          payment_evidence: { kind: "reconciled_historical_import", reference: "  " },
        },
        error: null,
      },
    ]),
  ).get(ACTOR, ID);
  assert.equal(malformed.ok, true);
  assert.equal(malformed.ok && malformed.value?.paymentEvidence, null);
});

test("create sends owner from the actor, pending state, MAD and the fingerprint", async () => {
  const fake = new FakeSupabase([{ data: OCCURRENCE_ROW, error: null }]);
  const created = await repository(fake).create(ACTOR, CREATE_RECORD);
  assert.equal(created.ok, true);

  const insert = fake.calls[0]?.steps.find((step) => step.startsWith("insert:"));
  assert.ok(insert);
  const payload = JSON.parse(insert.slice("insert:".length)) as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "owner-obligations");
  assert.equal(payload.state, "pending");
  assert.equal(payload.state_effective_date, "2026-11-01");
  assert.equal(payload.currency, "MAD");
  assert.equal(payload.create_fingerprint, FINGERPRINT);
  assert.equal(payload.payment_expense_id, undefined);
  assert.equal(payload.payment_evidence, undefined);

  const select = fake.calls[0]?.steps.find((step) => step.startsWith("select:"));
  assert.ok(select && !select.includes("create_fingerprint"));
});

test("list applies owner, kind, state and inclusive due filters in due order", async () => {
  const fake = new FakeSupabase([{ data: [OCCURRENCE_ROW], error: null }]);
  const result = await repository(fake).list(ACTOR, {
    kind: "bill",
    state: "pending",
    dueFrom: "2026-11-01",
    dueTo: "2026-11-30",
    limit: 26,
    offset: 25,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.length, 1);

  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-obligations"));
  assert.ok(steps.some((step) => step === "eq:kind=bill"));
  assert.ok(steps.some((step) => step === "eq:state=pending"));
  assert.ok(steps.some((step) => step === "gte:due_date=2026-11-01"));
  assert.ok(steps.some((step) => step === "lte:due_date=2026-11-30"));
  assert.ok(steps.some((step) => step === "order:due_date:true"));
  assert.ok(steps.some((step) => step === "range:25-50"));
});

test("update is guarded by version and owner and classifies a miss", async () => {
  const fake = new FakeSupabase([
    { data: { ...OCCURRENCE_ROW, version: 2 }, error: null },
  ]);
  const result = await repository(fake).update(ACTOR, ID, {
    changes: { amountMinor: 355000 },
    expectedVersion: 1,
    updatedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(result.ok, true);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:version=1"));
  assert.ok(steps.some((step) => step === `eq:id=${ID}`));
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-obligations"));
  const update = steps.find((step) => step.startsWith("update:"));
  assert.ok(update?.includes('"version":2'));

  const conflict = await repository(
    new FakeSupabase([
      { data: null, error: null },
      { data: { id: ID }, error: null },
    ]),
  ).update(ACTOR, ID, {
    changes: { description: "Rent" },
    expectedVersion: 1,
    updatedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false && conflict.error.code, "conflict");

  const missing = await repository(
    new FakeSupabase([
      { data: null, error: null },
      { data: null, error: null },
    ]),
  ).update(ACTOR, ID, {
    changes: { description: "Rent" },
    expectedVersion: 1,
    updatedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.error.code, "notFound");
});

test("transition guards both version and source state", async () => {
  const fake = new FakeSupabase([
    { data: { ...OCCURRENCE_ROW, state: "cancelled", version: 2 }, error: null },
  ]);
  const result = await repository(fake).transition(ACTOR, ID, {
    fromState: "pending",
    to: "cancelled",
    effectiveDate: "2026-11-11",
    reason: "Duplicate bill",
    expectedVersion: 1,
    updatedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(result.ok, true);
  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:state=pending"));
  assert.ok(steps.some((step) => step === "eq:version=1"));
  const update = steps.find((step) => step.startsWith("update:"));
  assert.ok(update?.includes('"state":"cancelled"'));
  assert.ok(update?.includes('"state_effective_date":"2026-11-11"'));
  assert.ok(update?.includes('"version":2'));
});

test("permission and unique violations map to forbidden and conflict", async () => {
  const forbidden = await repository(
    new FakeSupabase([{ data: null, error: { code: "42501" } }]),
  ).create(ACTOR, CREATE_RECORD);
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.ok === false && forbidden.error.code, "forbidden");

  const duplicate = await repository(
    new FakeSupabase([
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "money_obligations_template_period_unique"',
        },
      },
    ]),
  ).create(ACTOR, CREATE_RECORD);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.ok === false && duplicate.error.code, "conflict");
});

test("template list excludes archived rows unless explicitly requested", async () => {
  const activeOnly = new FakeSupabase([{ data: [TEMPLATE_ROW], error: null }]);
  await repository(activeOnly).listTemplates(ACTOR, {
    kind: "bill",
    includeArchived: false,
  });
  let steps = activeOnly.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:lifecycle=active"));
  assert.ok(steps.some((step) => step === "eq:kind=bill"));

  const all = new FakeSupabase([{ data: [TEMPLATE_ROW], error: null }]);
  await repository(all).listTemplates(ACTOR, {
    kind: null,
    includeArchived: true,
  });
  steps = all.calls[0]?.steps ?? [];
  assert.ok(!steps.some((step) => step.startsWith("eq:lifecycle")));
  assert.ok(steps.some((step) => step === "eq:owner_user_id=owner-obligations"));
});

test("template create and update preserve owner, active lifecycle and version guard", async () => {
  const createFake = new FakeSupabase([{ data: TEMPLATE_ROW, error: null }]);
  const created = await repository(createFake).createTemplate(ACTOR, {
    values: {
      kind: "bill",
      description: "Internet",
      amountMinor: 29900,
      cadence: "monthly",
      dueDayOfMonth: 15,
      dueWeekday: null,
      startDate: "2026-01-01",
      endDate: null,
      needVsWant: "need",
      purpose: "flexible",
      countsInDaily: true,
      category: "household",
      idempotencyKey: "template-1",
    },
    createFingerprint: FINGERPRINT,
  });
  assert.equal(created.ok, true);
  const insert = createFake.calls[0]?.steps.find((step) =>
    step.startsWith("insert:"),
  );
  const payload = JSON.parse(
    insert!.slice("insert:".length),
  ) as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "owner-obligations");
  assert.equal(payload.lifecycle, "active");
  assert.equal(payload.create_fingerprint, FINGERPRINT);

  const updateFake = new FakeSupabase([
    { data: { ...TEMPLATE_ROW, version: 2 }, error: null },
  ]);
  const updated = await repository(updateFake).updateTemplate(ACTOR, TEMPLATE_ID, {
    changes: { amountMinor: 31900, lifecycle: "archived" },
    expectedVersion: 1,
    updatedAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(updated.ok, true);
  const steps = updateFake.calls[0]?.steps ?? [];
  assert.ok(steps.some((step) => step === "eq:version=1"));
  const update = steps.find((step) => step.startsWith("update:"));
  assert.ok(update?.includes('"lifecycle":"archived"'));
  assert.ok(update?.includes('"version":2'));
});
