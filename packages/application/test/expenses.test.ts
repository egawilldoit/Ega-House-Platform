import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "../src/auth/actor";
import type {
  ExpenseIdempotencyReceipt,
  ExpenseListRecordQuery,
  ExpenseRepository,
  ExpenseUpdateRecordInput,
} from "../src/expenses/ports";
import {
  parseCreateExpenseInput,
  type ExpenseCreateValues,
  type PersonalExpense,
} from "@ega/domain/expenses";

import {
  createExpense,
  deleteExpense,
  expenseReceiptFingerprint,
  getExpense,
  listExpenses,
  updateExpense,
} from "../src/expenses/service";

const ACTOR = createAuthenticatedActor("owner-1");
const ID = "00000000-0000-4000-8000-000000000001";

function expense(overrides: Partial<PersonalExpense> = {}): PersonalExpense {
  return {
    id: ID,
    kind: "expense",
    direction: "out",
    occurredAt: "2026-11-07T08:30:00.000Z",
    bookingDate: "2026-11-07",
    amountMinor: 2250,
    currency: "MAD",
    category: "coffee",
    note: "morning coffee",
    merchant: "Cafe Atlas",
    needVsWant: "want",
    paymentMethod: "card",
    purpose: null,
    countsInDaily: true,
    periodId: null,
    idempotencyKey: "key-1",
    version: 1,
    deletedAt: null,
    createdAt: "2026-11-07T08:31:00.000Z",
    updatedAt: "2026-11-07T08:31:00.000Z",
    ...overrides,
  };
}

const CREATE_BODY = {
  occurredAt: "2026-11-07T09:30:00+01:00",
  amountMinor: 2250,
  category: "coffee",
  note: "morning coffee",
  merchant: "Cafe Atlas",
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "key-1",
};

const ORIGINAL_VALUES: ExpenseCreateValues = {
  occurredAt: "2026-11-07T08:30:00.000Z",
  bookingDate: "2026-11-07",
  amountMinor: 2250,
  category: "coffee",
  note: "morning coffee",
  merchant: "Cafe Atlas",
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "key-1",
};

const ORIGINAL_FINGERPRINT = expenseReceiptFingerprint(ORIGINAL_VALUES);

function receipt(
  value: PersonalExpense,
  createFingerprint = ORIGINAL_FINGERPRINT,
): ExpenseIdempotencyReceipt {
  return { expense: value, createFingerprint };
}

type FakeState = {
  existing: ExpenseIdempotencyReceipt | null;
  createResults: Array<
    | { ok: true; value: PersonalExpense }
    | { ok: false; error: { code: "conflict" | "unknown" | "notFound" | "forbidden" } }
  >;
  racedExisting: ExpenseIdempotencyReceipt | null;
  updateResult:
    | { ok: true; value: PersonalExpense }
    | { ok: false; error: { code: "conflict" | "unknown" | "notFound" | "forbidden" } };
  deleteResult:
    | { ok: true; value: { id: string; deletedAt: string; alreadyDeleted: boolean } }
    | { ok: false; error: { code: "conflict" | "unknown" | "notFound" | "forbidden" } };
  listResults: PersonalExpense[][];
  getResult: PersonalExpense | null;
};

function makeRepository(state: Partial<FakeState> = {}) {
  const calls: {
    find: string[];
    create: number;
    list: ExpenseListRecordQuery[];
    update: ExpenseUpdateRecordInput[];
    delete: Array<{ id: string; nowIso: string }>;
  } = { find: [], create: 0, list: [], update: [], delete: [] };

  const repository: ExpenseRepository = {
    async findByIdempotencyKey(_actor, key) {
      calls.find.push(key);
      if (calls.find.length === 1) {
        return { ok: true, value: state.existing ?? null };
      }
      return { ok: true, value: state.racedExisting ?? null };
    },
    async create(_actor, _input) {
      calls.create += 1;
      return state.createResults?.shift() ?? { ok: true, value: expense() };
    },
    async get() {
      return { ok: true, value: state.getResult ?? null };
    },
    async list(_actor, query) {
      calls.list.push(query);
      return { ok: true, value: state.listResults?.shift() ?? [] };
    },
    async update(_actor, _id, input) {
      calls.update.push(input);
      return state.updateResult ?? { ok: true, value: expense({ version: 2 }) };
    },
    async summarize() {
      return { ok: true as const, value: { totalsByCategory: {}, countsByCategory: {}, recordCount: 0, truncated: false } };
    },
    async softDelete(_actor, id, nowIso) {
      calls.delete.push({ id, nowIso });
      return (
        state.deleteResult ?? {
          ok: true,
          value: { id, deletedAt: nowIso, alreadyDeleted: false },
        }
      );
    },
  };

  return { repository, calls };
}

