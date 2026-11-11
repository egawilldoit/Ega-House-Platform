import assert from "node:assert/strict";
import test from "node:test";

import type { PersonalExpense } from "@ega/domain/expenses";

import { createAuthenticatedActor } from "../src/auth/actor";
import {
  EXPENSE_EXPORT_PAGE_SIZE,
  exportExpenses,
} from "../src/expenses/export";
import type {
  ExpenseListRecordQuery,
  ExpenseRepository,
} from "../src/expenses/ports";

const ACTOR = createAuthenticatedActor("owner-1");

function row(index: number): PersonalExpense {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    occurredAt: "2026-11-11T09:00:00.000Z",
    amountMinor: 1100,
    currency: "MAD",
    category: "coffee",
    note: null,
    merchant: null,
    needVsWant: "want",
    paymentMethod: null,
    idempotencyKey: `key-${index}`,
    version: 1,
    deletedAt: null,
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  };
}

function repositoryWith(rows: PersonalExpense[]) {
  const calls: Array<{ actorUserId: string; query: ExpenseListRecordQuery }> = [];
  const repository = {
    async list(actor: { userId: string }, query: ExpenseListRecordQuery) {
      calls.push({ actorUserId: actor.userId, query });
      return {
        ok: true as const,
        value: rows.slice(query.offset, query.offset + query.limit),
      };
    },
  } as unknown as ExpenseRepository;
  return { repository, calls };
}

test("export pages through the whole owner range without a silent ceiling", async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => row(index));
  const { repository, calls } = repositoryWith(rows);

  const result = await exportExpenses(ACTOR, repository, {
    from: "2026-11-01",
    to: "2026-11-30",
    timezone: "Africa/Casablanca",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.recordCount, 1200);
  assert.equal(result.data.expenses.length, 1200);
  assert.deepEqual(
    calls.map((call) => call.query.offset),
    [0, EXPENSE_EXPORT_PAGE_SIZE, EXPENSE_EXPORT_PAGE_SIZE * 2],
  );
  for (const call of calls) {
    assert.equal(call.actorUserId, ACTOR.userId);
    assert.equal(call.query.startUtcIso !== null, true);
    assert.equal(call.query.endUtcExclusiveIso !== null, true);
  }
});

test("export refuses explicitly above its bounded row budget instead of truncating", async () => {
  const rows = Array.from({ length: 700 }, (_, index) => row(index));
  const { repository } = repositoryWith(rows);

  const result = await exportExpenses(ACTOR, repository, {
    from: "2026-11-01",
    to: "2026-11-30",
    timezone: "Africa/Casablanca",
    maxRows: 600,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "validation");
  assert.match(result.errorMessage, /more than 600 expenses/);
});

test("export validates dates and timezone through the shared list parser", async () => {
  const { repository } = repositoryWith([]);

  const badDate = await exportExpenses(ACTOR, repository, {
    from: "2026-13-40",
    to: "2026-11-30",
    timezone: "Africa/Casablanca",
  });
  assert.equal(badDate.ok, false);

  const badTimezone = await exportExpenses(ACTOR, repository, {
    from: "2026-11-01",
    to: "2026-11-30",
    timezone: "Mars/Olympus",
  });
  assert.equal(badTimezone.ok, false);
});

test("export returns an empty complete result for a range with no rows", async () => {
  const { repository, calls } = repositoryWith([]);

  const result = await exportExpenses(ACTOR, repository, {
    from: "2026-11-01",
    to: "2026-11-30",
    timezone: "Africa/Casablanca",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.recordCount, 0);
  assert.equal(calls.length, 1);
});
