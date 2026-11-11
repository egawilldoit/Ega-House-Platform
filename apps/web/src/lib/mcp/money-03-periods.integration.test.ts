import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * MONEY-03 database proof.
 *
 * Opt-in via `MONEY_TEST_DATABASE_URL` because it executes RLS/RPC against a
 * live Postgres/Supabase target. Everything runs in one rolled-back
 * transaction. The proof seeds the reconciliation owner
 * `ab.mortaki@gmail.com` required by migration 0043 so this same target can
 * run the full migration chain.
 */

const connectionString = process.env.MONEY_TEST_DATABASE_URL;
const RESOURCE = "https://ega.example.com/api/mcp";
const RECONCILIATION_EMAIL = "ab.mortaki@gmail.com";

function assertSafeTarget(url: string | undefined): void {
  if (!url) return;
  const host = new URL(url).hostname;
  const local =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!local && process.env.MONEY_TEST_ALLOW_NONLOCAL !== "1") {
    throw new Error(
      "MONEY_TEST_DATABASE_URL points at a remote host. Set MONEY_TEST_ALLOW_NONLOCAL=1 only for an approved rolled-back proof target.",
    );
  }
}

class RollbackProof extends Error {}

function claims(owner: string, clientId: string | null) {
  return JSON.stringify(
    clientId
      ? { sub: owner, role: "authenticated", client_id: clientId, aud: RESOURCE }
      : { sub: owner, role: "authenticated", aud: "authenticated" },
  );
}

