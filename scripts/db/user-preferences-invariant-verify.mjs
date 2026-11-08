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
 *   ANON       - under Supabase-default grants anon holds the table privileges
 *                and the RPC EXECUTE grant; RLS still returns zero rows for
 *                reads and updates and the RPC's auth.uid() guard rejects the
 *                call (P0001).
 *   AUTH       - authenticated without a JWT subject has no auth.uid().
 *   CROSS OWNER- owner B's RPC patch never changes owner A's row.
 *   GUIDANCE   - overlapping enabled blocks fail; the same overlap disabled is
 *                accepted.
 *   PAUSE      - pausing keeps the configured target minutes on read-back.
 *   RPC RETURN - the RPC returns the patched row.
 *   IDEMPOTENCE- re-applying the migration succeeds (up-only).
 *
 * Usage:
 *   node scripts/db/user-preferences-invariant-verify.mjs --url <postgres-url> [--socket <dir|file>]
 *
 * --socket points postgres.js at a Unix socket. Pass the socket directory (the
 * .s.PGSQL.<port> file name is derived) or the socket file itself. When the URL
 * carries ?port=, that port wins over the URL authority port.
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO anon, authenticated;`);
  // Supabase grants every new public object to anon and authenticated, then
  // relies on RLS and function guards for denial. Mirror that here so the proof
  // exercises the production security outcome instead of a missing grant.
  await sql.unsafe(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, anon;
  `);
  await sql.unsafe(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;
  `);
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
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated;`);
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

/** Authenticated database role with no JWT subject, so auth.uid() is NULL. */
function unauthenticatedJwtSession(sql) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '', true)`);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', '{}', true)`);
        return fn(tx);
      });
    },
  };
}

/**
 * Anonymous client role. It keeps Supabase's default table and function grants;
 * RLS and the RPC's auth.uid() guard are what deny it.
 */
