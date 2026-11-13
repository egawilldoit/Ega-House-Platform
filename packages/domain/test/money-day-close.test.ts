import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  moneyDayCloseTransition,
  parseMoneyDayCloseInput,
  type MoneyPeriod,
} from "../src/money";

function period(patch: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    startDate: "2026-11-09",
    endDate: "2026-11-30",
    currency: "MAD",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-29",
    lifecycle: "tracking",
    initialization: "initialized",
    openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    provenance: { opening: null, createdFrom: "web" },
    settings: {},
    version: 3,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-29T00:00:00.000Z",
    ...patch,
  };
}

test("day close advances only the expected active day", () => {
  assert.deepEqual(
    moneyDayCloseTransition(period(), {
      date: "2026-11-29",
      expectedVersion: 3,
    }),
    { ok: true, activeDate: "2026-11-30", lifecycle: "tracking", isFinalDay: false },
  );
});

test("closing the final day retains the end date and ends the period", () => {
  assert.deepEqual(
    moneyDayCloseTransition(period({ activeDate: "2026-11-30" }), {
      date: "2026-11-30",
      expectedVersion: 3,
    }),
    { ok: true, activeDate: "2026-11-30", lifecycle: "ended", isFinalDay: true },
  );
});

test("day close refuses a lagging date, a skipped day and a stale version", () => {
  assert.deepEqual(
    moneyDayCloseTransition(period(), {
      date: "2026-11-28",
      expectedVersion: 3,
    }),
    { ok: false, reason: "date_not_active" },
  );
  assert.deepEqual(
    moneyDayCloseTransition(period(), {
      date: "2026-11-30",
      expectedVersion: 3,
    }),
    { ok: false, reason: "date_after_active" },
  );
  assert.deepEqual(
    moneyDayCloseTransition(period(), {
      date: "2026-11-29",
      expectedVersion: 2,
    }),
    { ok: false, reason: "stale_period" },
  );
});

test("an ended period never accepts a routine close", () => {
  assert.deepEqual(
    moneyDayCloseTransition(period({ lifecycle: "ended" }), {
      date: "2026-11-29",
      expectedVersion: 3,
    }),
    { ok: false, reason: "period_not_tracking" },
  );
});

test("close input requires a UUID operation and rejects unknown fields", () => {
  const valid = parseMoneyDayCloseInput({
    version: 3,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    note: "Closed with chicken",
    finalPurchases: [
      {
        amountMinor: 1100,
        category: "coffee",
        needVsWant: "want",
        idempotencyKey: "close-purchase-1",
      },
    ],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.expectedVersion, 3);
    assert.equal(valid.value.finalPurchases.length, 1);
    assert.equal(valid.value.finalPurchases[0]!.countsInDaily, null);
  }

  const unknown = parseMoneyDayCloseInput({
    version: 3,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ownerUserId: "attacker",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.field, "ownerUserId");

  const badOp = parseMoneyDayCloseInput({
    version: 3,
    operationId: "not-a-uuid",
  });
  assert.equal(badOp.ok, false);

  const tooMany = parseMoneyDayCloseInput({
    version: 3,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    finalPurchases: Array.from({ length: 21 }, (_, index) => ({
      amountMinor: 100,
      category: "coffee",
      needVsWant: "need",
      idempotencyKey: `purchase-${index}`,
    })),
  });
  assert.equal(tooMany.ok, false);
});

test("MONEY-09 migration stores immutable close evidence and advances once", () => {
  const migration = readFileSync(
    new URL("../../../drizzle/0104_money_09_day_close.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.money_day_closes/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS money_day_closes_owner_operation_unique/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS money_day_closes_owner_period_date_unique/);
  assert.match(migration, /FOREIGN KEY \(owner_user_id, period_id\)/);
  assert.match(migration, /close_fingerprint text NOT NULL CHECK/);
  assert.match(migration, /snapshot jsonb NOT NULL/);
  assert.match(migration, /money_close_day/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /status', 'replayed'/);
  assert.match(migration, /status', 'operation_conflict'/);
  assert.match(migration, /status', 'duplicate_close'/);
  assert.match(migration, /close_date_not_active/);
  assert.match(migration, /baseline_unavailable/);
  assert.match(migration, /included_movement_invalid/);
  assert.match(migration, /lifecycle = 'ended'/);
  assert.match(migration, /money_ensure_day_start_baseline\(p_period_id, v_period\.active_date\)/);
  assert.match(migration, /mcp_finance_grant_allows\('personal_ops\.write'\)/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /owner_user_id = \(SELECT auth\.uid\(\)\)/);
  // The close is not a routine check-in and does not create a period.
  assert.doesNotMatch(migration, /daily_checkins/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.money_periods/i);
});
