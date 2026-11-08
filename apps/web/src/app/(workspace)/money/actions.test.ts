import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createAuthenticatedActor,
  createExpense,
  deleteExpense,
  updateExpense,
  type ExpenseRepository,
} from "@ega/application";
import type { AuthenticatedActor } from "@ega/application";
import type {
  ExpenseCreateValues,
  PersonalExpense,
} from "@ega/domain/expenses";

import { mapApplicationCode } from "@/lib/money/expense-action-codes";

const actionsSource = readFileSync(
  resolve(import.meta.dirname, "./actions.ts"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(import.meta.dirname, "./page.tsx"),
  "utf8",
);

test("money actions derive the actor from the verified session and never accept an owner", () => {
  assert.match(actionsSource, /getCurrentUser\(\)/);
  assert.match(actionsSource, /createAuthenticatedActor\(user\.id\)/);
  assert.match(actionsSource, /createExpense\(/);
  assert.match(actionsSource, /updateExpense\(/);
  assert.match(actionsSource, /deleteExpense\(/);
  assert.match(actionsSource, /getExpense\(/);
  assert.match(actionsSource, /new SupabaseExpenseRepository\(client\)/);
  assert.match(actionsSource, /revalidatePath\("\/money"\)/);
  assert.match(actionsSource, /mapApplicationCode\(result\.code\)/);
  assert.match(actionsSource, /expense-action-codes/);
  assert.doesNotMatch(actionsSource, /owner_user_id\s*:/);
  assert.doesNotMatch(actionsSource, /getSupabaseServiceClient/);
});

test("money actions map application codes onto the component conflict contract", () => {
  assert.equal(mapApplicationCode("conflict"), "CONFLICT");
  assert.equal(mapApplicationCode("validation"), "VALIDATION");
  assert.equal(mapApplicationCode("notFound"), "NOT_FOUND");
  assert.equal(mapApplicationCode("forbidden"), "FORBIDDEN");
  assert.equal(mapApplicationCode("unknown"), "INTERNAL");
  assert.equal(mapApplicationCode(undefined), "INTERNAL");
});

test("money page wires the mutation components with the verified owner", () => {
  assert.match(pageSource, /MoneyCreatePanel/);
  assert.match(pageSource, /MoneyRowActions/);
  assert.match(pageSource, /ownerKey=\{user\.id\}/);
  assert.match(pageSource, /expense=\{expense\}/);
});

/**
 * Owner-scoped in-memory repository honoring versions and idempotency
 * receipts, so the journey below proves the real application semantics the
 * actions delegate to: stable-key retry replays one row, a reused key with a
 * different payload conflicts, and a stale version never overwrites.
 */
function makeRepository() {
  const byId = new Map<string, PersonalExpense>();
  const byKey = new Map<
    string,
    { expense: PersonalExpense; createFingerprint: string }
  >();
  let sequence = 0;

  function scoped(actor: AuthenticatedActor, expense: PersonalExpense) {
    return (expense as unknown as { ownerUserId: string }).ownerUserId ===
      actor.userId
      ? expense
      : null;
  }

  const repository: ExpenseRepository = {
    async findByIdempotencyKey(actor, idempotencyKey) {
      const receipt = byKey.get(`${actor.userId}::${idempotencyKey}`) ?? null;
      return { ok: true as const, value: receipt };
    },
    async create(actor, input) {
      sequence += 1;
      const now = new Date().toISOString();
      const expense = {
        id: `11111111-1111-4111-8111-1111111111${String(sequence).padStart(2, "0")}`,
        occurredAt: input.values.occurredAt,
        amountMinor: input.values.amountMinor,
        currency: "MAD",
        category: input.values.category,
        note: input.values.note,
        merchant: input.values.merchant,
        needVsWant: input.values.needVsWant,
        paymentMethod: input.values.paymentMethod,
        idempotencyKey: input.values.idempotencyKey,
        version: 1,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
        ownerUserId: actor.userId,
      } as unknown as PersonalExpense;
      byId.set(expense.id, expense);
      byKey.set(`${actor.userId}::${input.values.idempotencyKey}`, {
        expense,
        createFingerprint: input.createFingerprint,
      });
      return { ok: true as const, value: expense };
    },
    async get(actor, id) {
      const expense = byId.get(id) ?? null;
      return {
        ok: true as const,
        value: expense && !expense.deletedAt ? scoped(actor, expense) : null,
      };
    },
    async list(actor, query) {
      const rows = [...byId.values()].filter(
        (expense) =>
          !expense.deletedAt && scoped(actor, expense) !== null,
      );
      return {
        ok: true as const,
        value: rows.slice(query.offset, query.offset + query.limit),
      };
    },
    async update(actor, id, input) {
      const current = byId.get(id) ?? null;
      if (!current || !scoped(actor, current)) {
        return {
          ok: false as const,
          error: { code: "notFound" as const },
        };
      }
      if (current.version !== input.expectedVersion) {
        return {
          ok: false as const,
          error: { code: "conflict" as const },
        };
      }
      const next = {
        ...current,
        ...input.changes,
        version: current.version + 1,
        updatedAt: input.updatedAt,
      };
      byId.set(id, next);
      return { ok: true as const, value: next };
    },
    async softDelete(actor, id, nowIso) {
      const current = byId.get(id) ?? null;
      if (!current || !scoped(actor, current)) {
        return {
          ok: false as const,
          error: { code: "notFound" as const },
        };
      }
      if (current.deletedAt) {
        return {
          ok: true as const,
          value: { id, deletedAt: current.deletedAt, alreadyDeleted: true },
        };
      }
      const next = { ...current, deletedAt: nowIso };
      byId.set(id, next);
      return {
        ok: true as const,
        value: { id, deletedAt: nowIso, alreadyDeleted: false },
      };
    },
  };
  return repository;
}

const CREATE_VALUES: ExpenseCreateValues = {
  occurredAt: "2026-11-08T10:00:00.000Z",
  amountMinor: 2250,
  category: "groceries",
  note: "Weekly shop",
  merchant: "Souk",
  needVsWant: "need",
  paymentMethod: "cash",
  idempotencyKey: "purchase-1",
};

test("timeout-then-retry with the same key creates one logical expense", async () => {
  const repository = makeRepository();
  const actor = createAuthenticatedActor("owner-1");

  const first = await createExpense(actor, repository, { ...CREATE_VALUES });
  assert.equal(first.ok, true);
  // Simulated timeout retry: identical payload and key.
  const retry = await createExpense(actor, repository, { ...CREATE_VALUES });
  assert.equal(retry.ok, true);
  if (first.ok && retry.ok) {
    assert.equal(first.data.replayed, false);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.expense.id, first.data.expense.id);
  }
});

test("a reused key with a different payload is rejected, never duplicated", async () => {
  const repository = makeRepository();
  const actor = createAuthenticatedActor("owner-1");

  const first = await createExpense(actor, repository, { ...CREATE_VALUES });
  assert.equal(first.ok, true);
  const conflicting = await createExpense(actor, repository, {
    ...CREATE_VALUES,
    amountMinor: 9999,
  });
  assert.equal(conflicting.ok, false);
  if (!conflicting.ok) assert.equal(conflicting.code, "conflict");
});

test("stale version update preserves server state for deliberate reconciliation", async () => {
  const repository = makeRepository();
  const actor = createAuthenticatedActor("owner-1");

  const created = await createExpense(actor, repository, { ...CREATE_VALUES });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const id = created.data.expense.id;

  const stale = await updateExpense(actor, repository, id, {
    version: 999,
    note: "Stale overwrite attempt",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "conflict");

  const current = await repository.get(actor, id);
  assert.equal(current.ok, true);
  if (current.ok) {
    assert.equal(current.value?.note, "Weekly shop");
    assert.equal(current.value?.version, 1);
  }

  const reconciled = await updateExpense(actor, repository, id, {
    version: 1,
    note: "Deliberate retry",
  });
  assert.equal(reconciled.ok, true);
});

test("soft delete reconciles: deleted rows leave the active list, repeat delete replays", async () => {
  const repository = makeRepository();
  const actor = createAuthenticatedActor("owner-1");

  const created = await createExpense(actor, repository, { ...CREATE_VALUES });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const id = created.data.expense.id;

  const deleted = await deleteExpense(actor, repository, id);
  assert.equal(deleted.ok, true);
  const again = await deleteExpense(actor, repository, id);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.data.alreadyDeleted, true);

  const listed = await repository.list(actor, {
    limit: 26,
    offset: 0,
    startUtcIso: null,
    endUtcExclusiveIso: null,
  });
  assert.equal(listed.ok, true);
  if (listed.ok) assert.deepEqual(listed.value, []);
});

test("expense rows are isolated between owners", async () => {
  const repository = makeRepository();
  const created = await createExpense(
    createAuthenticatedActor("owner-1"),
    repository,
    { ...CREATE_VALUES },
  );
  assert.equal(created.ok, true);

  const foreign = await repository.get(
    createAuthenticatedActor("owner-2"),
    (created as { ok: true; data: { expense: PersonalExpense } }).data.expense
      .id,
  );
  assert.equal(foreign.ok, true);
  if (foreign.ok) assert.equal(foreign.value, null);

  const foreignList = await repository.list(createAuthenticatedActor("owner-2"), {
    limit: 26,
    offset: 0,
    startUtcIso: null,
    endUtcExclusiveIso: null,
  });
  assert.equal(foreignList.ok, true);
  if (foreignList.ok) assert.deepEqual(foreignList.value, []);
});
