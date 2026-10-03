#!/usr/bin/env node
/**
 * Ephemeral-database proof for the MCP OAuth *database* authorization
 * surface: what an MCP OAuth bearer may actually do at the database, as
 * opposed to what the advertised `ega_*` tool contract permits at /api/mcp.
 *
 * The MCP runtime authenticates with the raw OAuth access token and hands the
 * same token to PostgREST as the `Authorization` header
 * (apps/web/src/lib/mcp/supabase-user-client.ts). The OAuth bearer therefore
 * maps to the same Postgres role (`authenticated`) as a browser session; the
 * only distinguishing JWT claim is `client_id`. Nothing above PostgREST - not
 * the tool schemas, not `MCP_WRITES_ENABLED`, not the Zod `.strict()` objects -
 * can constrain a direct `PATCH /rest/v1/tasks`. Only RLS, column privileges,
 * and database triggers can. This script proves that surface.
 *
 * Applies the full drizzle migration journal (plus the minimal Supabase shim
 * shared with the other scripts/db verifiers: auth schema, GUC-backed
 * auth.uid()/auth.jwt() stubs, Supabase roles, the 0043 reconciliation-owner
 * row, and the automation.implementation_runs stand-in) to a disposable
 * Postgres, then drives real `SET LOCAL ROLE authenticated` sessions carrying
 * an MCP-shaped JWT context (sub + client_id + aud) and asserts on *rows
 * affected / rows returned*, never on the mere absence of an exception: RLS
 * silently returns zero rows.
 *
 * Provenance: every assertion below is a regression test for a finding that
 * was reproduced against the real journal on `main` at 23317517 - the
 * `tasks_mcp_update_access` policy is a row predicate and could not restrict
 * columns, and seven owner-scoped tables created by 0045-0049 were never
 * included in the 0056 `client_id IS NULL` hardening pass. Both classes of
 * defect are asserted against in CONTRAST: a permitted case and its denied
 * twin, so a policy that silently widened would fail here.
 *
 * Sections:
 *   SCOPE-V1        a permissions-version-1 grant reaches exactly the v1
 *                   database surface and nothing newer
 *   SCOPE-V2        a permissions-version-2 grant reaches the new read domains
 *   COLUMN-FENCE    an MCP bearer holding tasks.update cannot write task
 *                   columns outside the advertised contract, and CAN write the
 *                   columns the contract does advertise
 *   CROSS-OWNER     every permitted MCP path rejects a foreign owner
 *   REVOCATION      a revoked grant loses ALL database capability immediately
 *   WRONG-CLIENT    same owner, wrong client_id -> denied
 *   WRONG-RESOURCE  same owner/client, wrong aud -> denied
 *   INTERNAL        device/provider infrastructure, internal MCP tables,
 *                   legacy agent tokens, calendar internals and the
 *                   task_status_events ledger stay unreachable
 *   AUDIT-TOOLS     the audit RPC accepts only registered tool names
 *   GRANT-SHAPE     the database refuses malformed permission/version documents
 *
 * Usage:
 *   node scripts/db/mcp-oauth-surface-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
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
  // Migration 0043 requires exactly one reconciliation owner row to exist.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const RESOURCE_URI = "https://ega.example.com/api/mcp";

const V1_READ_CLIENT = "v1-read-client";
const V1_WORKSPACE_CLIENT = "v1-workspace-client";
const V2_WORKSPACE_CLIENT = "v2-workspace-client";
const REVOKED_CLIENT = "revoked-client";

/** permissions_version 1 - exactly the documents shipped on main at 23317517. */
const V1_PERMISSIONS = {
  read_only: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "today.read",
    "timer.read",
  ],
  workspace_manager: [
    "projects.read",
    "projects.create",
    "projects.update",
    "goals.read",
    "goals.create",
    "goals.update",
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "today.read",
    "today.update",
    "timer.read",
    "timer.create",
    "timer.update",
  ],
};

/** permissions_version 2 - v1 plus the additive read domains. */
const V2_READ_PERMISSIONS = [
  "friction.read",
  "inbox.read",
  "notifications.read",
  "operator.read",
  "workload.read",
];

const V2_PERMISSIONS = {
  read_only: [...V1_PERMISSIONS.read_only, ...V2_READ_PERMISSIONS],
  workspace_manager: [...V1_PERMISSIONS.workspace_manager, ...V2_READ_PERMISSIONS],
};

/**
 * Owner-scoped tables that the 0056 hardening pass (and 0041) never covered
 * because they were created by 0045-0049 and left permissive. These are the
 * regression targets for SCOPE-V1 / SCOPE-V2.
 *
 * user_time_context is deliberately NOT in this list: it was already reachable
 * by any v1 principal holding today.read (ega_get_today_plan resolves the
 * owner's timezone through it), so its v1 exposure is advertised behaviour, not
 * drift. What was broken there was *write* access, asserted separately below.
 */
