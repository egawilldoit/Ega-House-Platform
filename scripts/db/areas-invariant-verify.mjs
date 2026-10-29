#!/usr/bin/env node
/**
 * Ephemeral-database proof for Areas (drizzle/0075_areas.sql).
 *
 * Applies the full drizzle migration journal (plus the standard minimal
 * Supabase shim) to a disposable Postgres, then proves:
 *
 *   CRUD        - an authenticated owner can create/read/update its Area.
 *   ISOLATION   - another authenticated owner cannot read, update or delete it.
 *   ASSIGN      - a same-owner project can be assigned, and an Area delete
 *                 atomically detaches the project while keeping the project and
 *                 its task rows.
 *   CROSS-OWNER - assigning a project to another owner's Area is refused by the
 *                 database trigger on both INSERT and UPDATE.
 *   OAUTH       - a client_id (MCP/OAuth) JWT cannot read or write Areas.
 *
 * Usage:
 *   node scripts/db/areas-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script. Only point it
 * at a throwaway container.
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

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  await sql.unsafe(
    `INSERT INTO auth.users (id, email) VALUES
       ($1, 'ab.mortaki@gmail.com'),
       ($2, 'owner-b@example.test')
     ON CONFLICT (id) DO NOTHING;`,
    [OWNER_A, OWNER_B],
  );
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

function asUser(sql, userId, { clientId = null } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          clientId ? JSON.stringify({ client_id: clientId }) : "{}",
        ]);
        return fn(tx);
      });
    },
  };
}

async function captureCode(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? error?.message ?? "unknown";
  }
}

async function main() {
  const { url } = parseArgs();
  const sql = postgres(url, { max: 4 });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    const tags = await readJournal();
    assert(tags.includes("0075_areas"), "journal must include the areas migration");

    let applied = 0;
    for (const tag of tags) {
      await applyFile(sql, tag);
      applied += 1;
    }
    // Supabase's baseline grants table privileges to authenticated; RLS is the
    // row gate. The disposable shim has no default grants, so add them after
    // the journal (new tables are created during the loop).
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`,
    );
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
    log("MIGRATE", `${applied} journal migrations applied`);

    // RLS is enabled and the four direct-user policies exist.
    const [rls] = await sql.unsafe(
      `SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.areas'::regclass`,
    );
    assert(rls?.enabled === true, "areas must have RLS enabled");
    const policies = await sql.unsafe(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'areas' ORDER BY policyname`,
    );
    assert(policies.length === 4, "areas must expose exactly the four direct-user policies");

    // CRUD by owner A through the authenticated role.
    const areaA = await asUser(sql, OWNER_A).run(async (tx) => {
      const [row] = await tx.unsafe(
        `INSERT INTO public.areas (name, icon, color, description)
         VALUES ('Job hunt', 'briefcase', 'blue', 'Applications')
         RETURNING id`,
      );
      return row.id;
    });
    assert(areaA, "owner A must create an area");

    const updated = await asUser(sql, OWNER_A).run(async (tx) => {
      const rows = await tx.unsafe(
        `UPDATE public.areas SET name = 'Job hunt 2027' WHERE id = $1 RETURNING id`,
        [areaA],
      );
      return rows.length;
    });
    assert(updated === 1, "owner A must update its own area");

    // Owner B cannot see or mutate A's Area.
    const bVisible = await asUser(sql, OWNER_B).run(async (tx) => {
      const rows = await tx.unsafe(`SELECT id FROM public.areas WHERE id = $1`, [areaA]);
      return rows.length;
    });
    assert(bVisible === 0, "owner B must not read owner A's area");

    const bUpdate = await asUser(sql, OWNER_B).run(async (tx) => {
      const rows = await tx.unsafe(
        `UPDATE public.areas SET name = 'stolen' WHERE id = $1 RETURNING id`,
        [areaA],
      );
      return rows.length;
    });
    assert(bUpdate === 0, "owner B must not update owner A's area");

    const bDelete = await asUser(sql, OWNER_B).run(async (tx) => {
      const rows = await tx.unsafe(`DELETE FROM public.areas WHERE id = $1 RETURNING id`, [areaA]);
      return rows.length;
    });
    assert(bDelete === 0, "owner B must not delete owner A's area");

    const spoofInsertCode = await captureCode(() =>
      asUser(sql, OWNER_B).run((tx) =>
        tx.unsafe(
          `INSERT INTO public.areas (owner_user_id, name) VALUES ($1, 'spoofed')`,
          [OWNER_A],
        ),
      ),
    );
    assert(spoofInsertCode !== null, "owner B must not insert an area for owner A");

    // Cross-owner project assignment is refused by the trigger.
    const projectB = await asUser(sql, OWNER_B).run(async (tx) => {
      const [row] = await tx.unsafe(
        `INSERT INTO public.projects (name, slug) VALUES ('Owner B project', 'owner-b-project') RETURNING id`,
      );
      return row.id;
    });
    assert(projectB, "owner B must create a project");

    const insertCrossCode = await captureCode(() =>
      asUser(sql, OWNER_B).run((tx) =>
        tx.unsafe(
          `INSERT INTO public.projects (name, slug, area_id) VALUES ('Cross', 'cross-owner-insert', $1)`,
          [areaA],
        ),
      ),
    );
    assert(insertCrossCode === "23514", "cross-owner area assignment on INSERT must be refused");

    const updateCrossCode = await captureCode(() =>
      asUser(sql, OWNER_B).run((tx) =>
        tx.unsafe(`UPDATE public.projects SET area_id = $1 WHERE id = $2`, [areaA, projectB]),
      ),
    );
    assert(updateCrossCode === "23514", "cross-owner area assignment on UPDATE must be refused");

    // Same-owner assignment works, then deletion detaches atomically.
    const projectA = await asUser(sql, OWNER_A).run(async (tx) => {
      const [row] = await tx.unsafe(
        `INSERT INTO public.projects (name, slug, area_id)
         VALUES ('Owner A project', 'owner-a-project', $1) RETURNING id`,
        [areaA],
      );
      return row.id;
    });
    assert(projectA, "owner A must create a project in its own area");

    const taskA = await asUser(sql, OWNER_A).run(async (tx) => {
      const [row] = await tx.unsafe(
        `INSERT INTO public.tasks (project_id, title) VALUES ($1, 'Keep me') RETURNING id`,
        [projectA],
      );
      return row.id;
    });
    assert(taskA, "owner A must create a task");

    const deleted = await asUser(sql, OWNER_A).run(async (tx) => {
      const rows = await tx.unsafe(`DELETE FROM public.areas WHERE id = $1 RETURNING id`, [areaA]);
      return rows.length;
    });
    assert(deleted === 1, "owner A must delete its own area");

    const [detached] = await sql.unsafe(
      `SELECT area_id FROM public.projects WHERE id = $1`,
      [projectA],
    );
    assert(detached && detached.area_id === null, "deleting an area must detach its projects");
    const [projectStillThere] = await sql.unsafe(
      `SELECT id FROM public.projects WHERE id = $1`,
      [projectA],
    );
    assert(projectStillThere, "area deletion must keep the project");
    const [taskStillThere] = await sql.unsafe(`SELECT id FROM public.tasks WHERE id = $1`, [taskA]);
    assert(taskStillThere, "area deletion must keep the task");

    // OAuth/client JWT contexts are excluded from the direct-user policies.
    const oauthVisible = await asUser(sql, OWNER_A, { clientId: "area-proof-client" }).run(
      async (tx) => {
        const rows = await tx.unsafe(`SELECT id FROM public.areas`);
        return rows.length;
      },
    );
    assert(oauthVisible === 0, "client_id JWT contexts must not read Areas");

    const oauthInsertCode = await captureCode(() =>
      asUser(sql, OWNER_A, { clientId: "area-proof-client" }).run((tx) =>
        tx.unsafe(`INSERT INTO public.areas (name) VALUES ('oauth area')`),
      ),
    );
    assert(oauthInsertCode !== null, "client_id JWT contexts must not create Areas");

    console.log("AREAS-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
