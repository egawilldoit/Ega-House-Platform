import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * MONEY-001-B database proof.
 *
 * Opt-in via `MONEY_TEST_DATABASE_URL` because it executes RLS against a live
 * local/disposable Postgres/Supabase shim. Everything runs inside one
 * rolled-back transaction; the test never applies migrations and never touches
 * a non-local target unless MONEY_TEST_ALLOW_NONLOCAL is explicitly approved.
 */

const connectionString = process.env.MONEY_TEST_DATABASE_URL;
const RESOURCE = "https://ega.example.com/api/mcp";

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

function claims(owner: string) {
  return JSON.stringify({
    sub: owner,
    role: "authenticated",
    aud: RESOURCE,
  });
}

const SNAPSHOT_DIGEST = "a".repeat(64);
const MANIFEST_DIGEST = "b".repeat(64);
const SNAPSHOT = {
  version: "money-001-november-v1",
  snapshotId: "nov-2026-synthetic",
  workbookId: "synthetic-nov-2026-workbook",
  sourceIdentity: "synthetic://ega-house/money/2026-11/acceptance-v1",
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
  snapshotId: "nov-2026-synthetic",
  sourceIdentity: SNAPSHOT.sourceIdentity,
  target: { ownerId: "owner-a", environment: "test" },
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
  summary: {},
  discrepancies: [],
  blockers: [],
};
const APPROVAL = {
  status: "approved",
  manifestDigest: MANIFEST_DIGEST,
  snapshotDigest: SNAPSHOT_DIGEST,
  ownerId: "owner-a",
  environment: "test",
  approvedAt: "2026-11-23T10:00:00.000Z",
  approvedBy: "owner-a",
  acknowledgedDiscrepancyIds: [],
};

