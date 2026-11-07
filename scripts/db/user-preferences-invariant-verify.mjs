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
    if (rest[i] === "--socket") args.socket = rest[++i];
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
  const { url, socket } = parseArgs();
  const tags = await readJournal();
  assert(tags.includes(MIGRATION_TAG), `journal must include ${MIGRATION_TAG}`);

  const sql = postgres(url, { max: 4, onnotice: () => {}, ...(socket ? { path: socket } : {}) });
  try {
    await reset(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      if (tag === "0078_personal_operations") {
        await sql.unsafe(`INSERT INTO public.user_preferences (user_id, theme) VALUES ('44444444-4444-4444-8444-444444444444', 'light')`);
      }
      const count = await applyFile(sql, tag);
      applied += 1;
      log("MIGRATE", `${tag}: ${count} statement(s)`);
    }
    log("MIGRATE", `${applied} journal migrations applied`);
    const legacy = await sql.unsafe(`SELECT theme, personal_operations, job_search_reference FROM public.user_preferences WHERE user_id = '44444444-4444-4444-8444-444444444444'`);
    assert(legacy[0].theme === "light" && legacy[0].personal_operations === null && legacy[0].job_search_reference === null, "legacy preference row survives upgrade");

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
         RETURNING theme, accent, density, reduced_motion, launch_page, task_layout, task_open_mode, job_search_reference`,
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
    assert(inserted.job_search_reference === null, "default job_search_reference must be null");
    log("DEFAULTS", "insert-with-user_id produced every documented default");

    // Atomic patches preserve independent fields and use the authenticated actor.
    const schedule = { paused: false, targets: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, { work: 480, jobSearch: 90 }])), guidance: [] };
    await Promise.all([
      ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ theme: "dark" }])),
      ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ personalOperations: schedule }])),
    ]);
    const concurrent = await ownerA.run(tx => tx.unsafe(`SELECT theme, personal_operations FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(concurrent[0].theme === "dark" && concurrent[0].personal_operations?.targets?.monday?.work === 480, "concurrent patches must preserve both fields");
    await expectFailure("RPC rejects malformed schedule", () => ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ personalOperations: { paused: false } }])), ["23514"]);
    await expectFailure("RPC rejects caller identity", () => ownerB.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ userId: OWNER_A, theme: "light" }])), ["P0001"]);
    await ownerA.run(tx => tx.unsafe(`UPDATE public.user_preferences SET theme = 'system' WHERE user_id = auth.uid()`));
    log("PATCH", "concurrent fields and actor binding verified");

    // JOB-SEARCH REFERENCE ------------------------------------------------------
    const TASK_REF = "11111111-1111-4111-8111-111111111111";
    const OTHER_TASK_REF = "22222222-2222-4222-8222-222222222222";
    const defaultRef = await ownerA.run(tx => tx.unsafe(`SELECT job_search_reference FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(defaultRef[0].job_search_reference === null, "job_search_reference must default to null");

    await ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { jobSearchReference: { kind: "task", id: TASK_REF } },
    ]));
    const savedRef = await ownerA.run(tx => tx.unsafe(`SELECT job_search_reference FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(savedRef[0].job_search_reference?.kind === "task" && savedRef[0].job_search_reference?.id === TASK_REF, "valid task reference must persist");

    // Clearing sends JSONB null; the RPC must convert it to SQL NULL so the
    // CHECK (which allows SQL NULL) does not reject the patch.
    await ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { jobSearchReference: null },
    ]));
    const clearedRef = await ownerA.run(tx => tx.unsafe(`SELECT job_search_reference FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(clearedRef[0].job_search_reference === null, "clearing must store SQL NULL, not JSONB null");

    // A subsequent schedule/theme patch must still succeed after clearing.
    await ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { personalOperations: schedule, theme: "dark" },
    ]));
    const afterClear = await ownerA.run(tx => tx.unsafe(`SELECT theme, personal_operations FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(afterClear[0].theme === "dark" && afterClear[0].personal_operations?.targets?.monday?.work === 480, "3-key schedule patch must succeed after clearing the reference");
    log("REFERENCE", "clear-to-null and subsequent 3-key schedule/theme patch verified");
    await ownerA.run(tx => tx.unsafe(`UPDATE public.user_preferences SET theme = 'system' WHERE user_id = auth.uid()`));

    await expectFailure("RPC rejects a project reference", () => ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { jobSearchReference: { kind: "project", id: TASK_REF } },
    ])), ["23514"]);
    await expectFailure("RPC rejects an invalid reference UUID", () => ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { jobSearchReference: { kind: "task", id: "not-a-uuid" } },
    ])), ["23514"]);
    // The exact 0078 3-key validator body is restored by 0089, so a database
    // that ever applied the deleted branch 0079 converges here. The 4-key
    // rejection plus the copied body is the convergence proof.
    await expectFailure("RPC rejects a 4-key personal schedule", () => ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { personalOperations: { ...schedule, jobSearchReference: { kind: "task", id: TASK_REF } } },
    ])), ["23514"]);
    await ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { personalOperations: schedule },
    ]));
    const acceptedSchedule = await ownerA.run(tx => tx.unsafe(`SELECT personal_operations FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(acceptedSchedule[0].personal_operations?.targets?.monday?.work === 480, "3-key personal schedule must remain accepted");
    await expectFailure("RPC rejects caller identity plus reference", () => ownerB.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
      { userId: OWNER_A, jobSearchReference: { kind: "task", id: TASK_REF } },
    ])), ["P0001"]);

    await Promise.all([
      ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ theme: "light" }])),
      ownerA.run(tx => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
        { jobSearchReference: { kind: "task", id: OTHER_TASK_REF } },
      ])),
    ]);
    const concurrentRef = await ownerA.run(tx => tx.unsafe(`SELECT theme, job_search_reference FROM public.user_preferences WHERE user_id = auth.uid()`));
    assert(
      concurrentRef[0].theme === "light"
        && concurrentRef[0].job_search_reference?.id === OTHER_TASK_REF,
      "concurrent theme + jobSearchReference patches must preserve both",
    );
    await ownerA.run(tx => tx.unsafe(`UPDATE public.user_preferences SET theme = 'system' WHERE user_id = auth.uid()`));
    log("REFERENCE", "task reference, rejection, ownership and independent merge verified");

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

    const reappliedRef = await applyFile(sql, "0089_job_search_reference");
    log("IDEMPOTENCE", `0089_job_search_reference re-applied (${reappliedRef} statement(s))`);

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
