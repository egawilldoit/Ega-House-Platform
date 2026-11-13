#!/usr/bin/env node
/** Disposable PostgreSQL proof for MONEY-09 durable day close through 0104. */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const RESOURCE = "https://ega.example.com/api/mcp";
const READ = ["today.read", "timer.read", "personal_ops.read"];
const WRITE = [...READ, "personal_ops.write"];
const tags = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries.map(x => x.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");
const sql = postgres(url, { max: 2, onnotice: () => {} });
function assert(ok, message) { if (!ok) throw new Error(message); }
function repeat(character, count) { return character.repeat(count); }
function day(value) { return new Date(value).toISOString().slice(0, 10); }
async function user(owner, fn, clientId = null) {
  return sql.begin(async tx => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: owner, role: "authenticated", aud: clientId ? RESOURCE : "authenticated", ...(clientId ? {client_id: clientId} : {})})]);
    return fn(tx);
  });
}
const close = (tx, periodId, version, date, operationId, fingerprint, included = [], note = "CLOSED proof") =>
  tx.unsafe(`SELECT public.money_close_day(
    $1::uuid,$2::integer,$3::date,$4::text,$5::uuid,$6::text,$7::uuid[],$8::timestamptz
  ) AS result`, [periodId, version, date, note, operationId, fingerprint, included, "2026-11-09T20:00:00.000Z"]);

