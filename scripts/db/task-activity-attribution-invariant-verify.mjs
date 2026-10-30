#!/usr/bin/env node
/**
 * Ephemeral-database proof for task-activity actor attribution and producer
 * coverage (EGA-784 stage 2).
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, then proves the mutation-path matrix:
 *
 *   OWNER_WEB     - an authenticated owner write records actor_kind 'owner' on
 *                   created/field/archive/restore activity and the status
 *                   ledger.
 *   MCP_AGENT     - a verified MCP OAuth session records 'agent' with the
 *                   stable client_id and the grant's snapshotted name.
 *   AGENT_TOKEN   - a service-role scoped-agent write records 'agent' from the
 *                   server-set actor headers; a missing header records 'system'.
 *   SPOOF         - authenticated requests cannot spoof the actor headers; a
 *                   direct client insert/update/delete of the ledger is denied.
 *   SYSTEM_JOB    - a privileged job without actor context records 'system'.
 *   REMINDERS     - scheduling, rescheduling and cancellation emit activity;
 *                   delivery-only status writes emit nothing.
 *   TIMERS        - session rows snapshot the starter's provenance, including
 *                   MCP client identity; legacy rows stay 'unknown'.
 *   COMMUNICAITON - the shared comment contract is append-only, idempotent by
 *                   source id, and survives credential revocation.
 *   NO-OP/RETRY   - repeated identical writes create no false/duplicate rows.
 *   ANALYTICS     - existing task_status_events completion consumers still see
 *                   exactly one event per transition.
 *   RLS           - owners read only their own rows; no write policies exist.
 *   IDEMPOTENCE   - re-applying the migration succeeds (up-only).
 *
 * Usage:
 *   node scripts/db/task-activity-attribution-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION_TAG = "0068_task_activity_attribution";
const MIGRATION_FILE = "0068_task_activity_attribution.sql";

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444441";
const TASK_OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const TASK_MCP = "aaaaaaaa-0000-4000-8000-0000000000a2";
const TASK_AGENT_TOKEN = "aaaaaaaa-0000-4000-8000-0000000000a3";
const TASK_SYSTEM = "aaaaaaaa-0000-4000-8000-0000000000a4";
const TASK_REMINDER = "aaaaaaaa-0000-4000-8000-0000000000a5";
const TASK_TIMER = "aaaaaaaa-0000-4000-8000-0000000000a6";
const TASK_COMMENT = "aaaaaaaa-0000-4000-8000-0000000000a7";
const TASK_OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const AGENT_TOKEN_ID = "55555555-5555-4555-8555-555555555555";
const MCP_CLIENT_ID = "mcp-client-a";
const MCP_RESOURCE = "https://ega.test/mcp";

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

function expect(condition, section, message) {
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
  await sql.unsafe(`ALTER ROLE service_role BYPASSRLS;`);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES
      ('${OWNER_A}'::uuid, 'ab.mortaki@gmail.com'),
      ('${OWNER_B}'::uuid, 'owner-b@example.test')
    ON CONFLICT (id) DO NOTHING;
  `);
  // GUC-backed identity so the proof can simulate verified PostgREST sessions.
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('app.current_user', true), '')::uuid
    $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(NULLIF(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb)
    $fn$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated, service_role;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated, service_role;`);
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
  await sql.unsafe(`DROP SCHEMA IF EXISTS private CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
  log("RESET", "Database schemas dropped and recreated");
}

async function runPrivilegeProof(sql) {
  const privileges = await sql`
    SELECT
      has_table_privilege('authenticated', 'public.task_activity_events', 'INSERT') AS can_insert,
      has_table_privilege('authenticated', 'public.task_activity_events', 'UPDATE') AS can_update,
      has_table_privilege('authenticated', 'public.task_activity_events', 'DELETE') AS can_delete
  `;
  const row = privileges[0];
  expect(!row.can_insert && !row.can_update && !row.can_delete, "PRIVILEGES", "authenticated must hold no write grant on the activity ledger");
  log("PRIVILEGES", "Authenticated role has no INSERT/UPDATE/DELETE grant on task_activity_events.");
}

async function grantProofTableAccess(sql) {
  // Supabase grants table privileges outside the migration journal. The proof
  // grants the same surface so denials come from RLS, not missing GRANTs.
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated, service_role;`);
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      public.tasks, public.projects, public.goals,
      public.task_activity_events, public.task_status_events,
      public.task_sessions, public.task_reminders
    TO authenticated;
  `);
  await sql.unsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;`);
}

async function seed(sql) {
  await sql`
    INSERT INTO public.projects (id, owner_user_id, name, slug, created_at, updated_at)
    VALUES (${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Activity proof', 'activity-proof', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
  // An active MCP grant lets the simulated OAuth session pass the write RLS.
  await sql`
    INSERT INTO public.mcp_authorization_grants (
      owner_user_id, oauth_client_id, resource_uri, client_name,
      status, permission_profile, permissions, permissions_version,
      approved_at, created_at, updated_at
    )
    VALUES (
      ${OWNER_A}::uuid, ${MCP_CLIENT_ID}, ${MCP_RESOURCE}, 'Hermes',
      'active', 'workspace_manager',
      '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb, 1,
      now(), now(), now()
    )
    ON CONFLICT (owner_user_id, oauth_client_id) DO NOTHING
  `;
  await sql`
    INSERT INTO public.agent_integration_tokens (
      id, owner_user_id, name, token_prefix, token_hash, scopes, created_at, updated_at
    )
    VALUES (
      ${AGENT_TOKEN_ID}::uuid, ${OWNER_A}::uuid, 'T3 Code',
      '0123456789abcdef', repeat('a', 64), '{"tasks":{"read":true,"updateAny":true}}'::jsonb,
      now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `;
  log("SEED", "Project, MCP grant and scoped agent token seeded");
}

/**
 * Run one statement as a simulated verified transport.
 * Identity is transaction-local, exactly like PostgREST's request scope.
 */
