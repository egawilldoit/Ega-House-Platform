#!/usr/bin/env node
/**
 * Ephemeral-database migration proof for the task_sessions single-open-timer
 * invariant.
 *
 * Applies the full drizzle migration journal (plus a minimal Supabase shim:
 * auth schema, auth.uid()/auth.jwt() stubs, Supabase roles, one auth.users row
 * required by 0043) to a disposable Postgres, then proves:
 *
 *   RED   - before the invariant migration, two concurrent INSERTs of an open
 *           session for the same owner both succeed (race surface exists).
 *   GREEN - after the invariant migration, exactly one of the concurrent
 *           inserts survives and the loser observes SQLSTATE 23505.
 *   CLOSED-SESSION FREEDOM - multiple closed sessions per owner, start after
 *           stop, and distinct owners with open sessions all keep working.
 *   RLS   - pg_policies and relrowsecurity/relforcerowsecurity for
 *           task_sessions are identical before and after the migration.
 *   IDEMPOTENCE - re-applying the migration file succeeds (up-only).
 *
 * Usage:
 *   node scripts/db/timer-invariant-verify.mjs --url <postgres-url> \
 *     [--race-migration 0044_task_sessions_owner_open_unique]
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

function parseArgs() {
  const args = { raceMigration: "0044_task_sessions_owner_open_unique" };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
    if (rest[i] === "--race-migration") args.raceMigration = rest[++i];
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
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  // Migration 0043 requires exactly one reconciliation owner row to exist.
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$ SELECT '{}'::jsonb $fn$;
  `);
  // Migrations 0035+ alter automation.implementation_runs additively and
  // document that its base table predates the journal ("already exist in
  // production via manual/supabase setup"). The proof harness stands in the
  // Runner's documented base columns so those additive migrations and their
  // indexes still apply end-to-end.
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

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444441";
const TASK_ID = "44444444-4444-4444-8444-444444444444";

async function insertOpenSessionConcurrently(sql, ownerUserId) {
  const barrier = new Promise((resolve) => setTimeout(resolve, 50));
  const attempt = async () => {
    await barrier;
    try {
      await sql`
        INSERT INTO task_sessions (owner_user_id, task_id, started_at)
        VALUES (${ownerUserId}::uuid, ${TASK_ID}::uuid, now())
      `;
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error?.code ?? null };
    }
  };
  return Promise.all([attempt(), attempt()]);
}

async function countOpenSessions(sql, ownerUserId) {
  const [row] = await sql`
    SELECT count(*)::int AS count FROM task_sessions
    WHERE owner_user_id = ${ownerUserId}::uuid AND ended_at IS NULL
  `;
  return row.count;
}

async function snapshotTimerRls(sql) {
  const policies = await sql`
    SELECT policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_sessions'
    ORDER BY policyname
  `;
  const tableFlags = await sql`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public.task_sessions'::regclass
  `;
  return { policies, tableFlags };
}

async function seedTask(sql) {
  await sql`
    INSERT INTO projects (id, name, slug, created_at, updated_at)
    VALUES (${PROJECT_ID}::uuid, 'Proof project', 'proof-project', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
  // owner_user_id is nullable with a default of auth.uid(); the proof inserts
  // explicit owners because that is what every application write path does.
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_ID}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Proof task', 'todo', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function runRedPhase(sql) {
  await seedTask(sql);
  const results = await insertOpenSessionConcurrently(sql, OWNER_A);
  const survivors = await countOpenSessions(sql, OWNER_A);
  const bothSucceeded = results.every((result) => result.ok);
  if (!bothSucceeded || survivors !== 2) {
    console.error(
      `[RED] UNEXPECTED: pre-migration state did not reproduce the duplicate-open surface ` +
        `(attempts=${JSON.stringify(results)}, surviving open rows=${survivors}).`,
    );
    exit(1);
  }
  log(
    "RED",
    `Race proven pre-migration: both concurrent inserts succeeded, ${survivors} open rows for one owner.`,
  );
  await sql`DELETE FROM task_sessions`;
}

async function runGreenPhase(sql) {
  const results = await insertOpenSessionConcurrently(sql, OWNER_A);
  const survivors = await countOpenSessions(sql, OWNER_A);
  const winners = results.filter((result) => result.ok).length;
  const losers = results.filter((result) => !result.ok && result.code === "23505").length;

  if (winners !== 1 || losers !== 1 || survivors !== 1) {
    console.error(
      `[GREEN] FAILED: expected exactly one winner, one 23505 loser, one surviving row; got ` +
        `${JSON.stringify({ winners, losers, survivors })}.`,
    );
    exit(1);
  }
  log(
    "GREEN",
    `Invariant enforced: one winner, loser received SQLSTATE 23505, ${survivors} open row survives.`,
  );

  const otherOwnerResults = await insertOpenSessionConcurrently(sql, OWNER_B);
  if (otherOwnerResults.filter((result) => result.ok).length !== 1) {
    console.error("[GREEN] FAILED: a different owner could not hold their own open session.");
    exit(1);
  }
  const otherOwnerOpen = await countOpenSessions(sql, OWNER_B);
  if (otherOwnerOpen !== 1) {
    console.error(`[GREEN] FAILED: other-owner open count is ${otherOwnerOpen}, expected 1.`);
    exit(1);
  }
  log("GREEN", "Distinct owners each hold exactly one open session.");

  // Closed sessions must remain unrestricted for the same owner.
  for (let i = 0; i < 3; i += 1) {
    await sql`
      INSERT INTO task_sessions (owner_user_id, task_id, started_at, ended_at, duration_seconds)
      VALUES (${OWNER_A}::uuid, ${TASK_ID}::uuid, now() - interval '3 hours', now() - interval '2 hours', 3600)
    `;
  }
  log("GREEN", "Multiple closed sessions per owner allowed.");

  // Start-after-stop must work: close the remaining open session, start again.
  await sql`
    UPDATE task_sessions
    SET ended_at = now(), duration_seconds = 60
    WHERE owner_user_id = ${OWNER_A}::uuid AND ended_at IS NULL
  `;
  await sql`
    INSERT INTO task_sessions (owner_user_id, task_id, started_at)
    VALUES (${OWNER_A}::uuid, ${TASK_ID}::uuid, now())
  `;
  const reopened = await countOpenSessions(sql, OWNER_A);
  if (reopened !== 1) {
    console.error(`[GREEN] FAILED: start-after-stop produced ${reopened} open rows, expected 1.`);
    exit(1);
  }
  log("GREEN", "Start-after-stop works; index does not block closed sessions.");
}

async function main() {
  const { url, raceMigration } = parseArgs();
  const tags = await readJournal();
  if (!tags.includes(raceMigration)) {
    console.error(`Unknown --race-migration tag '${raceMigration}'. Known tags: ${tags.join(", ")}`);
    exit(2);
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      if (tag === raceMigration) continue;
      const statements = await applyFile(sql, tag);
      applied += 1;
      log("MIGRATE", `${tag}: ${statements} statement(s) applied`);
    }
    log("MIGRATE", `${applied} baseline migrations applied (excluding ${raceMigration})`);

    const rlsBefore = await snapshotTimerRls(sql);
    await runRedPhase(sql);

    const statements = await applyFile(sql, raceMigration);
    log("MIGRATE", `${raceMigration}: ${statements} statement(s) applied`);

    const rlsAfter = await snapshotTimerRls(sql);
    if (JSON.stringify(rlsBefore) !== JSON.stringify(rlsAfter)) {
      console.error("[RLS] FAILED: task_sessions policies or flags changed during migration.");
      console.error("before:", JSON.stringify(rlsBefore, null, 2));
      console.error("after:", JSON.stringify(rlsAfter, null, 2));
      exit(1);
    }
    if (rlsAfter.policies.length === 0 || !rlsAfter.tableFlags[0]?.relrowsecurity) {
      console.error("[RLS] FAILED: task_sessions has no policies or RLS disabled after migration.");
      exit(1);
    }
    log(
      "RLS",
      `task_sessions RLS intact: ${rlsAfter.policies.length} policies, relrowsecurity=${rlsAfter.tableFlags[0].relrowsecurity}, relforcerowsecurity=${rlsAfter.tableFlags[0].relforcerowsecurity}`,
    );

    await runGreenPhase(sql);

    const reappliedStatements = await applyFile(sql, raceMigration);
    log(
      "IDEMPOTENCE",
      `Re-applied ${raceMigration} (${reappliedStatements} statement(s)); up-only convention holds.`,
    );

    console.log("TIMER-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