const NEW_DOMAIN_TABLES = [
  "notifications",
  "notification_preferences",
  "operator_proposals",
];

/** Readable by an existing v1 principal through an already-advertised capability. */
const V1_READABLE_TABLES = [
  "user_time_context",
];

/** New read surfaces opened by permissions_version 2. */
const V2_READ_TABLES = [
  ...NEW_DOMAIN_TABLES,
  ...V1_READABLE_TABLES,
  "idea_notes",
];

/**
 * Internal infrastructure and ledgers that stay unreachable at EVERY permission
 * version: the FCM provider credential, provider delivery state, and the inbox
 * idempotency dedup ledger. Exposing any of these would hand an MCP client
 * either a live push credential or the ability to defeat domain idempotency -
 neither is a workspace capability.
 */
const MCP_INTERNAL_TABLES = [
  "notification_devices",
  "notification_deliveries",
  "inbox_idempotency_keys",
];

const PROJECT_A = "44444444-4444-4444-8444-444444444441";
const PROJECT_B = "44444444-4444-4444-8444-444444444442";
const GOAL_A = "55555555-5555-4555-8555-555555555551";
const GOAL_B = "55555555-5555-4555-8555-555555555552";
const TASK_A = "66666666-6666-4666-8666-666666666661";
const TASK_B = "66666666-6666-4666-8666-666666666662";
const SESSION_A = "77777777-7777-4777-8777-777777777771";
const REMINDER_A = "88888888-8888-4888-8888-888888888881";

/**
 * An MCP session: exactly what PostgREST builds from an MCP OAuth bearer.
 * `client_id` present => MCP principal; absent => ordinary browser session.
 */
function mcpSession(sql, { userId = OWNER_A, clientId, resource = RESOURCE_URI } = {}) {
  return session(sql, { userId, claims: { client_id: clientId, aud: resource } });
}

/** An ordinary authenticated browser session (no `client_id` claim). */
function directUserSession(sql, { userId = OWNER_A } = {}) {
  return session(sql, { userId, claims: null });
}

function session(sql, { userId, claims }) {
  return {
    async run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        if (userId) {
          await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        }
        const jwt = claims ? { role: "authenticated", sub: userId, ...claims } : { role: "authenticated", sub: userId };
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(jwt)]);
        return fn(tx);
      });
    },
  };
}

async function capturePostgresError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? "UNKNOWN";
  }
}

/** Assert a statement is *refused* (42501 or a trigger raise). */
async function expectDenied(label, fn) {
  const code = await capturePostgresError(fn);
  assert(code === "42501", `${label} must be refused with SQLSTATE 42501, got ${code ?? "no error"}`);
}

/**
 * Assert a mutation is closed: either it is refused with 42501, or it succeeds
 * but matches zero rows. The statement must end in `RETURNING id` so the row
 * count is observable - RLS filters silently rather than raising.
 */
async function expectNoRows(label, fn) {
  let rows;
  try {
    rows = await fn();
  } catch (error) {
    const code = error?.code ?? "UNKNOWN";
    assert(code === "42501", `${label} must affect zero rows or be refused, got SQLSTATE ${code}`);
    return;
  }
  assert(Array.isArray(rows) && rows.length === 0, `${label} must affect zero rows, got ${rows?.length ?? "?"}`);
}

async function insertGrant(sql, { owner, client, profile, permissions, version, status = "active", resource = RESOURCE_URI }) {
  const [row] = await sql`
    INSERT INTO public.mcp_authorization_grants (
      owner_user_id, oauth_client_id, client_name, resource_uri, status,
      permission_profile, permissions, permissions_version, approved_at, revoked_at, updated_at
    ) VALUES (
      ${owner}::uuid, ${client}, ${client}, ${resource}, ${status},
      ${profile}, ${sql.json(permissions)}, ${version},
      now(), ${status === "revoked" ? sql`now()` : null}, now()
    )
    RETURNING id
  `;
  assert(row?.id, `failed to seed grant for ${client}`);
  return row.id;
}

/**
 * Assert a table is completely unreachable. Two acceptable shapes, both of
 * which are what production relies on: the table privilege was REVOKEd
 * (SQLSTATE 42501 at the ACL check, which is strictly stronger), or the policy
 * filtered every row (zero rows returned).
 */
/**
 * Tables whose SELECT privilege the migrations REVOKEd from `authenticated`.
 * For these, "unreachable" is already proven by the ACL - a strictly stronger
 * guarantee than a policy filter - so the proof asserts the privilege is
 * absent instead of issuing a query that can only raise. Computed once from
 * the catalogue after the journal is applied.
 */
let aclRevokedTables = new Set();

async function computeAclRevokedTables(sql) {
  const rows = await sql`
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
    ORDER BY c.relname
  `;
  aclRevokedTables = new Set(rows.map((row) => row.relname));
  log("PRIVILEGES", `ACL-revoked for authenticated: ${[...aclRevokedTables].join(", ") || "(none)"}`);
}

