#!/usr/bin/env node
/** Disposable PostgreSQL proof for MONEY-08 migration 0100. */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const tags = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")).entries.map(x => x.tag);
const url = argv[argv.indexOf("--url") + 1];
if (!url) throw new Error("Missing --url");
const sql = postgres(url, { max: 2, onnotice: () => {} });
function assert(ok, message) { if (!ok) throw new Error(message); }
async function user(owner, fn) {
  return sql.begin(async tx => {
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx.unsafe("SELECT set_config('request.jwt.claim.sub', $1, true)", [owner]);
    await tx.unsafe("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({sub: owner, role: "authenticated", aud: "authenticated"})]);
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
    const created = await user(A, tx => tx.unsafe(`SELECT (public.money_create_period(
      '2026-11-12'::date,'2026-11-30'::date,'Africa/Casablanca'::text,
      '2026-11-12'::date,'initialized'::text,50000::integer,'2026-11-12'::date,
      repeat('a',64)::text,'{"opening":{"source":"user_entered"}}'::jsonb,
      '{"savingsTargetMinor":12000,"emergencyTargetMinor":3000}'::jsonb,
      now()::timestamptz)).id AS id`));
    const period = created[0].id;
    const rows = await sql.unsafe("SELECT p.id AS policy_id, p.version, p.policy, b.availability, b.unavailable_reason, b.policy_version_id FROM public.money_policy_versions p JOIN public.money_day_start_baselines b USING(owner_user_id, period_id) WHERE p.owner_user_id=$1 AND p.period_id=$2", [A,period]);
    const baseline = await sql.unsafe("SELECT availability, cash_minor, commitments_minor, savings_target_minor, savings_funded_minor, emergency_target_minor, emergency_used_minor, inputs FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2", [A,period]);
    assert(rows.length===1 && rows[0].version===1 && rows[0].availability==="available" && rows[0].policy_version_id===rows[0].policy_id, "RPC created version-1 policy and available baseline");
    assert(baseline.length===1 && baseline[0].cash_minor===50000 && baseline[0].commitments_minor===0 && baseline[0].savings_target_minor===12000 && baseline[0].savings_funded_minor===0 && baseline[0].emergency_target_minor===3000 && baseline[0].emergency_used_minor===0, "setup snapshot preserves opening and configured targets");
    const unknown = await user(B, tx => tx.unsafe(`SELECT (public.money_create_period(
      '2026-12-01'::date,'2026-12-31'::date,'Africa/Casablanca'::text,
      '2026-12-01'::date,'uninitialized'::text,NULL::integer,NULL::date,NULL::text,
      '{}'::jsonb,'{}'::jsonb,now()::timestamptz)).id AS id`));
    const unknownBaseline = await sql.unsafe("SELECT availability, unavailable_reason FROM public.money_day_start_baselines WHERE owner_user_id=$1 AND period_id=$2", [B,unknown[0].id]);
    assert(unknownBaseline[0].availability==="unavailable" && unknownBaseline[0].unavailable_reason!==null, "unknown setup inputs remain explicitly unavailable");
    console.log("[RPC] policy and known first-day setup baseline are atomic; unknown inputs stay unavailable");
    const asA = await user(A, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    const asB = await user(B, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    const asC = await user(C, tx => tx.unsafe("SELECT count(*)::int n FROM public.money_day_start_baselines"));
    assert(asA[0].n===1 && asB[0].n===1 && asC[0].n===0, "RLS owner isolation");
    console.log("[RLS] owners A and B see their own baselines; owner C sees none");
    for (const [label, statement, params] of [
      ["cross-owner period", "INSERT INTO public.money_policy_versions(owner_user_id,period_id,version,effective_date,policy) VALUES($1,$2,1,'2026-11-12','{}')", [B,period]],
      ["cross-owner policy baseline", "INSERT INTO public.money_day_start_baselines(owner_user_id,period_id,date,version,policy_version_id,algorithm_version,availability,unavailable_reason) VALUES($1,$2,'2026-11-12',9,$3,'v1','unavailable','unknown')", [A,period,"ffffffff-ffff-4fff-8fff-ffffffffffff"]],
    ]) {
      let denied=false; try { await sql.unsafe(statement,params); } catch(e) { denied=e.code==="23503"; if(!denied) throw e; }
      assert(denied, `${label} foreign key rejects mismatch`);
    }
    console.log("[FK] cross-owner period and invalid policy references rejected");
    console.log("[DONE] MONEY-08 migration 0100 proof passed");
  } finally { await sql.end(); }
}
main().catch(e=>{ console.error(e); exit(1); });