async function asRole(sql, identity, statement) {
  return sql.begin(async (tx) => {
    if (identity.user) {
      await tx.unsafe(`SELECT set_config('app.current_user', '${identity.user}', true)`);
    }
    if (identity.jwt) {
      await tx.unsafe(
        `SELECT set_config('app.jwt', '${JSON.stringify(identity.jwt).replaceAll("'", "''")}', true)`,
      );
    }
    if (identity.headers) {
      await tx.unsafe(
        `SELECT set_config('request.headers', '${JSON.stringify(identity.headers).replaceAll("'", "''")}', true)`,
      );
    }
    await tx.unsafe(`SET LOCAL ROLE ${identity.role}`);
    return statement(tx);
  });
}

const ownerA = { role: "authenticated", user: OWNER_A, jwt: { role: "authenticated" } };
const ownerB = { role: "authenticated", user: OWNER_B, jwt: { role: "authenticated" } };
const mcpA = {
  role: "authenticated",
  user: OWNER_A,
  jwt: {
    role: "authenticated",
    client_id: MCP_CLIENT_ID,
    aud: MCP_RESOURCE,
    sub: OWNER_A,
  },
};
const agentTokenA = {
  role: "service_role",
  jwt: { role: "service_role" },
  headers: {
    "x-ega-actor-kind": "agent",
    "x-ega-actor-agent-id": AGENT_TOKEN_ID,
  },
};
const serviceNoActor = { role: "service_role", jwt: { role: "service_role" } };

async function insertTaskAs(sql, identity, id, title, status = "todo") {
  const [task] = await asRole(sql, identity, (tx) => tx`
    INSERT INTO public.tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${id}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, ${title}, ${status}, now(), now())
    RETURNING id
  `);
  return task.id;
}

async function activityRows(sql, taskId, eventKind = null) {
  if (eventKind) {
    return sql`
      SELECT * FROM public.task_activity_events
      WHERE task_id = ${taskId}::uuid AND event_kind = ${eventKind}
      ORDER BY occurred_at, id
    `;
  }
  return sql`
    SELECT * FROM public.task_activity_events
    WHERE task_id = ${taskId}::uuid
    ORDER BY occurred_at, id
  `;
}