describe.skipIf(!connectionString)("MONEY-03 period and opening proof", () => {
  const sql = postgres(connectionString!, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it("initializes and corrects one opening, keeps boundaries, and isolates owners", async () => {
    assertSafeTarget(connectionString);
    const otherOwner = randomUUID();
    const state: Record<string, unknown> = {};

    // Seed the reconciliation owner required by 0043. Reuse an existing id.
    const existing = await sql`
      select id from auth.users
      where lower(email) = ${RECONCILIATION_EMAIL}
      limit 1`;
    let owner = existing[0]?.id as string | undefined;
    if (!owner) {
      owner = randomUUID();
      await sql`
        insert into auth.users
          (id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data)
        values
          (${owner}, 'authenticated', 'authenticated', ${RECONCILIATION_EMAIL},
           '', now(), '{}'::jsonb, '{}'::jsonb)
        on conflict do nothing`;
      const seeded = await sql`
        select id from auth.users
        where lower(email) = ${RECONCILIATION_EMAIL}
        limit 1`;
      owner = (seeded[0]?.id as string | undefined) ?? owner;
    }

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into public.user_time_context (user_id, iana_timezone)
          values (${owner}, 'Africa/Casablanca')
          on conflict (user_id) do update set iana_timezone = excluded.iana_timezone`;

        const asUser = async (userId: string, clientId: string | null) => {
          await tx`reset role`;
          await tx`set local role authenticated`;
          // Supabase auth.uid() reads either the individual claim or the JSON
          // claims; the disposable proof shim reads the former.
          await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
          await tx`select set_config('request.jwt.claims', ${claims(userId, clientId)}, true)`;
        };

        await asUser(owner, null);

        // A new timestamped expense keeps its instant and gets a deterministic
        // owner-local booking date from the 0095 trigger.
        const expenseId = randomUUID();
        await tx`
          insert into public.personal_expenses
            (id, occurred_at, amount_minor, currency, category, need_vs_want,
             idempotency_key, create_fingerprint)
          values
            (${expenseId}, '2026-11-09T23:30:00.000Z', 1100, 'MAD', 'coffee',
             'want', ${`proof-${expenseId}`}, ${"a".repeat(64)})`;
        const expense = await tx`
          select occurred_at, booking_date::text as booking_date, kind, direction, amount_minor
          from public.personal_expenses where id = ${expenseId}`;
        state.expenseInstant = new Date(
          expense[0].occurred_at as string | Date,
        ).toISOString();
        state.expenseBookingDate = String(expense[0].booking_date);
        state.expenseKind = String(expense[0].kind);
        state.expenseDirection = String(expense[0].direction);

        // Create a partial period with a known opening (zero would also be
        // valid); version 2 reflects the period+opening atomic write.
        const created = await tx`
          select * from public.money_create_period(
            ${"2026-11-09"}::date,
            ${"2026-11-30"}::date,
            'Africa/Casablanca',
            ${"2026-11-11"}::date,
            'initialized',
            50000,
            ${"2026-11-09"}::date,
            ${"b".repeat(64)},
            ${tx.json({
              opening: {
                source: "user_entered",
                recordedAt: "2026-11-11T10:00:00.000Z",
                cutoffDate: "2026-11-08",
                evidence: null,
                note: null,
                corrections: [],
              },
              createdFrom: "web",
            })},
            ${tx.json({ dailyTargetMinor: 20000 })},
            ${"2026-11-11T10:00:00.000Z"}::timestamptz
          )`;
        const periodId = String(created[0].id);
        state.createdVersion = Number(created[0].version);
        state.initialization = String(created[0].initialization);
        state.openingMovementId = String(created[0].opening_movement_id);

        const opening = await tx`
          select id, amount_minor, occurred_at, booking_date::text as booking_date, version
          from public.personal_expenses
          where kind = 'opening' and period_id = ${periodId}`;
        state.openingRows = opening.length;
        state.openingAmount = Number(opening[0].amount_minor);
        state.openingDateOnly = opening[0].occurred_at === null;
        state.openingBooksOnStart = String(opening[0].booking_date);

        // A second opening row for the same owner+period is refused.
        state.duplicateOpeningRejected = false;
        await tx.unsafe("savepoint duplicate_opening");
        try {
          await tx`
            insert into public.personal_expenses
              (owner_user_id, occurred_at, amount_minor, currency, category,
               need_vs_want, idempotency_key, create_fingerprint, kind,
               direction, booking_date, counts_in_daily, period_id)
            values
              (${owner}, null, 1, 'MAD', null, null, 'second-opening',
               ${"c".repeat(64)}, 'opening', 'in', '2026-11-09', false,
               ${periodId})`;
          await tx.unsafe("release savepoint duplicate_opening");
        } catch {
          await tx.unsafe("rollback to savepoint duplicate_opening");
          state.duplicateOpeningRejected = true;
        }

        // Active date changes without changing boundaries or transactions.
        const advanced = await tx`
          select id, active_date::text as active_date, start_date::text as start_date, end_date::text as end_date, version from public.money_update_period(
            ${periodId}::uuid, 2, ${"2026-11-10"}::date, null, null, null, null, null, null,
            ${"2026-11-11T11:00:00.000Z"}::timestamptz
          )`;
        state.advancedActiveDate = String(advanced[0].active_date);
        state.advancedStart = String(advanced[0].start_date);
        state.advancedEnd = String(advanced[0].end_date);
        state.advancedVersion = Number(advanced[0].version);
        const untouched = await tx`
          select amount_minor, booking_date::text as booking_date from public.personal_expenses where id = ${expenseId}`;
        state.expenseAfterAdvance = Number(untouched[0].amount_minor);
        state.bookingAfterAdvance = String(untouched[0].booking_date);

        // Stale version returns no row and never overwrites.
        const stale = await tx`
          select id, active_date::text as active_date, start_date::text as start_date, end_date::text as end_date, version from public.money_update_period(
            ${periodId}::uuid, 2, ${"2026-11-09"}::date, null, null, null, null, null, null,
            ${"2026-11-11T12:00:00.000Z"}::timestamptz
          )`;
        state.staleRows = stale.length;
        const stillAdvanced = await tx`
          select active_date::text as active_date, version from public.money_periods where id = ${periodId}`;
        state.stillActiveDate = String(stillAdvanced[0].active_date);
        state.stillVersion = Number(stillAdvanced[0].version);

        // Correction keeps one ledger row, bumps its version, and appends
        // provenance supplied by the application.
        const corrected = await tx`
          select * from public.money_update_period(
            ${periodId}::uuid, 3, null, null, 65000, null, 'recounted',
            ${tx.json({
              opening: {
                source: "user_entered",
                recordedAt: "2026-11-11T10:00:00.000Z",
                cutoffDate: "2026-11-08",
                evidence: null,
                note: "recounted",
                corrections: [
                  {
                    at: "2026-11-11T12:00:00.000Z",
                    amountMinor: 65000,
                    previousAmountMinor: 50000,
                    ledgerVersion: 2,
                    source: "user_entered",
                    note: "recounted",
                  },
                ],
              },
              createdFrom: "web",
            })},
            'initialized',
            ${"2026-11-11T12:00:00.000Z"}::timestamptz
          )`;
        state.correctedVersion = Number(corrected[0].version);
        const correctedOpening = await tx`
          select id, amount_minor, version
          from public.personal_expenses
          where kind = 'opening' and period_id = ${periodId}`;
        state.correctedRows = correctedOpening.length;
        state.correctedAmount = Number(correctedOpening[0].amount_minor);
        state.correctedLedgerVersion = Number(correctedOpening[0].version);
        state.sameOpeningId =
          String(correctedOpening[0].id) === state.openingMovementId;

        // An overlapping tracking period is refused by the unique tracking
        // index. This must run while the source period is still tracking.
        state.overlapRejected = false;
        await tx.unsafe("savepoint overlap_period");
        try {
          await tx`
            select * from public.money_create_period(
              ${"2026-11-15"}::date, ${"2026-12-15"}::date, 'Africa/Casablanca',
              ${"2026-11-15"}::date, 'uninitialized', null, null, null,
              ${tx.json({ opening: null, createdFrom: "web" })},
              ${tx.json({})}, now()
            )`;
          await tx.unsafe("release savepoint overlap_period");
        } catch {
          await tx.unsafe("rollback to savepoint overlap_period");
          state.overlapRejected = true;
        }

        // Ending is a versioned transition; routine updates then refuse.
        await tx`
          update public.money_periods
          set lifecycle = 'ended', version = version + 1, updated_at = now()
          where id = ${periodId}`;
        state.endedRoutineRefused = false;
        await tx.unsafe("savepoint ended_period");
        try {
          await tx`
            select * from public.money_update_period(
              ${periodId}::uuid, 5, ${"2026-11-10"}::date, null, null, null, null, null, null, now()
            )`;
          await tx.unsafe("release savepoint ended_period");
        } catch {
          await tx.unsafe("rollback to savepoint ended_period");
          state.endedRoutineRefused = true;
        }

        // Another owner sees neither the period nor the opening under RLS.
        await asUser(otherOwner, null);
        const otherPeriods = await tx`
          select id from public.money_periods where id = ${periodId}`;
        const otherOpenings = await tx`
          select id from public.personal_expenses where kind = 'opening'`;
        state.otherOwnerPeriods = otherPeriods.length;
        state.otherOwnerOpenings = otherOpenings.length;

        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }

    expect(state.expenseInstant).toBe("2026-11-09T23:30:00.000Z");
    expect(state.expenseBookingDate).toBe("2026-11-10");
    expect(state.expenseKind).toBe("expense");
    expect(state.expenseDirection).toBe("out");
    expect(state.createdVersion).toBe(2);
    expect(state.initialization).toBe("initialized");
    expect(state.openingRows).toBe(1);
    expect(state.openingAmount).toBe(50000);
    expect(state.openingDateOnly).toBe(true);
    expect(state.openingBooksOnStart).toBe("2026-11-09");
    expect(state.duplicateOpeningRejected).toBe(true);
    expect(state.advancedActiveDate).toBe("2026-11-10");
    expect(state.advancedStart).toBe("2026-11-09");
    expect(state.advancedEnd).toBe("2026-11-30");
    expect(state.advancedVersion).toBe(3);
    expect(state.expenseAfterAdvance).toBe(1100);
    expect(state.bookingAfterAdvance).toBe("2026-11-10");
    expect(state.staleRows).toBe(0);
    expect(state.stillActiveDate).toBe("2026-11-10");
    expect(state.stillVersion).toBe(3);
    expect(state.correctedVersion).toBe(4);
    expect(state.correctedRows).toBe(1);
    expect(state.correctedAmount).toBe(65000);
    expect(state.correctedLedgerVersion).toBe(2);
    expect(state.sameOpeningId).toBe(true);
    expect(state.endedRoutineRefused).toBe(true);
    expect(state.overlapRejected).toBe(true);
    expect(state.otherOwnerPeriods).toBe(0);
    expect(state.otherOwnerOpenings).toBe(0);
  }, 60_000);
});
