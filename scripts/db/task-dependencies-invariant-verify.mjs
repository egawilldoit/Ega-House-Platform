#!/usr/bin/env node
/**
 * Ephemeral-database proof for EGA-794 task dependencies and date windows.
 *
 * Applies the full drizzle journal (plus the standard Supabase shim) to a
 * disposable Postgres, then proves:
 *
 *   DATE WINDOW - due < start is rejected; same-day and nullable start/due are
 *                 allowed; unrelated task rows still update.
 *   SELF        - a task cannot be blocked by itself.
 *   CYCLE       - a direct reverse edge and an indirect chain edge are rejected.
 *   CONCURRENT  - two racing reverse-edge inserts cannot both commit; the
 *                 per-owner advisory lock serializes them and the loser sees
 *                 the committed edge.
 *   CROSS-OWNER - an edge with a forged other-owner endpoint fails at
 *                 persistence, and RLS hides/denies the other owner's edges.
 *   DUPLICATE   - the owner/edge unique index rejects the same edge twice.
 *   CASCADE     - deleting a task removes its edges.
 *   IDEMPOTENCE - re-applying the migration succeeds.
 *
 * Usage:
 *   node scripts/db/task-dependencies-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION = "0071_task_start_date_dependencies";

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_A = "44444444-4444-4444-8444-444444444441";
const PROJECT_B = "44444444-4444-4444-8444-444444444442";
const TASK_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TASK_B = "aaaaaaaa-0000-4000-8000-00000000000b";
const TASK_C = "aaaaaaaa-0000-4000-8000-00000000000c";
const TASK_D = "aaaaaaaa-0000-4000-8000-00000000000d";
const TASK_E = "aaaaaaaa-0000-4000-8000-00000000000e";
const TASK_F = "aaaaaaaa-0000-4000-8000-00000000000f";
const TASK_X = "bbbbbbbb-0000-4000-8000-00000000000b";

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--url") args.url = rest[++index];
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

function fail(section, message) {
  console.error(`[${section}] FAILED: ${message}`);
  exit(1);
}

function assert(condition, section, message) {
  if (!condition) fail(section, message);
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
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END
    $shim$;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);
  `);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;`);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS automation;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS automation.implementation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64),
      linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1,
      status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64),
      heartbeat_at timestamptz, lease_expires_at timestamptz, started_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(), finished_at timestamptz, failure_code varchar(64),
      pr_number bigint, created_at timestamptz DEFAULT now()
    );
  `);
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
  log("RESET", "Database schemas dropped and recreated");
}

function directSession(sql, userId) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', '{}', true)`);
        return fn(tx);
      });
    },
  };
}

async function seed(sql) {
  await sql`
    INSERT INTO public.projects (id, name, slug, owner_user_id)
    VALUES
      (${PROJECT_A}::uuid, 'Owner A project', 'owner-a-project', ${OWNER_A}::uuid),
      (${PROJECT_B}::uuid, 'Owner B project', 'owner-b-project', ${OWNER_B}::uuid)
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO public.tasks (id, project_id, owner_user_id, title, status)
    VALUES
      (${TASK_A}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'A', 'todo'),
      (${TASK_B}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'B', 'todo'),
      (${TASK_C}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'C', 'todo'),
      (${TASK_D}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'D', 'todo'),
      (${TASK_E}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'E', 'todo'),
      (${TASK_F}::uuid, ${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'F', 'todo'),
      (${TASK_X}::uuid, ${PROJECT_B}::uuid, ${OWNER_B}::uuid, 'X', 'todo')
    ON CONFLICT (id) DO NOTHING
  `;
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.projects, public.tasks, public.task_dependencies
    TO authenticated
  `);
  log("SEED", "Two owners, projects and tasks seeded");
}

async function expectFailure(section, label, fn, expectedCodes) {
  try {
    await fn();
  } catch (error) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? error);
    if (expectedCodes && !expectedCodes.includes(code)) {
      fail(section, `${label} failed with unexpected code ${code}: ${message}`);
    }
    log(section, `${label} rejected (${code || "error"}: ${message.split("\n")[0]})`);
    return;
  }
  fail(section, `${label} should have been rejected`);
}

async function runDateWindowProof(sql, directA) {
  await expectFailure(
    "DATE-WINDOW",
    "inverted start/due",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          UPDATE public.tasks SET start_date = '2026-06-10', due_date = '2026-06-09'
          WHERE id = '${TASK_E}'::uuid
        `),
      ),
    ["23514"],
  );

  await directA.run((tx) =>
    tx.unsafe(`
      UPDATE public.tasks SET start_date = '2026-06-10', due_date = '2026-06-10'
      WHERE id = '${TASK_E}'::uuid
    `),
  );
  const sameDay = await sql`SELECT start_date::text, due_date::text FROM public.tasks WHERE id = ${TASK_E}::uuid`;
  assert(sameDay[0]?.start_date === "2026-06-10" && sameDay[0]?.due_date === "2026-06-10", "DATE-WINDOW", "same-day window should persist");

  await directA.run((tx) =>
    tx.unsafe(`
      UPDATE public.tasks SET start_date = NULL, due_date = NULL
      WHERE id = '${TASK_E}'::uuid
    `),
  );
  log("DATE-WINDOW", "inverted rejected; same-day and nullable windows allowed");
}

async function runSelfAndCycleProof(directA) {
  await expectFailure(
    "SELF",
    "self edge",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_A}'::uuid, '${TASK_A}'::uuid)
        `),
      ),
    ["23514"],
  );

  await directA.run((tx) =>
    tx.unsafe(`
      INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
      VALUES ('${OWNER_A}'::uuid, '${TASK_A}'::uuid, '${TASK_B}'::uuid)
    `),
  );
  await expectFailure(
    "CYCLE",
    "direct reverse edge",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_B}'::uuid, '${TASK_A}'::uuid)
        `),
      ),
    ["23514"],
  );

  await directA.run((tx) =>
    tx.unsafe(`
      INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
      VALUES ('${OWNER_A}'::uuid, '${TASK_C}'::uuid, '${TASK_D}'::uuid)
    `),
  );
  await directA.run((tx) =>
    tx.unsafe(`
      INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
      VALUES ('${OWNER_A}'::uuid, '${TASK_D}'::uuid, '${TASK_E}'::uuid)
    `),
  );
  await expectFailure(
    "CYCLE",
    "indirect chain edge",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_E}'::uuid, '${TASK_C}'::uuid)
        `),
      ),
    ["23514"],
  );
  log("CYCLE", "direct and indirect cycles rejected, valid chain accepted");
}

async function runConcurrentProof(sql) {
  const left = await sql.reserve();
  const right = await sql.reserve();
  try {
    await left.unsafe(`BEGIN`);
    await left.unsafe(`
      INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
      VALUES ('${OWNER_A}'::uuid, '${TASK_D}'::uuid, '${TASK_F}'::uuid)
    `);
    log("CONCURRENT", "first reverse edge inserted and holding the owner lock");

    const racing = (async () => {
      await right.unsafe(`BEGIN`);
      try {
        await right.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_F}'::uuid, '${TASK_D}'::uuid)
        `);
        await right.unsafe(`COMMIT`);
        return { committed: true };
      } catch (error) {
        await right.unsafe(`ROLLBACK`);
        return { committed: false, error };
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 150));
    await left.unsafe(`COMMIT`);
    const result = await racing;

    assert(!result.committed, "CONCURRENT", "the second reverse edge must not commit");
    assert(String(result.error?.code ?? "") === "23514", "CONCURRENT", `second edge should fail the cycle check, got ${result.error?.code}`);
  } finally {
    left.release();
    right.release();
  }

  const edges = await sql`
    SELECT task_id, blocked_by_task_id FROM public.task_dependencies
    WHERE owner_user_id = ${OWNER_A}::uuid
      AND ((task_id = ${TASK_D}::uuid AND blocked_by_task_id = ${TASK_F}::uuid)
        OR (task_id = ${TASK_F}::uuid AND blocked_by_task_id = ${TASK_D}::uuid))
  `;
  assert(edges.length === 1, "CONCURRENT", `exactly one racing edge should survive, got ${edges.length}`);
  log("CONCURRENT", "racing reverse inserts serialized; exactly one edge survived");
}

async function runCrossOwnerProof(directA, directB) {
  await expectFailure(
    "CROSS-OWNER",
    "forged other-owner endpoint",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_E}'::uuid, '${TASK_X}'::uuid)
        `),
      ),
    ["42501"],
  );

  await expectFailure(
    "CROSS-OWNER",
    "spoofed owner with other-owner endpoints",
    () =>
      directB.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_B}'::uuid, '${TASK_A}'::uuid, '${TASK_B}'::uuid)
        `),
      ),
    ["42501"],
  );

  const foreignVisible = await directB.run((tx) =>
    tx.unsafe(`SELECT id FROM public.task_dependencies WHERE owner_user_id = '${OWNER_A}'::uuid`),
  );
  assert(foreignVisible.length === 0, "CROSS-OWNER", `owner B must not read owner A edges, got ${foreignVisible.length}`);

  const foreignDelete = await directB.run((tx) =>
    tx.unsafe(`
      DELETE FROM public.task_dependencies
      WHERE owner_user_id = '${OWNER_A}'::uuid
        AND task_id = '${TASK_A}'::uuid
        AND blocked_by_task_id = '${TASK_B}'::uuid
      RETURNING id
    `),
  );
  assert(foreignDelete.length === 0, "CROSS-OWNER", "owner B must not delete owner A edges");

  const ownVisible = await directA.run((tx) =>
    tx.unsafe(`SELECT id FROM public.task_dependencies WHERE owner_user_id = '${OWNER_A}'::uuid`),
  );
  assert(ownVisible.length >= 3, "CROSS-OWNER", `owner A should read own edges, got ${ownVisible.length}`);
  log("CROSS-OWNER", "forged endpoints, foreign reads and foreign deletes denied");
}

async function runDuplicateAndCascadeProof(sql, directA) {
  await expectFailure(
    "DUPLICATE",
    "duplicate edge",
    () =>
      directA.run((tx) =>
        tx.unsafe(`
          INSERT INTO public.task_dependencies (owner_user_id, task_id, blocked_by_task_id)
          VALUES ('${OWNER_A}'::uuid, '${TASK_A}'::uuid, '${TASK_B}'::uuid)
        `),
      ),
    ["23505"],
  );
  log("DUPLICATE", "duplicate edge rejected by the unique index");

  await sql`DELETE FROM public.tasks WHERE id = ${TASK_A}::uuid`;
  const remaining = await sql`
    SELECT id FROM public.task_dependencies
    WHERE task_id = ${TASK_A}::uuid OR blocked_by_task_id = ${TASK_A}::uuid
  `;
  assert(remaining.length === 0, "CASCADE", `deleting a task should remove its edges, got ${remaining.length}`);
  log("CASCADE", "task delete cascades its dependency edges");
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      await applyFile(sql, tag);
      applied += 1;
    }
    log("MIGRATE", `${applied} migration(s) applied from the journal`);
    assert(tags.includes(MIGRATION), "MIGRATE", `${MIGRATION} must be in the journal`);

    await seed(sql);
    const directA = directSession(sql, OWNER_A);
    const directB = directSession(sql, OWNER_B);

    await runDateWindowProof(sql, directA);
    await runSelfAndCycleProof(directA);
    await runConcurrentProof(sql);
    await runCrossOwnerProof(directA, directB);
    await runDuplicateAndCascadeProof(sql, directA);

    const statements = await applyFile(sql, MIGRATION);
    log("IDEMPOTENCE", `Re-applied ${MIGRATION} (${statements} statement(s)); up-only convention holds.`);

    console.log("TASK-DEPENDENCIES-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