async function assertInvisible(tx, label, table) {
  if (aclRevokedTables.has(table)) return;
  const [row] = await tx.unsafe(`SELECT count(*)::int AS count FROM public.${table}`);
  assert(row.count === 0, `${label}: ${table} must return 0 rows, got ${row.count}`);
}

async function assertVisible(tx, label, table) {
  const [row] = await tx.unsafe(`SELECT count(*)::int AS count FROM public.${table}`);
  assert(row.count > 0, `${label}: ${table} must return rows for an authorized principal, got ${row.count}`);
}

async function seedDomainRows(sql) {
  await sql.unsafe(`
    INSERT INTO public.projects (id, owner_user_id, name, slug, description, status)
    VALUES
      ('${PROJECT_A}', '${OWNER_A}', 'A project', 'a-project', 'owner A', 'active'),
      ('${PROJECT_B}', '${OWNER_B}', 'B project', 'b-project', 'owner B', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.goals (id, owner_user_id, project_id, title, status)
    VALUES
      ('${GOAL_A}', '${OWNER_A}', '${PROJECT_A}', 'A goal', 'active'),
      ('${GOAL_B}', '${OWNER_B}', '${PROJECT_B}', 'B goal', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.tasks (id, owner_user_id, project_id, goal_id, title, status, priority)
    VALUES
      ('${TASK_A}', '${OWNER_A}', '${PROJECT_A}', '${GOAL_A}', 'A task', 'todo', 'medium'),
      ('${TASK_B}', '${OWNER_B}', '${PROJECT_B}', '${GOAL_B}', 'B task', 'todo', 'medium')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.task_sessions (id, owner_user_id, task_id, started_at)
    VALUES ('${SESSION_A}', '${OWNER_A}', '${TASK_A}', now() - interval '90 minutes')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.task_reminders (id, owner_user_id, task_id, remind_at, channel, delivery_mode, status)
    VALUES ('${REMINDER_A}', '${OWNER_A}', '${TASK_A}', now() + interval '2 hours', 'email', 'email', 'pending')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.notifications (id, owner_user_id, type, title, body, target_type, target_id, idempotency_key)
    VALUES ('99999999-9999-4999-8999-999999999991', '${OWNER_A}', 'task_reminder', 'Owner A reminder', 'private', 'task', '${TASK_A}', 'surface-proof-key')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_devices (id, owner_user_id, installation_id, platform, provider, provider_token)
    VALUES ('99999999-9999-4999-8999-999999999992', '${OWNER_A}', 'installation-a', 'android', 'fcm', 'fcm-token-secret')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_deliveries (id, notification_id, owner_user_id, channel, device_id, provider)
    VALUES ('99999999-9999-4999-8999-999999999995', '99999999-9999-4999-8999-999999999991', '${OWNER_A}', 'push', '99999999-9999-4999-8999-999999999992', 'fcm')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.idea_notes (id, owner_user_id, title, body, status, type)
    VALUES ('99999999-9999-4999-8999-999999999996', '${OWNER_A}', 'Owner A inbox item', 'body', 'inbox', 'idea')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_preferences (owner_user_id, notification_type, push_enabled, email_enabled)
    VALUES ('${OWNER_A}', 'task_reminder', true, true)
    ON CONFLICT (owner_user_id, notification_type) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.user_time_context (user_id, iana_timezone)
    VALUES ('${OWNER_A}', 'Europe/Berlin')
    ON CONFLICT (user_id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.operator_proposals (
      id, revision, owner_user_id, local_date, time_context_id, baseline_hash,
      proposed_task_ids, task_versions, idempotency_key, status
    ) VALUES (
      '99999999-9999-4999-8999-999999999993', 1, '${OWNER_A}', current_date,
      'Europe/Berlin', 'baseline-hash', '["${TASK_A}"]'::jsonb, '[]'::jsonb,
      'surface-proof-operator-key', 'generated'
    )
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.inbox_idempotency_keys (id, owner_user_id, key, inbox_item_id, fingerprint)
    VALUES ('99999999-9999-4999-8999-999999999994', '${OWNER_A}', 'capture-key-1', '99999999-9999-4999-8999-999999999996', 'fingerprint-1')
    ON CONFLICT (id) DO NOTHING
  `);
  log("SEED", "Owner-scoped domain rows seeded for both owners");
}

/**
 * Model Supabase's production privilege posture, which is what makes RLS the
 * only boundary: `authenticated` holds table-level DML on the owner-scoped
 * tables, so nothing above PostgREST (tool schemas, MCP_WRITES_ENABLED, Zod
 * `.strict()`) can narrow what a replayed bearer does.
 *
 * The three tables whose migrations explicitly `REVOKE`d client access
 * (mcp_mutation_receipts, mcp_rate_limit_windows, agent_integration_tokens)
 * are deliberately NOT re-granted here: that revocation is part of what the
 * proof asserts.
 */
