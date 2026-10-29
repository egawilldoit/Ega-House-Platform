#!/usr/bin/env node
/**
 * Ephemeral-database proof for the archive-centre reconciliation
 * (drizzle/0073_archive_centre.sql) and the parent-ancestry visibility rule.
 *
 * Applies the drizzle migration journal up to 0063, seeds legacy rows that only
 * carry `status = 'archived'`, then applies 0073 and proves:
 *
 *   BACKFILL    - legacy archived projects/goals gain archived_at from
 *                 updated_at, archived_by from the owner, and mixed-case
 *                 markers normalise to the canonical 'archived' value.
 *   INVARIANT   - archived_at and status='archived' cannot disagree: a half
 *                 write is rejected by the CHECK while a paired write passes.
 *   OWNER-SCOPE - a direct authenticated session only reads/updates its own
 *                 archived rows; a foreign owner sees zero rows and changes
 *                 nothing (RLS, no service role).
 *   INDEPENDENCE- restoring a project leaves independently archived children
 *                 and every recorded timer session untouched.
 *   VISIBILITY  - the SQL predicate behind active lists excludes tasks whose
 *                 project/goal is archived, keeps goal-less tasks, and keeps
 *                 tasks under active parents.
 *
 * Usage:
 *   node scripts/db/archive-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script. Only point it
 * at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const ARCHIVE_TAG = "0073_archive_centre";

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
  for (const statement of splitStatements(text)) {
    await sql.unsafe(statement);
  }
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

const F = {
  projectArchived: "20000000-0000-4000-8000-000000000001",
  projectLegacyMixed: "20000000-0000-4000-8000-000000000002",
  projectActive: "20000000-0000-4000-8000-000000000003",
  projectForeign: "20000000-0000-4000-8000-000000000004",
  goalArchived: "20000000-0000-4000-8000-000000000011",
  goalActive: "20000000-0000-4000-8000-000000000012",
  taskUnderArchivedProject: "20000000-0000-4000-8000-000000000021",
  taskUnderArchivedGoal: "20000000-0000-4000-8000-000000000022",
  taskGoalLess: "20000000-0000-4000-8000-000000000023",
  taskArchivedChild: "20000000-0000-4000-8000-000000000024",
  sessionOpen: "20000000-0000-4000-8000-000000000031",
};

const LEGACY_TIME = "2026-04-01T08:00:00.000Z";

async function seedLegacyRows(sql) {
  await sql.unsafe(
    `INSERT INTO public.projects (id, owner_user_id, name, slug, status, updated_at)
     VALUES ($1, $3, 'Legacy archived', 'legacy-archived', 'archived', $4),
            ($2, $3, 'Legacy mixed case', 'legacy-mixed', 'Archived ', $4)`,
    [F.projectArchived, F.projectLegacyMixed, OWNER_A, LEGACY_TIME],
  );
  await sql.unsafe(
    `INSERT INTO public.projects (id, owner_user_id, name, slug, status)
     VALUES ($1, $2, 'Active project', 'active-project', 'active')`,
    [F.projectActive, OWNER_A],
  );
  await sql.unsafe(
    `INSERT INTO public.projects (id, owner_user_id, name, slug, status)
     VALUES ($1, $2, 'Foreign archived', 'foreign-archived', 'archived')`,
    [F.projectForeign, OWNER_B],
  );
  await sql.unsafe(
    `INSERT INTO public.goals (id, owner_user_id, project_id, title, status, updated_at)
     VALUES ($1, $3, $4, 'Legacy archived goal', 'archived', $5),
            ($2, $3, $4, 'Active goal', 'active', $5)`,
    [F.goalArchived, F.goalActive, OWNER_A, F.projectActive, LEGACY_TIME],
  );
  await sql.unsafe(
    `INSERT INTO public.tasks (id, owner_user_id, project_id, goal_id, title, status)
     VALUES ($1, $5, $6, NULL, 'Under archived project', 'todo'),
            ($2, $5, $7, $8, 'Under archived goal', 'todo'),
            ($3, $5, $7, NULL, 'Goal-less task', 'todo'),
            ($4, $5, $6, NULL, 'Independently archived child', 'todo')`,
    [
      F.taskUnderArchivedProject,
      F.taskUnderArchivedGoal,
      F.taskGoalLess,
      F.taskArchivedChild,
      OWNER_A,
      F.projectArchived,
      F.projectActive,
      F.goalArchived,
    ],
  );
  log("SEED", "Legacy status-only archive markers and children ready");
}

// Runs `fn` inside one transaction carrying a transaction-local direct-user
// auth context (JWT sub, no client_id claim), like a Supabase user request.
function directSession(sql, { userId = OWNER_A } = {}, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE authenticated`);
    await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, ["{}"]);
    return fn(tx);
  });
}

// Supabase grants table privileges through default privileges rather than the
// migration journal; mirror that for the proof role after the schema exists.
async function grantProofRolePrivileges(sql) {
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
}

async function capturePostgresCode(fn) {
  try {
    await fn();
  } catch (error) {
    return error?.code ?? "unknown";
  }
  return null;
}

async function getProject(sql, id) {
  const [row] = await sql.unsafe(
    `SELECT status, archived_at, archived_by FROM public.projects WHERE id = $1`,
    [id],
  );
  return row;
}

async function proofBackfill(sql) {
  for (const [id, label] of [
    [F.projectArchived, "legacy project"],
    [F.projectLegacyMixed, "mixed-case project"],
  ]) {
    const row = await getProject(sql, id);
    assert(row?.status === "archived", `${label} status normalised to 'archived'`);
    assert(
      new Date(row.archived_at).toISOString() === LEGACY_TIME,
      `${label} archived_at backfilled from updated_at`,
    );
    assert(row.archived_by === OWNER_A, `${label} archived_by attributed to its owner`);
  }

  const active = await getProject(sql, F.projectActive);
  assert(active.archived_at === null, "active project keeps a null archive marker");

  const [goal] = await sql.unsafe(
    `SELECT status, archived_at, archived_by FROM public.goals WHERE id = $1`,
    [F.goalArchived],
  );
  assert(goal?.status === "archived", "legacy goal status normalised");
  assert(new Date(goal.archived_at).toISOString() === LEGACY_TIME, "legacy goal archived_at backfilled");
  assert(goal.archived_by === OWNER_A, "legacy goal archived_by attributed");
  log("BACKFILL", "Legacy status-only markers reconciled without inventing timestamps");
}

async function proofInvariant(sql) {
  const halfArchive = await capturePostgresCode(() =>
    sql.unsafe(`UPDATE public.projects SET status = 'archived' WHERE id = $1`, [F.projectActive]),
  );
  assert(halfArchive === "23514", `status-only archive rejected by CHECK (got ${halfArchive})`);

  const halfRestore = await capturePostgresCode(() =>
    sql.unsafe(`UPDATE public.projects SET status = 'active' WHERE id = $1`, [F.projectArchived]),
  );
  assert(halfRestore === "23514", `status-only restore rejected by CHECK (got ${halfRestore})`);

  await sql.unsafe(
    `UPDATE public.projects
     SET status = 'archived', archived_at = now(), archived_by = owner_user_id
     WHERE id = $1`,
    [F.projectActive],
  );
  const archived = await getProject(sql, F.projectActive);
  assert(archived.status === "archived" && archived.archived_at !== null, "paired archive accepted");

  await sql.unsafe(
    `UPDATE public.projects SET status = 'active', archived_at = NULL, archived_by = NULL WHERE id = $1`,
    [F.projectActive],
  );
  const restored = await getProject(sql, F.projectActive);
  assert(restored.status === "active" && restored.archived_at === null, "paired restore accepted");

  const goalHalf = await capturePostgresCode(() =>
    sql.unsafe(`UPDATE public.goals SET archived_at = now() WHERE id = $1`, [F.goalActive]),
  );
  assert(goalHalf === "23514", `goal metadata-only archive rejected by CHECK (got ${goalHalf})`);
  log("INVARIANT", "Archive marker and status can only move together");
}

async function proofOwnerScope(sql) {
  const ownCount = await directSession(sql, {}, (tx) =>
    tx.unsafe(`SELECT count(*)::int AS n FROM public.projects WHERE id = $1`, [F.projectArchived]),
  );
  assert(ownCount[0]?.n === 1, "owner reads their own archived project");

  const foreignRead = await directSession(sql, { userId: OWNER_B }, (tx) =>
    tx.unsafe(`SELECT count(*)::int AS n FROM public.projects WHERE id = $1`, [F.projectArchived]),
  );
  assert(foreignRead[0]?.n === 0, "foreign owner cannot read another owner's archived project");

  const foreignWrite = await directSession(sql, { userId: OWNER_B }, (tx) =>
    tx.unsafe(
      `UPDATE public.projects SET status = 'active', archived_at = NULL WHERE id = $1 RETURNING id`,
      [F.projectArchived],
    ),
  );
  assert(foreignWrite.length === 0, "foreign owner cannot restore another owner's project");
  const intact = await getProject(sql, F.projectArchived);
  assert(intact.status === "archived" && intact.archived_at !== null, "foreign write changed nothing");
  log("OWNER-SCOPE", "RLS keeps archived reads and restores inside the owner");
}

async function proofIndependence(sql) {
  await sql.unsafe(
    `UPDATE public.tasks SET archived_at = now(), archived_by = $2 WHERE id = $1`,
    [F.taskArchivedChild, OWNER_A],
  );
  await sql.unsafe(
    `INSERT INTO public.task_sessions (id, owner_user_id, task_id, started_at, ended_at)
     VALUES ($1, $2, $3, now() - interval '1 hour', now())`,
    [F.sessionOpen, OWNER_A, F.taskArchivedChild],
  );

  const before = await sql.unsafe(
    `SELECT id, archived_at FROM public.tasks ORDER BY id`,
  );
  const sessionsBefore = await sql.unsafe(`SELECT count(*)::int AS n FROM public.task_sessions`);

  // Restore the parent project exactly as the archive centre does: one row,
  // archive metadata and status together.
  await sql.unsafe(
    `UPDATE public.projects SET status = 'active', archived_at = NULL, archived_by = NULL
     WHERE id = $1`,
    [F.projectArchived],
  );

  const after = await sql.unsafe(`SELECT id, archived_at FROM public.tasks ORDER BY id`);
  const sessionsAfter = await sql.unsafe(`SELECT count(*)::int AS n FROM public.task_sessions`);

  const archivedChild = after.find((row) => row.id === F.taskArchivedChild);
  assert(archivedChild?.archived_at !== null, "restoring a parent leaves an archived child archived");
  for (const row of before) {
    const next = after.find((candidate) => candidate.id === row.id);
    assert(
      JSON.stringify(row.archived_at) === JSON.stringify(next?.archived_at),
      `task ${row.id} archive state unchanged by parent restore`,
    );
  }
  assert(
    sessionsBefore[0]?.n === sessionsAfter[0]?.n && sessionsAfter[0]?.n === 1,
    "recorded timer sessions survive archive and restore",
  );
  log("INDEPENDENCE", "Parent restore never resurrects children or deletes evidence");
}

async function proofVisibility(sql) {
  // Mirrors the predicate the task reads apply: archived task rows are out,
  // and a project/goal ancestor that is archived hides its children while
  // goal-less tasks and active-parent tasks stay.
  const rows = await sql.unsafe(`
    SELECT t.id
    FROM public.tasks t
    LEFT JOIN public.goals g ON g.id = t.goal_id
    WHERE t.archived_at IS NULL
      AND t.project_id NOT IN (
        SELECT id FROM public.projects WHERE archived_at IS NOT NULL
      )
      AND (t.goal_id IS NULL OR g.archived_at IS NULL)
    ORDER BY t.id
  `);
  const visible = rows.map((row) => row.id);

  assert(!visible.includes(F.taskUnderArchivedProject), "task under archived project is hidden");
  assert(!visible.includes(F.taskUnderArchivedGoal), "task under archived goal is hidden");
  assert(!visible.includes(F.taskArchivedChild), "individually archived task is hidden");
  assert(visible.includes(F.taskGoalLess), "goal-less task under an active project stays visible");
  log("VISIBILITY", "Archived ancestry is excluded while goal-less work stays visible");
}

async function main() {
  const args = parseArgs();
  const sql = postgres(args.url, { max: 1, onnotice: () => {} });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    const tags = await readJournal();
    const archiveIndex = tags.indexOf(ARCHIVE_TAG);
    assert(archiveIndex > 0, `journal includes ${ARCHIVE_TAG} after a base migration`);

    for (const tag of tags.slice(0, archiveIndex)) {
      await applyFile(sql, tag);
    }
    log("MIGRATE", `journal applied up to the tag before ${ARCHIVE_TAG}`);

    await seedLegacyRows(sql);
    await applyFile(sql, ARCHIVE_TAG);
    // Newer migrations may exist after this one; this proof owns the upgrade
    // path INTO the archive migration, not the repository head. Any later tag
    // is covered by its own journal proof.
    log(
      "MIGRATE",
      `${ARCHIVE_TAG} (position ${archiveIndex + 1}/${tags.length}) applied over legacy data`,
    );

    await grantProofRolePrivileges(sql);

    await proofBackfill(sql);
    await proofInvariant(sql);
    await proofOwnerScope(sql);
    await proofVisibility(sql);
    await proofIndependence(sql);

    console.log("[PROOF] ARCHIVE-INVARIANTS VERIFIED");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
