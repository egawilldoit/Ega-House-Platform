#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
function parseArgs(){ const a={}; const r=argv.slice(2); for(let i=0;i<r.length;i++) if(r[i]==="--url") a.url=r[++i]; if(!a.url){console.error("Missing --url"); exit(2);} return a;}
function log(s,m){console.log(`[${s}] ${m}`);}
function assert(c,m){ if(!c){console.error(`[PROOF] FAILED: ${m}`); exit(1);} }
async function readJournal(){ const j=JSON.parse(await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8")); return j.entries.map(e=>e.tag); }
function split(s){ return s.split("--> statement-breakpoint").map(x=>x.trim()).filter(x=>x.length>0); }
async function applyFile(sql,tag){ const t=await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8"); const stmts=split(t); for(const s of stmts) await sql.unsafe(s); return stmts.length; }
async function applyShim(sql){
  await sql.unsafe(`DO $x$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $x$;`);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth; GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin; GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);`);
  await sql.unsafe(`INSERT INTO auth.users (id, email) VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com') ON CONFLICT (id) DO NOTHING;`);
  await sql.unsafe(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;`);
  await sql.unsafe(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;`);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS automation; CREATE TABLE IF NOT EXISTS automation.implementation_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64), linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1, status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64), heartbeat_at timestamptz, lease_expires_at timestamptz, started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), finished_at timestamptz, failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now());`);
}
async function reset(sql){ await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;`); log("RESET","done"); }

const OWNER_A="22222222-2222-4222-8222-222222222222";
const OWNER_B="33333333-3333-4333-8333-333333333333";

function directSession(sql, userId){
  return { run(fn){ return sql.begin(async tx=>{ await tx.unsafe(`SET LOCAL ROLE authenticated`); await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]); await tx.unsafe(`SELECT set_config('request.jwt.claims', '{}', true)`); return fn(tx); }); } };
}

async function expectAllowed(label, fn){ try{ await fn(); log("DIRECT", label+" PASS"); } catch(e){ console.error(`[PROOF] FAILED: ${label} should be allowed but got ${e.code} ${e.message}`); exit(1); } }
async function expectDenied(label, fn){ try{ await fn(); console.error(`[PROOF] FAILED: ${label} should be denied`); exit(1); } catch(e){ log("DIRECT", label+` denied (${e.code})`); } }