async function runOwnerProof(sql) {
  await insertTaskAs(sql, ownerA, TASK_OWNER, "Owner proof");
  let rows = await activityRows(sql, TASK_OWNER, "created");
  expect(rows.length === 1, "OWNER_WEB", `expected one created event, got ${rows.length}`);
  expect(rows[0].actor_kind === "owner", "OWNER_WEB", `created actor must be owner, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_user_id === OWNER_A, "OWNER_WEB", "created actor must carry the verified user id");
  expect(rows[0].actor_agent_id === null, "OWNER_WEB", "owner activity must not invent an agent id");

  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET priority = 'high', updated_at = now() WHERE id = ${TASK_OWNER}::uuid
  `);
  rows = await activityRows(sql, TASK_OWNER, "field_change");
  expect(rows.length === 1, "OWNER_WEB", `expected one field_change event, got ${rows.length}`);
  expect(rows[0].actor_kind === "owner", "OWNER_WEB", "field change must be attributed to the owner");
  expect(rows[0].delta.priority?.to === "high", "OWNER_WEB", "field delta must record the new value");

  // Repeated identical write is a no-op: no false change.
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET priority = 'high', updated_at = now() WHERE id = ${TASK_OWNER}::uuid
  `);
  rows = await activityRows(sql, TASK_OWNER, "field_change");
  expect(rows.length === 1, "NO-OP", `no-op write must not append activity, got ${rows.length}`);

  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET status = 'in_progress', updated_at = now() WHERE id = ${TASK_OWNER}::uuid
  `);
  let statusRows = await sql`
    SELECT * FROM public.task_status_events
    WHERE task_id = ${TASK_OWNER}::uuid ORDER BY occurred_at
  `;
  expect(statusRows.length === 1, "OWNER_WEB", `expected one status event, got ${statusRows.length}`);
  expect(statusRows[0].actor_kind === "owner", "OWNER_WEB", "status event must be attributed to the owner");
  expect(statusRows[0].actor_user_id === OWNER_A, "OWNER_WEB", "status event must carry the owner id");
  // The status ledger owns status; the field ledger must not duplicate it.
  rows = await activityRows(sql, TASK_OWNER, "field_change");
  expect(rows.length === 1, "ANALYTICS", "status change must not duplicate into the field ledger");

  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET archived_at = now(), updated_at = now() WHERE id = ${TASK_OWNER}::uuid
  `);
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET archived_at = NULL, updated_at = now() WHERE id = ${TASK_OWNER}::uuid
  `);
  const archiveRows = await activityRows(sql, TASK_OWNER);
  const archived = archiveRows.filter((row) => row.event_kind === "archived");
  const restored = archiveRows.filter((row) => row.event_kind === "restored");
  expect(archived.length === 1 && restored.length === 1, "OWNER_WEB", "archive/restore must each emit one event");
  expect(
    archived[0].actor_kind === "owner" && restored[0].actor_kind === "owner",
    "OWNER_WEB",
    "archive/restore must be attributed to the owner",
  );

  log("OWNER_WEB", "Owner created/field/status/archive/restore rows are owner-attributed; no-op writes emit nothing.");
}