describe.skipIf(!connectionString)("MONEY-001-B adoption RLS proof", () => {
  const sql = postgres(connectionString!, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it("isolates adoption evidence and keeps the signed adjustment negative with owner-scoped keys", async () => {
    assertSafeTarget(connectionString);
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const state: Record<string, unknown> = {};

    try {
      await sql.begin(async (tx) => {
        const asUser = async (userId: string) => {
          await tx`reset role`;
          await tx`set local role authenticated`;
          await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
          await tx`select set_config('request.jwt.claims', ${claims(userId)}, true)`;
        };

        await asUser(ownerA);
        const inserted = await tx`
          insert into public.money_import_adoptions
            (snapshot_id, snapshot_digest, manifest_digest, source_identity,
             target_environment, opening_strategy, cutover_date, status,
             snapshot, manifest, approval)
          values
            ('nov-2026-synthetic', ${SNAPSHOT_DIGEST}, ${MANIFEST_DIGEST},
             'synthetic://ega-house/money/2026-11/acceptance-v1', 'test',
             'verified_cutover_opening', '2026-11-01', 'applying',
             ${tx.json(SNAPSHOT)}, ${tx.json(MANIFEST)}, ${tx.json(APPROVAL)})
          returning id, owner_user_id, status`;
        const adoptionId = String(inserted[0].id);
        state.ownerAInserted = String(inserted[0].owner_user_id) === ownerA;
        state.initialStatus = String(inserted[0].status);

        const own = await tx`
          select id from public.money_import_adoptions where id = ${adoptionId}`;
        state.ownerASelects = own.length;

        const updated = await tx`
          update public.money_import_adoptions
          set status = 'adopted',
              applied_counts = ${tx.json({ ledgerInserted: 6 })},
              updated_at = now()
          where id = ${adoptionId}
          returning status, applied_counts`;
        state.updatedStatus = String(updated[0].status);
        state.updatedCounts = updated[0].applied_counts;

        state.ownerADeleteDenied = false;
        await tx.unsafe("savepoint owner_a_delete");
        try {
          await tx`delete from public.money_import_adoptions where id = ${adoptionId}`;
          await tx.unsafe("release savepoint owner_a_delete");
        } catch {
          await tx.unsafe("rollback to savepoint owner_a_delete");
          state.ownerADeleteDenied = true;
        }

        // Owner B sees none of A's receipt and cannot insert as A or update it.
        await asUser(ownerB);
        const foreignSelect = await tx`
          select id from public.money_import_adoptions where id = ${adoptionId}`;
        state.ownerBSelects = foreignSelect.length;

        state.ownerBInsertDenied = false;
        await tx.unsafe("savepoint owner_b_insert");
        try {
          await tx`
            insert into public.money_import_adoptions
              (owner_user_id, snapshot_id, snapshot_digest, manifest_digest,
               source_identity, target_environment, opening_strategy,
               cutover_date, status, snapshot, manifest, approval)
            values
              (${ownerA}, 'nov-2026-other', ${SNAPSHOT_DIGEST}, ${MANIFEST_DIGEST},
               'synthetic://other', 'test', 'verified_cutover_opening',
               '2026-11-01', 'applying', ${tx.json(SNAPSHOT)},
               ${tx.json(MANIFEST)}, ${tx.json(APPROVAL)})`;
          await tx.unsafe("release savepoint owner_b_insert");
        } catch {
          await tx.unsafe("rollback to savepoint owner_b_insert");
          state.ownerBInsertDenied = true;
        }

        const foreignUpdate = await tx`
          update public.money_import_adoptions
          set status = 'review_needed'
          where id = ${adoptionId}
          returning id`;
        state.ownerBUpdates = foreignUpdate.length;

        // A signed reconciliation adjustment remains an out movement, and the
        // canonical signed aggregate applies the direction once.
        await asUser(ownerA);
        const adjustmentKey = `proof-adjustment-${randomUUID()}`;
        await tx`
          insert into public.personal_expenses
            (owner_user_id, occurred_at, amount_minor, currency, category, note,
             merchant, need_vs_want, payment_method, idempotency_key,
             create_fingerprint, kind, direction, booking_date, counts_in_daily)
          values
            (${ownerA}, null, 250, 'MAD', null, null, null, null, null,
             ${adjustmentKey}, ${"c".repeat(64)}, 'reconciliation_adjustment',
             'out', '2026-11-05', false)`;
        const aggregate = await tx`
          select coalesce(sum(
            case when direction = 'in' then amount_minor else -amount_minor end
          ), 0)::integer as net, count(*)::integer as rows
          from public.personal_expenses
          where owner_user_id = ${ownerA}
            and idempotency_key = ${adjustmentKey}
            and deleted_at is null`;
        state.adjustmentNet = Number(aggregate[0].net);
        state.adjustmentRows = Number(aggregate[0].rows);

        // The same idempotency key is owner-scoped: B accepts its own row, and
        // A cannot insert a second row with the first owner's key.
        await asUser(ownerB);
        await tx`
          insert into public.personal_expenses
            (owner_user_id, occurred_at, amount_minor, currency, category, note,
             merchant, need_vs_want, payment_method, idempotency_key,
             create_fingerprint, kind, direction, booking_date, counts_in_daily)
          values
            (${ownerB}, null, 250, 'MAD', null, null, null, null, null,
             ${adjustmentKey}, ${"d".repeat(64)}, 'reconciliation_adjustment',
             'out', '2026-11-05', false)`;
        const ownerBCount = await tx`
          select count(*)::integer as rows
          from public.personal_expenses
          where owner_user_id = ${ownerB}
            and idempotency_key = ${adjustmentKey}`;
        state.ownerBKeyRows = Number(ownerBCount[0].rows);

        await asUser(ownerA);
        state.duplicateKeyDenied = false;
        await tx.unsafe("savepoint owner_a_duplicate_key");
        try {
          await tx`
            insert into public.personal_expenses
              (owner_user_id, occurred_at, amount_minor, currency, category, note,
               merchant, need_vs_want, payment_method, idempotency_key,
               create_fingerprint, kind, direction, booking_date, counts_in_daily)
            values
              (${ownerA}, null, 250, 'MAD', null, null, null, null, null,
               ${adjustmentKey}, ${"e".repeat(64)}, 'reconciliation_adjustment',
               'out', '2026-11-05', false)`;
          await tx.unsafe("release savepoint owner_a_duplicate_key");
        } catch {
          await tx.unsafe("rollback to savepoint owner_a_duplicate_key");
          state.duplicateKeyDenied = true;
        }

        throw new RollbackProof();
      });
    } catch (error) {
      if (!(error instanceof RollbackProof)) throw error;
    }

    expect(state.ownerAInserted).toBe(true);
    expect(state.initialStatus).toBe("applying");
    expect(state.ownerASelects).toBe(1);
    expect(state.updatedStatus).toBe("adopted");
    expect(state.updatedCounts).toMatchObject({ ledgerInserted: 6 });
    expect(state.ownerADeleteDenied).toBe(true);
    expect(state.ownerBSelects).toBe(0);
    expect(state.ownerBInsertDenied).toBe(true);
    expect(state.ownerBUpdates).toBe(0);
    expect(state.adjustmentRows).toBe(1);
    expect(state.adjustmentNet).toBe(-250);
    expect(state.ownerBKeyRows).toBe(1);
    expect(state.duplicateKeyDenied).toBe(true);
  }, 60_000);
});