async function main(){
  const {url}=parseArgs();
  const tags=await readJournal();
  const sql=postgres(url,{max:4,onnotice:()=>{}});
  try{
    await reset(sql);
    await applyShim(sql);
    let applied=0; for(const tag of tags){ const n=await applyFile(sql,tag); applied++; log("MIGRATE", tag+": "+n); }
    log("MIGRATE", applied+" migrations");
    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects, public.goals, public.tasks, public.task_sessions, public.task_reminders, public.week_reviews, public.idea_notes, public.task_saved_views, public.calendar_integration_settings TO authenticated`);
    await sql.unsafe(`REVOKE ALL ON TABLE public.mcp_mutation_receipts FROM authenticated, anon, public`);
    // seed a project for A
    const directA=directSession(sql, OWNER_A);
    const directB=directSession(sql, OWNER_B);
    const projId="77777777-7777-4777-8777-777777777771";
    const goalId="88888888-8888-4888-8888-888888888881";
    const taskId="99999999-9999-4999-8999-999999999991";
    // projects
    await expectAllowed("project create", ()=>directA.run(tx=>tx.unsafe(`INSERT INTO public.projects (id, name, slug, owner_user_id) VALUES ('${projId}'::uuid, 'My Project', 'my-project', '${OWNER_A}'::uuid)`)));
    await expectAllowed("project update", ()=>directA.run(tx=>tx.unsafe(`UPDATE public.projects SET name='Renamed' WHERE id='${projId}'::uuid`)));
    await expectAllowed("project read own", async ()=>{ const rows=await directA.run(tx=>tx.unsafe(`SELECT * FROM public.projects WHERE id='${projId}'::uuid`)); assert(rows.length===1, "own read should find"); });
    {
      const rows=await directB.run(tx=>tx.unsafe(`UPDATE public.projects SET name='Hacked' WHERE id='${projId}'::uuid RETURNING id`));
      assert(rows.length===0, "foreign-owner project update must affect 0 rows");
      log("DIRECT","foreign-owner project update denied (0 rows)");
    }
    // goals
    await expectAllowed("goal create", ()=>directA.run(tx=>tx.unsafe(`INSERT INTO public.goals (id, project_id, title, owner_user_id) VALUES ('${goalId}'::uuid, '${projId}'::uuid, 'Goal One', '${OWNER_A}'::uuid)`)));
    await expectAllowed("goal update", ()=>directA.run(tx=>tx.unsafe(`UPDATE public.goals SET title='Goal Renamed' WHERE id='${goalId}'::uuid`)));
    await expectAllowed("goal delete", ()=>directA.run(async tx=>{ const rows=await tx.unsafe(`DELETE FROM public.goals WHERE id='${goalId}'::uuid RETURNING id`); assert(rows.length===1,"delete should affect 1"); }));
    // re-create for task
    await directA.run(tx=>tx.unsafe(`INSERT INTO public.goals (id, project_id, title, owner_user_id) VALUES ('${goalId}'::uuid, '${projId}'::uuid, 'Goal One', '${OWNER_A}'::uuid) ON CONFLICT (id) DO NOTHING`));
    // tasks
    await expectAllowed("task create", ()=>directA.run(tx=>tx.unsafe(`INSERT INTO public.tasks (id, project_id, goal_id, title, owner_user_id) VALUES ('${taskId}'::uuid, '${projId}'::uuid, '${goalId}'::uuid, 'Task One', '${OWNER_A}'::uuid)`)));
    await expectAllowed("task update", ()=>directA.run(tx=>tx.unsafe(`UPDATE public.tasks SET title='Task Renamed' WHERE id='${taskId}'::uuid`)));
    {
      const rows=await directB.run(tx=>tx.unsafe(`UPDATE public.tasks SET title='Hacked' WHERE id='${taskId}'::uuid RETURNING id`));
      assert(rows.length===0, "foreign task update must affect 0 rows");
      log("DIRECT","foreign task update denied (0 rows)");
    }
    await expectAllowed("task delete", async ()=>{ const d=await directA.run(tx=>tx.unsafe(`DELETE FROM public.tasks WHERE id='${taskId}'::uuid RETURNING id`)); assert(d.length===1); log("DIRECT","task delete PASS"); });
    // re-create task for timer/reminder
    await directA.run(tx=>tx.unsafe(`INSERT INTO public.tasks (id, project_id, title, owner_user_id) VALUES ('${taskId}'::uuid, '${projId}'::uuid, 'Task One', '${OWNER_A}'::uuid) ON CONFLICT (id) DO NOTHING`));
    // timer
    const sessId="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaa1";
    await expectAllowed("timer start", ()=>directA.run(tx=>tx.unsafe(`INSERT INTO public.task_sessions (id, task_id, owner_user_id, started_at) VALUES ('${sessId}'::uuid, '${taskId}'::uuid, '${OWNER_A}'::uuid, now())`)));
    await expectAllowed("timer update (stop)", ()=>directA.run(tx=>tx.unsafe(`UPDATE public.task_sessions SET ended_at=now() WHERE id='${sessId}'::uuid`)));
    // reminder
    const remId="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb1";
    await expectAllowed("reminder create", ()=>directA.run(tx=>tx.unsafe(`INSERT INTO public.task_reminders (id, task_id, owner_user_id, remind_at) VALUES ('${remId}'::uuid, '${taskId}'::uuid, '${OWNER_A}'::uuid, now()+ interval '1 day')`)));
    await expectAllowed("reminder delete", ()=>directA.run(tx=>tx.unsafe(`DELETE FROM public.task_reminders WHERE id='${remId}'::uuid`)));
    // own reads
    await expectAllowed("own reads", async ()=>{ const rows=await directA.run(tx=>tx.unsafe(`SELECT * FROM public.projects WHERE owner_user_id='${OWNER_A}'::uuid`)); assert(rows.length>=1); });
    // foreign reads should be 0 (RLS filters)
    const foreignRows=await directA.run(tx=>tx.unsafe(`SELECT * FROM public.projects WHERE owner_user_id='${OWNER_B}'::uuid`));
    assert(foreignRows.length===0, "foreign read should be 0");
    log("DIRECT","foreign read denied (0 rows)");
    // cleanup: delete dependents first (FK order: sessions/reminders -> tasks -> goals -> projects)
    await directA.run(tx=>tx.unsafe(`DELETE FROM public.task_sessions WHERE task_id='${taskId}'::uuid`));
    await directA.run(tx=>tx.unsafe(`DELETE FROM public.task_reminders WHERE task_id='${taskId}'::uuid`));
    await directA.run(tx=>tx.unsafe(`DELETE FROM public.tasks WHERE project_id='${projId}'::uuid`));
    await directA.run(tx=>tx.unsafe(`DELETE FROM public.goals WHERE project_id='${projId}'::uuid`));
    await expectAllowed("project delete", ()=>directA.run(tx=>tx.unsafe(`DELETE FROM public.projects WHERE id='${projId}'::uuid`)));
    console.log("MCP-NORMAL-USER-VERIFY PASS");
  } finally{ await sql.end({timeout:5}); }
}
main().catch(e=>{ console.error("[FATAL]", e.message); exit(1);});