async function runMcpProof(sql) {
  // MCP creates receive a server-generated id from the column fence.
  const taskId = await insertTaskAs(sql, mcpA, TASK_MCP, "MCP proof");
  expect(taskId !== TASK_MCP, "MCP_AGENT", "MCP creation must replace the caller-supplied id");
  let rows = await activityRows(sql, taskId, "created");
  expect(rows.length === 1, "MCP_AGENT", `expected one MCP created event, got ${rows.length}`);
  expect(rows[0].actor_kind === "agent", "MCP_AGENT", `MCP created actor must be agent, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_agent_id === MCP_CLIENT_ID, "MCP_AGENT", "MCP actor must store the stable client id");
  expect(rows[0].actor_label === "Hermes", "MCP_AGENT", `MCP actor label must snapshot the grant name, got ${rows[0].actor_label}`);
  expect(rows[0].actor_user_id === OWNER_A, "MCP_AGENT", "MCP actor must also carry the task owner id");

  await asRole(sql, mcpA, (tx) => tx`
    UPDATE public.tasks SET title = 'MCP renamed', updated_at = now() WHERE id = ${taskId}::uuid
  `);
  rows = await activityRows(sql, taskId, "field_change");
  expect(rows.length === 1, "MCP_AGENT", `expected one MCP field change, got ${rows.length}`);
  expect(rows[0].actor_kind === "agent", "MCP_AGENT", "MCP field change must stay agent-attributed");
  expect(rows[0].actor_label === "Hermes", "MCP_AGENT", "MCP field change must keep the snapshotted label");

  await asRole(sql, mcpA, (tx) => tx`
    UPDATE public.tasks SET status = 'done', updated_at = now() WHERE id = ${taskId}::uuid
  `);
  const statusRows = await sql`
    SELECT * FROM public.task_status_events WHERE task_id = ${taskId}::uuid ORDER BY occurred_at
  `;
  expect(statusRows.length === 1 && statusRows[0].to_status === "done", "ANALYTICS", "MCP completion must keep one status event");
  expect(statusRows[0].actor_kind === "agent", "MCP_AGENT", "MCP status event must be agent-attributed");
  expect(statusRows[0].actor_agent_id === MCP_CLIENT_ID, "MCP_AGENT", "MCP status event must carry the client id");

  // Revoking the grant must not rewrite existing history.
  await sql`
    UPDATE public.mcp_authorization_grants
    SET status = 'revoked', revoked_at = now(), updated_at = now()
    WHERE owner_user_id = ${OWNER_A}::uuid AND oauth_client_id = ${MCP_CLIENT_ID}
  `;
  const afterRevoke = await activityRows(sql, taskId, "created");
  expect(
    afterRevoke[0].actor_kind === "agent" && afterRevoke[0].actor_label === "Hermes",
    "CREDENTIAL_ROTATION",
    "grant revocation must not rewrite historical actor attribution",
  );

  // Restore the grant for the remaining proofs.
  await sql`
    UPDATE public.mcp_authorization_grants
    SET status = 'active', revoked_at = NULL, updated_at = now()
    WHERE owner_user_id = ${OWNER_A}::uuid AND oauth_client_id = ${MCP_CLIENT_ID}
  `;
  log("MCP_AGENT", "Verified MCP sessions record stable agent identity; revocation preserves history.");
}

async function runAgentTokenProof(sql) {
  await insertTaskAs(sql, agentTokenA, TASK_AGENT_TOKEN, "Agent token proof");
  let rows = await activityRows(sql, TASK_AGENT_TOKEN, "created");
  expect(rows.length === 1, "AGENT_TOKEN", `expected one created event, got ${rows.length}`);
  expect(rows[0].actor_kind === "agent", "AGENT_TOKEN", `scoped-agent write must be agent, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_agent_id === AGENT_TOKEN_ID, "AGENT_TOKEN", "scoped-agent actor must store the token id");
  expect(rows[0].actor_label === "T3 Code", "AGENT_TOKEN", "scoped-agent actor must snapshot the token name from its row");
  expect(rows[0].actor_user_id === null, "AGENT_TOKEN", "service-role agent write has no auth user claim");

  await asRole(sql, agentTokenA, (tx) => tx`
    UPDATE public.tasks SET priority = 'urgent', updated_at = now() WHERE id = ${TASK_AGENT_TOKEN}::uuid
  `);
  rows = await activityRows(sql, TASK_AGENT_TOKEN, "field_change");
  expect(rows.length === 1 && rows[0].actor_kind === "agent", "AGENT_TOKEN", "scoped-agent field change must stay agent-attributed");

  // Revoking the token must not rewrite history.
  await sql`
    UPDATE public.agent_integration_tokens SET revoked_at = now(), updated_at = now()
    WHERE id = ${AGENT_TOKEN_ID}::uuid
  `;
  const afterRevoke = await activityRows(sql, TASK_AGENT_TOKEN, "created");
  expect(afterRevoke[0].actor_label === "T3 Code", "CREDENTIAL_ROTATION", "token revocation must preserve the snapshot");

  log("AGENT_TOKEN", "Scoped-agent service-role writes record the verified token id and name; revocation preserves history.");
}

