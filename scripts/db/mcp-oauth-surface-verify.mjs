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
 *   DIRECT-USER-PARITY
 *                   the same policies do not narrow ordinary owner sessions:
 *                   42 legitimate owner writes and reads across every table the
 *                   MCP hardening touched, plus owner isolation and the
 *                   installed state of the fence triggers
 *   CROSS-OWNER     every permitted MCP path rejects a foreign owner
 *   RPC-SURFACE     every function `authenticated` may EXECUTE is enumerated
 *                   from the catalog and classified; direct-user-only RPCs
 *                   refuse an MCP bearer; MCP-internal RPCs remain reachable
 *                   and token-fenced
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
const PROJECT_A2 = "44444444-4444-4444-8444-444444444443";
const PROJECT_B = "44444444-4444-4444-8444-444444444442";
const GOAL_A = "55555555-5555-4555-8555-555555555551";
const GOAL_A2 = "55555555-5555-4555-8555-555555555553";
const GOAL_B = "55555555-5555-4555-8555-555555555552";
const TASK_A = "66666666-6666-4666-8666-666666666661";
/** Owner-created during the parity run; has no dependents, so its key is rewritable. */
const TASK_NEW = "66666666-6666-4666-8666-6666666666aa";
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

/** Assert a statement is *refused* by the authorization boundary (42501). */
async function expectDenied(label, fn) {
  const code = await capturePostgresError(fn);
  assert(code === "42501", `${label} must be refused with SQLSTATE 42501, got ${code ?? "no error"}`);
}

/**
 * Assert a statement is refused, allowing a documented set of SQLSTATEs.
 * Used where the refusal is correct but the mechanism is not the RLS/policy
 * path - e.g. PostgreSQL refusing to invoke a trigger function as an RPC
 * (0A000) is exactly as unreachable as a 42501.
 */
