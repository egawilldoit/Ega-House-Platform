import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { obligationReceiptFingerprint } from "@ega/application";

import { createApp } from "../src/index";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
};
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];

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

class FakeBuilder {
  private readonly steps: Step[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }
  gte(...args: unknown[]) {
    this.steps.push({ method: "gte", args });
    return this;
  }
  lte(...args: unknown[]) {
    this.steps.push({ method: "lte", args });
    return this;
  }
  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }
  range(...args: unknown[]) {
    this.steps.push({ method: "range", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  maybeSingle(...args: unknown[]) {
    return this.terminal("maybeSingle", args);
  }
  single(...args: unknown[]) {
    return this.terminal("single", args);
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await", []).then(fulfilled, rejected);
  }
  private terminal(method: string, args: unknown[]) {
    this.steps.push({ method, args });
    this.fake.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(this.fake.pop(this.table));
  }
}

const AUTH = { authorization: "Bearer money-token" };
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const FINGERPRINT = obligationReceiptFingerprint({
  kind: "bill",
  description: "Rent",
  amountMinor: 350000,
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  dueDate: "2026-11-05",
  needVsWant: null,
  purpose: "fixed",
  countsInDaily: false,
  category: "bills",
  stateEffectiveDate: "2026-11-01",
  templateId: null,
  idempotencyKey: "occurrence-1",
});

function occurrenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OCCURRENCE_ID,
    template_id: null,
    kind: "bill",
    description: "Rent",
    amount_minor: 350000,
    currency: "MAD",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    due_date: "2026-11-05",
    need_vs_want: null,
    purpose: "fixed",
    counts_in_daily: false,
    category: "bills",
    state: "pending",
    state_effective_date: "2026-11-01",
    state_reason: null,
    payment_expense_id: null,
    payment_evidence: null,
    idempotency_key: "occurrence-1",
    create_fingerprint: FINGERPRINT,
    version: 1,
    created_at: "2026-11-01T09:00:00+00:00",
    updated_at: "2026-11-01T09:00:00+00:00",
    ...overrides,
  };
}

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    kind: "bill",
    description: "Internet",
    amount_minor: 29900,
    currency: "MAD",
    cadence: "monthly",
    due_day_of_month: 15,
    due_weekday: null,
    start_date: "2026-10-01",
    end_date: null,
    need_vs_want: "need",
    purpose: "fixed",
    counts_in_daily: false,
    category: "bills",
    lifecycle: "active",
    idempotency_key: "template-1",
    create_fingerprint: FINGERPRINT,
    version: 1,
    created_at: "2026-10-01T09:00:00+00:00",
    updated_at: "2026-10-01T09:00:00+00:00",
    ...overrides,
  };
}

const CREATE_BODY = {
  kind: "bill",
  description: "Rent",
  amountMinor: 350000,
  dueDate: "2026-11-05",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  stateEffectiveDate: "2026-11-01",
  idempotencyKey: "occurrence-1",
};

function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => (token === "money-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  });
}

test("money obligation routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", "/api/money/obligations"],
    ["GET", "/api/money/obligations/summary?cutoff=2026-11-11"],
    ["POST", "/api/money/obligations"],
    ["GET", `/api/money/obligations/${OCCURRENCE_ID}`],
    ["PATCH", `/api/money/obligations/${OCCURRENCE_ID}`],
    ["POST", `/api/money/obligations/${OCCURRENCE_ID}/transition`],
    ["GET", "/api/money/obligation-templates"],
  ] as const) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal((await res.json()).error.code, "UNAUTHENTICATED");
  }
});

test("POST /api/money/obligations creates a pending occurrence for the verified owner", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: null, error: null });
  fake.push("money_obligations", { data: occurrenceRow(), error: null });

  const res = await makeApp(fake).request("/api/money/obligations", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(CREATE_BODY),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.obligation.id, OCCURRENCE_ID);
  assert.equal(body.obligation.amountMinor, 350000);
  assert.equal(body.obligation.state, "pending");
  assert.equal(body.obligation.needVsWant, null);

  const insert = fake.calls
    .flatMap((call) => call.steps)
    .find((step) => step.method === "insert");
  const payload = insert?.args[0] as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "user-123");
  assert.equal(payload.state, "pending");
  assert.equal(payload.currency, "MAD");
  assert.equal(payload.payment_expense_id, undefined);
});

test("POST /api/money/obligations replays a matching receipt with 200", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: occurrenceRow(), error: null });

  const res = await makeApp(fake).request("/api/money/obligations", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(CREATE_BODY),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true);
});

