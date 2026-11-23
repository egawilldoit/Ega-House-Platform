#!/usr/bin/env node
/**
 * Disposable PostgreSQL proof for MONEY-001-A: optional day close and reviewed
 * finalization with unverified days.
 *
 * Scenario:
 *   - Nov 1–30 tracking period with a known opening and complete baseline.
 *   - Close Nov 20 through the real `money_close_day` path.
 *   - Leave Nov 21 and 22 unclosed; move the active date to Nov 23 through the
 *     real settings RPC (`money_update_period`).
 *   - Record and read a Nov 23 expense. Exactly one close row exists, the Nov 20
 *     snapshot is unchanged and no close was fabricated for 21/22/23.
 *   - Preview/roll over from the still-tracking source: missing acknowledgment is
 *     refused, a stale count conflicts, and the acknowledged rollover creates
 *     exactly one successor opening/link while retaining the review evidence.
 *   - A rewind to a closed date is refused; owner B sees none of owner A's data.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const RESOURCE = "https://ega.example.com/api/mcp";
const READ = ["today.read", "timer.read", "personal_ops.read"];
const WRITE = [...READ, "personal_ops.write"];

const tags = JSON.parse(
  await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
).entries.map((entry) => entry.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");

// Keep DATE columns as ISO strings; this proof compares calendar dates.
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
    await tx.unsafe(
      "SELECT set_config('request.jwt.claims', $1, true)",
      [
        JSON.stringify({
          sub: owner,
          role: "authenticated",
          aud: clientId ? RESOURCE : "authenticated",
          ...(clientId ? { client_id: clientId } : {}),
        }),
      ],
    );
    return fn(tx);
  });
}

const close = (tx, periodId, version, date, operationId, fingerprint, note = "CLOSED proof") =>
  tx.unsafe(
    `SELECT public.money_close_day(
      $1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz
    ) AS result`,
    [periodId, version, date, note, operationId, fingerprint, [], "2026-11-20T20:00:00.000Z"],
  );

const updateActiveDate = (tx, periodId, version, date) =>
  tx.unsafe(
    `SELECT * FROM public.money_update_period(
      $1,$2,$3::date,NULL::jsonb,NULL::integer,NULL::text,NULL::text,
      NULL::jsonb,NULL::text,'2026-11-23T09:00:00.000Z'::timestamptz
    )`,
    [periodId, version, date],
  );

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
      "INSERT INTO auth.users VALUES ($1, 'a@example.test'), ($2, 'b@example.test')",
      [A, B],
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
      for (const stmt of text
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean)) {
        await sql.unsafe(stmt);
      }
    }
    console.log(`[MIGRATE] ${tags.length} migrations through ${tags.at(-1)}`);

    // The new reviewed-finalization signature is additive: the previous
    // 25-argument RPC remains as a compatibility overload for fully closed
    // sources, and cannot carry a fake unverified-day acknowledgment.
    const rolloverOverloads = await sql.unsafe(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args
       FROM pg_proc AS p
       JOIN pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'money_rollover_period'
       ORDER BY array_length(p.proargtypes, 1)`,
    );
    assert(
      rolloverOverloads.length === 2 &&
        rolloverOverloads[0].args.includes("p_unverified_days_note") === false &&
        rolloverOverloads[1].args.includes("p_unverified_days_note") === true,
      "the rollover RPC keeps a backward-compatible overload",
    );

    for (const [clientId, profile, permissions] of [
      ["money-read", "personal_operations", READ],
      ["money-write", "personal_operations_writer", WRITE],
    ]) {
      await sql`INSERT INTO public.mcp_authorization_grants
        (owner_user_id,oauth_client_id,resource_uri,client_name,status,permission_profile,permissions,permissions_version,approved_at)
        VALUES (${A}::uuid,${clientId},${RESOURCE},'proof','active',${profile},${sql.json(permissions)},1,now())`;
    }

    // --- One known period, complete baseline, explicit Nov 20 close ----------
    const created = await user(A, (tx) =>
      tx.unsafe(`SELECT (p).id AS id, (p).version AS version
        FROM (SELECT public.money_create_period(
          '2026-11-01'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
          '2026-11-20'::date,'initialized'::text,100000::integer,'2026-11-01'::date,
          repeat('a',64)::text,
          '{"opening":{"source":"user_entered","recordedAt":"2026-11-01T00:00:00.000Z","cutoffDate":"2026-11-01","evidence":null,"note":null,"corrections":[]}}'::jsonb,
          '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
          '2026-11-20T08:00:00.000Z'::timestamptz) AS p) created`),
    );
    const periodId = created[0].id;
    await user(A, (tx) =>
      tx.unsafe("SELECT public.money_rebase_day_start_baseline($1::uuid)", [periodId]),
    );
    const baseline = await sql.unsafe(
      `SELECT availability FROM public.money_day_start_baselines
       WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-20'
       ORDER BY version DESC LIMIT 1`,
      [A, periodId],
    );
    assert(
      baseline.length === 1 && baseline[0].availability === "available",
      "complete day-start baseline exists before the close",
    );

    const beforeClose = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [periodId])
    )[0];
    const closed = await user(A, (tx) =>
      close(
        tx,
        periodId,
        beforeClose.version,
        "2026-11-20",
        "a0000000-0000-4000-8000-000000000001",
        hex("b"),
      ),
    );
    assert(
      closed[0].result.status === "closed" &&
        closed[0].result.period.active_date === "2026-11-21",
      "closing Nov 20 retains evidence and advances exactly one day",
    );
    const closeSnapshotBefore = await sql.unsafe(
      `SELECT close_date, close_fingerprint, snapshot, period_version_after
       FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2 ORDER BY close_date`,
      [A, periodId],
    );
    assert(closeSnapshotBefore.length === 1, "exactly one close row was created");

    // A rewind to the closed day is refused before the later booking.
    const afterClose = (
      await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [periodId])
    )[0];
    let rewindDenied = false;
    try {
      await user(A, (tx) => updateActiveDate(tx, periodId, afterClose.version, "2026-11-20"));
    } catch (error) {
      rewindDenied = error.code === "23514";
    }
    assert(rewindDenied, "the active date never reopens a retained close");

    // --- Skip Nov 21/22 and record Nov 23 -----------------------------------
    const advanced = await user(A, (tx) =>
      updateActiveDate(tx, periodId, afterClose.version, "2026-11-23"),
    );
    assert(
      advanced.length === 1 && advanced[0].active_date === "2026-11-23",
      "the active date advances to Nov 23 without a close",
    );
    const closesAfterAdvance = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2",
      [A, periodId],
    );
    assert(closesAfterAdvance[0].n === 1, "calendar advancement creates no close row");

    const expense = await user(A, (tx) =>
      tx.unsafe(
        `INSERT INTO public.personal_expenses
         (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
          category,need_vs_want,purpose,counts_in_daily,idempotency_key,create_fingerprint)
         VALUES ($1,$2,'2026-11-23','expense','out',1250,'MAD',
          'coffee','want','flexible',true,'money-001-a-nov-23',repeat('c',64))
         RETURNING id`,
        [A, periodId],
      ),
    );
    const expenseRow = await user(A, (tx) =>
      tx.unsafe(
        `SELECT id, booking_date, amount_minor, kind, counts_in_daily
         FROM public.personal_expenses WHERE id=$1`,
        [expense[0].id],
      ),
    );
    assert(
      expenseRow.length === 1 &&
        expenseRow[0].booking_date === "2026-11-23" &&
        expenseRow[0].amount_minor === 1250,
      "the Nov 23 expense persists exactly once through the owner path",
    );
    const closeSnapshotAfter = await sql.unsafe(
      `SELECT close_date, close_fingerprint, snapshot, period_version_after
       FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2 ORDER BY close_date`,
      [A, periodId],
    );
    assert(
      closeSnapshotAfter.length === 1 &&
        JSON.stringify(closeSnapshotAfter[0]) === JSON.stringify(closeSnapshotBefore[0]),
      "the Nov 20 close evidence is unchanged after the later booking",
    );
    const fabricated = await sql.unsafe(
      `SELECT close_date FROM public.money_day_closes
       WHERE owner_user_id=$1 AND period_id=$2
         AND close_date IN ('2026-11-21','2026-11-22','2026-11-23')`,
      [A, periodId],
    );
    assert(fabricated.length === 0, "no close rows were fabricated for skipped dates");
    console.log("[CLOSE] optional close: Nov 23 booking works with Nov 21/22 unverified and no fake closes");

    // --- Local cash oracle matches the web-facing calculation ---------------
    const oracle = await sql.unsafe(
      `SELECT opening.amount_minor + COALESCE((
         SELECT sum(CASE WHEN movement.direction='in' THEN movement.amount_minor
                         ELSE -movement.amount_minor END)
         FROM public.personal_expenses AS movement
         WHERE movement.owner_user_id=period.owner_user_id
           AND movement.period_id=period.id
           AND movement.deleted_at IS NULL
           AND movement.kind <> 'opening'
           AND movement.booking_date <= '2026-11-23'
       ),0)::integer AS recorded_cash
       FROM public.money_periods AS period
       JOIN public.personal_expenses AS opening
         ON opening.id=period.opening_movement_id AND opening.owner_user_id=period.owner_user_id
       WHERE period.id=$1 AND period.owner_user_id=$2`,
      [periodId, A],
    );
    assert(
      oracle[0].recorded_cash === 98750,
      "independent ledger oracle records cash once through Nov 23",
    );

    // --- Finalization reviews every unverified date -------------------------
    const summary = await user(A, (tx) =>
      tx.unsafe(
        "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
        [periodId],
      ),
    );
    const assessment = summary[0].summary;
    assert(
      assessment.available === true &&
        assessment.closeCount === 1 &&
        assessment.periodDayCount === 30 &&
        assessment.requiredCloseCount === 30 &&
        assessment.unverifiedDayCount === 29 &&
        assessment.completeCloseEvidence === false &&
        assessment.trackedFromDate === "2026-11-20" &&
        JSON.stringify(assessment.closedDates) === JSON.stringify(["2026-11-20"]),
      "the preview exposes retained closes and the exact unverified count",
    );
    assert(
      assessment.missingCloseDates.length === 29 &&
        assessment.missingCloseDates[0] === "2026-11-01" &&
        assessment.missingCloseDates.includes("2026-11-21") &&
        assessment.missingCloseDates.includes("2026-11-22") &&
        assessment.missingCloseDates.includes("2026-11-30") &&
        !assessment.missingCloseDates.includes("2026-11-20"),
      "leading and skipped unverified dates are listed exactly",
    );
    console.log("[FINALIZE] exact closed dates and 29 unverified dates are visible before approval");

    const closeArgs = (operationId, note, count, acceptedNote = null) => [
      periodId,
      advanced[0].version,
      "2026-12-01",
      "2026-12-31",
      "2026-12-01",
      "Africa/Casablanca",
      "initialized",
      false,
      98750,
      "2026-11-30",
      null,
      "Carried forward from the reviewed source",
      hex("d"),
      {
        opening: {
          source: "carry_forward",
          recordedAt: "2026-12-01T09:00:00.000Z",
          cutoffDate: "2026-11-30",
          evidence: null,
          note: "Carried forward from the reviewed source",
          corrections: [],
        },
        createdFrom: "web",
      },
      {},
      operationId,
      hex("e"),
      "carry_forward",
      null,
      null,
      acceptedNote,
      note,
      count,
      { modeledClosingCashMinor: 98750, pendingOccurrenceCount: 0 },
      [],
      [],
      "2026-12-01T09:00:00.000Z",
    ];
    const callRollover = (tx, args) =>
      tx.unsafe(
        `SELECT public.money_rollover_period(
          $1::uuid,$2::integer,$3::date,$4::date,$5::date,$6::text,$7::text,$8::boolean,
          $9::integer,$10::date,$11::text,$12::text,$13::text,$14::jsonb,$15::jsonb,$16::text,
          $17::text,$18::text,$19::text,$20::text,$21::text,$22::text,$23::integer,$24::jsonb,
          $25::jsonb,$26::jsonb,$27::timestamptz
        ) AS result`,
        args,
      );

    let missingNoteDenied = false;
    let missingDetail = "";
    try {
      await user(A, (tx) => callRollover(tx, closeArgs("money-001-a-no-note", null, 0)));
    } catch (error) {
      missingNoteDenied = error.code === "23514" && /Unverified source days/.test(error.message);
      missingDetail = error.detail ?? "";
    }
    assert(
      missingNoteDenied && /2026-11-21/.test(missingDetail),
      "finalization rejects a missing acknowledgment and names the unverified dates",
    );
    let staleCountDenied = false;
    try {
      await user(A, (tx) =>
        callRollover(tx, closeArgs("money-001-a-stale-count", "Reviewed all unverified days", 12)),
      );
    } catch (error) {
      staleCountDenied = error.code === "40001";
    }
    assert(staleCountDenied, "a stale unverified-day count conflicts instead of being trusted");
    const noReceipt = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_period_rollovers WHERE owner_user_id=$1 AND source_period_id=$2",
      [A, periodId],
    );
    assert(noReceipt[0].n === 0, "refused finalizations leave no receipt");

    const first = await user(A, (tx) =>
      callRollover(
        tx,
        closeArgs(
          "money-001-a-ok",
          "Reviewed Nov 1–19 and 21–30 as unverified; no close rows invented",
          29,
          "Savings target versus transfers reviewed",
        ),
      ),
    );
    const record = first[0].result.rollover;
    assert(first[0].result.replayed === false, "the acknowledged finalization is not a replay");
    assert(
      record.unverified_days_count === 29 &&
        /Reviewed Nov 1/.test(record.unverified_days_note ?? ""),
      "the reviewed count and note are retained on the receipt",
    );
    const periods = await sql.unsafe(
      `SELECT id, lifecycle, start_date, end_date, active_date, opening_movement_id, successor_period_id
       FROM public.money_periods WHERE owner_user_id=$1 ORDER BY start_date`,
      [A],
    );
    assert(periods.length === 2, "exactly one successor period exists");
    const source = periods.find((row) => row.id === periodId);
    const successor = periods.find((row) => row.id === record.successor_period_id);
    assert(
      source.lifecycle === "rolled_over" &&
        source.successor_period_id === successor.id &&
        successor.lifecycle === "tracking" &&
        successor.start_date === "2026-12-01" &&
        successor.end_date === "2026-12-31" &&
        successor.active_date === "2026-12-01",
      "the tracking source links one successor and the successor is the only tracking period",
    );
    const successorOpenings = await sql.unsafe(
      `SELECT count(*)::int n FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [A, successor.id],
    );
    assert(successorOpenings[0].n === 1, "the successor has exactly one opening movement");
    const successorOpening = await sql.unsafe(
      `SELECT amount_minor FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind='opening' AND deleted_at IS NULL`,
      [A, successor.id],
    );
    assert(successorOpening[0].amount_minor === 98750, "the carry-forward uses the modeled closing cash");
    const closesAfterRollover = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2",
      [A, periodId],
    );
    assert(closesAfterRollover[0].n === 1, "rollover invented no close rows");
    const sourceExpenses = await sql.unsafe(
      `SELECT count(*)::int n FROM public.personal_expenses
       WHERE owner_user_id=$1 AND period_id=$2 AND kind <> 'opening' AND deleted_at IS NULL`,
      [A, periodId],
    );
    assert(sourceExpenses[0].n === 1, "the Nov 23 expense was not duplicated into the successor");

    const replay = await user(A, (tx) =>
      callRollover(
        tx,
        closeArgs(
          "money-001-a-ok",
          "Reviewed Nov 1–19 and 21–30 as unverified; no close rows invented",
          29,
          "Savings target versus transfers reviewed",
        ),
      ),
    );
    assert(replay[0].result.replayed === true, "the same operation replays its original receipt");
    const periodsAfterReplay = await sql.unsafe(
      "SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1",
      [A],
    );
    assert(periodsAfterReplay[0].n === 2, "replay creates no second successor");
    console.log("[FINALIZE] acknowledged rollover is atomic, idempotent and retains no invented closes");

    // --- Owner isolation and grant boundaries ------------------------------
    const bPeriods = await user(B, (tx) =>
      tx.unsafe("SELECT count(*)::int n FROM public.money_periods"),
    );
    assert(bPeriods[0].n === 0, "owner B cannot read owner A's periods");
    const bCloses = await user(B, (tx) =>
      tx.unsafe("SELECT count(*)::int n FROM public.money_day_closes"),
    );
    assert(bCloses[0].n === 0, "owner B cannot read owner A's close evidence");
    const bSummary = await user(B, (tx) =>
      tx.unsafe(
        "SELECT public.money_rollover_close_snapshot_summary($1::uuid) AS summary",
        [periodId],
      ),
    );
    assert(
      bSummary[0].summary.available === false &&
        bSummary[0].summary.reason === "source_period_not_found",
      "owner B cannot infer another owner's finalization evidence",
    );
    let bRolloverDenied = false;
    try {
      await user(B, (tx) => callRollover(tx, closeArgs("money-001-a-b", "B attempt", 29)));
    } catch (error) {
      bRolloverDenied = error.code === "P0002";
    }
    assert(bRolloverDenied, "owner B cannot roll over owner A's period");

    let readGrantDenied = false;
    try {
      await user(A, (tx) => callRollover(tx, closeArgs("money-001-a-read", "read grant", 29)), "money-read");
    } catch (error) {
      readGrantDenied = error.code === "42501";
    }
    assert(readGrantDenied, "a read-only finance grant cannot finalize a period");

    console.log("MONEY-001-A optional-close/finalization proof passed");
  } catch (error) {
    console.error(error);
    exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