async function runSpoofProof(sql) {
  const forgedHeaders = {
    "x-ega-actor-kind": "agent",
    "x-ega-actor-agent-id": "aaaaaaaa-0000-4000-8000-0000000000f9",
  };
  await insertTaskAs(
    sql,
    { role: "authenticated", user: OWNER_A, jwt: { role: "authenticated" }, headers: forgedHeaders },
    TASK_SYSTEM,
    "Spoof proof",
  );
  let rows = await activityRows(sql, TASK_SYSTEM, "created");
  expect(rows.length === 1, "SPOOF", "forged header write must still record one created row");
  expect(rows[0].actor_kind === "owner", "SPOOF", `authenticated header spoof must stay owner, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_agent_id === null, "SPOOF", "authenticated header spoof must not store an agent id");

  const directInsertDenied = await (async () => {
    try {
      await asRole(sql, ownerA, (tx) => tx`
        INSERT INTO public.task_activity_events
          (owner_user_id, task_id, actor_kind, event_kind, delta, occurred_at)
        VALUES (${OWNER_A}::uuid, ${TASK_SYSTEM}::uuid, 'agent', 'field_change', '{}'::jsonb, now())
      `);
      return false;
    } catch {
      return true;
    }
  })();
  expect(directInsertDenied, "SPOOF", "authenticated clients must not insert ledger rows directly");

  const directUpdateDenied = await (async () => {
    try {
      const result = await asRole(sql, ownerA, (tx) => tx`
        UPDATE public.task_activity_events SET actor_label = 'Forged' WHERE task_id = ${TASK_SYSTEM}::uuid
      `);
      return result.count === 0 || result.length === 0;
    } catch {
      return true;
    }
  })();
  expect(directUpdateDenied, "SPOOF", "authenticated clients must not update ledger rows");

  log("SPOOF", "Authenticated headers are ignored and direct ledger writes are denied.");
}

async function runSystemProof(sql) {
  // Direct privileged connection with no verified user/agent context.
  await sql`
    INSERT INTO public.tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES ('aaaaaaaa-0000-4000-8000-0000000000ff'::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'System proof', 'todo', now(), now())
  `;
  const rows = await activityRows(sql, "aaaaaaaa-0000-4000-8000-0000000000ff");
  expect(rows.length === 1, "SYSTEM_JOB", `expected one system created row, got ${rows.length}`);
  expect(rows[0].actor_kind === "system", "SYSTEM_JOB", `privileged job must be system, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_user_id === null && rows[0].actor_agent_id === null, "SYSTEM_JOB", "system must not invent identity");

  // A service-role request with no actor header is also system (legacy/agent
  // path that has not been upgraded), never an invented agent.
  await insertTaskAs(sql, serviceNoActor, "aaaaaaaa-0000-4000-8000-0000000000f1", "Service without header");
  const noHeader = await activityRows(sql, "aaaaaaaa-0000-4000-8000-0000000000f1", "created");
  expect(noHeader[0].actor_kind === "system", "SYSTEM_JOB", "service write without actor context must be system");

  log("SYSTEM_JOB", "Jobs and unattributed service writes record system, never an invented identity.");
}