test("POST rejects caller identity, float amounts and out-of-period due dates", async () => {
  const app = makeApp(new FakeSupabase());
  for (const body of [
    { ...CREATE_BODY, ownerUserId: "attacker" },
    { ...CREATE_BODY, currency: "USD" },
    { ...CREATE_BODY, amountMinor: 10.5 },
    { ...CREATE_BODY, amountMinor: 0 },
    { ...CREATE_BODY, dueDate: "2026-12-05" },
    { ...CREATE_BODY, state: "paid" },
    { ...CREATE_BODY, stateEffectiveDate: undefined },
  ]) {
    const res = await app.request("/api/money/obligations", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error.code, "VALIDATION");
  }
});

test("GET /api/money/obligations scopes by owner and applies kind/state/due filters", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: [occurrenceRow()], error: null });

  const res = await makeApp(fake).request(
    "/api/money/obligations?kind=bill&state=pending&dueFrom=2026-11-01&dueTo=2026-11-30&limit=10",
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.obligations.length, 1);
  assert.deepEqual(body.pagination, { limit: 10, offset: 0, hasMore: false });

  const steps = fake.calls[0]?.steps ?? [];
  assert.ok(
    steps.some(
      (step) =>
        step.method === "eq" &&
        step.args[0] === "owner_user_id" &&
        step.args[1] === "user-123",
    ),
  );
  assert.ok(steps.some((step) => step.method === "eq" && step.args[1] === "bill"));
  assert.ok(steps.some((step) => step.method === "gte" && step.args[0] === "due_date"));
  assert.ok(steps.some((step) => step.method === "lte" && step.args[0] === "due_date"));
});

test("GET /api/money/obligations rejects unsupported filters with 400", async () => {
  const app = makeApp(new FakeSupabase());
  for (const query of [
    "limit=0",
    "limit=101",
    "offset=-1",
    "kind=loan",
    "state=overdue",
    "dueFrom=2026-12-01&dueTo=2026-11-01",
    "ownerUserId=attacker",
  ]) {
    const res = await app.request(`/api/money/obligations?${query}`, {
      headers: AUTH,
    });
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).error.code, "VALIDATION");
  }
});

test("GET summary totals overdue and due occurrences at the cutoff", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", {
    data: [
      occurrenceRow({ id: "row-1", due_date: "2026-11-01", amount_minor: 10000 }),
      occurrenceRow({ id: "row-2", due_date: "2026-11-11", amount_minor: 20000 }),
      occurrenceRow({ id: "row-3", due_date: "2026-12-01", amount_minor: 99000 }),
    ],
    error: null,
  });

  const res = await makeApp(fake).request(
    "/api/money/obligations/summary?cutoff=2026-11-11",
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.summary.cutoffDate, "2026-11-11");
  assert.equal(body.summary.overdueMinor, 10000);
  assert.equal(body.summary.dueMinor, 20000);
  assert.equal(body.summary.outstandingMinor, 30000);
  assert.equal(body.summary.currency, "MAD");
  assert.equal(body.summary.truncated, false);
});

test("GET summary requires a real cutoff date", async () => {
  const res = await makeApp(new FakeSupabase()).request(
    "/api/money/obligations/summary?cutoff=2026-02-30",
    { headers: AUTH },
  );
  assert.equal(res.status, 400);
});

test("GET /api/money/obligations/:id returns 404 for unknown or malformed ids", async () => {
  const missing = await makeApp(new FakeSupabase()).request(
    `/api/money/obligations/${OCCURRENCE_ID}`,
    { headers: AUTH },
  );
  assert.equal(missing.status, 404);

  const malformed = await makeApp(new FakeSupabase()).request(
    "/api/money/obligations/not-a-uuid",
    { headers: AUTH },
  );
  assert.equal(malformed.status, 404);
});

test("PATCH maps a stale version to 409 and a paid settlement edit to 409", async () => {
  const stale = new FakeSupabase();
  stale.push("money_obligations", { data: occurrenceRow(), error: null });
  stale.push("money_obligations", { data: null, error: null });
  stale.push("money_obligations", { data: { id: OCCURRENCE_ID }, error: null });
  const staleRes = await makeApp(stale).request(
    `/api/money/obligations/${OCCURRENCE_ID}`,
    {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, amountMinor: 360000 }),
    },
  );
  assert.equal(staleRes.status, 409);

  const paid = new FakeSupabase();
  paid.push("money_obligations", {
    data: occurrenceRow({
      state: "paid",
      state_effective_date: "2026-11-05",
      payment_expense_id: "33333333-3333-4333-8333-333333333333",
    }),
    error: null,
  });
  const paidRes = await makeApp(paid).request(
    `/api/money/obligations/${OCCURRENCE_ID}`,
    {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, amountMinor: 1 }),
    },
  );
  assert.equal(paidRes.status, 409);
  assert.match((await paidRes.json()).error.message, /MONEY-07/);
  // No UPDATE statement was attempted for the settled occurrence.
  assert.ok(!fakeHasUpdate(paid));
});