test("create persists a validated expense and reports a fresh receipt", async () => {
  const { repository, calls } = makeRepository();
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, false);
  assert.equal(calls.create, 1);
  assert.deepEqual(calls.find, ["key-1"]);
});

test("create replays the prior receipt for the same canonical payload", async () => {
  const { repository, calls } = makeRepository({ existing: receipt(expense()) });
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.expense.id, ID);
  assert.equal(calls.create, 0);
});

test("create replays the original payload after the row was edited", async () => {
  const edited = expense({ amountMinor: 2400, note: "updated coffee", version: 2 });
  const { repository } = makeRepository({ existing: receipt(edited) });
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.expense.amountMinor, 2400);
  assert.equal(result.data.expense.note, "updated coffee");
  assert.equal(result.data.expense.version, 2);
});

test("create rejects edited values even though they match the current row", async () => {
  const edited = expense({ amountMinor: 2400, note: "updated coffee", version: 2 });
  const { repository, calls } = makeRepository({ existing: receipt(edited) });
  const result = await createExpense(ACTOR, repository, {
    ...CREATE_BODY,
    amountMinor: 2400,
    note: "updated coffee",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "conflict");
  assert.equal(calls.create, 0);
});

test("max escaped metadata hashes to a fixed 64-character receipt", () => {
  const parsed = parseCreateExpenseInput({
    ...CREATE_BODY,
    note: "\"\\\n".repeat(167).slice(0, 500),
    merchant: "\"\\".repeat(60),
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const fingerprint = expenseReceiptFingerprint(parsed.value);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint.length, 64);
});

test("create rejects the same key with a different original payload", async () => {
  const otherFingerprint = expenseReceiptFingerprint({
    ...ORIGINAL_VALUES,
    amountMinor: 999,
  });
  const { repository, calls } = makeRepository({
    existing: receipt(expense({ amountMinor: 999 }), otherFingerprint),
  });
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "conflict");
  assert.equal(calls.create, 0);
});

test("create replays the original payload after a soft delete", async () => {
  const deleted = expense({
    version: 2,
    deletedAt: "2026-11-08T00:00:00.000Z",
  });
  const { repository } = makeRepository({ existing: receipt(deleted) });
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.expense.deletedAt, "2026-11-08T00:00:00.000Z");
});

test("create classifies a concurrent unique-constraint race as a replay", async () => {
  const { repository, calls } = makeRepository({
    createResults: [{ ok: false, error: { code: "conflict" } }],
    racedExisting: receipt(expense()),
  });
  const result = await createExpense(ACTOR, repository, CREATE_BODY);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, true);
  assert.equal(calls.create, 1);
});

test("create validates before any persistence call", async () => {
  const { repository, calls } = makeRepository();
  for (const body of [
    { ...CREATE_BODY, amountMinor: 22.5 },
    { ...CREATE_BODY, amountMinor: 0 },
    { ...CREATE_BODY, amountMinor: 2147483648 },
    { ...CREATE_BODY, category: "rent" },
    { ...CREATE_BODY, ownerUserId: "attacker" },
    { ...CREATE_BODY, occurredAt: "2026-11-07" },
  ]) {
    const result = await createExpense(ACTOR, repository, body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "validation");
  }
  assert.equal(calls.create, 0);
  assert.equal(calls.find.length, 0);
});

test("update forwards the expected version and maps stale changes to conflict", async () => {
  const { repository, calls } = makeRepository({
    updateResult: { ok: false, error: { code: "conflict" } },
  });
  const result = await updateExpense(
    ACTOR,
    repository,
    ID,
    { version: 4, amountMinor: 1990 },
    { now: new Date("2026-11-07T10:00:00.000Z") },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "conflict");
  assert.equal(calls.update[0]?.expectedVersion, 4);
  assert.equal(calls.update[0]?.changes.amountMinor, 1990);
  assert.equal(calls.update[0]?.updatedAt, "2026-11-07T10:00:00.000Z");
});

