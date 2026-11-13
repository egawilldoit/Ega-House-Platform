#!/usr/bin/env node
/**
 * Disposable PostgreSQL proof for MONEY-10 (explicit period rollover).
 *
 * It applies the whole migration journal, finishes the source and middle
 * periods through real MONEY-09 `money_close_day` calls, then exercises the
 * close-to-restated comparison, atomic rollover, replay, unpaid-item treatment,
 * the ledger-trigger correction bridge and the verified-opening stop condition.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const RESOURCE = "https://ega.example.com/api/mcp";

const tags = JSON.parse(
  await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
).entries.map((entry) => entry.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");
// Keep DATE columns as ISO strings; this proof compares dates and never needs a
// JavaScript Date whose local timezone could shift the calendar day.
const sql = postgres(url, {
  max: 2,
  onnotice: () => {},
  types: {
    date: { to: 1082, from: [1082], serialize: (value) => value, parse: (value) => value },
  },
});

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function hex(char) {
  return char.repeat(64);
}

async function user(owner, fn, clientId = null) {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: owner,
        role: "authenticated",
        aud: clientId ? RESOURCE : "authenticated",
        ...(clientId ? { client_id: clientId } : {}),
      }),
    ]);
    return fn(tx);
  });
}

async function main() {
  try {
    await sql.unsafe(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;",
    );
    await sql.unsafe(`DO $x$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $x$`);
    await sql.unsafe("CREATE SCHEMA auth");
    await sql.unsafe("GRANT USAGE ON SCHEMA public, auth TO anon, authenticated");
    await sql.unsafe("CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL)");
    await sql.unsafe(
      "INSERT INTO auth.users VALUES ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'c@example.test')",
      [A, B, C],
    );
    await sql.unsafe("UPDATE auth.users SET email='ab.mortaki@gmail.com' WHERE id=$1", [A]);
    await sql.unsafe(
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$",
    );
    await sql.unsafe(
      "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$",
    );
    await sql.unsafe("CREATE SCHEMA automation");
    await sql.unsafe(
      "CREATE TABLE automation.implementation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64), linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1, status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64), heartbeat_at timestamptz, lease_expires_at timestamptz, started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), finished_at timestamptz, failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now())",
    );
    for (const tag of tags) {
      const text = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
      for (const statement of text
        .split("--> statement-breakpoint")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await sql.unsafe(statement);
      }
    }
    console.log(`[MIGRATE] ${tags.length} migrations through ${tags.at(-1)}`);

    // --- Owner A: one period with a known opening and mixed movements --------
    const created = await user(A, (tx) =>
      tx.unsafe(`SELECT (p).id AS id, (p).version AS version
        FROM (SELECT public.money_create_period(
          '2026-11-29'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
          '2026-11-29'::date,'initialized'::text,68900::integer,'2026-11-29'::date,
          repeat('a',64)::text,'{"opening":{"source":"user_entered","recordedAt":"2026-11-12T00:00:00.000Z","cutoffDate":"2026-11-12","evidence":null,"note":null,"corrections":[]}}'::jsonb,
          '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
          now()::timestamptz) AS p) created`),
    );
    const sourceId = created[0].id;

    // Simulate a web-created period whose mutable settings copy stayed empty:
    // the effective policy version is the source of truth.
    await sql.unsafe(
      "UPDATE public.money_periods SET settings='{}'::jsonb, version=version+1, updated_at=now() WHERE id=$1 AND owner_user_id=$2",
      [sourceId, A],
    );

    const movements = await user(A, async (tx) => {
      const rows = await tx.unsafe(`INSERT INTO public.personal_expenses
        (owner_user_id,amount_minor,currency,note,idempotency_key,create_fingerprint,kind,direction,
         booking_date,counts_in_daily,period_id,category,need_vs_want,purpose)
        VALUES
          ($1,5000,'MAD','salary','m10-income',repeat('b',64),'income','in','2026-11-29',false,$2,NULL,NULL,NULL),
          ($1,1100,'MAD','groceries','m10-expense',repeat('c',64),'expense','out','2026-11-29',true,$2,'groceries','need','flexible'),
          ($1,2000,'MAD','savings','m10-savings',repeat('d',64),'savings_transfer','out','2026-11-29',false,$2,NULL,NULL,NULL)
        RETURNING id, kind`, [A, sourceId]);
      return rows;
    });
    const expenseId = movements.find((row) => row.kind === "expense").id;

    // Fixture rows are seeded as the database owner with an explicit owner id;
    // the authenticated surface has no direct INSERT grant on occurrences.
    const template = await sql.unsafe(`INSERT INTO public.money_obligation_templates
        (owner_user_id,kind,description,amount_minor,currency,cadence,due_day_of_month,start_date,
         need_vs_want,purpose,counts_in_daily,category,lifecycle,idempotency_key,create_fingerprint)
        VALUES ($1,'subscription','Internet',3000,'MAD','monthly',5,'2026-11-01',
         'need','fixed',false,'subscriptions','active','m10-template',repeat('e',64))
        RETURNING id`, [A]);
    const templateId = template[0].id;

    const oneOff = await sql.unsafe(`INSERT INTO public.money_obligations
        (owner_user_id,kind,description,amount_minor,currency,period_start,period_end,due_date,
         need_vs_want,purpose,counts_in_daily,category,state,state_effective_date,state_history,
         idempotency_key,create_fingerprint)
        VALUES ($1,'bill','Repair',4000,'MAD','2026-11-29','2026-11-30','2026-11-30',
         'need','fixed',false,'bills','pending','2026-11-29','[]'::jsonb,
         'm10-one-off',repeat('f',64))
        RETURNING id`, [A]);
    const oneOffId = oneOff[0].id;

    // MONEY-09 precondition through the real durable close. The first-day
    // baseline is seeded as the fixture owner because this proof deliberately
    // runs on fixed historical dates that the current-day rebase path rejects;
    // both close rows and their snapshots are then produced by money_close_day.
    const policy = await sql.unsafe(
      "SELECT id FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2 ORDER BY version DESC LIMIT 1",
      [A, sourceId],
    );
    await sql.unsafe(
      `UPDATE public.money_day_start_baselines
       SET policy_version_id=$1, availability='available', unavailable_reason=NULL,
           cash_minor=68900, commitments_minor=0, savings_target_minor=12000,
           savings_funded_minor=0, emergency_target_minor=3000, emergency_used_minor=0,
           inputs='{"setupComplete":true}'::jsonb
       WHERE owner_user_id=$2 AND period_id=$3 AND date='2026-11-29'`,
      [policy[0].id, A, sourceId],
    );
    await sql.unsafe(
      `UPDATE public.money_periods
       SET day_start_setup_completed=true, version=version+1, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [sourceId, A],
    );

    for (const [index, date] of ["2026-11-29", "2026-11-30"].entries()) {
      const current = await sql.unsafe(
        "SELECT version FROM public.money_periods WHERE id=$1",
        [sourceId],
      );
      await user(A, (tx) =>
        tx.unsafe(
          `SELECT public.money_close_day($1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz)`,
          [
            sourceId,
            current[0].version,
            date,
            "CLOSED",
            `750e8400-e29b-41d4-a716-44665544001${index}`,
            hex(String(index + 1)),
            [],
            "2026-11-30T20:00:00.000Z",
          ],
        ),
      );
    }
    const ended = await sql.unsafe(
      "SELECT lifecycle, active_date, version FROM public.money_periods WHERE id=$1",
      [sourceId],
    );
    assert(
      ended[0].lifecycle === "ended" && ended[0].active_date === "2026-11-30",
      "source ended through the final durable close",
    );
    const closeRows = await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2",
      [A, sourceId],
    );
    assert(closeRows[0].n === 2, "two real day-close snapshots were retained");
    const snapshotSummary = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
        [sourceId],
      ),
    );
    assert(
      snapshotSummary[0].summary.available === true &&
        snapshotSummary[0].summary.closeCount === 2 &&
        snapshotSummary[0].summary.restatedDifferenceCount === 0 &&
        snapshotSummary[0].summary.paidObligationMismatchCount === 0 &&
        snapshotSummary[0].summary.countedVisitMismatchCount === 0 &&
        snapshotSummary[0].summary.savingsTargetMinor === 12000 &&
        snapshotSummary[0].summary.savingsTransferredMinor === 2000,
      "close snapshots and reconciliation evidence compare cleanly",
    );
    console.log("[CLOSE] real MONEY-09 close evidence and restated comparison are present");

    // --- Preview-shaped rollover request ------------------------------------
    const occurrences = [
      {
        values: {
          kind: "subscription",
          description: "Internet",
          amountMinor: 3000,
          periodStart: "2026-12-01",
          periodEnd: "2026-12-31",
          dueDate: "2026-12-05",
          needVsWant: "need",
          purpose: "fixed",
          countsInDaily: false,
          category: "subscriptions",
          stateEffectiveDate: "2026-12-01",
          templateId,
          idempotencyKey: `obligation-template:${templateId}:2026-12-01`,
        },
        createFingerprint: hex("1"),
      },
    ];
    const carried = [
      {
        occurrenceId: oneOffId,
        periodStart: "2026-12-01",
        periodEnd: "2026-12-19",
        dueDate: "2026-12-14",
        idempotencyKey: `rollover-carry:2026-12-01:${oneOffId}`,
        createFingerprint: hex("2"),
      },
    ];
    const provenance = {
      opening: {
        source: "carry_forward",
        recordedAt: "2026-12-01T09:00:00.000Z",
        cutoffDate: "2026-11-30",
        evidence: null,
        note: "Carried forward from the finished period.",
        corrections: [],
      },
      createdFrom: "mcp",
    };
    const rolloverArgs = (operationId, fingerprint, overrides = {}) => [
      sourceId,
      overrides.expectedVersion ?? ended[0].version,
      "2026-12-01",
      "2026-12-19",
      "2026-12-01",
      "Africa/Casablanca",
      overrides.initialized ?? "initialized",
      overrides.allowUncoveredDays ?? false,
      overrides.openingAmountMinor ?? 70800,
      "2026-11-30",
      null,
      "Carried forward from the finished period.",
      hex("3"),
      provenance,
      {},
      operationId,
      fingerprint,
      overrides.openingMode ?? "carry_forward",
      overrides.unpaidTreatment ?? "carry_forward",
      overrides.unpaidReason ?? "still owed",
      null,
      { modeledClosingCashMinor: 70800, pendingOccurrenceCount: 1 },
      overrides.occurrences ?? occurrences,
      overrides.carried ?? carried,
      "2026-12-01T09:00:00.000Z",
    ];
    const callRollover = (tx, args) =>
      tx.unsafe(
        `SELECT public.money_rollover_period(
          $1::uuid,$2::integer,$3::date,$4::date,$5::date,$6::text,$7::text,$8::boolean,
          $9::integer,$10::date,$11::text,$12::text,$13::text,$14::jsonb,$15::jsonb,$16::text,
          $17::text,$18::text,$19::text,$20::text,$21::text,$22::jsonb,$23::jsonb,$24::jsonb,
          $25::timestamptz
        ) AS result`,
        args,
      );

    const first = await user(A, (tx) => callRollover(tx, rolloverArgs("m10-op-1", hex("9"))));
    assert(first[0].result.replayed === false, "first rollover is not a replay");
    const successorId = first[0].result.rollover.successor_period_id;
    assert(successorId && successorId !== sourceId, "one successor was created");

    const periods = await sql.unsafe(
      "SELECT id, lifecycle, start_date, end_date, active_date, initialization, opening_movement_id, successor_period_id, version FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date",
      [A],
    );
    assert(periods.length === 2, "exactly two periods exist after rollover");
    const source = periods.find((row) => row.id === sourceId);
    const successor = periods.find((row) => row.id === successorId);
    assert(source.lifecycle === "rolled_over", "source lifecycle is rolled_over");
    assert(source.successor_period_id === successorId, "source links exactly one successor");
    assert(
      successor.lifecycle === "tracking" &&
        successor.start_date === "2026-12-01" &&
        successor.end_date === "2026-12-19" &&
        successor.active_date === "2026-12-01" &&
        successor.initialization === "initialized",
      "successor is the single tracking period with the chosen dates",
    );
    console.log("[ROLLOVER] one successor period and source link committed atomically");

    const copiedPolicy = await sql.unsafe(
      "SELECT policy FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2 ORDER BY version DESC LIMIT 1",
      [A, successorId],
    );
    const successorSettings = await sql.unsafe(
      "SELECT settings FROM public.money_periods WHERE owner_user_id=$1 AND id=$2",
      [A, successorId],
    );
    assert(
      copiedPolicy[0].policy.settings.savingsTargetMinor === 12000 &&
        copiedPolicy[0].policy.settings.emergencyTargetMinor === 3000 &&
        successorSettings[0].settings.savingsTargetMinor === 12000,
      "the successor copies the source's effective policy, not its empty period copy",
    );
    console.log("[POLICY] successor policy is copied from the effective source policy version");

    const openingRows = await sql.unsafe(
      "SELECT amount_minor, kind, direction, period_id, booking_date, counts_in_daily FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [A, successorId],
    );
    assert(
      openingRows.length === 1 &&
        openingRows[0].amount_minor === 70800 &&
        openingRows[0].direction === "in" &&
        openingRows[0].booking_date === "2026-12-01" &&
        openingRows[0].counts_in_daily === false,
      "exactly one carry-forward opening movement exists and is not daily spending",
    );
    const carriedOpening = await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.personal_expenses WHERE owner_user_id=$1 AND kind='income' AND period_id=$2",
      [A, successorId],
    );
    assert(carriedOpening[0].n === 0, "carry-forward cash is not duplicated as income");
    console.log("[OPENING] carried cash is one opening movement, never duplicated income");

    const successorObligations = await sql.unsafe(
      "SELECT state, template_id, due_date, period_start, amount_minor FROM public.money_obligations WHERE owner_user_id=$1 AND period_start >= '2026-12-01' ORDER BY template_id NULLS LAST",
      [A],
    );
    assert(successorObligations.length === 2, "one generated and one carried occurrence exist");
    assert(
      successorObligations.some(
        (row) => row.template_id === templateId && row.state === "pending" && row.due_date === "2026-12-05",
      ),
      "the template regenerated a pending occurrence with a new period identity",
    );
    assert(
      successorObligations.some(
        (row) => row.template_id === null && row.state === "pending" && row.amount_minor === 4000,
      ),
      "the one-off unpaid occurrence was carried as a new pending row",
    );
    const sourceOneOff = await sql.unsafe(
      "SELECT state, state_reason FROM public.money_obligations WHERE id=$1",
      [oneOffId],
    );
    assert(
      sourceOneOff[0].state === "cancelled" && sourceOneOff[0].state_reason === "still owed",
      "the carried source occurrence is cancelled with retained reason, not deleted",
    );
    console.log("[OBLIGATIONS] template occurrence regenerated; unpaid one-off carried once with reason history");

    const replay = await user(A, (tx) => callRollover(tx, rolloverArgs("m10-op-1", hex("9"))));
    assert(replay[0].result.replayed === true && replay[0].result.rollover.successor_period_id === successorId, "retry replays the original successor");
    const periodCount = await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.money_periods WHERE owner_user_id=$1",
      [A],
    );
    assert(periodCount[0].n === 2, "a retry never creates a second period");
    console.log("[REPLAY] identical operation replays without a duplicate period or opening");

    let changedReplayDenied = false;
    try {
      await user(A, (tx) => callRollover(tx, rolloverArgs("m10-op-1", hex("8"))));
    } catch (error) {
      changedReplayDenied = error.code === "23505";
    }
    assert(changedReplayDenied, "a reused operation id with a different request conflicts");

    let crossOwnerDenied = false;
    try {
      await user(B, (tx) => callRollover(tx, rolloverArgs("m10-op-owner", hex("7"))));
    } catch (error) {
      crossOwnerDenied = error.code === "P0002";
    }
    assert(crossOwnerDenied, "another owner cannot roll over the source period");
    console.log("[OWNER] operation ids and rollover writes stay owner-scoped");

    // --- Bridge: pre-cutoff correction into the derived successor -----------
    // A generic ledger update is the correction path under test: the trigger
    // must post the bridge without any separate application-side RPC call.
    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor=2100, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [expenseId, A],
      ),
    );
    const bridgeRows = await sql.unsafe(
      "SELECT amount_minor, direction, applied, correction_version FROM public.money_period_rollover_bridges WHERE owner_user_id=$1",
      [A],
    );
    assert(
      bridgeRows.length === 1 &&
        bridgeRows[0].amount_minor === 1000 &&
        bridgeRows[0].direction === "out" &&
        bridgeRows[0].applied === true &&
        bridgeRows[0].correction_version === 2,
      "the canonical update trigger posted one incremental bridge",
    );
    const adjustment = await sql.unsafe(
      "SELECT amount_minor, direction, kind, counts_in_daily, period_id, booking_date FROM public.personal_expenses WHERE owner_user_id=$1 AND kind='reconciliation_adjustment'",
      [A],
    );
    assert(
      adjustment.length === 1 &&
        adjustment[0].amount_minor === 1000 &&
        adjustment[0].direction === "out" &&
        adjustment[0].counts_in_daily === false &&
        adjustment[0].period_id === successorId &&
        adjustment[0].booking_date === "2026-12-01",
      "the bridge is a non-daily reconciliation adjustment in the successor",
    );

    const successorCash = await sql.unsafe(
      `SELECT (opening.amount_minor
        + COALESCE((SELECT sum(CASE WHEN m.direction='in' THEN m.amount_minor ELSE -m.amount_minor END)
            FROM public.personal_expenses m
            WHERE m.owner_user_id=$1 AND m.period_id=$2 AND m.deleted_at IS NULL AND m.kind <> 'opening'),0))::int AS cash
       FROM public.personal_expenses opening
       WHERE opening.owner_user_id=$1 AND opening.period_id=$2 AND opening.kind='opening'`,
      [A, successorId],
    );
    const sourceRestated = await sql.unsafe(
      `SELECT (opening.amount_minor
        + COALESCE((SELECT sum(CASE WHEN m.direction='in' THEN m.amount_minor ELSE -m.amount_minor END)
            FROM public.personal_expenses m
            WHERE m.owner_user_id=$1 AND m.period_id=$2 AND m.deleted_at IS NULL AND m.kind <> 'opening'),0))::int AS cash
       FROM public.personal_expenses opening
       WHERE opening.owner_user_id=$1 AND opening.period_id=$2 AND opening.kind='opening'`,
      [A, sourceId],
    );
    assert(
      successorCash[0].cash === sourceRestated[0].cash && successorCash[0].cash === 69800,
      "successor cash reconciles to the restated source closing cash",
    );
    console.log("[BRIDGE] pre-cutoff correction restates successor cash through one labeled adjustment");

    const bridgeReplay = await sql.begin(async (tx) => {
      await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [A]);
      await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: A, role: "authenticated" }),
      ]);
      return tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::uuid,$3::integer,$4::integer,$5::integer,$6::date,$7::timestamptz) AS result",
        [
          sourceId,
          expenseId,
          -1100,
          -2100,
          2,
          "2026-11-29",
          "2026-12-02T09:00:00.000Z",
        ],
      );
    });
    assert(bridgeReplay[0].result.replayed === 1 && bridgeReplay[0].result.postings === 0, "bridge retry is idempotent");
    const adjustmentCount = await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.personal_expenses WHERE owner_user_id=$1 AND kind='reconciliation_adjustment'",
      [A],
    );
    assert(adjustmentCount[0].n === 1, "a retry never duplicates the bridge adjustment");
    console.log("[BRIDGE] retry applies no second adjustment");

    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor=2600, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [expenseId, A],
      ),
    );
    const secondBridgeRows = await sql.unsafe(
      "SELECT amount_minor FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 ORDER BY correction_version",
      [A],
    );
    assert(
      secondBridgeRows.length === 2 && secondBridgeRows[1].amount_minor === 500,
      "a later correction posts only the incremental delta",
    );
    const adjustments = await sql.unsafe(
      "SELECT amount_minor FROM public.personal_expenses WHERE owner_user_id=$1 AND kind='reconciliation_adjustment' ORDER BY created_at, amount_minor",
      [A],
    );
    assert(
      adjustments.length === 2 && adjustments.reduce((sum, row) => sum + row.amount_minor, 0) === 1500,
      "the second correction adds only 500 centimes",
    );
    console.log("[BRIDGE] repeated edits apply only the incremental delta");

    // --- Verified opening stops propagation ---------------------------------
    // Finish the middle period through real closes too, so the second rollover
    // exercises the same retained-close gate. One middle-period expense is
    // corrected after its close to prove a restated snapshot needs acceptance.
    const successorExpense = await sql.unsafe(
      `INSERT INTO public.personal_expenses
        (owner_user_id,amount_minor,currency,note,idempotency_key,create_fingerprint,kind,direction,
         booking_date,counts_in_daily,period_id,category,need_vs_want,purpose)
       VALUES ($1,1000,'MAD','middle expense','m10-middle-expense',repeat('9',64),'expense','out',
         '2026-12-10',true,$2,'groceries','need','flexible')
       RETURNING id`,
      [A, successorId],
    );
    const successorExpenseId = successorExpense[0].id;
    // Use the real MONEY-08 setup path, not a seeded baseline. The successor
    // policy was copied from the source's effective policy, so the explicit
    // rebase must produce an available day-start baseline.
    await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_rebase_day_start_baseline($1::uuid)",
        [successorId],
      ),
    );
    const successorBaseline = await sql.unsafe(
      "SELECT availability, savings_target_minor, emergency_target_minor FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 ORDER BY version DESC LIMIT 1",
      [A, successorId],
    );
    assert(
      successorBaseline[0].availability === "available" &&
        successorBaseline[0].savings_target_minor === 12000 &&
        successorBaseline[0].emergency_target_minor === 3000,
      "explicit successor setup produces an available baseline from the copied policy",
    );
    console.log("[POLICY] successor explicit setup yields an available day-start baseline");
    const successorDays = [];
    for (
      let cursor = new Date("2026-12-01T00:00:00Z");
      cursor <= new Date("2026-12-19T00:00:00Z");
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    ) {
      successorDays.push(cursor.toISOString().slice(0, 10));
    }
    for (const [index, date] of successorDays.entries()) {
      const current = await sql.unsafe(
        "SELECT version FROM public.money_periods WHERE id=$1",
        [successorId],
      );
      await user(A, (tx) =>
        tx.unsafe(
          `SELECT public.money_close_day($1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz)`,
          [
            successorId,
            current[0].version,
            date,
            "CLOSED",
            `750e8400-e29b-41d4-a716-4466554401${String(index).padStart(2, "0")}`,
            hex("5"),
            [],
            "2026-12-19T20:00:00.000Z",
          ],
        ),
      );
    }
    const successorEnded = await sql.unsafe(
      "SELECT lifecycle, active_date, version FROM public.money_periods WHERE id=$1",
      [successorId],
    );
    assert(
      successorEnded[0].lifecycle === "ended" &&
        successorEnded[0].active_date === "2026-12-19",
      "middle period ended through its final close",
    );
    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses
         SET amount_minor=1500, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [successorExpenseId, A],
      ),
    );
    const restatedSummary = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
        [successorId],
      ),
    );
    assert(
      restatedSummary[0].summary.available === true &&
        restatedSummary[0].summary.restatedDifferenceCount > 0,
      "a post-close correction marks the retained close as restated",
    );
    console.log("[CLOSE] later correction is disclosed as a restated close snapshot");

    const verifiedArgs = rolloverArgs("m10-op-2", hex("6"), {
      expectedVersion: successorEnded[0].version,
      initialized: "reconciled",
      allowUncoveredDays: true,
      openingMode: "verified_source",
      openingAmountMinor: 67800,
      unpaidTreatment: "keep_pending",
      unpaidReason: null,
      occurrences: [
        {
          values: {
            kind: "subscription",
            description: "Internet",
            amountMinor: 3000,
            periodStart: "2027-01-01",
            periodEnd: "2027-01-31",
            dueDate: "2027-01-05",
            needVsWant: "need",
            purpose: "fixed",
            countsInDaily: false,
            category: "subscriptions",
            stateEffectiveDate: "2027-01-01",
            templateId,
            idempotencyKey: `obligation-template:${templateId}:2027-01-01`,
          },
          createFingerprint: hex("4"),
        },
      ],
      carried: [],
    });
    // Source ID must be the successor for the second rollover.
    verifiedArgs[0] = successorId;
    verifiedArgs[2] = "2027-01-01";
    verifiedArgs[3] = "2027-01-31";
    verifiedArgs[4] = "2027-01-01";
    verifiedArgs[8] = 67800;
    verifiedArgs[9] = "2026-12-19";
    verifiedArgs[10] = "verified statement";
    verifiedArgs[11] = "Verified opening";
    verifiedArgs[13] = {
      opening: {
        source: "verified_source",
        recordedAt: "2027-01-01T09:00:00.000Z",
        cutoffDate: "2026-12-19",
        evidence: "verified statement",
        note: "Verified opening",
        corrections: [],
      },
      createdFrom: "web",
    };
    let restatedRolloverDenied = false;
    try {
      await user(A, (tx) => callRollover(tx, verifiedArgs));
    } catch (error) {
      restatedRolloverDenied = error.code === "23514";
    }
    assert(
      restatedRolloverDenied,
      "a restated close cannot roll over without an acceptance note",
    );
    verifiedArgs[20] = "restated close reviewed and accepted";
    const verified = await user(A, (tx) => callRollover(tx, verifiedArgs));
    const verifiedPeriodId = verified[0].result.rollover.successor_period_id;
    assert(verifiedPeriodId, "a second, independently verified successor was created");
    const verifiedOpening = await sql.unsafe(
      "SELECT amount_minor FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [A, verifiedPeriodId],
    );
    assert(verifiedOpening[0].amount_minor === 67800, "verified opening retains its verified amount");
    console.log("[VERIFIED] partial source rolled into a full successor month with a verified opening");

    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor=3100, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [expenseId, A],
      ),
    );
    const chainRows = await sql.unsafe(
      "SELECT destination_period_id, applied, variance_reason, amount_minor FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 AND correction_version=4 ORDER BY applied DESC",
      [A],
    );
    assert(
      chainRows.length === 2 &&
        chainRows.some(
          (row) =>
            row.destination_period_id === successorId &&
            row.applied === true &&
            row.amount_minor === 500,
        ) &&
        chainRows.some(
          (row) =>
            row.destination_period_id === verifiedPeriodId &&
            row.applied === false &&
            row.amount_minor === 500,
        ),
      "the bridge posts to the derived period and stops at the verified opening with a variance",
    );
    const verifiedOpeningAfter = await sql.unsafe(
      "SELECT amount_minor FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [A, verifiedPeriodId],
    );
    assert(verifiedOpeningAfter[0].amount_minor === 67800, "a verified opening snapshot is never altered");
    const varianceRows = await sql.unsafe(
      "SELECT destination_period_id, applied, variance_reason, amount_minor FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 AND variance_reason IS NOT NULL",
      [A],
    );
    assert(
      varianceRows.length === 1 &&
        varianceRows[0].destination_period_id === verifiedPeriodId &&
        varianceRows[0].applied === false &&
        varianceRows[0].amount_minor === 500,
      "the historical variance is disclosed without an adjustment row",
    );
    console.log("[VERIFIED] variance is disclosed, never written into the verified snapshot");

    const verifiedReplay = await sql.begin(async (tx) => {
      await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [A]);
      await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: A, role: "authenticated" }),
      ]);
      return tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::uuid,$3::integer,$4::integer,$5::integer,$6::date,$7::timestamptz) AS result",
        [
          sourceId,
          expenseId,
          -2600,
          -3100,
          4,
          "2026-11-29",
          "2027-01-02T09:00:00.000Z",
        ],
      );
    });
    assert(
      verifiedReplay[0].result.replayed === 2 &&
        verifiedReplay[0].result.postings === 0 &&
        verifiedReplay[0].result.variances === 0,
      "a replay of a correction already disclosed at a verified opening stops there",
    );
    const verifiedAdjustments = await sql.unsafe(
      "SELECT count(*)::int AS n FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='reconciliation_adjustment'",
      [A, verifiedPeriodId],
    );
    assert(
      verifiedAdjustments[0].n === 0,
      "a verified opening never receives a bridge adjustment",
    );
    console.log("[VERIFIED] a correction replay stops at the verified opening instead of passing it");

    // --- Bridge identity is movement-scoped ---------------------------------
    // A second source movement corrected to the same version number must get a
    // distinct bridge identity; otherwise one correction would mask the other.
    const secondSourceExpense = await sql.unsafe(
      `INSERT INTO public.personal_expenses
        (owner_user_id,amount_minor,currency,note,idempotency_key,create_fingerprint,kind,direction,
         booking_date,counts_in_daily,period_id,category,need_vs_want,purpose)
       VALUES ($1,300,'MAD','second correction','m10-second-correction',repeat('8',64),
         'expense','out','2026-11-29',true,$2,'groceries','need','flexible')
       RETURNING id`,
      [A, sourceId],
    );
    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses
         SET amount_minor=500, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [secondSourceExpense[0].id, A],
      ),
    );
    const versionTwoBridges = await sql.unsafe(
      "SELECT identity, movement_id FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 AND correction_version=2",
      [A],
    );
    assert(
      versionTwoBridges.length >= 2 &&
        new Set(versionTwoBridges.map((row) => row.identity)).size ===
          versionTwoBridges.length &&
        new Set(versionTwoBridges.map((row) => row.movement_id)).size >= 2,
      "two movements corrected at version 2 keep distinct bridge identities",
    );
    console.log("[BRIDGE] identity is movement-scoped, so concurrent corrections never collide");

    // --- Legacy/backdated inserts and cross-window moves --------------------
    // A direct-user insert with no period id but a booking date inside the
    // rolled-over source must bridge, and moving it into the former successor
    // window must bridge both source chains.
    const legacyMovement = await user(A, (tx) =>
      tx.unsafe(
        `INSERT INTO public.personal_expenses
          (owner_user_id,amount_minor,currency,note,idempotency_key,create_fingerprint,kind,direction,
           booking_date,counts_in_daily,period_id,category,need_vs_want,purpose)
         VALUES ($1,700,'MAD','legacy backdated','m10-legacy-backdated',repeat('7',64),'expense','out',
           '2026-11-30',true,NULL,'groceries','need','flexible')
         RETURNING id`,
        [A],
      ),
    );
    const legacyId = legacyMovement[0].id;
    const legacyBridges = await sql.unsafe(
      "SELECT source_period_id, correction_version, amount_minor, applied FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 AND movement_id=$2",
      [A, legacyId],
    );
    assert(
      legacyBridges.some(
        (row) =>
          row.source_period_id === sourceId &&
          row.amount_minor === 700 &&
          row.applied === true,
      ),
      "a legacy null-period insert backdated into a rolled-over source is bridged",
    );

    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses
         SET booking_date='2026-12-05', version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [legacyId, A],
      ),
    );
    const movedBridges = await sql.unsafe(
      "SELECT DISTINCT source_period_id FROM public.money_period_rollover_bridges WHERE owner_user_id=$1 AND movement_id=$2 AND correction_version=2",
      [A, legacyId],
    );
    assert(
      movedBridges.some((row) => row.source_period_id === sourceId) &&
        movedBridges.some((row) => row.source_period_id === successorId),
      "moving a movement between rolled-over windows bridges both sources",
    );
    console.log("[BRIDGE] backdated inserts and cross-window moves resolve sources by booking date");

    // --- MCP read grant cannot write through the SECURITY DEFINER RPCs -----
    await sql.unsafe(
      `INSERT INTO public.mcp_authorization_grants
        (owner_user_id, oauth_client_id, resource_uri, client_name, status,
         permission_profile, permissions, permissions_version, approved_at)
       VALUES ($1, 'm10-reader', $2, 'Proof reader', 'active',
         'personal_operations', '["today.read","timer.read","personal_ops.read"]'::jsonb, 1, now())`,
      [A, RESOURCE],
    );
    let readerRolloverDenied = false;
    try {
      await user(
        A,
        (tx) => callRollover(tx, rolloverArgs("m10-op-reader-denied", hex("a"))),
        "m10-reader",
      );
    } catch (error) {
      readerRolloverDenied = error.code === "42501";
    }
    assert(
      readerRolloverDenied,
      "a read-only MCP grant cannot call the rollover write RPC",
    );
    let readerBridgeDenied = false;
    try {
      await user(
        A,
        (tx) =>
          tx.unsafe(
            "SELECT public.money_apply_rollover_bridge($1::uuid,$2::uuid,0,-1,1,'2026-11-29'::date,now())",
            [sourceId, expenseId],
          ),
        "m10-reader",
      );
    } catch (error) {
      readerBridgeDenied = error.code === "42501";
    }
    assert(
      readerBridgeDenied,
      "the correction bridge is not an authenticated direct-write surface",
    );
    console.log("[SECURITY] read grants never imply write; bridge RPC is not client-callable");

    // --- A final day without every earlier close cannot roll over ----------
    const incompleteCreated = await user(B, (tx) =>
      tx.unsafe(`SELECT (p).id AS id, (p).version AS version
        FROM (SELECT public.money_create_period(
          '2027-02-01'::date,'2027-02-02'::date,'Africa/Casablanca'::text,
          '2027-02-02'::date,'initialized'::text,5000::integer,'2027-02-01'::date,
          repeat('d',64)::text,'{"opening":{"source":"user_entered","recordedAt":"2027-02-01T00:00:00.000Z","cutoffDate":"2027-02-01","evidence":null,"note":null,"corrections":[]}}'::jsonb,
          '{"savingsTargetMinor":1000,"emergencyTargetMinor":100}'::jsonb,
          now()::timestamptz) AS p) created`),
    );
    const incompleteId = incompleteCreated[0].id;
    const incompletePolicy = await sql.unsafe(
      "SELECT id FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2 ORDER BY version DESC LIMIT 1",
      [B, incompleteId],
    );
    await sql.unsafe(
      `UPDATE public.money_day_start_baselines
       SET policy_version_id=$1, availability='available', unavailable_reason=NULL,
           cash_minor=5000, commitments_minor=0, savings_target_minor=1000,
           savings_funded_minor=0, emergency_target_minor=100, emergency_used_minor=0,
           inputs='{"setupComplete":true}'::jsonb
       WHERE owner_user_id=$2 AND period_id=$3 AND date='2027-02-02'`,
      [incompletePolicy[0].id, B, incompleteId],
    );
    await sql.unsafe(
      `UPDATE public.money_periods
       SET day_start_setup_completed=true, version=version+1, updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [incompleteId, B],
    );
    const incompleteVersion = await sql.unsafe(
      "SELECT version FROM public.money_periods WHERE id=$1",
      [incompleteId],
    );
    await user(B, (tx) =>
      tx.unsafe(
        `SELECT public.money_close_day($1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz)`,
        [
          incompleteId,
          incompleteVersion[0].version,
          "2027-02-02",
          "CLOSED",
          "750e8400-e29b-41d4-a716-4466554402aa",
          hex("c"),
          [],
          "2027-02-02T20:00:00.000Z",
        ],
      ),
    );
    let incompleteDenied = false;
    let incompleteMessage = "";
    try {
      await user(B, (tx) =>
        callRollover(tx, [
          incompleteId,
          incompleteVersion[0].version + 1,
          "2027-02-03",
          "2027-02-10",
          "2027-02-03",
          "Africa/Casablanca",
          "initialized",
          false,
          5000,
          "2027-02-02",
          null,
          "Carried forward",
          hex("d"),
          {
            opening: {
              source: "carry_forward",
              recordedAt: "2027-02-03T09:00:00.000Z",
              cutoffDate: "2027-02-02",
              evidence: null,
              note: "Carried forward",
              corrections: [],
            },
            createdFrom: "web",
          },
          {},
          "m10-op-incomplete",
          hex("e"),
          "carry_forward",
          null,
          null,
          null,
          {},
          [],
          [],
          "2027-02-03T09:00:00.000Z",
        ]),
      );
    } catch (error) {
      incompleteDenied = error.code === "23514";
      incompleteMessage = error.message ?? "";
    }
    assert(
      incompleteDenied && /Every source day/.test(incompleteMessage),
      "a source with an unclosed earlier day cannot roll over",
    );
    console.log("[CLOSE] every tracked source day must have retained close evidence");

    // --- Past-dated setup is allowed by the current MONEY-08 rebase ---------
    // A late rollover leaves the successor active date in the past. The current
    // rebase definition (0102) has no CURRENT_DATE restriction, so explicit
    // setup must still become available instead of forcing a date move.
    const lateCreated = await user(C, (tx) =>
      tx.unsafe(`SELECT (p).id AS id
        FROM (SELECT public.money_create_period(
          '2026-10-01'::date,'2026-10-02'::date,'Africa/Casablanca'::text,
          '2026-10-02'::date,'initialized'::text,1000::integer,'2026-10-01'::date,
          repeat('6',64)::text,'{"opening":{"source":"user_entered","recordedAt":"2026-10-01T00:00:00.000Z","cutoffDate":"2026-10-01","evidence":null,"note":null,"corrections":[]}}'::jsonb,
          '{"savingsTargetMinor":500,"emergencyTargetMinor":50}'::jsonb,
          now()::timestamptz) AS p) created`),
    );
    await user(C, (tx) =>
      tx.unsafe("SELECT public.money_rebase_day_start_baseline($1::uuid)", [
        lateCreated[0].id,
      ]),
    );
    const lateBaseline = await sql.unsafe(
      "SELECT availability FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 ORDER BY version DESC LIMIT 1",
      [C, lateCreated[0].id],
    );
    assert(
      lateBaseline[0].availability === "available",
      "a past active date can complete explicit setup",
    );
    console.log("[SETUP] past-dated successor setup is not restricted to today");

    // --- Owner isolation and no direct write surface ------------------------
    const bVisible = await user(B, (tx) =>
      tx.unsafe("SELECT count(*)::int AS n FROM public.money_period_rollovers"),
    );
    const aVisible = await user(A, (tx) =>
      tx.unsafe("SELECT count(*)::int AS n FROM public.money_period_rollovers"),
    );
    assert(bVisible[0].n === 0 && aVisible[0].n === 2, "RLS exposes only the owner's rollover receipts");
    let directInsertDenied = false;
    try {
      await user(A, (tx) =>
        tx.unsafe(
          "INSERT INTO public.money_period_rollovers(owner_user_id,source_period_id,successor_period_id,operation_id,request_fingerprint,opening_mode,opening_amount_minor,closing_cutoff_date) VALUES($1,$2,$3,'direct',repeat('a',64),'carry_forward',1,'2026-11-30')",
          [A, sourceId, verifiedPeriodId],
        ),
      );
    } catch (error) {
      directInsertDenied = error.code === "42501";
    }
    assert(directInsertDenied, "clients cannot insert rollover receipts directly");
    console.log("[RLS] rollover receipts are owner-readable and not client-writable");

    console.log(`[DONE] MONEY-10 rollover proof through ${tags.at(-1)} passed`);
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  exit(1);
});
