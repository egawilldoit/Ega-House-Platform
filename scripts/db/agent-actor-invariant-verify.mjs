#!/usr/bin/env node
/**
 * Ephemeral-database proof for agent identities and attribution (EGA-800).
 *
 * Applies the full drizzle migration journal to a disposable Postgres, then
 * proves:
 *
 *   IDENTITY  - agent identities are owner-scoped under RLS; cross-owner reads,
 *               updates and deletes are denied.
 *   UNIQUE    - display names are unique per owner, case-insensitively.
 *   TOKEN     - a credential can link to an identity; revocation keeps the link.
 *   ACTIVITY  - a trusted service-role agent write (EGA-784 header contract)
 *               records actor_kind='agent', the stable identity id and a
 *               display-name snapshot from `agent_actors`.
 *   OWNER     - an authenticated product write stays owner-attributed even if
 *               it supplies agent headers.
 *   SYSTEM    - a service write without the actor header stays system.
 *   AUDIT     - a direct client audit insert cannot claim an agent identity.
 *
 * Usage:
 *   node scripts/db/agent-actor-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script.
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

function fail(section, message) {
  console.error(`[${section}] FAILED: ${message}`);
  exit(1);
}

async function expect(condition, section, message) {
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
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);`);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('app.current_user', true), '')::uuid $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$ SELECT COALESCE(NULLIF(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb) $fn$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, anon;`);
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
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "44444444-4444-4444-8444-444444444441";
const TASK_AGENT = "aaaaaaaa-0000-4000-8000-000000000001";
const TASK_OWNER = "aaaaaaaa-0000-4000-8000-000000000002";
const TASK_SYSTEM = "aaaaaaaa-0000-4000-8000-000000000003";

async function seed(sql) {
  await sql`
    INSERT INTO projects (id, name, slug, created_at, updated_at)
    VALUES (${PROJECT_ID}::uuid, 'Agent proof', 'agent-proof', now(), now())
  `;
  await sql`
    INSERT INTO agent_actors (id, owner_user_id, display_name, kind, role, avatar_color)
    VALUES
      (${AGENT_A}::uuid, ${OWNER_A}::uuid, 'Codex', 'codex', 'Implementation', 'violet'),
      (${AGENT_B}::uuid, ${OWNER_B}::uuid, 'Runner', 'runner', NULL, 'green')
  `;
}

async function asUser(sql, userId, callback, headers = null) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE authenticated;`);
    await tx.unsafe(`SELECT set_config('app.current_user', $1, true)`, [userId]);
    await tx.unsafe(`SELECT set_config('app.jwt', '{}', true)`);
    if (headers) {
      await tx.unsafe(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(headers)]);
    }
    await callback(tx);
  });
}

async function asAgent(sql, actorId, callback) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.jwt', '{"role":"service_role"}', true)`);
    await tx.unsafe(
      `SELECT set_config('request.headers', $1, true)`,
      [
        JSON.stringify({
          "x-ega-actor-kind": "agent",
          "x-ega-actor-agent-id": actorId,
        }),
      ],
    );
    await callback(tx);
  });
}

async function asSystemService(sql, callback) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.jwt', '{"role":"service_role"}', true)`);
    await callback(tx);
  });
}

async function runIdentityProof(sql) {
  await asUser(sql, OWNER_A, async (tx) => {
    const visible = await tx`SELECT id FROM agent_actors ORDER BY id`;
    await expect(visible.length === 1 && visible[0].id === AGENT_A, "IDENTITY", `owner A must see only their agent, got ${visible.length}`);
    const updated = await tx`
      UPDATE agent_actors SET role = 'Hijacked' WHERE id = ${AGENT_B}::uuid RETURNING id
    `;
    await expect(updated.length === 0, "IDENTITY", "owner A must not update owner B's agent");
  });

  let deleteDenied = false;
  try {
    await asUser(sql, OWNER_A, async (tx) => {
      await tx`DELETE FROM agent_actors WHERE id = ${AGENT_A}::uuid`;
    });
  } catch (error) {
    deleteDenied = /permission denied|policy/i.test(String(error?.message ?? error));
  }
  await expect(deleteDenied, "IDENTITY", "authenticated role must not delete agent identities");

  let duplicateDenied = false;
  try {
    await sql`
      INSERT INTO agent_actors (owner_user_id, display_name, kind)
      VALUES (${OWNER_A}::uuid, 'codex', 'custom')
    `;
  } catch (error) {
    duplicateDenied = error?.code === "23505";
  }
  await expect(duplicateDenied, "UNIQUE", "per-owner display names must be unique case-insensitively");
  log("IDENTITY", "Owner isolation, no delete, and case-insensitive uniqueness are enforced.");
}

async function runTokenProof(sql) {
  const prefix = "0123456789abcdef";
  const hash = "a".repeat(64);
  const rows = await sql`
    INSERT INTO agent_integration_tokens (owner_user_id, agent_id, name, token_prefix, token_hash, scopes)
    VALUES (${OWNER_A}::uuid, ${AGENT_A}::uuid, 'Proof credential', ${prefix}, ${hash}, '{"tasks":{"read":true}}'::jsonb)
    RETURNING id, agent_id
  `;
  await expect(rows[0]?.agent_id === AGENT_A, "TOKEN", "credential must link to the identity");
  await sql`UPDATE agent_integration_tokens SET revoked_at = now() WHERE id = ${rows[0].id}::uuid`;
  const after = await sql`SELECT agent_id FROM agent_integration_tokens WHERE id = ${rows[0].id}::uuid`;
  await expect(after[0]?.agent_id === AGENT_A, "TOKEN", "revocation must not erase the identity link");
  log("TOKEN", "Credential links to identity and survives revocation.");
}

async function runActivityProof(sql) {
  await asAgent(sql, AGENT_A, async (tx) => {
    await tx`
      INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
      VALUES (${TASK_AGENT}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Agent created', 'todo', now(), now())
    `;
  });
  const created = await sql`
    SELECT actor_kind, actor_agent_id, actor_label
    FROM task_activity_events WHERE task_id = ${TASK_AGENT}::uuid AND event_kind = 'created'
  `;
  await expect(created[0]?.actor_kind === "agent", "ACTIVITY", "agent insert must be attributed to the agent");
  await expect(created[0]?.actor_agent_id === AGENT_A, "ACTIVITY", "stable identity id must be stored");
  await expect(created[0]?.actor_label === "Codex", "ACTIVITY", "identity display name must be snapshotted");

  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_OWNER}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Owner edit', 'todo', now(), now())
  `;
  await asUser(
    sql,
    OWNER_A,
    async (tx) => {
      await tx`
        UPDATE tasks SET title = 'Owner renamed', updated_at = now()
        WHERE id = ${TASK_OWNER}::uuid
      `;
    },
    {
      "x-ega-actor-kind": "agent",
      "x-ega-actor-agent-id": AGENT_A,
    },
  );
  const ownerEvent = await sql`
    SELECT actor_kind, actor_agent_id FROM task_activity_events
    WHERE task_id = ${TASK_OWNER}::uuid AND event_kind = 'field_change'
  `;
  await expect(ownerEvent[0]?.actor_kind === "owner", "OWNER", "authenticated writes must stay owner-attributed");
  await expect(ownerEvent[0]?.actor_agent_id === null, "OWNER", "client-supplied agent headers must be ignored");

  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_SYSTEM}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'System edit', 'todo', now(), now())
  `;
  await asSystemService(sql, async (tx) => {
    await tx`
      UPDATE tasks SET title = 'System rename', updated_at = now()
      WHERE id = ${TASK_SYSTEM}::uuid
    `;
  });
  const systemEvent = await sql`
    SELECT actor_kind, actor_agent_id FROM task_activity_events
    WHERE task_id = ${TASK_SYSTEM}::uuid AND event_kind = 'field_change'
  `;
  await expect(systemEvent[0]?.actor_kind === "system", "SYSTEM", "service writes without actor headers stay system");
  await expect(systemEvent[0]?.actor_agent_id === null, "SYSTEM", "system writes must not borrow an identity");

  log("ACTIVITY", "Agent, owner, and system attribution are correct.");
}

async function runAuditProof(sql) {
  const tokenId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await asUser(sql, OWNER_A, async (tx) => {
    await tx`
      INSERT INTO agent_integration_events (owner_user_id, token_id, agent_id, action, outcome)
      VALUES (${OWNER_A}::uuid, ${tokenId}::uuid, ${AGENT_A}::uuid, 'task.updated', 'success')
    `;
  });
  const events = await sql`
    SELECT agent_id, agent_label FROM agent_integration_events
    WHERE owner_user_id = ${OWNER_A}::uuid ORDER BY created_at DESC LIMIT 1
  `;
  await expect(events[0]?.agent_id === null, "AUDIT", "client audit inserts must not claim an agent");
  await expect(events[0]?.agent_label === null, "AUDIT", "client audit inserts must not claim a label");

  const serviceEvent = await sql`
    INSERT INTO agent_integration_events (owner_user_id, token_id, agent_id, action, outcome)
    VALUES (${OWNER_A}::uuid, ${tokenId}::uuid, ${AGENT_A}::uuid, 'task.updated', 'success')
    RETURNING agent_id, agent_label
  `;
  await expect(serviceEvent[0]?.agent_id === AGENT_A, "AUDIT", "service audit inserts keep the agent id");
  await expect(serviceEvent[0]?.agent_label === "Codex", "AUDIT", "service audit inserts snapshot the label");
  log("AUDIT", "Client forgery is rejected; service attribution is snapshotted.");
}

async function main() {
  const args = parseArgs();
  const sql = postgres(args.url, { max: 1, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    for (const tag of await readJournal()) {
      await applyFile(sql, tag);
    }
    log("MIGRATIONS", "Full journal applied");
    await seed(sql);
    await runIdentityProof(sql);
    await runTokenProof(sql);
    await runActivityProof(sql);
    await runAuditProof(sql);
    console.log("\nAll agent identity/attribution invariants passed.");
  } catch (error) {
    console.error(error);
    exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
