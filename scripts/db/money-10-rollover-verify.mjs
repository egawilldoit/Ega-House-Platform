#!/usr/bin/env node
/**
 * Disposable PostgreSQL proof for MONEY-10 (explicit period rollover).
 *
 * It applies the whole migration journal, simulates the MONEY-09 precondition
 * (`ended` with every tracked day closed) by setting the lifecycle directly,
 * then exercises the atomic rollover, replay, unpaid-item treatment, the
 * derived-period correction bridge and the verified-opening stop condition.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const RESOURCE = "https://ega.example.com/api/mcp";
const READ = ["today.read", "timer.read", "personal_ops.read"];
const WRITE = [...READ, "personal_ops.write"];

const tags = JSON.parse(
  await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
).entries.map((entry) => entry.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");
const sql = postgres(url, { max: 2, onnotice: () => {} });

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
          '2026-11-12'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
          '2026-11-12'::date,'initialized'::text,68900::integer,'2026-11-12'::date,
          repeat('a',64)::text,'{"opening":{"source":"user_entered","recordedAt":"2026-11-12T00:00:00.000Z","cutoffDate":"2026-11-12","evidence":null,"note":null,"corrections":[]}}'::jsonb,
          '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
          now()::timestamptz) AS p) created`),
    );
    const sourceId = created[0].id;

    const movements = await user(A, async (tx) => {
      const rows = await tx.unsafe(`INSERT INTO public.personal_expenses
        (owner_user_id,amount_minor,currency,note,idempotency_key,create_fingerprint,kind,direction,
         booking_date,counts_in_daily,period_id,category,need_vs_want,purpose)
        VALUES
          ($1,5000,'MAD','salary','m10-income',repeat('b',64),'income','in','2026-11-15',false,$2,NULL,NULL,NULL),
          ($1,1100,'MAD','groceries','m10-expense',repeat('c',64),'expense','out','2026-11-20',true,$2,'groceries','need','flexible'),
          ($1,2000,'MAD','savings','m10-savings',repeat('d',64),'savings_transfer','out','2026-11-18',false,$2,NULL,NULL,NULL)
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
        VALUES ($1,'bill','Repair',4000,'MAD','2026-11-12','2026-11-30','2026-11-25',
         'need','fixed',false,'bills','pending','2026-11-12','[]'::jsonb,
         'm10-one-off',repeat('f',64))
        RETURNING id`, [A]);
    const oneOffId = oneOff[0].id;

    // MONEY-09 precondition. This proof does not fabricate close evidence: it
    // only reproduces the lifecycle state that the durable close produces.
    await user(A, (tx) =>
      tx.unsafe(`UPDATE public.money_periods
        SET lifecycle='ended', active_date=end_date, version=version+1, updated_at=now()
        WHERE id=$1 AND owner_user_id=$2`, [sourceId, A]),
    );
    const ended = await sql.unsafe(
      "SELECT lifecycle, active_date FROM public.money_periods WHERE id=$1",
      [sourceId],
    );
    assert(ended[0].lifecycle === "ended", "source is ended for the proof");

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
      overrides.expectedVersion ?? 3,
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
      { savingsTargetMinor: 12000, emergencyTargetMinor: 3000 },
      operationId,
      fingerprint,
      overrides.openingMode ?? "carry_forward",
      overrides.unpaidTreatment ?? "carry_forward",
      overrides.unpaidReason ?? "still owed",
      null,
      { modeledClosingCashMinor: 70800, pendingOccurrenceCount: 1 },
      JSON.stringify(overrides.occurrences ?? occurrences),
      JSON.stringify(overrides.carried ?? carried),
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
    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor=2100, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [expenseId, A],
      ),
    );
    const bridge1 = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::integer,$3::integer,$4::integer,$5::date,$6::timestamptz) AS result",
        [expenseId, -1100, -2100, 2, "2026-11-20", "2026-12-02T09:00:00.000Z"],
      ),
    );
    assert(bridge1[0].result.postings === 1 && bridge1[0].result.variances === 0, "one bridge adjustment was posted");
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

    const bridgeReplay = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::integer,$3::integer,$4::integer,$5::date,$6::timestamptz) AS result",
        [expenseId, -1100, -2100, 2, "2026-11-20", "2026-12-02T09:00:00.000Z"],
      ),
    );
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
    const bridge2 = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::integer,$3::integer,$4::integer,$5::date,$6::timestamptz) AS result",
        [expenseId, -2100, -2600, 3, "2026-11-20", "2026-12-03T09:00:00.000Z"],
      ),
    );
    assert(bridge2[0].result.postings === 1, "a later correction posts only the incremental delta");
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
    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.money_periods SET lifecycle='ended', active_date=end_date, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [successorId, A],
      ),
    );
    const verifiedArgs = rolloverArgs("m10-op-2", hex("6"), {
      expectedVersion: successor.version + 1,
      initialized: "reconciled",
      allowUncoveredDays: true,
      openingMode: "verified_source",
      openingAmountMinor: 69300,
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
    verifiedArgs[8] = 69300;
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
    const verified = await user(A, (tx) => callRollover(tx, verifiedArgs));
    const verifiedPeriodId = verified[0].result.rollover.successor_period_id;
    assert(verifiedPeriodId, "a second, independently verified successor was created");
    const verifiedOpening = await sql.unsafe(
      "SELECT amount_minor FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [A, verifiedPeriodId],
    );
    assert(verifiedOpening[0].amount_minor === 69300, "verified opening retains its verified amount");
    console.log("[VERIFIED] partial source rolled into a full successor month with a verified opening");

    await user(A, (tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor=3100, version=version+1, updated_at=now()
         WHERE id=$1 AND owner_user_id=$2`,
        [expenseId, A],
      ),
    );
    const bridge3 = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_apply_rollover_bridge($1::uuid,$2::integer,$3::integer,$4::integer,$5::date,$6::timestamptz) AS result",
        [expenseId, -2600, -3100, 4, "2026-11-20", "2027-01-02T09:00:00.000Z"],
      ),
    );
    assert(
      bridge3[0].result.postings === 1 && bridge3[0].result.variances === 1,
      "the bridge stops at the verified opening and discloses the variance",
    );
    const verifiedOpeningAfter = await sql.unsafe(
      "SELECT amount_minor FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening'",
      [A, verifiedPeriodId],
    );
    assert(verifiedOpeningAfter[0].amount_minor === 69300, "a verified opening snapshot is never altered");
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

    console.log("[DONE] MONEY-10 rollover proof through migration 0110 passed");
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  exit(1);
});