async function grantClientTablePrivileges(sql) {
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.projects,
      public.goals,
      public.tasks,
      public.task_sessions,
      public.task_reminders,
      public.week_reviews,
      public.idea_notes,
      public.task_recurrences,
      public.task_external_refs,
      public.task_saved_views,
      public.task_status_events,
      public.calendar_integration_settings,
      public.calendar_sync_jobs,
      public.agent_integration_events,
      public.notifications,
      public.notification_devices,
      public.notification_deliveries,
      public.notification_preferences,
      public.user_time_context,
      public.operator_proposals,
      public.inbox_idempotency_keys,
      public.mcp_authorization_grants
    TO authenticated
  `);
  log("PRIVILEGES", "Modelled Supabase's table-level DML posture for the authenticated role (RLS is the only boundary)");
}

async function migrate(sql) {
  const journal = await readJournal();
  for (const tag of journal) {
    await applyFile(sql, tag);
  }
  log("MIGRATE", `Applied ${journal.length} migrations from the drizzle journal`);
}

// ---------------------------------------------------------------------------
// SCOPE-V1 / SCOPE-V2
// ---------------------------------------------------------------------------

async function assertScopeV1(sql) {
  const session = mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT });
  await session.run(async (tx) => {
    // The v1 grant legitimately reaches the v1 surface.
    await assertVisible(tx, "v1 workspace_manager", "projects");
    await assertVisible(tx, "v1 workspace_manager", "goals");
    await assertVisible(tx, "v1 workspace_manager", "tasks");
    await assertVisible(tx, "v1 workspace_manager", "task_sessions");
    // ega_get_today_plan resolves the owner's timezone through
    // user_time_context, so this exposure is advertised behaviour and must
    // survive the hardening.
    for (const table of V1_READABLE_TABLES) {
      await assertVisible(tx, "v1 workspace_manager", table);
    }

    // It must reach nothing in the newer domains: those permissions were
    // never consented to.
    for (const table of NEW_DOMAIN_TABLES) {
      await assertInvisible(tx, "v1 workspace_manager", table);
    }
    for (const table of MCP_INTERNAL_TABLES) {
      await assertInvisible(tx, "v1 workspace_manager", table);
    }
  });
  log("SCOPE-V1", "A permissions_version 1 workspace_manager grant sees exactly the v1 surface; no newer domain leaked.");

  // Mutating those tables must be equally closed, not merely unreadable.
  await expectNoRows("v1 operator_proposals lifecycle write", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.operator_proposals SET status = 'applied' WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]),
    ),
  );
  await expectNoRows("v1 notification_preferences write", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.notification_preferences SET push_enabled = false WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]),
    ),
  );
  await expectNoRows("v1 user_time_context write", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.user_time_context SET iana_timezone = 'Mars/Olympus' WHERE user_id = $1::uuid RETURNING user_id`, [OWNER_A]),
    ),
  );
  await expectNoRows("v1 inbox_idempotency_keys delete", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`DELETE FROM public.inbox_idempotency_keys WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]),
    ),
  );
  await expectNoRows("v1 notification read_at write", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.notifications SET read_at = now() WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]),
    ),
  );
  log("SCOPE-V1", "A permissions_version 1 grant cannot write, delete, or reach lifecycle state in any newer domain.");
}

async function assertScopeV2(sql) {
  await mcpSession(sql, { clientId: V2_WORKSPACE_CLIENT }).run(async (tx) => {
    for (const table of V2_READ_TABLES) {
      await assertVisible(tx, "v2 workspace_manager", table);
    }
    await assertVisible(tx, "v2 workspace_manager", "tasks");
    await assertVisible(tx, "v2 workspace_manager", "task_sessions");
    // Even at v2 the internal ledgers and the push credential stay closed.
    for (const table of MCP_INTERNAL_TABLES) {
      await assertInvisible(tx, "v2 workspace_manager", table);
    }
  });
  log("SCOPE-V2", "A permissions_version 2 grant reaches every v2 read surface; the push credential, provider deliveries and the inbox dedup ledger stay closed.");
}

// ---------------------------------------------------------------------------
// COLUMN-FENCE
// ---------------------------------------------------------------------------

async function assertColumnFence(sql) {
  const session = mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT });

  // Permitted: every column the ega_* task contract does advertise.
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET title = 'renamed via contract', updated_at = now() WHERE id = $1::uuid RETURNING id`,
      [TASK_A],
    );
    assert(rows.length === 1, "tasks.title is advertised by ega_update_task and must remain writable");
  });
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET archived_at = now(), archived_by = $1::uuid WHERE id = $2::uuid RETURNING id`,
      [OWNER_A, TASK_A],
    );
    assert(rows.length === 1, "tasks.archived_at is advertised by ega_archive_task and must remain writable");
  });
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET planned_for_date = current_date WHERE id = $1::uuid RETURNING id`,
      [TASK_A],
    );
    assert(rows.length === 1, "tasks.planned_for_date is advertised by ega_plan_task_for_today and must remain writable");
  });
  log("COLUMN-FENCE", "Advertised task columns (title, archived_at, planned_for_date) remain writable through the database.");

  // Denied: columns no ega_* tool exposes. Each of these was reproduced as
  // writable on main at 23317517.
  const fenced = [
    ["scheduled_start_at", `UPDATE public.tasks SET scheduled_start_at = now() + interval '1 day' WHERE id = $1::uuid`],
    ["scheduled_end_at", `UPDATE public.tasks SET scheduled_end_at = now() + interval '2 days' WHERE id = $1::uuid`],
    ["calendar_sync_enabled", `UPDATE public.tasks SET calendar_sync_enabled = true WHERE id = $1::uuid`],
    ["calendar_reminder_minutes", `UPDATE public.tasks SET calendar_reminder_minutes = 999 WHERE id = $1::uuid`],
    ["calendar_event_id", `UPDATE public.tasks SET calendar_event_id = 'forged-gcal-event' WHERE id = $1::uuid`],
    ["calendar_sync_status", `UPDATE public.tasks SET calendar_sync_status = 'synced' WHERE id = $1::uuid`],
    ["calendar_sync_failure_reason", `UPDATE public.tasks SET calendar_sync_failure_reason = 'x' WHERE id = $1::uuid`],
    ["id", `UPDATE public.tasks SET id = gen_random_uuid() WHERE id = $1::uuid`],
    ["created_at", `UPDATE public.tasks SET created_at = '2000-01-01T00:00:00Z'::timestamptz WHERE id = $1::uuid`],
  ];
  for (const [column, statement] of fenced) {
    await expectDenied(`tasks.${column} out-of-contract write`, () =>
      session.run((tx) => tx.unsafe(`${statement}`, [TASK_A])),
    );
  }
  log("COLUMN-FENCE", `All ${fenced.length} out-of-contract task columns were refused at the database.`);

  // mcp_operation_id / mcp_client_id stay writable because the application
  // itself writes them on every operationId-carrying mutation (0059). Forging
  // them is self-limiting - the unique index is (owner, client, operation) and
  // a collision can only fail the principal's own row - so they are an
  // application-written column, not an advertised-tool gap. Prove that:
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET mcp_client_id = $1, mcp_operation_id = gen_random_uuid() WHERE id = $2::uuid RETURNING id`,
      [V1_WORKSPACE_CLIENT, TASK_A],
    );
    assert(rows.length === 1, "the application-written idempotency fence columns must remain writable");
  });

  // INSERT-time fence: the calendar/scheduled columns have no usable default
  // so a non-default value proves an explicit, out-of-contract choice.
  for (const [column, expression] of [
    ["scheduled_start_at", `now() + interval '1 day'`],
    ["scheduled_end_at", `now() + interval '2 days'`],
    ["calendar_event_id", `'forged-gcal-event'`],
    ["calendar_sync_status", `'synced'`],
    ["calendar_sync_failure_reason", `'forged'`],
    ["calendar_sync_enabled", `true`],
    ["calendar_reminder_minutes", `999`],
  ]) {
    await expectDenied(`tasks.${column} out-of-contract INSERT`, () =>
      session.run((tx) =>
        tx.unsafe(
          `INSERT INTO public.tasks (project_id, title, ${column}) VALUES ($1::uuid, 'fenced', ${expression})`,
          [PROJECT_A],
        ),
      ),
    );
  }
  log("COLUMN-FENCE", "Out-of-contract task columns are refused on INSERT as well as UPDATE.");

  // Other MCP-writable tables get the same treatment on their own columns.
  await expectDenied("projects.name out-of-contract write", () =>
    session.run((tx) => tx.unsafe(`UPDATE public.projects SET name = 'renamed' WHERE id = $1::uuid`, [PROJECT_A])),
  );
  await expectDenied("projects.slug out-of-contract write", () =>
    session.run((tx) => tx.unsafe(`UPDATE public.projects SET slug = 'hijacked' WHERE id = $1::uuid`, [PROJECT_A])),
  );
  await expectDenied("goals.title out-of-contract write", () =>
    session.run((tx) => tx.unsafe(`UPDATE public.goals SET title = 'renamed' WHERE id = $1::uuid`, [GOAL_A])),
  );
  await expectDenied("goals.slug out-of-contract write", () =>
    session.run((tx) => tx.unsafe(`UPDATE public.goals SET slug = 'hijacked' WHERE id = $1::uuid`, [GOAL_A])),
  );
  // task_reminders has no MCP UPDATE policy at all, so this is a row filter
  // rather than a fence: an MCP bearer cannot drive a reminder to 'sent' and
  // bypass the delivery worker either way.
  await expectNoRows("task_reminders.status out-of-contract write", () =>
    session.run((tx) =>
      tx.unsafe(`UPDATE public.task_reminders SET status = 'sent', sent_at = now() WHERE id = $1::uuid RETURNING id`, [REMINDER_A]),
    ),
  );
  log("COLUMN-FENCE", "projects/goals/task_reminders out-of-contract column writes were refused.");

  // A direct browser session must not be affected by the fence.
  await directUserSession(sql).run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET scheduled_start_at = now() + interval '1 day', scheduled_end_at = now() + interval '2 days' WHERE id = $1::uuid RETURNING id`,
      [TASK_A],
    );
    assert(rows.length === 1, "the MCP write fence must not constrain ordinary owner sessions");
  });
  await directUserSession(sql).run(async (tx) => {
    const rows = await tx.unsafe(`UPDATE public.projects SET name = 'renamed by owner' WHERE id = $1::uuid RETURNING id`, [PROJECT_A]);
    assert(rows.length === 1, "the MCP write fence must not constrain ordinary owner sessions on projects");
  });
  log("COLUMN-FENCE", "Direct owner sessions keep unrestricted column access.");
}

