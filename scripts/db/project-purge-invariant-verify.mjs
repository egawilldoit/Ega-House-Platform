#!/usr/bin/env node
/**
 * Ephemeral-database proof for the archived project purge RPC
 * (drizzle/0062_project_purge.sql).
 *
 * Applies the full drizzle migration journal (plus a minimal Supabase shim:
 * auth schema, GUC-backed auth.uid()/auth.jwt() stubs, Supabase roles, one
 * auth.users row required by 0043, and the automation.implementation_runs
 * stand-in) to a disposable Postgres, then executes
 * public.purge_archived_project(...) as a direct authenticated user:
 *
 *   PURGE-MAIN   - archived project with goal, tasks, open+closed sessions,
 *                  external ref, reminder, recurrence, idea note, saved view,
 *                  task notification + delivery, calendar events, one
 *                  exhausted failed delete job and one pending delete job:
 *                  everything project-owned disappears atomically, notes/views
 *                  unlink, audit/proposal history survives, exactly one fresh
 *                  pending delete job is enqueued (for the exhausted case)
 *                  and no duplicate is added for the pending case.
 *   NOT-ARCHIVED - active project purge returns not_archived, nothing deleted.
 *   CONFIRMATION - wrong project name returns confirmation_mismatch, intact.
 *   COUNT-CHANGE - stale expected counts return contents_changed with fresh
 *                  counts, nothing deleted.
 *   OAUTH-DENIED - a client_id JWT context raises SQLSTATE 42501.
 *   OTHER-OWNER  - a foreign project returns not_found, nothing deleted.
 *   ROLLBACK     - an induced mid-purge FK failure aborts the whole
 *                  transaction (all rows remain), then the purge succeeds
 *                  after the blocker is removed.
 *
 * Usage:
 *   node scripts/db/project-purge-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
  }
  if (!args.url) {
    console.error("Missing required --url <postgres-url>");
    exit(2);
  }
  return args;
}

function log(section, message) {
  console.log(`[${section}] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[PROOF] FAILED: ${message}`);
    exit(1);
  }
}

async function readJournal() {
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"));
  return journal.entries.map((entry) => entry.tag);
}

function splitStatements(sqlText) {
  return sqlText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyFile(sql, tag) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  const statements = splitStatements(text);
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
  return statements.length;
}

async function applySupabaseShim(sql) {
  await sql.unsafe(`
    DO $shim$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
        CREATE ROLE supabase_auth_admin NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END
    $shim$;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $fn$;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS automation;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS automation.implementation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar(64),
      linear_issue_id varchar(64),
      linear_issue_identifier varchar(64),
      linear_issue_url text,
      attempt_number integer NOT NULL DEFAULT 1,
      status varchar(48) NOT NULL DEFAULT 'queued',
      claimed_by varchar(64),
      heartbeat_at timestamptz,
      lease_expires_at timestamptz,
      started_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      finished_at timestamptz,
      failure_code varchar(64),
      pr_number bigint,
      created_at timestamptz DEFAULT now()
    );
  `);
  log("SHIM", "Supabase compatibility objects ready");
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
  log("RESET", "Database schemas dropped and recreated");
}

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const P0 = {
  project: "10000000-0000-4000-8000-000000000000",
  name: "Stage CGI",
  goal: "10000000-0000-4000-8000-000000000001",
  task1: "10000000-0000-4000-8000-000000000011",
  task2: "10000000-0000-4000-8000-000000000012",
  sessionOpen: "10000000-0000-4000-8000-000000000021",
  sessionClosed: "10000000-0000-4000-8000-000000000022",
  extRef: "10000000-0000-4000-8000-000000000031",
  reminder: "10000000-0000-4000-8000-000000000041",
  recurrence: "10000000-0000-4000-8000-000000000051",
  note: "10000000-0000-4000-8000-000000000061",
  view: "10000000-0000-4000-8000-000000000071",
  notification: "10000000-0000-4000-8000-000000000081",
  delivery: "10000000-0000-4000-8000-000000000091",
  calExhausted: "10000000-0000-4000-8000-0000000000a1",
  calPending: "10000000-0000-4000-8000-0000000000a2",
  auditEvent: "10000000-0000-4000-8000-0000000000b1",
  proposal: "10000000-0000-4000-8000-0000000000c1",
};

// Runs `fn` inside one transaction carrying a transaction-local direct-user
// auth context (request.jwt.claim.sub, no client_id claim), matching how the
// purge RPC reads auth.uid()/auth.jwt() in Supabase.
function directSession(sql, { userId = OWNER_A } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, ["{}"]);
        return fn(tx);
      });
    },
  };
}

function oauthSession(sql, { userId = OWNER_A, clientId = "purge-proof-client" } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ client_id: clientId }),
        ]);
        return fn(tx);
      });
    },
  };
}

async function callPurge(conn, projectId, confirmationName, expectedTasks, expectedGoals) {
  const [row] = await conn.unsafe(
    `SELECT public.purge_archived_project($1, $2, $3, $4) AS result`,
    [projectId, confirmationName, expectedTasks, expectedGoals],
  );
  return row?.result;
}

async function capturePostgresCode(fn) {
  try {
    await fn();
  } catch (error) {
    return error?.code ?? "unknown";
  }
  return null;
}

async function countWhere(sql, table, column, value) {
  const rows = await sql.unsafe(
    `SELECT count(*)::int AS n FROM public.${table} WHERE ${column} = $1`,
    [value],
  );
  return rows[0]?.n ?? 0;
}

async function seedMainFixture(sql) {
  await sql.unsafe(
    `INSERT INTO public.projects (id, owner_user_id, name, slug, status)
     VALUES ($1, $2, 'Stage CGI', 'stage-cgi', 'archived')`,
    [P0.project, OWNER_A],
  );
  await sql.unsafe(
    `INSERT INTO public.goals (id, owner_user_id, project_id, title, status)
     VALUES ($1, $2, $3, 'Finish set', 'active')`,
    [P0.goal, OWNER_A, P0.project],
  );
  await sql.unsafe(
    `INSERT INTO public.tasks (id, owner_user_id, project_id, title, status, calendar_event_id)
     VALUES ($1, $2, $3, 'Build flats', 'todo', 'google-event-1'),
            ($4, $2, $3, 'Paint backdrop', 'todo', 'google-event-2')`,
    [P0.task1, OWNER_A, P0.project, P0.task2],
  );
  await sql.unsafe(
    `INSERT INTO public.task_sessions (id, owner_user_id, task_id, started_at, ended_at)
     VALUES ($1, $2, $3, now() - interval '1 hour', NULL),
            ($4, $2, $3, now() - interval '3 hour', now() - interval '2 hour')`,
    [P0.sessionOpen, OWNER_A, P0.task1, P0.sessionClosed],
  );
  await sql.unsafe(
    `INSERT INTO public.task_external_refs (id, owner_user_id, task_id, source, source_id)
     VALUES ($1, $2, $3, 'linear', 'EGA-1')`,
    [P0.extRef, OWNER_A, P0.task1],
  );
  await sql.unsafe(
    `INSERT INTO public.task_reminders (id, owner_user_id, task_id, remind_at)
     VALUES ($1, $2, $3, now() + interval '1 day')`,
    [P0.reminder, OWNER_A, P0.task1],
  );
  await sql.unsafe(
    `INSERT INTO public.task_recurrences (id, owner_user_id, task_id, rule, anchor_date, timezone, next_occurrence_date)
     VALUES ($1, $2, $3, 'weekly', CURRENT_DATE, 'UTC', CURRENT_DATE + 7)`,
    [P0.recurrence, OWNER_A, P0.task1],
  );
  await sql.unsafe(
    `INSERT INTO public.idea_notes (id, owner_user_id, title, project_id)
     VALUES ($1, $2, 'Set idea', $3)`,
    [P0.note, OWNER_A, P0.project],
  );
  await sql.unsafe(
    `INSERT INTO public.task_saved_views (id, owner_user_id, name, project_id, goal_id)
     VALUES ($1, $2, 'Set view', $3, $4)`,
    [P0.view, OWNER_A, P0.project, P0.goal],
  );
  await sql.unsafe(
    `INSERT INTO public.notifications (id, owner_user_id, type, title, target_type, target_id, idempotency_key)
     VALUES ($1, $2, 'task_reminder', 'Reminder', 'task', $3, 'purge-proof-note-1')`,
    [P0.notification, OWNER_A, P0.task1],
  );
  await sql.unsafe(
    `INSERT INTO public.notification_deliveries (id, notification_id, owner_user_id, channel, provider, status)
     VALUES ($1, $2, $3, 'email', 'resend', 'queued')`,
    [P0.delivery, P0.notification, OWNER_A],
  );
  // Exhausted failed delete job (attempts at the worker ceiling): purge must
  // enqueue a fresh actionable job instead of suppressing on it.
  await sql.unsafe(
    `INSERT INTO public.calendar_sync_jobs (id, owner_user_id, task_id, calendar_event_id, operation, status, attempts)
     VALUES ($1, $2, $3, 'google-event-1', 'delete', 'failed', 5)`,
    [P0.calExhausted, OWNER_A, P0.task1],
  );
  // Live pending delete job: purge must NOT duplicate it.
  await sql.unsafe(
    `INSERT INTO public.calendar_sync_jobs (id, owner_user_id, task_id, calendar_event_id, operation, status, attempts)
     VALUES ($1, $2, $3, 'google-event-2', 'delete', 'pending', 0)`,
    [P0.calPending, OWNER_A, P0.task2],
  );
  await sql.unsafe(
    `INSERT INTO public.agent_integration_events (id, owner_user_id, token_id, action, resource_type, resource_id, outcome)
     VALUES ($1, $2, $3, 'task_update', 'task', $4, 'success')`,
    [P0.auditEvent, OWNER_A, P0.auditEvent, P0.task1],
  );
  await sql.unsafe(
    `INSERT INTO public.operator_proposals (id, revision, owner_user_id, local_date, time_context_id, baseline_hash, proposed_task_ids, idempotency_key)
     VALUES ($1, 1, $2, CURRENT_DATE, 'morning', 'hash-1', $3, 'purge-proof-op-1')`,
    [P0.proposal, OWNER_A, JSON.stringify([P0.task1])],
  );
  log("SEED", "main purge fixture ready");
}

async function assertPurgeMain(sql) {
  const result = await directSession(sql).run((tx) =>
    callPurge(tx, P0.project, "Stage CGI", 2, 1),
  );
  assert(result?.status === "purged", `expected purged, got ${JSON.stringify(result)}`);
  assert(result.tasks_deleted === 2, `tasks_deleted must be 2, got ${JSON.stringify(result)}`);
  assert(result.goals_deleted === 1, `goals_deleted must be 1, got ${JSON.stringify(result)}`);
  assert(result.sessions_deleted === 2, `sessions_deleted must be 2, got ${JSON.stringify(result)}`);
  assert(result.notifications_deleted === 1, `notifications_deleted must be 1, got ${JSON.stringify(result)}`);
  assert(
    result.calendar_delete_jobs_enqueued === 1,
    `calendar_delete_jobs_enqueued must be 1, got ${JSON.stringify(result)}`,
  );

  for (const [table, column, id] of [
    ["projects", "id", P0.project],
    ["goals", "id", P0.goal],
    ["tasks", "id", P0.task1],
    ["tasks", "id", P0.task2],
    ["task_sessions", "id", P0.sessionOpen],
    ["task_sessions", "id", P0.sessionClosed],
    ["task_external_refs", "id", P0.extRef],
    ["task_reminders", "id", P0.reminder],
    ["task_recurrences", "id", P0.recurrence],
    ["notifications", "id", P0.notification],
    ["notification_deliveries", "id", P0.delivery],
  ]) {
    assert((await countWhere(sql, table, column, id)) === 0, `${table} ${id} must be deleted`);
  }

  const notes = await sql.unsafe(`SELECT project_id FROM public.idea_notes WHERE id = $1`, [P0.note]);
  assert(notes.length === 1 && notes[0]?.project_id === null, "idea note must survive unlinked");
  const views = await sql.unsafe(
    `SELECT project_id, goal_id FROM public.task_saved_views WHERE id = $1`,
    [P0.view],
  );
  assert(
    views.length === 1 && views[0]?.project_id === null && views[0]?.goal_id === null,
    "saved view must survive with project_id and goal_id NULL",
  );
  assert((await countWhere(sql, "agent_integration_events", "id", P0.auditEvent)) === 1, "audit event must survive");
  assert((await countWhere(sql, "operator_proposals", "id", P0.proposal)) === 1, "proposal must survive");

  const jobs = await sql.unsafe(
    `SELECT id, task_id, calendar_event_id, operation, status, attempts
     FROM public.calendar_sync_jobs
     WHERE owner_user_id = $1
     ORDER BY created_at`,
    [OWNER_A],
  );
  const fresh = jobs.filter((job) => job.status === "pending" && job.task_id === P0.task1);
  assert(
    fresh.length === 1
      && fresh[0]?.calendar_event_id === "google-event-1"
      && fresh[0]?.operation === "delete",
    `exactly one fresh pending delete job must exist for the exhausted task, got ${JSON.stringify(jobs)}`,
  );
  const pendingDupes = jobs.filter((job) => job.status === "pending" && job.task_id === P0.task2);
  assert(
    pendingDupes.length === 1 && pendingDupes[0]?.id === P0.calPending,
    `pending delete job must not be duplicated, got ${JSON.stringify(jobs)}`,
  );
  assert(
    jobs.some((job) => job.id === P0.calExhausted && job.status === "failed"),
    "exhausted failed job history must be preserved untouched",
  );
  log("PURGE-MAIN", "atomic purge proven: deletes, preservations, and calendar dedup");
}

async function seedGuardFixture(sql, suffix, name, status, taskCount) {
  const project = `20000000-0000-4000-8000-0000000000${suffix}`;
  await sql.unsafe(
    `INSERT INTO public.projects (id, owner_user_id, name, slug, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [project, OWNER_A, name, `guard-${suffix}`, status],
  );
  for (let index = 0; index < taskCount; index += 1) {
    await sql.unsafe(
      `INSERT INTO public.tasks (id, owner_user_id, project_id, title, status)
       VALUES (gen_random_uuid(), $1, $2, 'Guard task', 'todo')`,
      [OWNER_A, project],
    );
  }
  return project;
}

async function assertGuardCases(sql) {
  const activeProject = await seedGuardFixture(sql, "a1", "Active Guard", "active", 1);
  const activeResult = await directSession(sql).run((tx) =>
    callPurge(tx, activeProject, "Active Guard", 1, 0),
  );
  assert(activeResult?.status === "not_archived", `expected not_archived, got ${JSON.stringify(activeResult)}`);
  assert((await countWhere(sql, "projects", "id", activeProject)) === 1, "active project must survive");
  assert((await countWhere(sql, "tasks", "project_id", activeProject)) === 1, "active tasks must survive");

  const guarded = await seedGuardFixture(sql, "b2", "Guarded Name", "archived", 1);
  const wrongName = await directSession(sql).run((tx) =>
    callPurge(tx, guarded, "Wrong Name", 1, 0),
  );
  assert(
    wrongName?.status === "confirmation_mismatch",
    `expected confirmation_mismatch, got ${JSON.stringify(wrongName)}`,
  );
  const staleCounts = await directSession(sql).run((tx) =>
    callPurge(tx, guarded, "Guarded Name", 9, 9),
  );
  assert(
    staleCounts?.status === "contents_changed"
      && staleCounts?.task_count === 1
      && staleCounts?.goal_count === 0,
    `expected contents_changed with fresh counts, got ${JSON.stringify(staleCounts)}`,
  );
  assert((await countWhere(sql, "projects", "id", guarded)) === 1, "guarded project must survive");
  assert((await countWhere(sql, "tasks", "project_id", guarded)) === 1, "guarded tasks must survive");

  const oauthCode = await capturePostgresCode(() =>
    oauthSession(sql).run((tx) => callPurge(tx, guarded, "Guarded Name", 1, 0)),
  );
  assert(oauthCode === "42501", `OAuth context must raise 42501, got ${oauthCode}`);

  const foreignResult = await directSession(sql, { userId: OWNER_B }).run((tx) =>
    callPurge(tx, guarded, "Guarded Name", 1, 0),
  );
  assert(foreignResult?.status === "not_found", `expected not_found, got ${JSON.stringify(foreignResult)}`);
  assert((await countWhere(sql, "projects", "id", guarded)) === 1, "foreign purge must delete nothing");
  log("GUARDS", "not_archived, confirmation, counts, OAuth, and owner guards proven");
}

async function assertRollback(sql) {
  const project = await seedGuardFixture(sql, "c3", "Rollback Guard", "archived", 1);
  const [task] = await sql.unsafe(`SELECT id FROM public.tasks WHERE project_id = $1`, [project]);
  const [goal] = await sql.unsafe(
    `INSERT INTO public.goals (owner_user_id, project_id, title, status)
     VALUES ($1, $2, 'Rollback goal', 'active') RETURNING id`,
    [OWNER_A, project],
  );
  await sql.unsafe(`CREATE TABLE public.purge_proof_blocker (task_id uuid REFERENCES public.tasks(id))`);
  await sql.unsafe(`INSERT INTO public.purge_proof_blocker (task_id) VALUES ($1)`, [task.id]);

  const code = await capturePostgresCode(() =>
    directSession(sql).run((tx) => callPurge(tx, project, "Rollback Guard", 1, 1)),
  );
  assert(code === "23503", `induced failure must raise 23503, got ${code}`);
  assert((await countWhere(sql, "projects", "id", project)) === 1, "project must survive rollback");
  assert((await countWhere(sql, "tasks", "project_id", project)) === 1, "tasks must survive rollback");
  assert((await countWhere(sql, "goals", "id", goal.id)) === 1, "goals must survive rollback");

  await sql.unsafe(`DROP TABLE public.purge_proof_blocker`);
  const result = await directSession(sql).run((tx) =>
    callPurge(tx, project, "Rollback Guard", 1, 1),
  );
  assert(result?.status === "purged", `expected purged after blocker removal, got ${JSON.stringify(result)}`);
  assert((await countWhere(sql, "projects", "id", project)) === 0, "project must purge after blocker removal");
  log("ROLLBACK", "mid-purge failure rolls back everything");
}

async function main() {
  const { url } = parseArgs();
  const sql = postgres(url, { max: 4 });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    const tags = await readJournal();
    assert(tags[tags.length - 1] === "0062_project_purge", "journal must end with the purge migration");
    let applied = 0;
    for (const tag of tags) {
      const statements = await applyFile(sql, tag);
      applied += 1;
      if (tag === "0062_project_purge") {
        log("MIGRATE", `${tag}: ${statements} statement(s) applied on real Postgres`);
      }
    }
    log("MIGRATE", `${applied} journal migrations applied`);

    await seedMainFixture(sql);
    await assertPurgeMain(sql);
    await assertGuardCases(sql);
    await assertRollback(sql);

    console.log("PROJECT-PURGE-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