async function expectRefused(label, allowedCodes, fn) {
  const code = await capturePostgresError(fn);
  assert(
    code !== null && allowedCodes.includes(code),
    `${label} must be refused with one of ${allowedCodes.join("/")}, got ${code ?? "no error"}`,
  );
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
      ('${PROJECT_A2}', '${OWNER_A}', 'A second project', 'a-second-project', 'owner A again', 'active'),
      ('${PROJECT_B}', '${OWNER_B}', 'B project', 'b-project', 'owner B', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.goals (id, owner_user_id, project_id, title, status)
    VALUES
      ('${GOAL_A}', '${OWNER_A}', '${PROJECT_A}', 'A goal', 'active'),
      ('${GOAL_A2}', '${OWNER_A}', '${PROJECT_A2}', 'A second goal', 'active'),
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
      // The owner must still see their own seeded row, otherwise "invisible"
      // would be passing for the wrong reason (an empty table reads as success).
      const own = await tx.unsafe(
        `SELECT id FROM public.tasks WHERE id = $1::uuid AND owner_user_id = $2::uuid`,
        [TASK_A, OWNER_A],
      );
      assert(own.length === 1, `${label}: the caller must still see their own seeded task`);
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
// DIRECT-USER-PARITY
// ---------------------------------------------------------------------------

/**
 * The MCP hardening must not have narrowed ordinary owner sessions.
 *
 * This is asserted separately and positively. Inferring parity from "the MCP
 * denial passed" would be unsound: the same policy that refuses an MCP
 * principal could refuse a direct one and every MCP assertion would still be
 * green. Each case below is a write the product legitimately performs, so a
 * failure here is a product regression rather than a security improvement.
 */
async function assertDirectUserParity(sql) {
  const owner = directUserSession(sql, { userId: OWNER_A });
  const otherOwner = directUserSession(sql, { userId: OWNER_B });

  const cases = [
    // Tasks: the ordinary editing surface.
    ["tasks ordinary fields", `UPDATE public.tasks SET title = 'owner edit', description = 'd',
        blocked_reason = null, status = 'in_progress', priority = 'high',
        due_date = current_date, estimate_minutes = 30 WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    // Tasks: scheduling. The MCP fence must be completely inert here, because
    // apps/web/src/lib/services/task-service.ts writes scheduled_* directly.
    ["tasks scheduling window", `UPDATE public.tasks SET scheduled_start_at = now() + interval '1 day',
        scheduled_end_at = now() + interval '1 day 2 hours' WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    ["tasks scheduling cleared", `UPDATE public.tasks SET scheduled_start_at = NULL,
        scheduled_end_at = NULL WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    // Tasks: the Google Calendar mirror. The calendar sync worker and the
    // product's own reschedule path both own these columns.
    ["tasks calendar mirror", `UPDATE public.tasks SET calendar_sync_enabled = true,
        calendar_reminder_minutes = 45, calendar_event_id = 'owner-event',
        calendar_sync_status = 'pending', calendar_sync_failure_reason = 'retrying'
        WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    ["tasks focus rank", `UPDATE public.tasks SET focus_rank = 3 WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    ["tasks archive and unarchive", `UPDATE public.tasks SET archived_at = now(), archived_by = $1::uuid
        WHERE id = $2::uuid RETURNING id`, [OWNER_A, TASK_A]],
    ["tasks unarchive", `UPDATE public.tasks SET archived_at = NULL, archived_by = NULL
        WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    // Tasks: back-dating creation and forcing the primary key stay owner-only.
    ["tasks created_at backdated", `UPDATE public.tasks SET created_at = '2020-01-01T00:00:00Z'::timestamptz
        WHERE id = $1::uuid RETURNING id`, [TASK_A]],
    // Rewriting the primary key is owner-only. On a task with children the FK
    // legitimately refuses it, so prove it on a row the owner just created.
    ["tasks inserted by owner", `INSERT INTO public.tasks (id, owner_user_id, project_id, title)
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'owner-created') RETURNING id`, [TASK_NEW, OWNER_A, PROJECT_A]],
    ["tasks primary key rewritten", `UPDATE public.tasks SET id = $1::uuid WHERE id = $2::uuid RETURNING id`,
      ["66666666-6666-4666-8666-6666666666ff", TASK_NEW]],
    // Referential moves that stay inside the owner's own hierarchy.
    ["tasks reassigned within owner", `UPDATE public.tasks SET project_id = $1::uuid WHERE id = $2::uuid RETURNING id`,
      [PROJECT_A2, TASK_A]],
    ["tasks goal reassigned within owner", `UPDATE public.tasks SET goal_id = $1::uuid WHERE id = $2::uuid RETURNING id`,
      [GOAL_A2, TASK_A]],
    ["tasks completed_at set directly", `UPDATE public.tasks SET status = 'done', completed_at = now()
        WHERE id = $1::uuid RETURNING id`, [TASK_A]],

    // Projects and goals: the owner renames and re-parents their own rows.
    ["projects renamed", `UPDATE public.projects SET name = 'renamed', slug = 'renamed-slug',
        description = 'changed', status = 'archived' WHERE id = $1::uuid RETURNING id`, [PROJECT_A]],
    ["goals edited and re-parented", `UPDATE public.goals SET title = 'renamed', slug = 'renamed-slug',
        description = 'changed', health = 'on_track', next_step = 'do it', status = 'active',
        project_id = $1::uuid WHERE id = $2::uuid RETURNING id`, [PROJECT_A2, GOAL_A]],

    // Timer sessions: the seeded session is still open, and the product allows
    // only one open session per owner+task, so close it before starting another.
    ["task_sessions closed", `UPDATE public.task_sessions SET ended_at = now() + interval '45 minutes',
        duration_seconds = 2700 WHERE id = $1::uuid RETURNING id`, [SESSION_A]],
    ["task_sessions inserted", `INSERT INTO public.task_sessions (owner_user_id, task_id, started_at)
        VALUES ($1::uuid, $2::uuid, now()) RETURNING id`, [OWNER_A, TASK_A]],

    // Reminders: create then cancel, the reminder path.
    ["task_reminders inserted", `INSERT INTO public.task_reminders (owner_user_id, task_id, remind_at,
        channel, delivery_mode, source, source_id)
        VALUES ($1::uuid, $2::uuid, now() + interval '3 hours', 'email', 'email', 'owner', 'owner-src-1')
        RETURNING id`, [OWNER_A, TASK_A]],
    ["task_reminders marked sent", `UPDATE public.task_reminders SET status = 'sent', sent_at = now()
        WHERE id = $1::uuid RETURNING id`, [REMINDER_A]],
    ["task_reminders deleted", `DELETE FROM public.task_reminders WHERE id = $1::uuid RETURNING id`, [REMINDER_A]],

    // The 0045-0049 tables the hardening replaced. These are exactly the ones
    // whose policies were rewritten, so owner parity matters most here.
    ["notifications read", `UPDATE public.notifications SET read_at = now(), opened_at = now()
        WHERE id = $1::uuid RETURNING id`, ["99999999-9999-4999-8999-999999999991"]],
    ["notification preferences disabled", `UPDATE public.notification_preferences SET push_enabled = false,
        email_enabled = false WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],
    ["notification preferences re-enabled", `UPDATE public.notification_preferences SET push_enabled = true,
        email_enabled = true WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],
    ["notification preferences deleted", `DELETE FROM public.notification_preferences
        WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],
    ["user time context written", `INSERT INTO public.user_time_context (user_id, iana_timezone)
        VALUES ($1::uuid, 'Europe/Berlin') ON CONFLICT (user_id) DO UPDATE SET iana_timezone = 'Europe/Berlin'
        RETURNING user_id`, [OWNER_A]],
    ["user time context deleted", `DELETE FROM public.user_time_context WHERE user_id = $1::uuid RETURNING user_id`,
      [OWNER_A]],
    ["operator proposal inserted", `INSERT INTO public.operator_proposals (revision, owner_user_id,
        local_date, time_context_id, baseline_hash, proposed_task_ids, task_versions, idempotency_key, status)
        VALUES (1, $1::uuid, current_date, 'Europe/Berlin', 'direct-hash', '[]'::jsonb, '[]'::jsonb,
        'direct-owner-key', 'generated') RETURNING id`, [OWNER_A]],
    ["operator proposal approved", `UPDATE public.operator_proposals SET status = 'approved', approved_at = now()
        WHERE idempotency_key = 'direct-owner-key' RETURNING id`, []],
    ["operator proposal applied", `UPDATE public.operator_proposals SET status = 'applied', applied_at = now()
        WHERE idempotency_key = 'direct-owner-key' RETURNING id`, []],
    ["operator proposal deleted", `DELETE FROM public.operator_proposals
        WHERE idempotency_key = 'direct-owner-key' RETURNING id`, []],
    ["inbox item inserted", `INSERT INTO public.idea_notes (owner_user_id, title, body, status, type, priority)
        VALUES ($1::uuid, 'direct item', 'body', 'inbox', 'idea', 'high') RETURNING id`, [OWNER_A]],
    ["inbox item updated", `UPDATE public.idea_notes SET status = 'reviewing', title = 'direct item v2'
        WHERE owner_user_id = $1::uuid AND status = 'inbox' RETURNING id`, [OWNER_A]],
    ["inbox item deleted", `DELETE FROM public.idea_notes WHERE owner_user_id = $1::uuid AND status = 'reviewing'
        RETURNING id`, [OWNER_A]],
    // inbox_idempotency_keys.inbox_item_id is a NOT NULL FK to idea_notes, so the
    // host item is created in the same statement.
    ["inbox idempotency key inserted", `WITH host_item AS (
          INSERT INTO public.idea_notes (owner_user_id, title, status, type)
          VALUES ($1::uuid, 'idempotency host', 'inbox', 'idea') RETURNING id
        )
        INSERT INTO public.inbox_idempotency_keys (owner_user_id, key, inbox_item_id, fingerprint)
        SELECT $1::uuid, 'direct-capture-key', host_item.id, 'direct-fingerprint'
        FROM host_item RETURNING id`, [OWNER_A]],
    ["inbox idempotency key deleted", `DELETE FROM public.inbox_idempotency_keys
        WHERE key = 'direct-capture-key' RETURNING id`, []],
    ["task recurrence inserted", `INSERT INTO public.task_recurrences (owner_user_id, task_id, rule,
        anchor_date, timezone, next_occurrence_date) VALUES ($1::uuid, $2::uuid, 'weekly:monday',
        current_date, 'Europe/Berlin', current_date + 7) RETURNING id`, [OWNER_A, TASK_A]],
    ["task recurrence updated", `UPDATE public.task_recurrences SET next_occurrence_date = current_date + 14
        WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],
    ["task recurrence deleted", `DELETE FROM public.task_recurrences WHERE owner_user_id = $1::uuid RETURNING id`,
      [OWNER_A]],
    ["weekly review inserted", `INSERT INTO public.week_reviews (owner_user_id, week_start, week_end, summary)
        VALUES ($1::uuid, date_trunc('week', current_date)::date,
        (date_trunc('week', current_date)::date + 6), 'direct summary') RETURNING id`, [OWNER_A]],
    ["weekly review updated", `UPDATE public.week_reviews SET wins = 'direct wins'
        WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],
    ["weekly review deleted", `DELETE FROM public.week_reviews WHERE owner_user_id = $1::uuid RETURNING id`, [OWNER_A]],

    // Mobile device registration must still work: the MCP guard added to
    // claim_notification_device keys on client_id being absent.
    ["notification device claimed", `SELECT public.claim_notification_device($1, $2, $3, $4) AS claimed`,
      ["installation-direct", "android", "fcm", "direct-token"]],
  ];

  let passed = 0;
  for (const [label, statement, params] of cases) {
    let rows;
    try {
      rows = await owner.run((tx) => tx.unsafe(statement, params));
    } catch (error) {
      console.error(`[PROOF] FAILED: DIRECT-USER-PARITY: ${label} raised ${error?.code}: ${error?.message}`);
      console.error(`[PROOF]   statement: ${statement.replace(/\s+/g, " ").trim()}`);
      exit(1);
    }
    assert(rows.length > 0, `DIRECT-USER-PARITY: ${label} must succeed for an owner session, got ${rows.length} row(s)`);
    passed += 1;
  }
  log("DIRECT-USER-PARITY", `${passed} legitimate owner writes and reads all succeeded under the MCP hardening.`);

  // Parity must not become a cross-owner leak.
  await otherOwner.run(async (tx) => {
    for (const table of [
      "projects", "goals", "tasks", "task_sessions", "task_reminders",
      ...NEW_DOMAIN_TABLES, ...V1_READABLE_TABLES, "idea_notes", "task_recurrences", "week_reviews",
    ]) {
      if (aclRevokedTables.has(table)) continue;
      const ownerColumn = table === "user_time_context" ? "user_id" : "owner_user_id";
      const [row] = await tx.unsafe(
        `SELECT count(*)::int AS count FROM public.${table} WHERE ${ownerColumn} = $1::uuid`,
        [OWNER_A],
      );
      assert(row.count === 0, `DIRECT-USER-PARITY: owner B must not read owner A's ${table}`);
    }
  });
  log("DIRECT-USER-PARITY", "Owner isolation still holds for direct sessions: no foreign-owner rows were readable.");

  // The fence must be inert, not merely permissive, for direct owners. The 42
  // cases above are the real evidence - they wrote every column the MCP fence
  // forbids for MCP principals. This only asserts the fence is actually
  // installed on every table it is supposed to guard, so a dropped trigger
  // cannot make the parity cases pass for the wrong reason.
  const expectedFencedTables = [
    "projects", "goals", "tasks", "task_sessions", "task_reminders",
  ];
  const triggers = await sql`
    SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%_mcp_write_fence'
    ORDER BY c.relname
  `;
  const fenced = new Set(triggers.map((row) => row.table_name));
  for (const table of expectedFencedTables) {
    assert(fenced.has(table), `the ${table} write-fence trigger must exist`);
  }
  const disabled = triggers.filter((row) => row.tgenabled === "D");
  assert(disabled.length === 0, `write-fence triggers must not be disabled: ${disabled.map((row) => row.trigger_name).join(", ")}`);
  log(
    "DIRECT-USER-PARITY",
    `Write-fence triggers are installed and enabled on all ${expectedFencedTables.length} fenced tables; owner writes passed them without being refused.`,
  );
}

// ---------------------------------------------------------------------------
// RPC-SURFACE
// ---------------------------------------------------------------------------

/** Functions in public/ that `authenticated` may EXECUTE, from the catalog. */
let authenticatedRpcs = new Map();

async function computeAuthenticatedRpcs(sql) {
  const rows = await sql`
    SELECT n.nspname AS schema, p.proname AS name, p.oid::regprocedure::text AS signature,
           p.prosecdef AS security_definer, p.provolatile AS volatility
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind = 'f'
      AND n.nspname IN ('public', 'private')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ORDER BY n.nspname, p.proname
  `;
  authenticatedRpcs = new Map(rows.map((row) => [`${row.schema}.${row.name}`, row]));
  log(
    "RPC-SURFACE",
    `authenticated may EXECUTE ${rows.length} function(s): ${[...authenticatedRpcs.keys()].join(", ")}`,
  );
}

async function assertRpcSurface(sql) {
  // Classification. Enumerated from the catalog above so the inventory cannot
  // silently fall behind the schema; the sets below are the intent, and the
  // exhaustiveness assertion below is what forces every new function to be
  // classified deliberately.
  const MCP_INTERNAL_ALLOWED = [
    "public.resolve_active_mcp_grant",
    "public.consume_mcp_rate_limit",
    "public.mcp_claim_mutation_receipt",
    "public.mcp_store_mutation_result",
    "public.mcp_fail_mutation_result",
    "public.record_mcp_audit_event",
  ];
  const DIRECT_USER_ONLY = [
    "public.claim_notification_device",
    "public.purge_archived_project",
  ];
  // private.* helpers are reachable only as authenticated, never exposed by
  // PostgREST, and carry no independent authority of their own.
  const PRIVATE_HELPERS = [
    "private.has_active_mcp_permission",
    "private.has_any_active_mcp_permission",
    "private.is_registered_mcp_tool",
    "private.mcp_writable_columns",
    "private.enforce_mcp_write_fence",
  ];

  const unclassified = [...authenticatedRpcs.keys()].filter(
    (name) => ![...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS].includes(name),
  );
  assert(
    unclassified.length === 0,
    `every authenticated-executable function must be classified; unclassified: ${unclassified.join(", ")}`,
  );
  log("RPC-SURFACE", "Every function authenticated may execute is classified; no unclassified entry point exists.");

  // Nothing in the MCP-internal or direct-user-only sets may have lost its
  // EXECUTE grant - that would break the product, not secure it.
  for (const name of [...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS]) {
    assert(authenticatedRpcs.has(name), `${name} must remain executable by authenticated`);
  }

  // Every SECURITY DEFINER function reachable by authenticated must be
  // deliberately classified: a new definer function is exactly how a
  // privilege escalation would enter.
  const definers = [...authenticatedRpcs.values()]
    .filter((row) => row.security_definer)
    .map((row) => `${row.schema}.${row.name}`);
  const unclassifiedDefiners = definers.filter(
    (name) => ![...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS].includes(name),
  );
  assert(
    unclassifiedDefiners.length === 0,
    `unclassified SECURITY DEFINER function(s) reachable by authenticated: ${unclassifiedDefiners.join(", ")}`,
  );
  log("RPC-SURFACE", `All ${definers.length} SECURITY DEFINER functions reachable by authenticated are deliberately classified.`);

  // The trigger function must not be directly callable.
  await expectRefused(
    "private.enforce_mcp_write_fence direct call",
    // 0A000 feature_not_supported: PostgreSQL refuses to invoke a trigger
    // function outside a trigger context.
    ["0A000"],
    () =>
      mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
        tx.unsafe(`SELECT private.enforce_mcp_write_fence()`),
      ),
  );
  log("RPC-SURFACE", "The write-fence trigger function cannot be invoked directly as an RPC.");

  // Direct-user-only RPCs must refuse an MCP bearer.
  // Every context keeps a client_id, so each really is an MCP principal being
  // refused. Omitting client_id would make it an ordinary owner session and the
  // call would legitimately succeed.
  const deniedContexts = [
    ["wrong owner", mcpSession(sql, { userId: OWNER_B, clientId: V1_WORKSPACE_CLIENT })],
    ["wrong client", mcpSession(sql, { userId: OWNER_A, clientId: "not-a-real-client" })],
    ["wrong resource", mcpSession(sql, { userId: OWNER_A, clientId: V1_WORKSPACE_CLIENT, resource: "https://evil.example.com/api/mcp" })],
    ["revoked grant", mcpSession(sql, { userId: OWNER_A, clientId: REVOKED_CLIENT })],
  ];
  for (const [label, session] of deniedContexts) {
    await expectDenied(`claim_notification_device ${label}`, () =>
      session.run((tx) =>
        tx.unsafe(`SELECT public.claim_notification_device($1, $2, $3, $4)`, [`probe-${label.replaceAll(" ", "-")}`, "android", "fcm", `token-${label.replaceAll(" ", "-")}`]),
      ),
    );
  }
  const [device] = await sql.unsafe(`SELECT count(*)::int AS count FROM public.notification_devices WHERE owner_user_id = $1::uuid AND installation_id LIKE 'probe-%'`, [OWNER_A]);
  assert(device.count === 0, "a refused claim_notification_device call must not have created a device row");
  log("RPC-SURFACE", "claim_notification_device refused an MCP bearer under every identity mismatch and left no row behind.");

  // purge_archived_project keeps its own direct-user guard.
  await expectDenied("purge_archived_project as MCP", () =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`SELECT public.purge_archived_project($1::uuid, $2, $3, $4)`, [PROJECT_A, "probe", 1, 0]),
    ),
  );
  log("RPC-SURFACE", "purge_archived_project refused an MCP bearer.");

  // MCP-internal RPCs must actually be reachable by an MCP bearer. Calling each
  // with deliberately wrong arguments proves it reached its own validation
  // instead of being blocked at the boundary.
  const [grant] = await mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT id FROM public.resolve_active_mcp_grant()`),
  );
  assert(typeof grant?.id === "string", "resolve_active_mcp_grant must be reachable by an MCP bearer");

  // The rate-limit RPC validates the tool name against ^[a-z0-9_]{1,128}$, so the
  // probe uses a registered tool's name. It returns TABLE(allowed, retry_after),
  // which postgres.js hands back as a positional array.
  const rate = await mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit('ega_list_projects', 1, 60)`),
  );
  assert(rate[0]?.allowed === true, `consume_mcp_rate_limit must allow an MCP bearer under its own grant, got ${JSON.stringify(rate[0])}`);
  // And the per-tool limit must actually engage rather than being decorative.
  const limited = await mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit('ega_list_projects', 1, 60)`),
  );
  assert(limited[0]?.allowed === false, "a second call past the per-tool limit must be refused");
  assert(Number(limited[0]?.retry_after_seconds) > 0, "a refused rate-limit call must report a retry_after");
  // The window is bound to owner+client+tool+resource, so a different client
  // under the same owner with the same limit is unaffected by the exhausted one.
  const otherClient = await mcpSession(sql, { clientId: V1_READ_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit('ega_list_projects', 1, 60)`),
  );
  assert(otherClient[0]?.allowed === true, "the per-tool rate-limit window must be client bound");

  // Returns TABLE(outcome, claim_token, ...), so select * to get named columns.
  const [claim] = await mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
    tx.unsafe(
      `SELECT * FROM public.mcp_claim_mutation_receipt($1, $2::uuid, $3)`,
      ["rpc_surface_probe", "00000000-0000-4000-8000-00000000abcd", "rpc_surface_probe"],
    ),
  );
  assert(
    claim?.claim_outcome === "CLAIM_GRANTED",
    `mcp_claim_mutation_receipt must be reachable, got ${JSON.stringify(claim)}`,
  );
  assert(typeof claim?.claim_token === "string", "a granted claim must return a claim token");

  // Stale-token fencing proves store/fail are reachable and token-fenced, not
  // that they are simply absent.
  const stale = await capturePostgresError(() =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`SELECT public.mcp_store_mutation_result($1, $2::uuid, $3::uuid, $4::jsonb)`, [
        "rpc_surface_probe", "00000000-0000-4000-8000-00000000abcd", "00000000-0000-4000-8000-0000000000ff", "{}",
      ]),
    ),
  );
  assert(stale === "02000", `mcp_store_mutation_result must reject a stale claim token with 02000, got ${stale}`);

  const staleFail = await capturePostgresError(() =>
    mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run((tx) =>
      tx.unsafe(`SELECT public.mcp_fail_mutation_result($1, $2::uuid, $3::uuid, true)`, [
        "rpc_surface_probe", "00000000-0000-4000-8000-00000000abcd", "00000000-0000-4000-8000-0000000000ff",
      ]),
    ),
  );
  assert(staleFail === "02000", `mcp_fail_mutation_result must reject a stale claim token with 02000, got ${staleFail}`);
  log("RPC-SURFACE", "All six MCP-internal RPCs are reachable by an MCP bearer and remain token-fenced.");
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
    await computeAuthenticatedRpcs(sql);
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
    await assertRpcSurface(sql);
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

    // Parity runs LAST on purpose: it is the only section that deliberately
    // mutates and deletes the owner's own rows (it archives, unarchives, closes
    // and creates real records). Running it earlier would perturb the row
    // counts the surface sections assert on, and a section that deleted the
    // notification preferences row would make the v2 read assertion below pass
    // or fail for the wrong reason.
    await assertDirectUserParity(sql);

    console.log("\n[PROOF] OK - the MCP OAuth database surface matches the advertised MCP contract.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