// ---------------------------------------------------------------------------
// CROSS-OWNER / REVOCATION / WRONG CLIENT / WRONG RESOURCE
// ---------------------------------------------------------------------------

const CROSS_OWNER_TABLES = [
  ["projects", "owner_user_id"],
  ["goals", "owner_user_id"],
  ["tasks", "owner_user_id"],
  ["task_sessions", "owner_user_id"],
  ...NEW_DOMAIN_TABLES.map((table) => [table, "owner_user_id"]),
  ...V1_READABLE_TABLES.map((table) => [table, "user_id"]),
];

async function assertCrossOwner(sql, clientIds) {
  for (const [label, clientId] of clientIds) {
    await mcpSession(sql, { clientId }).run(async (tx) => {
      for (const [table, ownerColumn] of CROSS_OWNER_TABLES) {
        if (aclRevokedTables.has(table)) continue;
        const [row] = await tx.unsafe(
          `SELECT count(*)::int AS count FROM public.${table} WHERE ${ownerColumn} <> $1::uuid`,
          [OWNER_A],
        );
        assert(
          row.count === 0,
          `${label} cross-owner: ${table} leaked ${row.count} row(s) not owned by the caller`,
        );
      }
      // The owner must still be able to see their own rows, otherwise
      // "invisible" would be passing for the wrong reason.
      const [own] = await tx.unsafe(
        `SELECT count(*)::int AS count FROM public.tasks WHERE owner_user_id = $1::uuid`,
        [OWNER_A],
      );
      assert(own.count === 1, `${label}: the caller must still see their own rows`);
    });
  }
  log("CROSS-OWNER", "Every permitted MCP path filtered the foreign owner's rows while still serving the caller's own.");

  // Moving a task into another owner's project must be refused even though the
  // row itself stays owner-scoped. main lost this check in 0041/0051.
  await expectDenied("cross-owner project reassignment", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET project_id = $1::uuid WHERE id = $2::uuid`, [PROJECT_B, TASK_A]),
    ),
  );
  await expectDenied("cross-owner goal reassignment", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.goals SET project_id = $1::uuid WHERE id = $2::uuid`, [PROJECT_B, GOAL_A]),
    ),
  );
  await expectDenied("owner reassignment", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET owner_user_id = $1::uuid WHERE id = $2::uuid`, [OWNER_B, TASK_A]),
    ),
  );
  log("CROSS-OWNER", "Cross-owner project/goal/owner reassignment was refused.");
}

async function assertRevocation(sql) {
  const before = await sql.unsafe(`SELECT status, revoked_at FROM public.mcp_authorization_grants WHERE oauth_client_id = '${REVOKED_CLIENT}'`);
  assert(before[0].status === "revoked", "the revoked fixture must be revoked");

  await mcpSession(sql, { clientId: REVOKED_CLIENT }).run(async (tx) => {
    for (const table of ["projects", "goals", "tasks", "task_sessions", ...NEW_DOMAIN_TABLES, ...MCP_INTERNAL_TABLES]) {
      await assertInvisible(tx, "revoked grant", table);
    }
  });
  await expectNoRows("revoked grant task write", () =>
    mcpSession(sql, { clientId: REVOKED_CLIENT }).run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET title = 'after revocation' WHERE id = $1::uuid RETURNING id`, [TASK_A]),
    ),
  );
  const grants = await mcpSession(sql, { clientId: REVOKED_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT count(*)::int AS count FROM public.mcp_authorization_grants`),
  );
  assert(grants[0].count === 0, "a revoked grant must not be able to read the grant table");
  log("REVOCATION", "A revoked grant lost every database capability immediately, including the newer domains.");
}

async function assertWrongIdentity(sql) {
  const contexts = [
    ["wrong client", mcpSession(sql, { clientId: "not-a-real-client" })],
    ["wrong resource", mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT, resource: "https://evil.example.com/api/mcp" })],
    ["wrong owner", mcpSession(sql, { userId: OWNER_B, clientId: V1_WORKSPACE_CLIENT })],
  ];
  for (const [label, session] of contexts) {
    await session.run(async (tx) => {
      for (const table of ["projects", "goals", "tasks", ...NEW_DOMAIN_TABLES, ...MCP_INTERNAL_TABLES]) {
        await assertInvisible(tx, label, table);
      }
    });
  }
  log("WRONG-CLIENT", "Wrong client_id, wrong aud, and wrong sub each produced an empty database surface.");
}

// ---------------------------------------------------------------------------
// INTERNAL
// ---------------------------------------------------------------------------

async function assertInternalUnreachable(sql, clientId = V1_WORKSPACE_CLIENT) {
  await mcpSession(sql, { clientId }).run(async (tx) => {
    for (const table of MCP_INTERNAL_TABLES) {
      await assertInvisible(tx, "broadest v1 grant", table);
    }
    for (const table of [
      "mcp_authorization_grants",
      "mcp_mutation_receipts",
      "mcp_rate_limit_windows",
      "agent_integration_events",
      "agent_integration_tokens",
      "calendar_integration_settings",
      "calendar_sync_jobs",
      "task_status_events",
      "task_saved_views",
      "task_external_refs",
      "idea_notes",
      "week_reviews",
      "task_recurrences",
    ]) {
      await assertInvisible(tx, "broadest v1 grant", table);
    }
  });
  log("INTERNAL", "Internal MCP tables, legacy agent tokens, calendar internals, the status-event ledger and ungranted domains stayed unreachable.");

  await expectDenied("notification device claim RPC", () =>
    mcpSession(sql, { clientId }).run((tx) =>
      tx.unsafe(`SELECT public.claim_notification_device($1, $2, $3, $4)`, ["installation-attacker", "android", "fcm", "attacker-token"]),
    ),
  );
  await expectDenied("task_status_events INSERT", () =>
    mcpSession(sql, { clientId }).run((tx) =>
      tx.unsafe(
        `INSERT INTO public.task_status_events (owner_user_id, task_id, from_status, to_status) VALUES ($1::uuid, $2::uuid, 'todo', 'done')`,
        [OWNER_A, TASK_A],
      ),
    ),
  );
  log("INTERNAL", "Device-claim RPC and the status-event ledger refused direct MCP writes.");
}

// ---------------------------------------------------------------------------
// AUDIT-TOOLS
// ---------------------------------------------------------------------------

async function assertAuditToolAllowlist(sql) {
  const call = (toolName) =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(
        `SELECT public.record_mcp_audit_event($1, $2, 'success', 1, NULL, '{}'::jsonb)`,
        [`surface-proof-${toolName}`, toolName],
      ),
    );

  await call("ega_list_projects");
  log("AUDIT-TOOLS", "A registered tool name was accepted by the audit RPC.");

  await expectDenied("forged audit tool name", () => call("forged_tool_that_does_not_exist"));
  log("AUDIT-TOOLS", "An unregistered tool name was refused by the audit RPC.");

  const [row] = await sql`
    SELECT count(*)::int AS count
    FROM public.agent_integration_events
    WHERE tool_name = 'forged_tool_that_does_not_exist'
  `;
  assert(row.count === 0, "a refused audit tool name must not leave a row behind");
}

// ---------------------------------------------------------------------------
// GRANT-SHAPE
// ---------------------------------------------------------------------------

async function assertGrantShape(sql) {
  // Live authority is what the database must police, so the malformed-document
  // cases are all written as ACTIVE rows.
  const activeCases = [
    ["v1 read_only", { profile: "read_only", permissions: V1_PERMISSIONS.read_only, version: 1, expect: null }],
    ["v1 workspace_manager", { profile: "workspace_manager", permissions: V1_PERMISSIONS.workspace_manager, version: 1, expect: null }],
    ["v2 read_only", { profile: "read_only", permissions: V2_PERMISSIONS.read_only, version: 2, expect: null }],
    ["v2 workspace_manager", { profile: "workspace_manager", permissions: V2_PERMISSIONS.workspace_manager, version: 2, expect: null }],
    [
      "unknown permission",
      { profile: "read_only", permissions: ["projects.read", "not.a.permission"], version: 2, expect: "23514" },
    ],
    [
      "empty permission document",
      { profile: "read_only", permissions: [], version: 2, expect: "23514" },
    ],
    [
      "unknown permission version",
      { profile: "read_only", permissions: V1_PERMISSIONS.read_only, version: 99, expect: "23514" },
    ],
    [
      "v1 version carrying the v2 document",
      { profile: "workspace_manager", permissions: V2_PERMISSIONS.workspace_manager, version: 1, expect: "23514" },
    ],
    [
      "v2 version carrying the v1 document",
      { profile: "workspace_manager", permissions: V1_PERMISSIONS.workspace_manager, version: 2, expect: "23514" },
    ],
    [
      "v2 version carrying a v1 document plus one extra permission",
      {
        profile: "read_only",
        permissions: [...V1_PERMISSIONS.read_only, "friction.read"],
        version: 2,
        expect: "23514",
      },
    ],
  ];

  for (const [label, spec] of activeCases) {
    const code = await capturePostgresError(() =>
      insertGrant(sql, {
        owner: OWNER_A,
        client: `shape-${label.replaceAll(" ", "-")}`,
        status: "active",
        profile: spec.profile,
        permissions: spec.permissions,
        version: spec.version,
      }),
    );
    if (spec.expect === null) {
      assert(code === null, `${label} must be accepted by the database, got SQLSTATE ${code}`);
    } else {
      assert(code === spec.expect, `${label} must fail closed with SQLSTATE ${spec.expect}, got ${code ?? "no error"}`);
    }
  }
  log("GRANT-SHAPE", "Valid v1/v2 documents were accepted; unknown permissions, empty documents, unknown versions and version/document mismatches were refused.");

  // Backwards compatibility for rows that already exist: a terminal grant
  // written by an older deployment, carrying a legacy short read_only or
  // task_manager document, must remain representable after this migration.
  const legacyCases = [
    ["legacy terminal read_only", { profile: "read_only", permissions: ["projects.read", "goals.read", "tasks.read"], version: 1 }],
    ["legacy terminal task_manager", { profile: "task_manager", permissions: ["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"], version: 1 }],
    ["terminal v1 workspace_manager", { profile: "workspace_manager", permissions: V1_PERMISSIONS.workspace_manager, version: 1 }],
    ["terminal v2 workspace_manager", { profile: "workspace_manager", permissions: V2_PERMISSIONS.workspace_manager, version: 2 }],
    ["terminal v2 read_only", { profile: "read_only", permissions: V2_PERMISSIONS.read_only, version: 2 }],
    ["terminal delivery_observer", { profile: "delivery_observer", permissions: ["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"], version: 1 }],
  ];
  for (const [label, spec] of legacyCases) {
    const code = await capturePostgresError(() =>
      insertGrant(sql, {
        owner: OWNER_A,
        client: `legacy-${label.replaceAll(" ", "-")}`,
        status: "revoked",
        profile: spec.profile,
        permissions: spec.permissions,
        version: spec.version,
      }),
    );
    assert(code === null, `${label} must remain representable, got SQLSTATE ${code}`);
  }
  log("GRANT-SHAPE", "Terminal/legacy grant documents written by earlier deployments remain representable.");
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  const sql = postgres(args.url, { max: 1, onnotice: () => {} });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    await migrate(sql);
    await grantClientTablePrivileges(sql);
    await computeAclRevokedTables(sql);
    await seedDomainRows(sql);

    await insertGrant(sql, {
      owner: OWNER_A,
      client: V1_READ_CLIENT,
      profile: "read_only",
      permissions: V1_PERMISSIONS.read_only,
      version: 1,
    });
    await insertGrant(sql, {
      owner: OWNER_A,
      client: V1_WORKSPACE_CLIENT,
      profile: "workspace_manager",
      permissions: V1_PERMISSIONS.workspace_manager,
      version: 1,
    });
    await insertGrant(sql, {
      owner: OWNER_A,
      client: REVOKED_CLIENT,
      profile: "workspace_manager",
      permissions: V1_PERMISSIONS.workspace_manager,
      version: 1,
      status: "revoked",
    });
    log("SEED", "Grants seeded: v1 read_only, v1 workspace_manager, v1 revoked");

    // The v1-only assertions run first so the surface proof still produces
    // discriminating output on a revision that does not yet know about
    // permissions_version 2.
    await assertScopeV1(sql);
    await assertColumnFence(sql);
    await assertRevocation(sql);
    await assertWrongIdentity(sql);
    await assertInternalUnreachable(sql, V1_WORKSPACE_CLIENT);
    await assertAuditToolAllowlist(sql);
    await assertGrantShape(sql);
    await assertCrossOwner(sql, [["v1", V1_WORKSPACE_CLIENT]]);

    await insertGrant(sql, {
      owner: OWNER_A,
      client: V2_WORKSPACE_CLIENT,
      profile: "workspace_manager",
      permissions: V2_PERMISSIONS.workspace_manager,
      version: 2,
    });
    log("SEED", "permissions_version 2 grant seeded");

    await assertScopeV2(sql);
    await assertCrossOwner(sql, [["v2", V2_WORKSPACE_CLIENT]]);

    console.log("\n[PROOF] OK - the MCP OAuth database surface matches the advertised MCP contract.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