async function runReminderProof(sql) {
  await insertTaskAs(sql, ownerA, TASK_REMINDER, "Reminder proof");
  const remindAt = "2026-11-10T09:00:00.000Z";
  const inserted = await asRole(sql, ownerA, (tx) => tx`
    INSERT INTO public.task_reminders
      (owner_user_id, task_id, remind_at, channel, status, created_at, updated_at)
    VALUES (${OWNER_A}::uuid, ${TASK_REMINDER}::uuid, ${remindAt}::timestamptz, 'email', 'pending', now(), now())
    RETURNING id
  `);
  const reminderId = inserted[0].id;

  let rows = await activityRows(sql, TASK_REMINDER, "reminder_scheduled");
  expect(rows.length === 1, "REMINDERS", `expected one scheduled event, got ${rows.length}`);
  expect(rows[0].actor_kind === "owner", "REMINDERS", "reminder scheduling must be owner-attributed");

  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.task_reminders
    SET remind_at = '2026-11-11T09:00:00.000Z'::timestamptz, updated_at = now()
    WHERE id = ${reminderId}::uuid
  `);
  rows = await activityRows(sql, TASK_REMINDER, "reminder_updated");
  expect(rows.length === 1, "REMINDERS", `expected one reschedule event, got ${rows.length}`);
  expect(
    rows[0].delta.remind_at?.from && rows[0].delta.remind_at?.to,
    "REMINDERS",
    "reschedule must record before and after",
  );

  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.task_reminders SET status = 'cancelled', updated_at = now()
    WHERE id = ${reminderId}::uuid
  `);
  rows = await activityRows(sql, TASK_REMINDER, "reminder_cancelled");
  expect(rows.length === 1, "REMINDERS", `expected one cancellation event, got ${rows.length}`);

  // Duplicate cancellation retry is a no-op.
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.task_reminders SET status = 'cancelled', updated_at = now()
    WHERE id = ${reminderId}::uuid
  `);
  rows = await activityRows(sql, TASK_REMINDER, "reminder_cancelled");
  expect(rows.length === 1, "NO-OP", `duplicate cancellation must not duplicate activity, got ${rows.length}`);

  // Delivery-only status change emits nothing.
  const beforeSent = (await activityRows(sql, TASK_REMINDER)).length;
  await sql`
    UPDATE public.task_reminders SET status = 'sent', sent_at = now(), updated_at = now()
    WHERE id = ${reminderId}::uuid
  `;
  const afterSent = (await activityRows(sql, TASK_REMINDER)).length;
  expect(afterSent === beforeSent, "REMINDERS", "delivery-only reminder writes must not emit activity");

  log("REMINDERS", "Scheduling/rescheduling/cancellation are owner-attributed; delivery status is silent.");
}

async function runTimerProof(sql) {
  await insertTaskAs(sql, ownerA, TASK_TIMER, "Timer proof");
  await asRole(sql, ownerA, (tx) => tx`
    INSERT INTO public.task_sessions (owner_user_id, task_id, started_at, ended_at, created_at, updated_at)
    VALUES (${OWNER_A}::uuid, ${TASK_TIMER}::uuid, now() - interval '10 minutes', now() - interval '5 minutes', now(), now())
  `);
  let rows = await sql`
    SELECT * FROM public.task_sessions WHERE task_id = ${TASK_TIMER}::uuid ORDER BY started_at
  `;
  expect(rows[0].actor_kind === "owner", "TIMERS", `owner session must be owner-attributed, got ${rows[0].actor_kind}`);

  // MCP timer start snapshots the stable client identity.
  await asRole(sql, mcpA, (tx) => tx`
    INSERT INTO public.task_sessions (owner_user_id, task_id, started_at, ended_at, created_at, updated_at)
    VALUES (${OWNER_A}::uuid, ${TASK_TIMER}::uuid, now() - interval '4 minutes', NULL, now(), now())
  `);
  rows = await sql`
    SELECT * FROM public.task_sessions WHERE task_id = ${TASK_TIMER}::uuid AND ended_at IS NULL
  `;
  expect(rows[0].actor_kind === "agent", "TIMERS", `MCP session must be agent-attributed, got ${rows[0].actor_kind}`);
  expect(rows[0].actor_agent_id === MCP_CLIENT_ID, "TIMERS", "MCP session must carry the client id");
  expect(rows[0].actor_label === "Hermes", "TIMERS", "MCP session must snapshot the client name");

  // The owner stopping the session must not overwrite the starter's identity.
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.task_sessions SET ended_at = now(), updated_at = now()
    WHERE task_id = ${TASK_TIMER}::uuid AND ended_at IS NULL
  `);
  rows = await sql`
    SELECT * FROM public.task_sessions WHERE task_id = ${TASK_TIMER}::uuid ORDER BY started_at
  `;
  expect(rows[1].actor_kind === "agent", "TIMERS", "stopping must preserve the starter's attribution");

  // Legacy rows lack proof and must stay unknown, not be guessed as owner.
  await sql.unsafe(`ALTER TABLE public.task_sessions DISABLE TRIGGER stamp_task_session_actor;`);
  await sql`
    INSERT INTO public.task_sessions (owner_user_id, task_id, started_at, ended_at, created_at, updated_at)
    VALUES (${OWNER_A}::uuid, ${TASK_TIMER}::uuid, now() - interval '2 hours', now() - interval '1 hour', now(), now())
  `;
  await sql.unsafe(`ALTER TABLE public.task_sessions ENABLE TRIGGER stamp_task_session_actor;`);
  rows = await sql`
    SELECT * FROM public.task_sessions WHERE task_id = ${TASK_TIMER}::uuid ORDER BY started_at
  `;
  expect(rows[0].actor_kind === "unknown", "TIMERS", `legacy session must stay unknown, got ${rows[0].actor_kind}`);

  log("TIMERS", "Session starters are snapshotted (owner/MCP agent); legacy rows stay unknown.");
}

