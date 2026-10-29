#!/usr/bin/env node
/**
 * Ephemeral-database proof for durable workspace preferences (EGA-798).
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, then proves:
 *
 *   DEFAULTS   - a row inserted with only user_id gets every documented default
 *                (theme system, neutral accent, comfortable density, no extra
 *                motion reduction, Home launch, List layout, side panel).
 *   CONSTRAINTS- unsupported enum values are rejected by the table CHECKs.
 *   RLS READ   - an owner sees only their own row.
 *   RLS WRITE  - an owner cannot insert under another owner's id, update or
 *                delete another owner's row.
 *   IDEMPOTENCE- re-applying the migration succeeds (up-only).
 *
 * Usage:
 *   node scripts/db/user-preferences-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION_TAG = "0072_user_preferences";

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

function splitStatements(text) {
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyFile(sql, tag) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  const statements = splitStatements(text);
  for (const statement of statements) await sql.unsafe(statement);
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
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
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
  await sql.unsafe(`
    INSERT INTO auth.users (id, email) VALUES
      ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
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
}

async function reset(sql) {
  await sql.unsafe(
    `DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;`,
  );
  log("RESET", "done");
}

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";

function session(sql, userId) {
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

async function expectFailure(label, fn, expectedCodes) {
  try {
    await fn();
  } catch (error) {
    assert(
      expectedCodes.includes(error.code),
      `${label}: expected one of ${expectedCodes.join(", ")}, got ${error.code} ${error.message}`,
    );
    log("DENIED", `${label} (${error.code})`);
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  assert(tags.includes(MIGRATION_TAG), `journal must include ${MIGRATION_TAG}`);

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await reset(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      const count = await applyFile(sql, tag);
      applied += 1;
      log("MIGRATE", `${tag}: ${count} statement(s)`);
    }
    log("MIGRATE", `${applied} journal migrations applied`);

    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_preferences TO authenticated`);
    await sql.unsafe(`
      INSERT INTO auth.users (id, email) VALUES
        ('${OWNER_A}'::uuid, 'owner-a@example.test'),
        ('${OWNER_B}'::uuid, 'owner-b@example.test')
      ON CONFLICT (id) DO NOTHING;
    `);

    const ownerA = session(sql, OWNER_A);
    const ownerB = session(sql, OWNER_B);

    // DEFAULTS -----------------------------------------------------------------
    const inserted = await ownerA.run(async (tx) => {
      const rows = await tx.unsafe(
        `INSERT INTO public.user_preferences (user_id) VALUES (auth.uid())
         RETURNING theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode`,
      );
      return rows[0];
    });
    assert(inserted.theme === "system", "default theme must be system");
    assert(inserted.accent === "neutral", "default accent must be neutral");
    assert(inserted.density === "comfortable", "default density must be comfortable");
    assert(inserted.reduced_motion === false, "default reduced_motion must be false");
    assert(inserted.launch_page === "home", "default launch_page must be home");
    assert(inserted.task_layout === "list", "default task_layout must be list");
    assert(inserted.task_open_mode === "panel", "default task_open_mode must be panel");
    log("DEFAULTS", "insert-with-user_id produced every documented default");

    // CONSTRAINTS --------------------------------------------------------------
    for (const [column, value] of [
      ["theme", "sepia"],
      ["accent", "red"],
      ["density", "tiny"],
      ["launch_page", "calendar"],
      ["task_layout", "table"],
      ["task_open_mode", "modal"],
    ]) {
      await expectFailure(
        `check ${column}=${value}`,
        () =>
          ownerA.run((tx) =>
            tx.unsafe(`UPDATE public.user_preferences SET ${column} = $1 WHERE user_id = auth.uid()`, [
              value,
            ]),
          ),
        ["23514"],
      );
    }

    // RLS READ -----------------------------------------------------------------
    const bSeesA = await ownerB.run((tx) =>
      tx.unsafe(`SELECT count(*)::int AS count FROM public.user_preferences`),
    );
    assert(bSeesA[0].count === 0, "owner B must not read owner A's preferences");

    const aSeesOwn = await ownerA.run((tx) =>
      tx.unsafe(`SELECT count(*)::int AS count FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    assert(aSeesOwn[0].count === 1, "owner A must read their own preferences");
    log("RLS", "owner isolation on read proven");

    // RLS WRITE ----------------------------------------------------------------
    await expectFailure(
      "insert under another owner",
      () =>
        ownerB.run((tx) =>
          tx.unsafe(`INSERT INTO public.user_preferences (user_id, theme) VALUES ($1::uuid, 'dark')`, [
            OWNER_A,
          ]),
        ),
      ["42501"],
    );

    const bUpdate = await ownerB.run((tx) =>
      tx.unsafe(`UPDATE public.user_preferences SET theme = 'dark' WHERE user_id = $1::uuid`, [
        OWNER_A,
      ]),
    );
    assert(bUpdate.count === 0, "owner B's update must affect no row");

    const bDelete = await ownerB.run((tx) =>
      tx.unsafe(`DELETE FROM public.user_preferences WHERE user_id = $1::uuid`, [OWNER_A]),
    );
    assert(bDelete.count === 0, "owner B's delete must affect no row");

    const afterAttacks = await ownerA.run((tx) =>
      tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    assert(afterAttacks[0].theme === "system", "owner A's row must be unchanged");
    log("RLS", "owner isolation on insert/update/delete proven");

    // OWNER WRITE + IDEMPOTENCE ------------------------------------------------
    const updated = await ownerA.run((tx) =>
      tx.unsafe(
        `UPDATE public.user_preferences
         SET theme = 'dark', accent = 'violet', density = 'compact', reduced_motion = true,
             launch_page = 'today', task_layout = 'kanban', task_open_mode = 'full'
         WHERE user_id = auth.uid()
         RETURNING theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode`,
      ),
    );
    assert(updated.count === 1, "owner A's update must succeed");
    assert(updated[0].theme === "dark", "owner A's theme update must persist");
    log("WRITE", "owner update persisted");

    const reapplied = await applyFile(sql, MIGRATION_TAG);
    log("IDEMPOTENCE", `${MIGRATION_TAG} re-applied (${reapplied} statement(s))`);

    const stillThere = await ownerA.run((tx) =>
      tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    assert(stillThere[0].theme === "dark", "re-applying the migration must preserve rows");

    log("PROOF", "user_preferences defaults, constraints, RLS and idempotence verified");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