test("update maps a missing or deleted expense to notFound", async () => {
  const { repository } = makeRepository({
    updateResult: { ok: false, error: { code: "notFound" } },
  });
  const result = await updateExpense(ACTOR, repository, ID, { version: 1, note: "x" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "notFound");
});

test("update rejects malformed ids and versions without persistence", async () => {
  const { repository, calls } = makeRepository();
  const malformed = await updateExpense(ACTOR, repository, "not-an-id", { version: 1, note: "x" });
  assert.equal(malformed.ok, false);
  const invalid = await updateExpense(ACTOR, repository, ID, { version: 0, note: "x" });
  assert.equal(invalid.ok, false);
  assert.equal(calls.update.length, 0);
});

test("get returns the owner record or notFound", async () => {
  const found = await getExpense(ACTOR, makeRepository({ getResult: expense() }).repository, ID);
  assert.equal(found.ok, true);

  const missing = await getExpense(ACTOR, makeRepository({ getResult: null }).repository, ID);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "notFound");

  const malformed = await getExpense(ACTOR, makeRepository().repository, "bad");
  assert.equal(malformed.ok, false);
});

test("list limits to the requested page and reports hasMore exactly", async () => {
  const rows = [
    expense({ id: "00000000-0000-4000-8000-000000000003" }),
    expense({ id: "00000000-0000-4000-8000-000000000002" }),
    expense({ id: "00000000-0000-4000-8000-000000000001" }),
  ];
  const { repository, calls } = makeRepository({ listResults: [rows] });
  const result = await listExpenses(
    ACTOR,
    repository,
    { from: "2026-11-01", to: "2026-11-07", limit: "2" },
    { timezone: "Asia/Tokyo" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.expenses.length, 2);
  assert.equal(result.data.pagination.hasMore, true);
  assert.equal(result.data.pagination.limit, 2);
  assert.equal(calls.list[0]?.limit, 3);
  assert.equal(calls.list[0]?.startUtcIso, "2026-10-31T15:00:00.000Z");
  assert.equal(calls.list[0]?.endUtcExclusiveIso, "2026-11-07T15:00:00.000Z");
});

test("list validates pagination and timezone before persistence", async () => {
  const { repository, calls } = makeRepository();
  for (const [query, options] of [
    [{ limit: "0" }, {}],
    [{ limit: "101" }, {}],
    [{ from: "2026-11-01" }, {}],
    [{ from: "2026-11-01", timezone: "Mars/Olympus" }, {}],
    [{ ownerUserId: "x" }, {}],
  ] as const) {
    const result = await listExpenses(ACTOR, repository, query, options);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "validation");
  }
  assert.equal(calls.list.length, 0);
});

test("delete reports first and repeated soft deletes without extra state changes", async () => {
  const now = new Date("2026-11-07T10:00:00.000Z");
  const { repository, calls } = makeRepository({
    deleteResult: {
      ok: true,
      value: { id: ID, deletedAt: now.toISOString(), alreadyDeleted: false },
    },
  });
  const first = await deleteExpense(ACTOR, repository, ID, { now });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.data.alreadyDeleted, false);

  const secondRepository = makeRepository({
    deleteResult: {
      ok: true,
      value: { id: ID, deletedAt: now.toISOString(), alreadyDeleted: true },
    },
  });
  const second = await deleteExpense(ACTOR, secondRepository.repository, ID, { now });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.data.alreadyDeleted, true);
    assert.equal(second.data.deletedAt, now.toISOString());
  }
  assert.equal(calls.delete.length, 1);
});

test("delete maps a missing id to notFound and never calls persistence for malformed ids", async () => {
  const missing = await deleteExpense(
    ACTOR,
    makeRepository({ deleteResult: { ok: false, error: { code: "notFound" } } }).repository,
    ID,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "notFound");

  const { repository, calls } = makeRepository();
  const malformed = await deleteExpense(ACTOR, repository, "bad");
  assert.equal(malformed.ok, false);
  assert.equal(calls.delete.length, 0);
});