async function main() {
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;");
    await sql.unsafe(`DO $x$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $x$`);
    await sql.unsafe("CREATE SCHEMA auth");
    await sql.unsafe("GRANT USAGE ON SCHEMA public, auth TO anon, authenticated");
    await sql.unsafe("CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL)");
    await sql.unsafe("INSERT INTO auth.users VALUES ($1, 'a@example.test'), ($2, 'b@example.test'), ($3, 'c@example.test')", [A,B,C]);
    await sql.unsafe("UPDATE auth.users SET email='ab.mortaki@gmail.com' WHERE id=$1", [A]);
    await sql.unsafe("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$");
    await sql.unsafe("CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$");
    await sql.unsafe("CREATE SCHEMA automation");
    await sql.unsafe("CREATE TABLE automation.implementation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64), linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1, status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64), heartbeat_at timestamptz, lease_expires_at timestamptz, started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), finished_at timestamptz, failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now())");
    for (const tag of tags) {
      const text = await readFile(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8");
      for (const stmt of text.split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean)) await sql.unsafe(stmt);
    }
    console.log(`[MIGRATE] ${tags.length} migrations through ${tags.at(-1)}`);

    const created = await user(A, tx => tx.unsafe(`SELECT (p).id AS id, (p).version AS version
      FROM (SELECT public.money_create_period(
        '2026-11-09'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
        '2026-11-09'::date,'initialized'::text,50000::integer,'2026-11-09'::date,
        repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
        '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
        '2026-11-09T08:00:00.000Z'::timestamptz) AS p) created`));
    const period = created[0].id;
    await user(A, tx => tx.unsafe("SELECT * FROM public.money_rebase_day_start_baseline($1)", [period]));
    const baseline = await sql.unsafe(`SELECT availability,cash_minor,savings_target_minor,emergency_target_minor
      FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-09'
      ORDER BY version DESC LIMIT 1`, [A, period]);
    assert(baseline.length === 1 && baseline[0].availability === "available"
      && baseline[0].cash_minor === 50000 && baseline[0].savings_target_minor === 12000
      && baseline[0].emergency_target_minor === 3000,
      "setup baseline is complete before a close");

    for (const [clientId, profile, permissions] of [["money-read", "personal_operations", READ], ["money-write", "personal_operations_writer", WRITE]]) {
      await sql`INSERT INTO public.mcp_authorization_grants
        (owner_user_id,oauth_client_id,resource_uri,client_name,status,permission_profile,permissions,permissions_version,approved_at)
        VALUES (${A}::uuid,${clientId},${RESOURCE},'proof','active',${profile},${sql.json(permissions)},1,now())`;
    }

    const expense = await user(A, tx => tx.unsafe(`INSERT INTO public.personal_expenses
      (owner_user_id,period_id,booking_date,kind,direction,amount_minor,currency,
       category,need_vs_want,purpose,counts_in_daily,idempotency_key,create_fingerprint)
      VALUES ($1,$2,'2026-11-09','expense','out',1100,'MAD',
       'coffee','want','flexible',true,'close-purchase-1',repeat('b',64)) RETURNING id`, [A, period]));
    const expenseId = expense[0].id;

    const periodRow = (await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [period]))[0];

    // Reader grant cannot close; writer grant can.
    const readerClose = await user(A, tx => close(tx, period, periodRow.version, "2026-11-09", "10000000-0000-4000-8000-000000000001", repeat('c',64), [expenseId]), "money-read")
      .then(() => false, e => e.code === "42501");
    assert(readerClose, "MCP read grant cannot close a day");

    const closed = await user(A, tx => close(tx, period, periodRow.version, "2026-11-09", "10000000-0000-4000-8000-000000000002", repeat('c',64), [expenseId]), "money-write");
    const closedResult = closed[0].result;
    assert(closedResult.status === "closed", "writer grant closes the active day");
    assert(day(closedResult.close.close_date) === "2026-11-09", "close row stores the closed date");
    assert(closedResult.close.is_final_day === false && closedResult.close.lifecycle_after === "tracking", "nonfinal close keeps tracking lifecycle");
    assert(day(closedResult.period.active_date) === "2026-11-10" && closedResult.period.version === periodRow.version + 1, "active date advances exactly one day and version increments once");
    assert(closedResult.close.snapshot.expenseTotalMinor === 1100
      && closedResult.close.snapshot.dailyIncludedSpendMinor === 1100
      && closedResult.close.snapshot.flexibleExpenseTotalMinor === 1100
      && closedResult.close.snapshot.categoryTotals.coffee === 1100,
      "close stores day/category/flexible totals from canonical expenses");
    assert(closedResult.close.snapshot.recordedCashMinor === 48900, "close stores recorded cash through the closed day");
    assert(closedResult.close.snapshot.dailyReference.referenceMinor === 1590
      && closedResult.close.snapshot.dailyReference.dailyRemainingMinor === 490,
      "close stores the versioned day-start reference and remaining allowance");
    assert(closedResult.close.snapshot.reserves.safeFlexibleMinor === 35000,
      "close stores the disjoint reserve snapshot");
    assert(closedResult.close.algorithm_version === "safe-flexible-start-of-day-v1",
      "close stores the algorithm version");
    const nextBaseline = await sql.unsafe(`SELECT availability,cash_minor FROM public.money_day_start_baselines
      WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-10' ORDER BY version DESC LIMIT 1`, [A, period]);
    assert(nextBaseline.length === 1 && nextBaseline[0].availability === "available" && nextBaseline[0].cash_minor === 48900,
      "the next active day has its own day-start baseline");
    console.log("[CLOSE] evidence, reference and one-day advance are committed");

    const current = (await sql.unsafe("SELECT active_date,version FROM public.money_periods WHERE id=$1", [period]))[0];
    const replay = await user(A, tx => close(tx, period, periodRow.version, "2026-11-09", "10000000-0000-4000-8000-000000000002", repeat('c',64), [expenseId]), "money-write");
    assert(replay[0].result.status === "replayed", "same operation replays the retained close after the date advanced");
    const repeatedEvidence = await user(A, tx => close(tx, period, current.version, "2026-11-09", "10000000-0000-4000-8000-000000000003", repeat('c',64), [expenseId]));
    assert(repeatedEvidence[0].result.status === "close_date_not_active", "a fresh close for the already-closed date validates the advanced active date");
    const conflicting = await user(A, tx => close(tx, period, current.version, "2026-11-09", "10000000-0000-4000-8000-000000000004", repeat('d',64), [expenseId], "Different note"));
    assert(conflicting[0].result.status === "close_date_not_active", "different evidence for the closed date cannot reopen the day");
    let closeCount = await sql.unsafe("SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2", [A, period]);
    assert(closeCount[0].n === 1, "replay and duplicate attempts never create a second close");
    const afterReplay = (await sql.unsafe("SELECT active_date,version FROM public.money_periods WHERE id=$1", [period]))[0];
    assert(day(afterReplay.active_date) === day(current.active_date) && afterReplay.version === current.version,
      "replay never advances or versions the period twice");

    const stale = await user(A, tx => close(tx, period, periodRow.version, "2026-11-10", "10000000-0000-4000-8000-000000000005", repeat('e',64)));
    assert(stale[0].result.status === "stale_version", "stale expected version is refused");
    const skipped = await user(A, tx => close(tx, period, current.version, "2026-11-11", "10000000-0000-4000-8000-000000000006", repeat('e',64)));
    assert(skipped[0].result.status === "close_date_not_active" && day(skipped[0].result.detail) === "2026-11-10",
      "close cannot skip the lagging active date");
    const invalidPurchase = await user(A, tx => close(tx, period, current.version, "2026-11-10", "10000000-0000-4000-8000-000000000007", repeat('e',64), ["99999999-9999-4999-8999-999999999999"]));
    assert(invalidPurchase[0].result.status === "included_movement_invalid", "an unrecorded final purchase prevents closing");
    const unchangedAfterRefusals = (await sql.unsafe("SELECT active_date,version FROM public.money_periods WHERE id=$1", [period]))[0];
    closeCount = await sql.unsafe("SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2", [A, period]);
    assert(day(unchangedAfterRefusals.active_date) === day(current.active_date)
      && unchangedAfterRefusals.version === current.version && closeCount[0].n === 1,
      "refused closes leave period state and close evidence unchanged");
    console.log("[REPLAY] duplicate operations replay; stale, skipped and invalid-purchase closes are refused without mutation");

    // A baseline failure after the close insert must roll back the insert and
    // the active-date/version advance together.
    const rollback = await sql.begin(async tx => {
      await tx.unsafe(`CREATE FUNCTION public.money_09_fail_baseline_insert() RETURNS trigger
        LANGUAGE plpgsql SET search_path='' AS $f$ BEGIN RAISE EXCEPTION 'simulated close baseline failure'; END $f$`);
      await tx.unsafe(`CREATE TRIGGER money_09_fail_baseline_insert BEFORE INSERT ON public.money_day_start_baselines
        FOR EACH ROW EXECUTE FUNCTION public.money_09_fail_baseline_insert()`);
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe("SELECT set_config('request.jwt.claim.sub',$1,true)", [A]);
      await tx.unsafe("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub: A, role: "authenticated", aud: "authenticated"})]);
      try {
        await close(tx, period, current.version, "2026-11-10", "10000000-0000-4000-8000-000000000008", repeat('f',64));
        return false;
      } catch (error) {
        if (!error.message.includes("simulated close baseline failure")) throw error;
        return true;
      }
    }).catch(error => {
      if (error.message.includes("simulated close baseline failure")) return true;
      throw error;
    });
    assert(rollback, "simulated next-day baseline failure is surfaced");
    const afterRollback = (await sql.unsafe("SELECT active_date,version FROM public.money_periods WHERE id=$1", [period]))[0];
    const rollbackDates = await sql.unsafe(`SELECT count(*)::int n FROM public.money_day_start_baselines
      WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-11'`, [A, period]);
    closeCount = await sql.unsafe("SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2", [A, period]);
    assert(day(afterRollback.active_date) === "2026-11-10" && afterRollback.version === current.version
      && closeCount[0].n === 1 && rollbackDates[0].n === 0,
      "baseline failure atomically rolls back close evidence, active date and version");
    console.log("[ROLLBACK] failed close leaves no close row, no date advance and no next-day baseline");

    // A later correction keeps the original snapshot intact and changes only the
    // live totals.
    await user(A, tx => tx.unsafe(`UPDATE public.personal_expenses
      SET amount_minor=2100, version=version+1, updated_at=now()
      WHERE id=$1 AND owner_user_id=$2`, [expenseId, A]));
    const retained = await sql.unsafe(`SELECT snapshot FROM public.money_day_closes
      WHERE owner_user_id=$1 AND period_id=$2 AND close_date='2026-11-09'`, [A, period]);
    const liveExpense = await sql.unsafe(`SELECT COALESCE(sum(amount_minor),0)::int total
      FROM public.personal_expenses WHERE owner_user_id=$1 AND period_id=$2
        AND booking_date='2026-11-09' AND kind='expense' AND deleted_at IS NULL`, [A, period]);
    assert(retained[0].snapshot.expenseTotalMinor === 1100
      && retained[0].snapshot.categoryTotals.coffee === 1100
      && retained[0].snapshot.recordedCashMinor === 48900,
      "a later correction never rewrites the retained close snapshot");
    assert(liveExpense[0].total === 2100, "live restated totals differ from the retained snapshot, enabling changed-since-close");
    const evidence = await user(A, tx => tx.unsafe(`SELECT close_date,note,snapshot FROM public.money_day_closes
      WHERE owner_user_id=$1 AND period_id=$2`, [A, period]));
    assert(evidence.length === 1 && evidence[0].note === "CLOSED proof", "owner reads the retained CLOSED note and snapshot");
    const isolated = await user(B, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_closes"));
    assert(isolated[0].n === 0, "another owner cannot read close evidence through RLS");
    const foreignClose = await user(B, tx => close(tx, period, current.version, "2026-11-10", "20000000-0000-4000-8000-000000000001", repeat('a',64)));
    assert(foreignClose[0].result.status === "not_found", "another owner cannot close this period");
    console.log("[HISTORY] original close is immutable; live totals restate beside it; owner RLS isolates evidence");

    // Final tracked day: retain the end date, end the period and require rollover.
    const finalPeriodRows = await user(B, tx => tx.unsafe(`SELECT (p).id AS id, (p).version AS version
      FROM (SELECT public.money_create_period(
        '2026-10-01'::date,'2026-10-01'::date,'Africa/Casablanca'::text,
        '2026-10-01'::date,'initialized'::text,50000::integer,'2026-10-01'::date,
        repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
        '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
        '2026-10-01T08:00:00.000Z'::timestamptz) AS p) created`));
    const finalPeriod = finalPeriodRows[0].id;
    await user(B, tx => tx.unsafe("SELECT * FROM public.money_rebase_day_start_baseline($1)", [finalPeriod]));
    const finalVersion = (await sql.unsafe("SELECT version FROM public.money_periods WHERE id=$1", [finalPeriod]))[0].version;
    const periodsBefore = await sql.unsafe("SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1", [B]);
    const finalClose = await user(B, tx => close(tx, finalPeriod, finalVersion, "2026-10-01", "20000000-0000-4000-8000-000000000002", repeat('b',64)));
    const finalResult = finalClose[0].result;
    assert(finalResult.status === "closed" && finalResult.close.is_final_day === true
      && finalResult.close.lifecycle_after === "ended",
      "closing the final day records a final-day close");
    assert(day(finalResult.period.active_date) === "2026-10-01" && finalResult.period.lifecycle === "ended"
      && finalResult.period.version === finalVersion + 1,
      "final-day close retains the end date and ends the period");
    const periodsAfter = await sql.unsafe("SELECT count(*)::int n FROM public.money_periods WHERE owner_user_id=$1", [B]);
    assert(periodsAfter[0].n === periodsBefore[0].n, "final-day close never silently creates a new period");
    const endedClose = await user(B, tx => close(tx, finalPeriod, finalVersion + 1, "2026-10-01", "20000000-0000-4000-8000-000000000003", repeat('c',64)));
    assert(endedClose[0].result.status === "period_not_tracking", "an ended period refuses further routine closes");
    const endedBaseline = await sql.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date>'2026-10-01'", [B, finalPeriod]);
    assert(endedBaseline[0].n === 0, "final-day close materializes no baseline beyond the period");
    console.log("[FINAL] final day retains end date, ends the period and requires explicit rollover");

    // Baseline remains unavailable without explicit setup, so a close cannot
    // invent a zero baseline.
    const unsetRows = await user(C, tx => tx.unsafe(`SELECT (p).id AS id, (p).version AS version
      FROM (SELECT public.money_create_period(
        '2026-10-05'::date,'2026-10-06'::date,'Africa/Casablanca'::text,
        '2026-10-05'::date,'initialized'::text,1000::integer,'2026-10-05'::date,
        repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
        '{"savingsTargetMinor":0,"emergencyTargetMinor":0}'::jsonb,
        '2026-10-05T08:00:00.000Z'::timestamptz) AS p) created`));
    const unsetPeriod = unsetRows[0].id;
    const incomplete = await user(C, tx => close(tx, unsetPeriod, unsetRows[0].version, "2026-10-05", "30000000-0000-4000-8000-000000000001", repeat('d',64)));
    assert(incomplete[0].result.status === "baseline_unavailable", "initial setup must be explicitly completed before closing");
    const unsetAfter = (await sql.unsafe("SELECT active_date,version FROM public.money_periods WHERE id=$1", [unsetPeriod]))[0];
    assert(day(unsetAfter.active_date) === "2026-10-05" && unsetAfter.version === unsetRows[0].version,
      "an unavailable baseline leaves the active date unchanged");
    const unsetCloses = await sql.unsafe("SELECT count(*)::int n FROM public.money_day_closes WHERE owner_user_id=$1 AND period_id=$2", [C, unsetPeriod]);
    assert(unsetCloses[0].n === 0, "an unavailable baseline stores no close");
    console.log("[BASELINE] incomplete setup refuses close instead of inventing zero inputs");

    console.log("MONEY-09 day-close proof passed (through 0104).");
  } catch (error) {
    console.error(error);
    exit(1);
  } finally {
    await sql.end();
  }
}
await main();