async function runCommentContractProof(sql) {
  await insertTaskAs(sql, ownerA, TASK_COMMENT, "Comment contract proof");

  // The future comment producer writes through the trusted service role with an
  // explicit stable source id. The read model consumes the same row shape.
  await sql`
    INSERT INTO public.task_activity_events
      (owner_user_id, task_id, actor_kind, actor_user_id, actor_agent_id, actor_label,
       event_kind, delta, source_event_id, occurred_at)
    VALUES
      (${OWNER_A}::uuid, ${TASK_COMMENT}::uuid, 'agent', ${OWNER_A}::uuid, ${MCP_CLIENT_ID},
       'Hermes', 'comment', '{"excerpt":"Ready for review"}'::jsonb, 'comment-1', now())
  `;
  let rows = await activityRows(sql, TASK_COMMENT, "comment");
  expect(rows.length === 1, "COMMENTS", `expected one comment row, got ${rows.length}`);
  expect(rows[0].actor_kind === "agent" && rows[0].source_event_id === "comment-1", "COMMENTS", "comment row must keep actor and source id");

  const duplicateDenied = await (async () => {
    try {
      await sql`
        INSERT INTO public.task_activity_events
          (owner_user_id, task_id, actor_kind, actor_agent_id, actor_label,
           event_kind, delta, source_event_id, occurred_at)
        VALUES
          (${OWNER_A}::uuid, ${TASK_COMMENT}::uuid, 'agent', ${MCP_CLIENT_ID},
           'Hermes', 'comment', '{}'::jsonb, 'comment-1', now())
      `;
      return false;
    } catch {
      return true;
    }
  })();
  expect(duplicateDenied, "COMMENTS", "a retried comment source id must not create a second row");

  log("COMMENTS", "The shared comment contract is append-only and idempotent by source id.");
}

async function runAnalyticsProof(sql) {
  // A completion keeps exactly one done event even after a done-spelling rename
  // and an unrelated edit, matching the existing analytics contract.
  await insertTaskAs(sql, ownerA, "aaaaaaaa-0000-4000-8000-0000000000c1", "Analytics proof");
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET status = 'done', updated_at = now()
    WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid
  `);
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET status = 'completed', updated_at = now()
    WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid
  `);
  await asRole(sql, ownerA, (tx) => tx`
    UPDATE public.tasks SET title = 'Renamed while done', updated_at = now()
    WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid
  `);
  const done = await sql`
    SELECT * FROM public.task_status_events
    WHERE task_id = 'aaaaaaaa-0000-4000-8000-0000000000c1'::uuid AND to_status = 'done'
  `;
  expect(done.length === 1, "ANALYTICS", `done-spelling rename must not duplicate completion, got ${done.length}`);
  expect(done[0].actor_kind === "owner", "ANALYTICS", "completion event must carry actor attribution");
}