function anonymousSession(sql) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE anon`);
        return fn(tx);
      });
    },
  };
}

async function expectFailure(label, fn, expectedCodes, messagePattern) {
  try {
    await fn();
  } catch (error) {
    assert(
      expectedCodes.includes(error.code),
      `${label}: expected one of ${expectedCodes.join(", ")}, got ${error.code} ${error.message}`,
    );
    if (messagePattern) {
      assert(
        messagePattern.test(error.message),
        `${label}: expected message matching ${messagePattern}, got "${error.message}"`,
      );
    }
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

  // --socket may name the socket directory (as the disposable-cluster
  // instructions do) or the socket file itself. An explicit ?port= wins over
  // the URL authority port when deriving the socket file name.
  const parsedUrl = new URL(url);
  const socketPort = parsedUrl.searchParams.get("port") || parsedUrl.port || "5432";
  const socketPath =
    socket && !socket.includes(".s.PGSQL.") ? join(socket, `.s.PGSQL.${socketPort}`) : socket;
  // postgres.js forwards unrecognised query parameters as server startup
  // settings, so consume ?port= locally instead of letting it reach the server.
  if (socketPath) parsedUrl.searchParams.delete("port");
  const sql = postgres(parsedUrl.toString(), {
    max: 4,
    onnotice: () => {},
    ...(socketPath ? { path: socketPath } : {}),
  });
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
    const legacy = await sql.unsafe(`SELECT theme, personal_operations FROM public.user_preferences WHERE user_id = '44444444-4444-4444-8444-444444444444'`);
    assert(legacy[0].theme === "light" && legacy[0].personal_operations === null, "legacy preference row survives upgrade");

    // The Supabase-default privileges installed above must already cover the
    // new table. Fail loudly if the shim stops modelling that reality.
    const [tablePrivilege] = await sql.unsafe(
      `SELECT has_table_privilege('anon', 'public.user_preferences', 'SELECT,INSERT,UPDATE,DELETE') AS granted`,
    );
    assert(tablePrivilege.granted, "Supabase-default grants must reach user_preferences");

    // 0078 revokes the function from PUBLIC and grants authenticated only.
    // Supabase-default EXECUTE still reaches anon; grant it explicitly if this
    // shim changes, so the guard (not a missing grant) rejects the call.
    let [functionPrivilege] = await sql.unsafe(
      `SELECT has_function_privilege('anon', 'public.patch_user_preferences(jsonb)', 'EXECUTE') AS granted`,
    );
    if (!functionPrivilege.granted) {
      await sql.unsafe(`GRANT EXECUTE ON FUNCTION public.patch_user_preferences(jsonb) TO anon`);
      [functionPrivilege] = await sql.unsafe(
        `SELECT has_function_privilege('anon', 'public.patch_user_preferences(jsonb)', 'EXECUTE') AS granted`,
      );
    }
    assert(functionPrivilege.granted, "anon must hold RPC EXECUTE so auth.uid() is what denies it");

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

    // ANONYMOUS DENIAL ---------------------------------------------------------
    // Supabase gives anon the default privileges, so denial must come from RLS
    // (zero rows) and the RPC's auth.uid() guard (P0001), not missing grants.
    const anonymous = anonymousSession(sql);
    const anonSelect = await anonymous.run((tx) =>
      tx.unsafe(`SELECT count(*)::int AS count FROM public.user_preferences`),
    );
    assert(anonSelect[0].count === 0, "anon SELECT must return zero rows under RLS, not a privilege error");

    const anonUpdate = await anonymous.run((tx) =>
      tx.unsafe(`UPDATE public.user_preferences SET theme = 'dark' RETURNING user_id`),
    );
    assert(anonUpdate.count === 0, "anon UPDATE must affect zero rows under RLS, not a privilege error");

    await expectFailure(
      "anon RPC patch",
      () => anonymous.run((tx) => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ theme: "dark" }])),
      ["P0001"],
      /authentication required/i,
    );

    const afterAnon = await ownerA.run((tx) =>
      tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    assert(afterAnon[0].theme === "system", "anon attempts must leave owner A's row unchanged");
    log(
      "ANON",
      "RLS returned zero rows and the auth.uid() guard rejected the RPC under Supabase-default grants",
    );

    // AUTHENTICATED WITHOUT A SUBJECT -----------------------------------------
    const noSubject = unauthenticatedJwtSession(sql);
    await expectFailure(
      "authenticated without JWT subject",
      () => noSubject.run((tx) => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ theme: "dark" }])),
      ["P0001"],
      /authentication required/i,
    );
    log("AUTH", "missing JWT subject is rejected by auth.uid() NULL guard");

    // CROSS-OWNER RPC ----------------------------------------------------------
    const ownerABefore = await ownerA.run((tx) =>
      tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    await ownerB.run((tx) => tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [{ theme: "light" }]));
    const crossOwner = await Promise.all([
      ownerA.run((tx) => tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`)),
      ownerB.run((tx) => tx.unsafe(`SELECT theme FROM public.user_preferences WHERE user_id = auth.uid()`)),
    ]);
    assert(
      crossOwner[0][0].theme === ownerABefore[0].theme,
      "owner B's RPC patch must not change owner A's row",
    );
    assert(crossOwner[1][0].theme === "light", "owner B's RPC patch must change owner B's row");
    log("CROSS OWNER", "owner B patch changed only owner B's row");

    // GUIDANCE OVERLAP + PAUSE + RPC RETURN ------------------------------------
    const baseTargets = Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [
        day,
        { work: day === "saturday" || day === "sunday" ? 240 : 480, jobSearch: day === "saturday" || day === "sunday" ? 0 : 90 },
      ]),
    );
    const overlappingGuidance = [
      { name: "Block A", days: ["monday"], start: "06:00", end: "07:00", enabled: true },
      { name: "Block B", days: ["monday"], start: "06:30", end: "07:30", enabled: true },
    ];
    await expectFailure(
      "overlapping enabled guidance",
      () =>
        ownerA.run((tx) =>
          tx.unsafe(`SELECT public.patch_user_preferences($1::jsonb)`, [
            { personalOperations: { paused: false, targets: baseTargets, guidance: overlappingGuidance } },
          ]),
        ),
      ["23514"],
    );

    const disabledOverlap = overlappingGuidance.map((block, index) =>
      index === 1 ? { ...block, enabled: false } : block,
    );
    const accepted = await ownerA.run((tx) =>
      tx.unsafe(
        `WITH patched AS (SELECT public.patch_user_preferences($1::jsonb) AS row)
         SELECT (row).personal_operations AS personal_operations FROM patched`,
        [{ personalOperations: { paused: false, targets: baseTargets, guidance: disabledOverlap } }],
      ),
    );
    assert(accepted[0].personal_operations.guidance.length === 2, "disabled overlap must be accepted");
    log("GUIDANCE", "enabled overlap rejected (23514); disabled overlap accepted");

    const pausedSchedule = {
      paused: true,
      targets: baseTargets,
      guidance: disabledOverlap,
    };
    const pausedPatch = await ownerA.run((tx) =>
      tx.unsafe(`SELECT (public.patch_user_preferences($1::jsonb)).theme AS theme`, [
        { personalOperations: pausedSchedule, theme: "dark" },
      ]),
    );
    assert(pausedPatch[0].theme === "dark", "the RPC must return the patched row");
    const pausedRead = await ownerA.run((tx) =>
      tx.unsafe(`SELECT personal_operations FROM public.user_preferences WHERE user_id = auth.uid()`),
    );
    assert(pausedRead[0].personal_operations.paused === true, "pause must persist");
    assert(
      pausedRead[0].personal_operations.targets.monday.work === 480
        && pausedRead[0].personal_operations.targets.monday.jobSearch === 90,
      "pausing must retain the configured target minutes",
    );
    assert(
      pausedRead[0].personal_operations.targets.sunday.work === 240
        && pausedRead[0].personal_operations.targets.sunday.jobSearch === 0,
      "weekend targets must survive the pause patch",
    );
    log("PAUSE", "pause retained weekday and weekend targets on read-back");
    log("RPC RETURN", "RPC returned the patched row (theme dark)");

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
