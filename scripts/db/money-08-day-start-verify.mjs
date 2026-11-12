#!/usr/bin/env node
/** Disposable PostgreSQL proof for MONEY-08 migrations through 0103. */
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
async function user(owner, fn, clientId = null) {
  return sql.begin(async tx => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: owner, role: "authenticated", aud: clientId ? RESOURCE : "authenticated", ...(clientId ? {client_id: clientId} : {})})]);
    return fn(tx);
  });
}
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
        '2026-11-12'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
        '2026-11-12'::date,'initialized'::text,50000::integer,'2026-11-12'::date,
        repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
        '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
        now()::timestamptz) AS p) created`));
    const period = created[0].id;
    const periodVersion = created[0].version;
    const incompleteSetup = await sql.unsafe(`SELECT availability,unavailable_reason,inputs
      FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-12'`, [A,period]);
    assert(incompleteSetup.length===1 && incompleteSetup[0].availability==="unavailable"
      && incompleteSetup[0].unavailable_reason==="initial_setup_incomplete"
      && incompleteSetup[0].inputs.setupComplete===false,
      "period creation leaves the opening baseline unavailable until setup is explicitly completed");
    for (const [clientId, profile, permissions] of [["money-read", "personal_operations", READ], ["money-write", "personal_operations_writer", WRITE]]) {
      await sql`INSERT INTO public.mcp_authorization_grants
        (owner_user_id,oauth_client_id,resource_uri,client_name,status,permission_profile,permissions,permissions_version,approved_at)
        VALUES (${A}::uuid,${clientId},${RESOURCE},'proof','active',${profile},${sql.json(permissions)},1,now())`;
    }
    const readerEnsure = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1,'2026-11-13'::date)).*", [period]), "money-read").then(() => false, e => e.code === "42501");
    const readerRebase = await user(A, tx => tx.unsafe("SELECT (public.money_rebase_day_start_baseline($1)).*", [period]), "money-read").then(() => false, e => e.code === "42501");
    assert(readerEnsure && readerRebase, "MCP read grant cannot ensure or rebase a baseline");
    const completedSetup = await user(A, tx => tx.unsafe("SELECT (public.money_rebase_day_start_baseline($1)).*", [period]));
    assert(completedSetup[0].availability==="available" && completedSetup[0].version===2,
      "owner rebase explicitly completes setup and replaces the incomplete baseline");
    const writerEnsure = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1,'2026-11-13'::date)).*", [period]), "money-write");
    assert(writerEnsure[0].availability === "available", "MCP write grant can ensure a baseline");
    const firstPartyEnsure = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1,'2026-11-14'::date)).*", [period]));
    assert(firstPartyEnsure[0].availability === "available", "first-party session can ensure a baseline");
    const internalRpc = await sql.unsafe("SELECT to_regprocedure('public.money_update_period_v1(uuid,integer,date,jsonb,integer,text,text,jsonb,text,timestamp with time zone)') AS id");
    assert(internalRpc[0].id === null, "no separate period update RPC can bypass baseline creation");
    const readerUpdateDenied = await user(A, tx => tx.unsafe(`SELECT * FROM public.money_update_period(
      $1,$2,'2026-11-15'::date,'{}'::jsonb,NULL::integer,NULL::text,NULL::text,
      '{}'::jsonb,NULL::text,now()::timestamptz)`, [period,periodVersion], "money-read")).then(() => false, e => e.code === "42501");
    assert(readerUpdateDenied, "MCP read grant cannot invoke the period update wrapper");
    // Migration 0103 wraps the full ten-argument period update RPC. Advancing
    // active_date must materialize that date's baseline in the same transaction.
    const advance = await user(A, tx => tx.unsafe(`SELECT (public.money_update_period(
      $1,$2,'2026-11-15'::date,'{}'::jsonb,NULL::integer,NULL::text,NULL::text,
      '{}'::jsonb,NULL::text,now()::timestamptz)).*`, [period,periodVersion]));
    assert(advance.length===1 && new Date(advance[0].active_date).toISOString().slice(0,10)==="2026-11-15"
      && advance[0].version===periodVersion+1, "period update advances active date and version");
    const advancedBaseline = await sql.unsafe(`SELECT availability,cash_minor,savings_target_minor,emergency_target_minor
      FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-15'`, [A,period]);
    assert(advancedBaseline.length===1 && advancedBaseline[0].availability==="available"
      && advancedBaseline[0].cash_minor===50000 && advancedBaseline[0].savings_target_minor===12000
      && advancedBaseline[0].emergency_target_minor===3000,
      "active date advancement materializes the baseline using effective policy and opening cash");
    // A transaction-local trigger raises during snapshot insertion. The RPC
    // must roll its period update back with the failed baseline generation.
    const rollback = await sql.begin(async tx => {
      await tx.unsafe(`CREATE FUNCTION public.money_08_fail_baseline_insert() RETURNS trigger
        LANGUAGE plpgsql SET search_path='' AS $f$ BEGIN RAISE EXCEPTION 'simulated baseline generation failure'; END $f$`);
      await tx.unsafe(`CREATE TRIGGER money_08_fail_baseline_insert BEFORE INSERT ON public.money_day_start_baselines
        FOR EACH ROW EXECUTE FUNCTION public.money_08_fail_baseline_insert()`);
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe("SELECT set_config('request.jwt.claim.sub',$1,true)",[A]);
      await tx.unsafe("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:A,role:"authenticated",aud:"authenticated"})]);
      try {
        await tx.unsafe(`SELECT * FROM public.money_update_period(
          $1,$2,'2026-11-16'::date,'{}'::jsonb,NULL::integer,NULL::text,NULL::text,
          '{}'::jsonb,NULL::text,now()::timestamptz)`,[period,periodVersion+1]);
        return false;
      } catch(e) {
        if (!e.message.includes("simulated baseline generation failure")) throw e;
        return true;
      }
    }).catch(e => { if(e.message.includes("simulated baseline generation failure")) return true; throw e; });
    assert(rollback, "simulated baseline generation failure is surfaced");
    const afterFailure = await sql.unsafe(`SELECT active_date,version FROM public.money_periods WHERE id=$1`,[period]);
    const failedDateBaseline = await sql.unsafe(`SELECT count(*)::int n FROM public.money_day_start_baselines
      WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-16'`,[A,period]);
    assert(new Date(afterFailure[0].active_date).toISOString().slice(0,10)==="2026-11-15"
      && afterFailure[0].version===periodVersion+1 && failedDateBaseline[0].n===0,
      "baseline generation failure atomically rolls back active date, version, and snapshot");
    console.log("[ADVANCE] active date materializes baseline; generation failure rolls back period update");
    const rows = await sql.unsafe("SELECT p.id AS policy_id, p.version, p.policy, b.availability, b.unavailable_reason, b.policy_version_id FROM public.money_policy_versions p JOIN public.money_day_start_baselines b USING(owner_user_id, period_id) WHERE p.owner_user_id=$1 AND p.period_id=$2 AND b.date='2026-11-12' AND b.version=2", [A,period]);
    const baseline = await sql.unsafe("SELECT availability, cash_minor, commitments_minor, savings_target_minor, savings_funded_minor, emergency_target_minor, emergency_used_minor, inputs FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-12' AND version=2", [A,period]);
    const preservedInitialBaseline = await sql.unsafe("SELECT availability,unavailable_reason,inputs FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-12' AND version=1", [A,period]);
    assert(rows.length===1 && rows[0].version===1 && rows[0].availability==="available" && rows[0].policy_version_id===rows[0].policy_id, "explicit setup rebase creates an available baseline against policy version 1");
    assert(preservedInitialBaseline.length===1 && preservedInitialBaseline[0].availability==="unavailable"
      && preservedInitialBaseline[0].unavailable_reason==="initial_setup_incomplete"
      && preservedInitialBaseline[0].inputs.setupComplete===false, "setup rebase preserves the original unavailable baseline");
    assert(baseline.length===1 && baseline[0].cash_minor===50000 && baseline[0].commitments_minor===0 && baseline[0].savings_target_minor===12000 && baseline[0].savings_funded_minor===0 && baseline[0].emergency_target_minor===3000 && baseline[0].emergency_used_minor===0, "setup snapshot preserves opening and configured targets");
    await user(A, tx => tx.unsafe(`INSERT INTO public.money_budget_plans
      (owner_user_id,period_id,savings_target_minor,emergency_target_minor)
      VALUES ($1,$2,12000,3000)`, [A,period]));
    await user(A, tx => tx.unsafe(`UPDATE public.money_budget_plans
      SET savings_target_minor=15000, emergency_target_minor=4500, version=2
      WHERE owner_user_id=$1 AND period_id=$2 AND version=1`, [A,period]));
    const revisions = await sql.unsafe(`SELECT id,version,effective_date,policy->'settings' AS settings
      FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2
      ORDER BY version`, [A,period]);
    const unchanged = await sql.unsafe(`SELECT b.cash_minor,b.savings_target_minor,b.emergency_target_minor,b.policy_version_id
      FROM public.money_day_start_baselines b WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-15'`, [A,period]);
    assert(revisions.length===2 && revisions[1].version===2 && new Date(revisions[1].effective_date).toISOString().slice(0,10)==='2026-11-15'
      && revisions[1].settings.savingsTargetMinor===15000 && revisions[1].settings.emergencyTargetMinor===4500,
      "budget target change appends an owner/period policy revision effective at active date");
    assert(unchanged.length===1 && unchanged[0].cash_minor===50000 && unchanged[0].savings_target_minor===12000
      && unchanged[0].emergency_target_minor===3000 && unchanged[0].policy_version_id===rows[0].policy_id,
      "target revision leaves the existing day-start baseline unchanged");
    const rebased = await user(A, tx => tx.unsafe("SELECT (public.money_rebase_day_start_baseline($1)).*", [period]));
    assert(new Date(rebased[0].date).toISOString().slice(0,10) === "2026-11-15", "owner can rebase a lagging active date independent of database current date");
    const baselineVersions = await sql.unsafe(`SELECT version,cash_minor,savings_target_minor,emergency_target_minor,policy_version_id
      FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-11-15' ORDER BY version`, [A,period]);
    assert(rebased[0].version===2 && rebased[0].savings_target_minor===15000 && rebased[0].emergency_target_minor===4500
      && rebased[0].policy_version_id===revisions[1].id,
      "owner rebase recomputes the active baseline with changed effective targets");
    assert(baselineVersions.length===2 && baselineVersions[0].version===1 && baselineVersions[0].savings_target_minor===12000
      && baselineVersions[0].emergency_target_minor===3000 && baselineVersions[1].version===2,
      "rebase retains the original baseline as version 1");
    const legacy = await user(A, tx => tx.unsafe(`SELECT (public.money_create_period(
      '2026-10-01'::date,'2026-10-31'::date,'Africa/Casablanca'::text,
      '2026-10-01'::date,'initialized'::text,50000::integer,'2026-10-01'::date,
      repeat('d',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
      '{}'::jsonb,now()::timestamptz)).id AS id,
      (public.money_create_period(
      '2026-11-12'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
      '2026-11-12'::date,'initialized'::text,50000::integer,'2026-11-12'::date,
      repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
      '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
      now()::timestamptz)).version AS version`));
    const legacyPeriod = legacy[0].id;
    await user(A, tx => tx.unsafe(`INSERT INTO public.money_budget_plans
      (owner_user_id,period_id,savings_target_minor,emergency_target_minor)
      VALUES ($1,$2,12000,3000)`, [A,legacyPeriod]));
    await user(A, tx => tx.unsafe(`UPDATE public.money_budget_plans
      SET savings_target_minor=15000, emergency_target_minor=4500, version=2
      WHERE owner_user_id=$1 AND period_id=$2`, [A,legacyPeriod]));
    const legacyPolicy = await sql.unsafe(`SELECT version,effective_date,policy
      FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2`, [A,legacyPeriod]);
    assert(legacyPolicy.length===1 && legacyPolicy[0].version===1
      && new Date(legacyPolicy[0].effective_date).toISOString().slice(0,10)==='2026-10-01'
      && legacyPolicy[0].policy.settings.savingsTargetMinor===15000
      && legacyPolicy[0].policy.settings.emergencyTargetMinor===4500,
      "legacy target edit records only complete current settings without a historical baseline");
    const revisedDay = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1, '2026-11-13'::date)).*", [period]));
    assert(revisedDay[0].availability==="available" && revisedDay[0].cash_minor===50000
      && revisedDay[0].savings_target_minor===15000 && revisedDay[0].emergency_target_minor===4500
      && revisedDay[0].policy_version_id===revisions[1].id,
      "subsequent day-start baseline uses the effective revised targets and preserves opening cash");
    console.log("[REVISION] target update appends policy version 2; existing day-start baseline remains immutable");
    const endFirst = await user(A, tx => tx.unsafe("UPDATE public.money_periods SET lifecycle='ended', version=version+1 WHERE id=$1 RETURNING id", [period]));
    assert(endFirst.length===1, "first period ends before creating the next tracking period");
    const endedRebaseDenied = await user(A, tx => tx.unsafe("SELECT (public.money_rebase_day_start_baseline($1)).*", [period]))
      .then(() => false, e => e.code === "P0001");
    assert(endedRebaseDenied, "ended period cannot be rebased");
    const nextPeriod = await user(A, tx => tx.unsafe(`SELECT (public.money_create_period(
      '2026-12-01'::date,'2026-12-31'::date,'Africa/Casablanca'::text,
      '2026-12-01'::date,'initialized'::text,73000::integer,'2026-12-01'::date,
      repeat('b',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
      '{"savingsTargetMinor":4000,"emergencyTargetMinor":9000}'::jsonb,
      now()::timestamptz)).id AS id,
      (public.money_create_period(
      '2026-11-12'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
      '2026-11-12'::date,'initialized'::text,50000::integer,'2026-11-12'::date,
      repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
      '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
      now()::timestamptz)).version AS version`));
    const nextPeriodId = nextPeriod[0].id;
    await sql.unsafe(`INSERT INTO public.money_obligations
      (owner_user_id,kind,description,amount_minor,period_start,period_end,due_date,
       purpose,counts_in_daily,state,state_effective_date,state_history,idempotency_key,create_fingerprint,created_at)
      VALUES
       ($1,'bill','initial obligation',2100,'2026-12-01','2026-12-31','2026-12-10',
        'fixed',true,'pending','2026-12-01','[]'::jsonb,'initial-obligation',repeat('e',64),'2026-11-30T12:00:00Z'),
       ($1,'bill','same-day transition',3200,'2026-12-01','2026-12-31','2026-12-10',
        'fixed',true,'cancelled','2026-12-01',jsonb_build_array(jsonb_build_object('state','cancelled','effectiveDate','2026-12-01','version',2)), 'same-day-transition',repeat('f',64),'2026-11-30T12:00:00Z'),
       ($1,'bill','future transition',4300,'2026-12-01','2026-12-31','2026-12-10',
        'fixed',true,'cancelled','2026-12-03',jsonb_build_array(jsonb_build_object('state','cancelled','effectiveDate','2026-12-03','version',2)), 'future-transition',repeat('1',64),'2026-11-30T12:00:00Z')`, [A]);
    const initialObligationsBaseline = await sql.unsafe("SELECT availability,unavailable_reason,inputs FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-12-01'", [A,nextPeriodId]);
    assert(initialObligationsBaseline.length===1 && initialObligationsBaseline[0].availability==="unavailable"
      && initialObligationsBaseline[0].unavailable_reason==="initial_setup_incomplete"
      && initialObligationsBaseline[0].inputs.setupComplete===false,
      "new period starts unavailable until obligation setup is explicitly completed");
    const openingObligations = await user(A, tx => tx.unsafe("SELECT (public.money_rebase_day_start_baseline($1)).*", [nextPeriodId]));
    assert(openingObligations[0].availability==="available" && openingObligations[0].commitments_minor===6400,
      "first-day baseline includes initial and future-transition pending obligations but excludes same-day cancellation");
    console.log("[OBLIGATIONS] first-day cutoff includes period-start obligations without applying same-day transitions");
    await user(A, tx => tx.unsafe(`INSERT INTO public.personal_expenses
      (owner_user_id,period_id,occurred_at,booking_date,kind,direction,amount_minor,currency,
       category,need_vs_want,idempotency_key,create_fingerprint)
      VALUES ($1,$2,'2026-11-20T12:00:00Z','2026-11-20','income','in',9000,'MAD',
       NULL,NULL,'prior-period-income',repeat('c',64))`, [A,period]));
    const later = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1, '2026-12-02'::date)).*", [nextPeriodId]));
    const laterAgain = await user(A, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1, '2026-12-02'::date)).*", [nextPeriodId]));
    assert(later[0].availability==="available" && later[0].cash_minor===73000 && later[0].commitments_minor===4300 && later[0].savings_funded_minor===0 && later[0].emergency_used_minor===0 && later[0].version===laterAgain[0].version, "later-period baseline applies only lifecycle transitions before the date, excludes prior-period movement, and is idempotent");
    assert(later[0].policy_version_id && later[0].policy_version_id!==rows[0].policy_id && later[0].inputs.lifecycleCutoff==="2026-12-02", "later-day baseline binds the second period policy and lifecycle cutoff");
    const nextPolicy = await sql.unsafe("SELECT id,version,policy FROM public.money_policy_versions WHERE owner_user_id=$1 AND period_id=$2", [A,nextPeriodId]);
    const nextBaseline = await sql.unsafe("SELECT cash_minor,savings_target_minor,emergency_target_minor,availability FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2 AND date='2026-12-01'", [A,nextPeriodId]);
    const priorAgain = await sql.unsafe("SELECT p.version,p.policy,b.cash_minor,b.savings_target_minor,b.emergency_target_minor,b.availability,b.policy_version_id FROM public.money_policy_versions p JOIN public.money_day_start_baselines b USING(owner_user_id,period_id) WHERE p.owner_user_id=$1 AND p.period_id=$2 AND p.version=1 AND b.date='2026-11-12'", [A,period]);
    assert(nextPolicy.length===1 && nextPolicy[0].version===1 && nextBaseline.length===1 && nextBaseline[0].cash_minor===73000 && nextBaseline[0].savings_target_minor===4000 && nextBaseline[0].emergency_target_minor===9000 && nextBaseline[0].availability==="available", "same owner next period receives only its own opening and policy inputs");
    assert(priorAgain.length===1 && priorAgain[0].version===1 && priorAgain[0].policy_version_id===rows[0].policy_id && priorAgain[0].cash_minor===50000 && priorAgain[0].savings_target_minor===12000 && priorAgain[0].emergency_target_minor===3000 && priorAgain[0].availability==="available", "creating a later period does not move or replace the prior-period policy or baseline");
    console.log("[PERIOD ISOLATION] same-owner prior-period policy and baseline remain unchanged");
    const unknown = await user(B, tx => tx.unsafe(`SELECT (p).id AS id FROM (SELECT public.money_create_period(
      '2026-12-01'::date,'2026-12-31'::date,'Africa/Casablanca'::text,
      '2026-12-01'::date,'uninitialized'::text,NULL::integer,NULL::date,NULL::text,
      '{}'::jsonb,'{}'::jsonb,now()::timestamptz) AS p) created`));
    const unknownBaseline = await sql.unsafe("SELECT availability, unavailable_reason FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2", [B,unknown[0].id]);
    assert(unknownBaseline[0].availability==="unavailable" && unknownBaseline[0].unavailable_reason!==null, "unknown setup inputs remain explicitly unavailable");
    const unknownLater = await user(B, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1, '2026-12-02'::date)).*", [unknown[0].id]));
    assert(unknownLater[0].availability==="unavailable" && unknownLater[0].cash_minor===null
      && unknownLater[0].unavailable_reason==="opening_balance_unknown",
      "uninitialized period with complete policy and no opening stays unavailable on a later date");
    console.log("[OPENING] missing opening remains unavailable after later-day materialization");
    await sql.unsafe(`INSERT INTO public.money_obligations
      (owner_user_id,kind,description,amount_minor,period_start,period_end,due_date,
       purpose,counts_in_daily,state,state_effective_date,state_history,idempotency_key,create_fingerprint)
      VALUES ($1,'bill','historical obligation',1000,'2026-12-01','2026-12-31','2026-12-10',
       'fixed',true,'cancelled','2026-12-01','[]'::jsonb,'unknown-history',repeat('d',64))`, [B]);
    const unknownObligation = await user(B, tx => tx.unsafe("SELECT (public.money_ensure_day_start_baseline($1, '2026-12-03'::date)).*", [unknown[0].id]));
    assert(unknownObligation[0].availability==="unavailable" && unknownObligation[0].cash_minor===null
      && unknownObligation[0].unavailable_reason==="obligation_history_incomplete",
      "incomplete obligation history has its own unavailable reason when opening is also unknown");
    console.log("[OBLIGATIONS] incomplete lifecycle history remains a distinct unavailable cause");
    console.log("[RPC] policy and known first-day setup baseline are atomic; unknown inputs stay unavailable");
    const asA = await user(A, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    const asB = await user(B, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    const asC = await user(C, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    assert(asA[0].n===6 && asB[0].n===3 && asC[0].n===0, "RLS owner isolation");
    console.log("[RLS] owners A and B see their own baselines; owner C sees none");
    for (const [label, statement, params] of [
      ["cross-owner period", "INSERT INTO public.money_policy_versions(owner_user_id,period_id,version,effective_date,policy) VALUES($1,$2,1,'2026-11-12','{}')", [B,period]],
      ["cross-owner policy baseline", "INSERT INTO public.money_day_start_baselines(owner_user_id,period_id,date,version,policy_version_id,algorithm_version,availability,unavailable_reason) VALUES($1,$2,'2026-11-12',9,$3,'v1','unavailable','unknown')", [A,period,"ffffffff-ffff-4fff-8fff-ffffffffffff"]],
    ]) {
      let denied=false; try { await sql.unsafe(statement,params); } catch(e) { denied=e.code==="23503"; if(!denied) throw e; }
      assert(denied, `${label} foreign key rejects mismatch`);
    }
    console.log("[FK] cross-owner period and invalid policy references rejected");
    console.log("[DONE] MONEY-08 proof through migration 0103 passed");
  } finally { await sql.end(); }
}
main().catch(e=>{ console.error(e); exit(1); });