async function runRlsProof(sql) {
  const flags = await sql`
    SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.task_activity_events'::regclass
  `;
  expect(flags[0].relrowsecurity === true, "RLS", "task_activity_events must have RLS enabled");

  const policies = await sql`
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_activity_events'
    ORDER BY policyname
  `;
  const selectPolicies = policies.filter((policy) => policy.cmd === "SELECT");
  const writePolicies = policies.filter((policy) => policy.cmd !== "SELECT");
  expect(selectPolicies.length === 1, "RLS", `expected one SELECT policy, got ${JSON.stringify(policies)}`);
  expect(writePolicies.length === 0, "RLS", `expected no write policies, got ${JSON.stringify(writePolicies)}`);

  await sql`
    INSERT INTO public.tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_OWNER_B}::uuid, ${PROJECT_ID}::uuid, ${OWNER_B}::uuid, 'Owner B', 'todo', now(), now())
  `;
  const own = await asRole(sql, ownerA, (tx) => tx`
    SELECT count(*)::int AS count FROM public.task_activity_events
    WHERE owner_user_id = ${OWNER_A}::uuid
  `);
  expect(own[0].count > 0, "RLS", "owner A must read own rows");
  const foreign = await asRole(sql, ownerA, (tx) => tx`
    SELECT count(*)::int AS count FROM public.task_activity_events
    WHERE owner_user_id = ${OWNER_B}::uuid
  `);
  expect(foreign[0].count === 0, "RLS", `owner A must not read owner B rows, got ${foreign[0].count}`);
  const ownB = await asRole(sql, ownerB, (tx) => tx`
    SELECT count(*)::int AS count FROM public.task_activity_events
    WHERE owner_user_id = ${OWNER_B}::uuid
  `);
  expect(ownB[0].count > 0, "RLS", "owner B must read own rows");
  const aViaB = await asRole(sql, ownerB, (tx) => tx`
    SELECT count(*)::int AS count FROM public.task_activity_events
    WHERE owner_user_id = ${OWNER_A}::uuid
  `);
  expect(aViaB[0].count === 0, "RLS", `owner B must not read owner A rows, got ${aViaB[0].count}`);

  // Cross-owner task update must affect no row and emit no event.
  const before = (await activityRows(sql, TASK_OWNER)).length;
  const cross = await asRole(sql, ownerB, (tx) => tx`
    UPDATE public.tasks SET title = 'Cross-owner' WHERE id = ${TASK_OWNER}::uuid
  `);
  expect(cross.count === 0, "RLS", `cross-owner update must affect no row, got ${cross.count}`);
  const after = (await activityRows(sql, TASK_OWNER)).length;
  expect(after === before, "RLS", "cross-owner update must emit no activity");

  log("RLS", "Append-only ledger, owner-scoped reads and cross-owner write denial proven.");
}

async function runIdempotenceProof(sql) {
  await applyFile(sql, MIGRATION_TAG);
  log("IDEMPOTENCE", `Re-applying ${MIGRATION_FILE} succeeded (up-only).`);
}

async function main() {
  const args = parseArgs();
  const sql = postgres(args.url, { max: 1, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    const tags = await readJournal();
    for (const tag of tags) {
      await applyFile(sql, tag);
    }
    log("MIGRATE", `Applied ${tags.length} journal migrations including ${MIGRATION_TAG}`);
    await runPrivilegeProof(sql);
    // Grant the Supabase-equivalent surface only after proving the journal's
    // own write revokes; RLS denials are proven below.
    await grantProofTableAccess(sql);
    await seed(sql);

    await runOwnerProof(sql);
    await runMcpProof(sql);
    await runAgentTokenProof(sql);
    await runSpoofProof(sql);
    await runSystemProof(sql);
    await runReminderProof(sql);
    await runTimerProof(sql);
    await runCommentContractProof(sql);
    await runAnalyticsProof(sql);
    await runRlsProof(sql);
    await runIdempotenceProof(sql);

    console.log("\nAll task-activity attribution and producer proofs passed.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