function fakeHasUpdate(fake: FakeSupabase) {
  return fake.calls.some((call) =>
    call.steps.some((step) => step.method === "update"),
  );
}

test("a status-only paid transition is refused with an actionable conflict", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: occurrenceRow(), error: null });
  const res = await makeApp(fake).request(
    `/api/money/obligations/${OCCURRENCE_ID}/transition`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        to: "paid",
        effectiveDate: "2026-11-11",
      }),
    },
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error.message, /MONEY-07/);
  assert.ok(!fakeHasUpdate(fake));
});

test("cancel and waiver transitions update version and effective date", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: occurrenceRow(), error: null });
  fake.push("money_obligations", {
    data: occurrenceRow({
      state: "cancelled",
      state_effective_date: "2026-11-11",
      state_reason: "Duplicate bill",
      version: 2,
    }),
    error: null,
  });

  const res = await makeApp(fake).request(
    `/api/money/obligations/${OCCURRENCE_ID}/transition`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        to: "cancelled",
        effectiveDate: "2026-11-11",
        reason: "Duplicate bill",
      }),
    },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.obligation.state, "cancelled");
  assert.equal(body.obligation.stateEffectiveDate, "2026-11-11");

  const update = fake.calls
    .flatMap((call) => call.steps)
    .find((step) => step.method === "update");
  const payload = update?.args[0] as Record<string, unknown>;
  assert.equal(payload.state, "cancelled");
  assert.equal(payload.state_effective_date, "2026-11-11");
  assert.equal(payload.version, 2);
});

test("template routes create, list and generate occurrences", async () => {
  const createFake = new FakeSupabase();
  createFake.push("money_obligation_templates", { data: null, error: null });
  createFake.push("money_obligation_templates", {
    data: templateRow(),
    error: null,
  });
  const createRes = await makeApp(createFake).request(
    "/api/money/obligation-templates",
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "bill",
        description: "Internet",
        amountMinor: 29900,
        cadence: "monthly",
        dueDayOfMonth: 15,
        startDate: "2026-10-01",
        idempotencyKey: "template-1",
      }),
    },
  );
  assert.equal(createRes.status, 201);
  assert.equal((await createRes.json()).template.id, TEMPLATE_ID);

  const listFake = new FakeSupabase();
  listFake.push("money_obligation_templates", {
    data: [templateRow()],
    error: null,
  });
  const listRes = await makeApp(listFake).request(
    "/api/money/obligation-templates?kind=bill&includeArchived=false",
    { headers: AUTH },
  );
  assert.equal(listRes.status, 200);
  assert.equal((await listRes.json()).templates.length, 1);
  const listSteps = listFake.calls[0]?.steps ?? [];
  assert.ok(
    listSteps.some(
      (step) => step.method === "eq" && step.args[0] === "lifecycle",
    ),
  );

  const generateFake = new FakeSupabase();
  generateFake.push("money_obligation_templates", {
    data: templateRow({ start_date: "2026-09-01" }),
    error: null,
  });
  generateFake.push("money_obligations", { data: null, error: null });
  generateFake.push("money_obligations", {
    data: occurrenceRow({
      id: "gen-1",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      due_date: "2026-09-15",
      template_id: TEMPLATE_ID,
      idempotency_key: `obligation-template:${TEMPLATE_ID}:2026-09-01`,
    }),
    error: null,
  });
  generateFake.push("money_obligations", { data: null, error: null });
  generateFake.push("money_obligations", {
    data: occurrenceRow({
      id: "gen-2",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      due_date: "2026-10-15",
      template_id: TEMPLATE_ID,
      idempotency_key: `obligation-template:${TEMPLATE_ID}:2026-10-01`,
    }),
    error: null,
  });
  generateFake.push("money_obligations", { data: null, error: null });
  generateFake.push("money_obligations", {
    data: occurrenceRow({
      id: "gen-3",
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      due_date: "2026-11-15",
      template_id: TEMPLATE_ID,
      idempotency_key: `obligation-template:${TEMPLATE_ID}:2026-11-01`,
    }),
    error: null,
  });
  const generateRes = await makeApp(generateFake).request(
    `/api/money/obligation-templates/${TEMPLATE_ID}/generate`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ throughDate: "2026-11-30" }),
    },
  );
  assert.equal(generateRes.status, 200);
  const generated = await generateRes.json();
  assert.equal(generated.ok, true);
  assert.equal(generated.created, 3);
  assert.equal(generated.existing, 0);
  assert.equal(generated.truncated, false);
});

test("template list rejects a non-boolean includeArchived", async () => {
  const res = await makeApp(new FakeSupabase()).request(
    "/api/money/obligation-templates?includeArchived=yes",
    { headers: AUTH },
  );
  assert.equal(res.status, 400);
});
