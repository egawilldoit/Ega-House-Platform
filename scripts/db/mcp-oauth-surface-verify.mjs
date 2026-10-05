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
 * A third class is about the proofs themselves rather than the policies, and
 * WRITE-GATE exists for it. When an UPDATE or DELETE carries a qualifying
 * clause, PostgreSQL OR-s the SELECT policies into its row-visibility filter, so
 * a probe driven by a principal that cannot read the row observes zero rows
 * whichever write policy is installed: its expected value is zero by
 * construction, and it cannot fail when the gate it names is removed. Deleting
 * the `AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL` clause from
 * `notifications_direct_user_update` left every scripts/db verifier green while a
 * v2 bearer could rewrite the owner's notifications. Every gated write is
 * therefore driven by a principal that already holds the read permission - so the
 * SELECT policies pass for free and the gate is the only thing left - and every
 * one is also asserted by reading the committed table back independently as the
 * superuser, because a statement reporting zero rows is not by itself evidence
 * that nothing happened.
 *
 * Sections:
 *   SCOPE-V1        a permissions-version-1 grant reaches exactly the v1
 *                   database surface and nothing newer
 *   SCOPE-V2        a permissions-version-2 grant reaches the new read domains
 *   WRITE-GATE      every `client_id IS NULL` gate on a `*_direct_user_*`
 *                   policy is load-bearing: driven by a principal that can
 *                   already READ the row, so no other policy can hand the
 *                   assertion its zero rows for free. Asserted on rows
 *                   affected AND on an independent superuser read-back of the
 *                   committed table
 *   COLUMN-FENCE    an MCP bearer holding tasks.update cannot write task
 *                   columns outside the advertised contract, and CAN write the
 *                   columns the contract does advertise; including the done /
 *                   reopen transitions through the MCP UPDATE path, asserted on
 *                   rows RETURNED, with the capture/normalizer/fence trigger
 *                   order 0078 depends on read from the catalog
 *   DIRECT-USER-PARITY
 *                   the same policies do not narrow ordinary owner sessions:
 *                   43 legitimate owner writes and reads across every table the
 *                   MCP hardening touched, plus owner isolation and the
 *                   installed state of the fence triggers
 *   CROSS-OWNER     every permitted MCP path rejects a foreign owner
 *   RPC-SURFACE     every function `authenticated` may EXECUTE is enumerated
 *                   from the catalog and classified; direct-user-only RPCs
 *                   refuse an MCP bearer; MCP-internal RPCs remain reachable
 *                   and token-fenced
 *   REVOCATION      a revoked grant loses ALL database capability immediately,
 *                   and does so whichever SINGLE column it was revoked by
 *                   (`revoked_at` alone with status left 'active', and status
 *                   alone with `revoked_at` left NULL); every copy of the
 *                   active-grant predicate in the catalog is proven to carry the
 *                   same `revoked_at IS NULL` guard as the authority
 *   WRONG-CLIENT    same owner, wrong client_id -> denied
 *   WRONG-RESOURCE  same owner/client, wrong aud -> denied
 *   INTERNAL        device/provider infrastructure, internal MCP tables,
 *                   legacy agent tokens, calendar internals and the
 *                   task_status_events ledger stay unreachable
 *   AUDIT-TOOLS     the audit RPC accepts only registered tool names
 *   OPERATION-IDENTITY
 *                   mcp_client_id is verified identity, not a caller-chosen
 *                   idempotency key: a mismatched value is corrected on INSERT
 *                   and refused on UPDATE, so one owner's v1 bearer cannot stamp
 *                   a row as the v2 client and have the v2 integration's replay
 *                   lookup return it as its own operation result. The honest
 *                   identity write and 0074's both-or-neither refusal are
 *                   asserted alongside, so a fence that refused everything would
 *                   fail rather than pass
 *   AUDIT-AUTHORITY a 'success' audit row requires the caller's ACTIVE GRANT to
 *                   hold the capability's permission, so the ledger cannot be
 *                   forged by the actor it audits; every denial is paired with a
 *                   permitted call and asserted on rows, and the direct-user
 *                   audit path is asserted to still succeed
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
/** Revoked the way the existing fixture does it: BOTH status='revoked' and revoked_at set. */
const REVOKED_CLIENT = "revoked-client";
/**
 * Revoked by `revoked_at` ALONE, with `status` left 'active'.
 *
 * private.has_active_mcp_permission requires `status = 'active' AND
 * revoked_at IS NULL`, and those are two independent conditions. An operator (or
 * any writer holding UPDATE on the grant table) can set `revoked_at` without
 * flipping `status`; the row is schema-legal - `mcp_authorization_grants_status_check`
 * admits 'active' and nothing couples the two columns - so the half-updated row is
 * representable and the guard must cover it. Deleting `AND
 * grant_record.revoked_at IS NULL` from 0051 leaves every other fixture green
 * because this one is the only thing that can tell the two halves apart.
 */
const REVOKED_AT_CLIENT = "revoked-at-client";
/**
 * Revoked by `status` ALONE, with `revoked_at` left NULL. The mirror image of
 * REVOKED_AT_CLIENT, so neither ordering can pass by accident: a guard that read
 * only one of the two conditions fails one fixture or the other.
 */
const STATUS_REVOKED_CLIENT = "status-revoked-client";
/** Seeded by AUDIT-AUTHORITY: needed to prove a task_manager cannot claim projects/goals. */
const V1_TASK_CLIENT = "v1-task-client";
/** Seeded by AUDIT-AUTHORITY: a non-active grant that satisfies every other authority condition. */
const V1_PENDING_CLIENT = "v1-pending-client";

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

/** permissions_version 1 task_manager - the document 0066 accepts at v1 and no later. */
const V1_TASK_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "timer.read",
];

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

/**
 * Run a mutation and report all three outcomes separately: rows returned, the
 * SQLSTATE, and the message.
 *
 * `expectDenied`/`expectNoRows` collapse a refusal to a SQLSTATE, which is the
 * right shape for asserting that something is CLOSED. It is the wrong shape for
 * asserting something is OPEN: there, "no rows" and "refused with 42501" are
 * two different regressions, and a mutation report is only actionable if it
 * names which one happened. Used where a capability is expected to work.
 */
async function captureMcpOutcome(fn) {
  try {
    const rows = await fn();
    return { rows: Array.isArray(rows) ? rows : [], error: null, message: null };
  } catch (error) {
    return { rows: [], error: error?.code ?? "UNKNOWN", message: error?.message ?? null };
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

/**
 * Seed one grant row.
 *
 * `status` and `revokedAt` are independent parameters, not one "revoked" flag,
 * because REVOCATION must prove the two halves of the predicate are load-bearing
 * separately. `revokedAt` defaults to now() when the status is revoked, which is
 * the shape a real revocation writes; pass it explicitly (or as null) to build
 * the two single-condition rows the predicate has to keep closed.
 */
async function insertGrant(
  sql,
  { owner, client, profile, permissions, version, status = "active", resource = RESOURCE_URI, revokedAt },
) {
  const revoked = revokedAt === undefined ? (status === "revoked" ? sql`now()` : null) : revokedAt;
  const [row] = await sql`
    INSERT INTO public.mcp_authorization_grants (
      owner_user_id, oauth_client_id, client_name, resource_uri, status,
      permission_profile, permissions, permissions_version, approved_at, revoked_at, updated_at
    ) VALUES (
      ${owner}::uuid, ${client}, ${client}, ${resource}, ${status},
      ${profile}, ${sql.json(permissions)}, ${version},
      now(), ${revoked}, now()
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
// WRITE-GATE
// ---------------------------------------------------------------------------

/** A durable value the write below must not have changed. */
const GATE_PROBE = "mcp-write-gate-probe";
const NOTIFICATION_ID = "99999999-9999-4999-8999-999999999991";
const IDEA_NOTE_ID = "99999999-9999-4999-8999-999999999996";
const OPERATOR_PROPOSAL_ID = "99999999-9999-4999-8999-999999999993";
const INBOX_KEY_ID = "99999999-9999-4999-8999-999999999994";

/** Capture a statement's outcome: either the rows it returned, or its SQLSTATE. */
async function captureWriteOutcome(fn) {
  try {
    return { rows: await fn() };
  } catch (error) {
    return { code: error?.code ?? "UNKNOWN" };
  }
}

/**
 * Assert a write that the `client_id IS NULL` gate on a `*_direct_user_*`
 * policy is supposed to close, on both halves of the gate:
 *
 *   1. the statement reported no affected rows, and
 *   2. an INDEPENDENT superuser read of the committed table shows no trace.
 *
 * (2) is not redundant. A qualifying clause makes PostgreSQL OR the SELECT
 * policies into the statement's row-visibility filter, so a zero-row result can
 * be produced by the SELECT policies alone and says nothing about the write
 * policy named in `policy`. Reading the committed table back as the superuser is
 * the only observation here that cannot be satisfied by the blocked statement's
 * own RLS view.
 */
async function expectGatedWriteClosed(sql, label, probe) {
  const { policy, clientId, stmt, params = [], durableSql, durableParams = params, durableMessage, durableExpect } = probe;

  const outcome = await captureWriteOutcome(() =>
    mcpSession(sql, { clientId }).run((tx) => tx.unsafe(stmt, params)),
  );
  if (outcome.code !== undefined) {
    // An INSERT whose WITH CHECK fails raises instead of filtering. That is as
    // closed as zero rows, but a different SQLSTATE is a real difference.
    assert(
      outcome.code === "42501",
      `${label} must affect zero rows or be refused by the client_id gate on ${policy}, got SQLSTATE ${outcome.code}`,
    );
  } else {
    assert(
      outcome.rows.length === 0,
      `${label} must affect zero rows - the client_id IS NULL gate on ${policy} did not close the write (${outcome.rows.length} row(s) affected)`,
    );
  }

  const [row] = await sql.unsafe(durableSql, durableParams);
  assert(
    durableExpect(row),
    `${label}: ${durableMessage} - read back independently as superuser: ${JSON.stringify(row)}`,
  );
}

/**
 * The gates are load-bearing only for a principal that cannot get the zero for
 * free, and that is the whole point of this section.
 *
 * A permissions_version 1 workspace_manager grant holds no `notifications.read`,
 * `operator.read` or `inbox.read`, so both `notifications_mcp_select_access` and
 * `notifications_direct_user_select` evaluate false for it, and SCOPE-V1's
 * `UPDATE public.notifications SET read_at = now() WHERE owner_user_id = <owner>
 * RETURNING id` observes zero rows *regardless of what
 * `notifications_direct_user_update` says*. Its expected value is zero by
 * construction, so it cannot fail when the gate is removed. Every probe below
 * is therefore driven by V2_WORKSPACE_CLIENT, the broadest principal in this
 * file, which holds the read permission that satisfies the SELECT policy for
 * free - leaving the `client_id IS NULL` gate as the only thing that can refuse.
 *
 * That rests on PostgreSQL's actual rule, measured against this journal rather
 * than assumed. When an UPDATE or DELETE carries a qualifying clause, the SELECT
 * policies are OR-ed into the row-visibility filter alongside the command's own
 * USING; EXPLAIN on a v1 bearer against a gate-stripped `notifications` shows it
 * plainly:
 *
 *     Filter: (((jwt->>'client_id') IS NOT NULL
 *                AND private.has_active_mcp_permission('notifications.read'))
 *               OR ((jwt->>'client_id') IS NULL))
 *
 * Three consequences shape these probes:
 *
 *   - Without that OR the filter is false for every row, so a v1 principal sees
 *     zero rows and learns nothing about the write policy. Driving the same
 *     statement as a v2 principal satisfies the OR for free and leaves the gate
 *     as the only thing that can refuse it.
 *   - The same rule has a sharp edge in the other direction: with the qualifying
 *     clause removed, the SELECT policies drop out of the plan entirely and the
 *     same principal CAN write a row it cannot read. A statement that reports
 *     zero rows is therefore not evidence that nothing happened, which is why
 *     every probe here also asserts an independent superuser read-back of the
 *     committed table.
 *   - An INSERT consults no SELECT policy at all: only the INSERT policy's WITH
 *     CHECK decides it. That makes INSERT the one command a probe can
 *     discriminate on without any read permission, and it is what makes the
 *     `pre`/`post` rows below necessary - an upsert against a seeded owner would
 *     be decided by the sibling UPDATE policy instead.
 *
 * One gate needs its own note. `inbox_idempotency_keys` has no MCP SELECT policy
 * at any permission version, so the OR above is false for every MCP principal on
 * every row: a `DELETE ... WHERE owner_user_id = <owner>` against it matches
 * nothing whatever the DELETE policy says - with the gate present, with it
 * removed, and (measured) even with the SELECT policy dropped altogether, where
 * the plan degrades to `Filter: false`. Only the filterless statement shape, which
 * drops the SELECT policies out of the plan entirely, can reach the gate, and
 * that is how it is proven below. The qualifying-clause form of the same DELETE is
 * kept as a claim check rather than a gate check.
 */
async function assertWriteGates(sql) {
  const clientId = V2_WORKSPACE_CLIENT;
  const owner = [OWNER_A];

  /**
   * One row per `client_id`-gated write policy 0065 and 0056 declare on a table
   * an MCP principal can reach, plus the two internal tables that carry no write
   * policy at all (asserted from the catalogue below). `policy` is named so a
   * failure names the policy that failed to close the write, not just the
   * statement that found it open.
   *
   * Each `durableExpect` names the seeded value the write must not have changed,
   * rather than merely "not the probe value": a read-back that matched nothing
   * would otherwise satisfy "not the probe value" for free.
   */
  const probes = [
    // ---- notifications: readable under notifications.read, never writable.
    // 0065 declares no INSERT or DELETE policy for this table at all (0045
    // dropped both so only service_role writes it); asserted below. ----
    {
      policy: "notifications_direct_user_update",
      op: "UPDATE",
      table: "notifications",
      stmt: `UPDATE public.notifications SET title = $2::text WHERE owner_user_id = $1::uuid RETURNING id`,
      params: [OWNER_A, GATE_PROBE],
      durableSql: `SELECT title FROM public.notifications WHERE id = $1::uuid`,
      durableParams: [NOTIFICATION_ID],
      durableMessage: "the owner's notification title must be unchanged",
      durableExpect: (row) => row.title === "Owner A reminder",
    },

    // ---- notification_preferences: the unread/preference summary is honest to
    // read, but flipping a delivery toggle stays a direct-user action ----
    {
      policy: "notification_preferences_direct_user_update",
      op: "UPDATE",
      table: "notification_preferences",
      stmt: `UPDATE public.notification_preferences SET push_enabled = false WHERE owner_user_id = $1::uuid RETURNING id`,
      params: owner,
      durableSql: `SELECT push_enabled FROM public.notification_preferences WHERE owner_user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "push delivery must still be enabled",
      durableExpect: (row) => row.push_enabled === true,
    },
    {
      policy: "notification_preferences_direct_user_insert",
      op: "INSERT",
      table: "notification_preferences",
      // notification_type is CHECK-constrained to 'task_reminder' and unique per
      // owner, so this table admits exactly one row per owner and the only
      // client-reachable write against a seeded owner is an upsert. An upsert's
      // ON CONFLICT DO UPDATE branch is closed by the sibling UPDATE policy, so
      // probing the upsert would pass whenever EITHER gate held and could not
      // fail when this one was removed. Clearing the conflicting row isolates
      // the INSERT policy's WITH CHECK - and an INSERT consults no SELECT
      // policy, so that CHECK alone decides the write.
      pre: `DELETE FROM public.notification_preferences WHERE owner_user_id = '${OWNER_A}'::uuid`,
      post: `INSERT INTO public.notification_preferences (owner_user_id, notification_type, push_enabled, email_enabled)
        VALUES ('${OWNER_A}'::uuid, 'task_reminder', true, true)
        ON CONFLICT (owner_user_id, notification_type) DO UPDATE SET push_enabled = true, email_enabled = true`,
      stmt: `INSERT INTO public.notification_preferences (owner_user_id, notification_type, push_enabled, email_enabled)
        VALUES ($1::uuid, 'task_reminder', false, false) RETURNING id`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.notification_preferences WHERE owner_user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "a forged preference row must not be created",
      durableExpect: (row) => row.count === 0,
    },
    {
      policy: "notification_preferences_direct_user_delete",
      op: "DELETE",
      table: "notification_preferences",
      stmt: `DELETE FROM public.notification_preferences WHERE owner_user_id = $1::uuid RETURNING id`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.notification_preferences WHERE owner_user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "the owner's preference row must survive",
      durableExpect: (row) => row.count === 1,
    },

    // ---- operator_proposals: readable under operator.read. 0065 deliberately
    // does not open the lifecycle, so the 'applied' transition a v1 read_only
    // bearer could once force directly stays a direct-user action ----
    {
      policy: "operator_proposals_direct_user_update",
      op: "UPDATE",
      table: "operator_proposals",
      stmt: `UPDATE public.operator_proposals SET status = 'applied', applied_at = now()
        WHERE owner_user_id = $1::uuid RETURNING id`,
      params: owner,
      durableSql: `SELECT status FROM public.operator_proposals WHERE id = $1::uuid`,
      durableParams: [OPERATOR_PROPOSAL_ID],
      durableMessage: "the owner's proposal must still be 'generated'",
      durableExpect: (row) => row.status === "generated",
    },
    {
      policy: "operator_proposals_direct_user_insert",
      op: "INSERT",
      table: "operator_proposals",
      stmt: `INSERT INTO public.operator_proposals (revision, owner_user_id, local_date, time_context_id,
          baseline_hash, proposed_task_ids, task_versions, idempotency_key, status)
        VALUES (1, $1::uuid, current_date, 'Europe/Berlin', 'mcp-gate-baseline', '[]'::jsonb, '[]'::jsonb,
          $2::text, 'applied') RETURNING id`,
      params: [OWNER_A, GATE_PROBE],
      durableSql: `SELECT count(*)::int AS count FROM public.operator_proposals WHERE idempotency_key = $1::text`,
      durableParams: [GATE_PROBE],
      durableMessage: "no operator proposal may be forged",
      durableExpect: (row) => row.count === 0,
    },
    {
      policy: "operator_proposals_direct_user_delete",
      op: "DELETE",
      table: "operator_proposals",
      stmt: `DELETE FROM public.operator_proposals WHERE owner_user_id = $1::uuid RETURNING id`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.operator_proposals WHERE id = $1::uuid`,
      durableParams: [OPERATOR_PROPOSAL_ID],
      durableMessage: "the owner's proposal must survive",
      durableExpect: (row) => row.count === 1,
    },

    // ---- user_time_context: readable so today.read can resolve the owner's
    // timezone; writing a timezone is a device setting, not a workspace
    // mutation ----
    {
      policy: "user_time_context_direct_user_update",
      op: "UPDATE",
      table: "user_time_context",
      stmt: `UPDATE public.user_time_context SET iana_timezone = 'Mars/Olympus' WHERE user_id = $1::uuid RETURNING user_id`,
      params: owner,
      durableSql: `SELECT iana_timezone FROM public.user_time_context WHERE user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "the owner's timezone must be unchanged",
      durableExpect: (row) => row.iana_timezone === "Europe/Berlin",
    },
    {
      policy: "user_time_context_direct_user_insert",
      op: "INSERT",
      table: "user_time_context",
      // user_id is the primary key, so this table admits one row per owner and
      // a seeded owner's only client-reachable write is an upsert. Isolated the
      // same way as notification_preferences_direct_user_insert above.
      pre: `DELETE FROM public.user_time_context WHERE user_id = '${OWNER_A}'::uuid`,
      post: `INSERT INTO public.user_time_context (user_id, iana_timezone)
        VALUES ('${OWNER_A}'::uuid, 'Europe/Berlin')
        ON CONFLICT (user_id) DO UPDATE SET iana_timezone = 'Europe/Berlin'`,
      stmt: `INSERT INTO public.user_time_context (user_id, iana_timezone)
        VALUES ($1::uuid, 'Mars/Olympus') RETURNING user_id`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.user_time_context WHERE user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "a forged timezone row must not be created",
      durableExpect: (row) => row.count === 0,
    },
    {
      policy: "user_time_context_direct_user_delete",
      op: "DELETE",
      table: "user_time_context",
      stmt: `DELETE FROM public.user_time_context WHERE user_id = $1::uuid RETURNING user_id`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.user_time_context WHERE user_id = $1::uuid`,
      durableParams: owner,
      durableMessage: "the owner's timezone row must survive",
      durableExpect: (row) => row.count === 1,
    },

    // ---- idea_notes: opened to MCP at v2 by 0065's inbox.read policy, and
    // gated for writes by 0056. An MCP bearer may read inbox items; only the
    // owner may create, edit or delete them ----
    {
      policy: "idea_notes_direct_user_update",
      op: "UPDATE",
      table: "idea_notes",
      stmt: `UPDATE public.idea_notes SET title = $2::text WHERE id = $1::uuid RETURNING id`,
      params: [IDEA_NOTE_ID, GATE_PROBE],
      durableSql: `SELECT title FROM public.idea_notes WHERE id = $1::uuid`,
      durableParams: [IDEA_NOTE_ID],
      durableMessage: "the owner's inbox item must be unchanged",
      durableExpect: (row) => row.title === "Owner A inbox item",
    },
    {
      policy: "idea_notes_direct_user_insert",
      op: "INSERT",
      table: "idea_notes",
      stmt: `INSERT INTO public.idea_notes (owner_user_id, title, status, type)
        VALUES ($1::uuid, $2::text, 'inbox', 'idea') RETURNING id`,
      params: [OWNER_A, GATE_PROBE],
      durableSql: `SELECT count(*)::int AS count FROM public.idea_notes WHERE title = $1::text`,
      durableParams: [GATE_PROBE],
      durableMessage: "no inbox item may be forged",
      durableExpect: (row) => row.count === 0,
    },
    {
      policy: "idea_notes_direct_user_delete",
      op: "DELETE",
      table: "idea_notes",
      stmt: `DELETE FROM public.idea_notes WHERE id = $1::uuid RETURNING id`,
      params: [IDEA_NOTE_ID],
      durableSql: `SELECT count(*)::int AS count FROM public.idea_notes WHERE id = $1::uuid`,
      durableParams: [IDEA_NOTE_ID],
      durableMessage: "the owner's inbox item must survive",
      durableExpect: (row) => row.count === 1,
    },

    // ---- inbox_idempotency_keys: the inbox dedup ledger, which has no MCP
    // SELECT policy at any permission version. 0065's claim is that an MCP
    // bearer can no longer forge or delete a capture key and so can no longer
    // defeat inbox conversion idempotency. The INSERT is judged purely by its
    // own WITH CHECK; the DELETE needs the filterless shape at the end of this
    // list, for the reason given on that probe. ----
    {
      policy: "inbox_idempotency_keys_direct_user_insert",
      op: "INSERT",
      table: "inbox_idempotency_keys",
      stmt: `INSERT INTO public.inbox_idempotency_keys (owner_user_id, key, inbox_item_id, fingerprint)
        VALUES ($1::uuid, $2::text, $3::uuid, 'mcp-write-gate-probe')`,
      params: [OWNER_A, GATE_PROBE, IDEA_NOTE_ID],
      durableSql: `SELECT count(*)::int AS count FROM public.inbox_idempotency_keys WHERE key = $1::text`,
      durableParams: [GATE_PROBE],
      durableMessage: "no inbox capture key may be forged",
      durableExpect: (row) => row.count === 0,
    },
    {
      // A claim check, not a gate check: no MCP principal can see a row of this
      // table, so the qualifying clause in this DELETE matches zero rows whatever
      // the DELETE policy says, and no probe can distinguish a present gate from
      // an absent one. The filterless probe at the end of this list is what
      // actually pins the gate; keep this one because it is the statement shape
      // 0065's own claim describes.
      policy: "inbox_idempotency_keys_direct_user_delete",
      op: "DELETE",
      table: "inbox_idempotency_keys",
      stmt: `DELETE FROM public.inbox_idempotency_keys WHERE owner_user_id = $1::uuid`,
      params: owner,
      durableSql: `SELECT count(*)::int AS count FROM public.inbox_idempotency_keys WHERE id = $1::uuid`,
      durableParams: [INBOX_KEY_ID],
      durableMessage: "the owner's capture key must survive",
      durableExpect: (row) => row.count === 1,
    },

    // ---- Filterless statements. These two carry NO qualifying clause, which is
    // the one shape where the SELECT policies drop out of the plan altogether
    // (see this function's comment) and the gate stands completely alone. It is
    // also a shape a client can actually issue - a PostgREST PATCH or DELETE with
    // no filter - so it is the sharpest available test of a USING clause, and the
    // only way to reach the gate on a table no MCP principal can read. Each is
    // asserted by the superuser read-back alone, since a filterless statement
    // reports no rows either way. ----
    {
      policy: "notifications_direct_user_update",
      op: "UPDATE",
      table: "notifications",
      stmt: `UPDATE public.notifications SET title = $1::text`,
      params: [GATE_PROBE],
      durableSql: `SELECT title FROM public.notifications WHERE id = $1::uuid`,
      durableParams: [NOTIFICATION_ID],
      durableMessage: "a filterless MCP write must not reach the owner's notifications",
      durableExpect: (row) => row.title === "Owner A reminder",
    },
    {
      policy: "inbox_idempotency_keys_direct_user_delete",
      op: "DELETE",
      table: "inbox_idempotency_keys",
      stmt: `DELETE FROM public.inbox_idempotency_keys`,
      params: [],
      durableSql: `SELECT count(*)::int AS count FROM public.inbox_idempotency_keys WHERE id = $1::uuid`,
      durableParams: [INBOX_KEY_ID],
      durableMessage: "a filterless MCP delete must not destroy the owner's capture key",
      durableExpect: (row) => row.count === 1,
    },
  ];

  for (const probe of probes) {
    // `pre`/`post` exist only to clear a uniqueness conflict that would otherwise
    // route the write through a sibling policy; both run as the superuser.
    if (probe.pre) await sql.unsafe(probe.pre);
    try {
      await expectGatedWriteClosed(sql, `MCP ${probe.op.toLowerCase()} on ${probe.table}`, { ...probe, clientId });
    } finally {
      if (probe.post) await sql.unsafe(probe.post);
    }
  }
  log(
    "WRITE-GATE",
    `All ${probes.length} gated writes on MCP-reachable tables left the owner's rows untouched: no statement affected a row, and an independent superuser read-back of every target confirmed no durable change.`,
  );

  // Two tables are closed for a different reason: notification_devices (which
  // holds the live FCM provider credential) and notification_deliveries carry no
  // INSERT, UPDATE or DELETE policy for `authenticated` at all, so there is no
  // gate to strip and no statement that could reach them. This has to be read
  // from the catalogue: a data-level probe cannot tell "no policy exists" from
  // "a policy filters every row", because to a WHERE clause the two are the
  // same observation.
  const internalWritePolicies = await sql`
    SELECT c.relname AS table, p.polname AS policy
    FROM pg_policy AS p
    JOIN pg_class AS c ON c.oid = p.polrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${sql.array(["notification_devices", "notification_deliveries"])})
      -- pg_policy.polcmd is the raw command character: a=INSERT, w=UPDATE,
      -- d=DELETE, r=SELECT. SELECT is deliberately excluded: these tables are
      -- supposed to have a read policy, and that policy's own client_id gate is
      -- covered by the WRITE-GATE probes above.
      AND p.polcmd IN ('a', 'w', 'd')
  `;
  assert(
    internalWritePolicies.length === 0,
    `notification_devices/notification_deliveries must carry no INSERT/UPDATE/DELETE policy for authenticated, found ${internalWritePolicies
      .map((row) => `${row.table}.${row.policy}`)
      .join(", ")}`,
  );
  log(
    "WRITE-GATE",
    "notification_devices and notification_deliveries carry no INSERT/UPDATE/DELETE policy for authenticated at all, so their closure needs no gate to hold.",
  );
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

  // mcp_operation_id stays writable on UPDATE because the application writes it
  // on every operationId-carrying mutation (0059), and a caller's own operation
  // key on their own row is exactly what that column is for. Asserted on a row
  // that already carries a COMPLETE identity, because 0074's both-or-neither
  // pairing constraint refuses a partial one - which is the pairing half of this
  // contract, not an accident of the fixture.
  //
  // This probe previously wrote BOTH identity columns on UPDATE and asserted both
  // were writable. That claim was the defect: mcp_client_id is the caller's
  // verified OAuth client identity, not a caller-chosen key, and every
  // application read-back / replay lookup filters on (mcp_client_id,
  // mcp_operation_id). It is now asserted NOT writable, in both directions, by
  // assertOperationIdentity below. The assertion here is narrowed in scope but
  // strengthened in shape: it establishes the complete identity first and then
  // proves the operation half still moves on UPDATE.
  const [identityRow] = await session.run((tx) =>
    tx.unsafe(
      `INSERT INTO public.tasks (project_id, title, mcp_operation_id, mcp_client_id)
       VALUES ($1::uuid, 'identity writable probe', gen_random_uuid(), $2)
       RETURNING id, mcp_client_id`,
      [PROJECT_A, V1_WORKSPACE_CLIENT],
    ),
  );
  assert(
    identityRow?.mcp_client_id === V1_WORKSPACE_CLIENT,
    "the application writes its own client id on create, and the fence must accept that unchanged",
  );
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET mcp_operation_id = gen_random_uuid() WHERE id = $1::uuid RETURNING id, mcp_operation_id, mcp_client_id`,
      [identityRow.id],
    );
    assert(rows.length === 1, "the application-written idempotency key must remain writable on UPDATE");
    assert(rows[0].mcp_operation_id !== null, "the rewritten operation id must persist");
    assert(
      rows[0].mcp_client_id === V1_WORKSPACE_CLIENT,
      `rewriting the operation key must leave the client half of the pair intact, got ${rows[0].mcp_client_id}`,
    );
  });

  // INSERT-time fence. Asserted BEHAVIOURALLY: the caller supplies forbidden
  // values and the proof reads the stored row back to confirm they did not
  // survive. The fence resets rather than raises, because a column's default
  // can be volatile (id is gen_random_uuid()) and no comparison against "the
  // value the default would have produced" can distinguish a caller-chosen key
  // from a generated one. Asserting a SQLSTATE here would also pass for the
  // wrong reason: a stripped value can trip an unrelated CHECK constraint.
  await session.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.tasks (
         project_id, title, focus_rank, archived_at, archived_by, created_at,
         scheduled_start_at, scheduled_end_at, calendar_sync_enabled,
         calendar_reminder_minutes, calendar_event_id, calendar_sync_status,
         calendar_sync_failure_reason, updated_at, completed_at
       ) VALUES (
         $1::uuid, 'fenced insert', 999, now(), $2::uuid,
         '2000-01-01T00:00:00Z'::timestamptz,
         now() + interval '1 day', now() + interval '2 days', true, 999,
         'forged-gcal-event', 'synced', 'forged',
         '2000-01-01T00:00:00Z'::timestamptz, '2000-01-01T00:00:00Z'::timestamptz
       ) RETURNING id, focus_rank, archived_at, archived_by, created_at,
         scheduled_start_at, scheduled_end_at, calendar_sync_enabled,
         calendar_reminder_minutes, calendar_event_id, calendar_sync_status,
         calendar_sync_failure_reason, created_at, updated_at, completed_at`,
      [PROJECT_A, OWNER_A],
    );
    assert(row, "the INSERT must succeed so the reset can be observed");
    assert(row.focus_rank === null, `focus_rank must be reset, got ${row.focus_rank}`);
    assert(row.archived_at === null, `archived_at must be reset, got ${row.archived_at}`);
    assert(row.archived_by === null, `archived_by must be reset, got ${row.archived_by}`);
    assert(row.created_at.getFullYear() >= 2024, `created_at must be reset to now(), got ${row.created_at}`);
    assert(row.updated_at.getFullYear() >= 2024, `updated_at must be reset to now(), got ${row.updated_at}`);
    assert(row.completed_at === null, `completed_at must be reset, got ${row.completed_at}`);
    assert(row.scheduled_start_at === null, "scheduled_start_at must be reset");
    assert(row.scheduled_end_at === null, "scheduled_end_at must be reset");
    assert(row.calendar_sync_enabled === false, "calendar_sync_enabled must be reset to its default");
    assert(Number(row.calendar_reminder_minutes) === 10, "calendar_reminder_minutes must be reset to its default");
    assert(row.calendar_event_id === null, "calendar_event_id must be reset");
    assert(row.calendar_sync_status === null, "calendar_sync_status must be reset");
    assert(row.calendar_sync_failure_reason === null, "calendar_sync_failure_reason must be reset");
  });
  log("COLUMN-FENCE", "A task INSERT could not carry focus_rank, archive state, a back-dated created_at, scheduling or calendar columns.");

  // A caller-chosen primary key must not survive.
  await session.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.tasks (id, project_id, title) VALUES ($1::uuid, $2::uuid, 'key probe')
       RETURNING id`,
      ["99999999-9999-4999-8999-9999999999f1", PROJECT_A],
    );
    assert(row.id !== "99999999-9999-4999-8999-9999999999f1", `a caller-chosen task id must be replaced by the default, got ${row.id}`);
  });
  log("COLUMN-FENCE", "A caller-chosen task primary key was replaced by the generated default.");

  // The other four fenced tables get the same INSERT treatment. task_reminders
  // is the sharp one: status is authorisable on UPDATE (ega_cancel_task_reminder
  // needs it) but not at INSERT, because a reminder created as 'sent' is
  // invisible to both delivery indexes, which filter on status = 'pending'.
  await session.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.task_reminders (
         id, task_id, remind_at, channel, delivery_mode, status, sent_at,
         processed_at, processing_error, failure_reason, source, source_id, created_at
       ) VALUES ($1::uuid, $2::uuid, now() + interval '2 hours', 'email', 'email', 'sent', now(),
         now(), 'forged', 'forged', 'forged-src', 'forged-src-1',
         '2000-01-01T00:00:00Z'::timestamptz)
       RETURNING id, status, sent_at, processed_at, processing_error,
         failure_reason, source, source_id, created_at`,
      ["88888888-8888-4888-8888-8888888888f2", TASK_A],
    );
    assert(row.status === "pending", `a reminder must be created pending, got ${row.status}`);
    assert(row.id !== "88888888-8888-4888-8888-8888888888f2", "a caller-chosen reminder id must be replaced by the default");
    for (const column of ["sent_at", "processed_at", "processing_error", "failure_reason", "source", "source_id"]) {
      assert(row[column] === null, `task_reminders.${column} must be reset, got ${row[column]}`);
    }
    assert(row.created_at.getFullYear() >= 2024, "task_reminders.created_at must be reset to now()");
  });
  log("COLUMN-FENCE", "A reminder INSERT could not forge delivery-worker state; it is always created pending.");

  await session.run(async (tx) => {
    // The seeded session is open and the product allows only one open session per
    // owner+task, so close it before probing a new insert.
    await tx.unsafe(`UPDATE public.task_sessions SET ended_at = now() WHERE id = $1::uuid`, [SESSION_A]);
    const [row] = await tx.unsafe(
      `INSERT INTO public.task_sessions (task_id, started_at, ended_at, duration_seconds, created_at)
       VALUES ($1::uuid, now(), now() + interval '5 hours', 999999, '2000-01-01T00:00:00Z'::timestamptz)
       RETURNING id, started_at, ended_at, duration_seconds, created_at`,
      [TASK_A],
    );
    assert(row.ended_at === null, "a session must not be insertable as already stopped");
    assert(row.duration_seconds === null, "duration_seconds must be reset");
    assert(row.created_at.getFullYear() >= 2024, "task_sessions.created_at must be reset to now()");
  });
  log("COLUMN-FENCE", "A timer session INSERT could not fabricate a stopped session or a duration.");

  await session.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.goals (id, project_id, title, slug, description, created_at, status, health, next_step)
       VALUES ($2::uuid, $1::uuid, 'create only probe', 'probe-slug', 'probe',
         '2000-01-01T00:00:00Z'::timestamptz, 'achieved', 'at_risk', 'forged next step')
       RETURNING id, created_at, status, health, next_step, title`,
      [PROJECT_A, "55555555-5555-4555-8555-5555555555f2"],
    );
    assert(row.created_at.getFullYear() >= 2024, "goals.created_at must be reset to now()");
    // title/slug/description/project_id ARE authorisable at INSERT under
    // goals.create; status/health/next_step are goals.update authority and must
    // not be settable at creation.
    assert(row.title === "create only probe", "goals.title is authorisable at INSERT under goals.create");
    assert(row.id !== "55555555-5555-4555-8555-5555555555f2", "a caller-chosen goal id must be replaced by the default");
    for (const [column, expected] of [["status", "draft"], ["health", null], ["next_step", null]]) {
      assert(row[column] === expected, `goals.${column} must be reset to ${expected} at INSERT, got ${row[column]}`);
    }
  });
  log("COLUMN-FENCE", "A goal INSERT could not carry a back-dated created_at; its create columns remained writable.");

  await session.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.projects (name, slug, description, created_at, status)
       VALUES ('probe', 'probe-slug', 'probe', '2000-01-01T00:00:00Z'::timestamptz, 'archived')
       RETURNING id, name, created_at, status`,
    );
    assert(row.created_at.getFullYear() >= 2024, "projects.created_at must be reset to now()");
    assert(row.name === "probe", "projects.name is authorisable at INSERT under projects.create");
    assert(row.status === "planned", `projects.status must be reset to planned at INSERT, got ${row.status}`);
  });
  log("COLUMN-FENCE", "A project INSERT could not carry a back-dated created_at; its create columns remained writable.");

  // A create-only grant must not inherit the UPDATE surface. task_manager is
  // create+update, so no shipped document isolates tasks.create; the synthetic
  // grant is installed by relaxing the profile/document CHECK inside the same
  // transaction, which is what an intermediate release would look like.
  // Capture the live constraint text so it can be restored byte-identically
  // rather than from a copy that could drift away from the migration.
  const [documentCheck] = await sql`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'mcp_authorization_grants_profile_permissions_check'
  `;
  assert(documentCheck?.definition, "the permission-document CHECK constraint must exist to be relaxed");
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `ALTER TABLE public.mcp_authorization_grants DROP CONSTRAINT mcp_authorization_grants_profile_permissions_check`,
      );
      await tx.unsafe(
        `INSERT INTO public.mcp_authorization_grants (
           owner_user_id, oauth_client_id, client_name, resource_uri, status,
           permission_profile, permissions, permissions_version, approved_at, updated_at
         ) VALUES ($1::uuid, 'create-only-client', 'create-only-client', $2::text, 'active',
           'workspace_manager', '["tasks.create"]'::jsonb, 1, now(), now())`,
        [OWNER_A, RESOURCE_URI],
      );
    });
  //
  // No RETURNING here on purpose. This grant holds tasks.create and no read
  // permission, so tasks_select_access filters every row and a RETURNING clause
  // is itself refused - PostgreSQL reports that as the INSERT violating RLS,
  // which reads like an insert failure rather than a read failure. The durable
  // effect is instead read back by an independent observer.
  await mcpSession(sql, { clientId: "create-only-client" }).run((tx) =>
    tx.unsafe(
      `INSERT INTO public.tasks (project_id, title, focus_rank, archived_at, archived_by, planned_for_date, created_at)
       VALUES ($1::uuid, 'create only probe', 999, now(), $2::uuid, current_date,
         '2000-01-01T00:00:00Z'::timestamptz)`,
      [PROJECT_A, OWNER_A],
    ),
  );
  const [created] = await sql`
    SELECT focus_rank, archived_at, archived_by, planned_for_date, created_at, status
    FROM public.tasks
    WHERE title = 'create only probe'
  `;
  assert(created, "a tasks.create-only grant must still be able to create a task");
  for (const column of ["focus_rank", "archived_at", "archived_by", "planned_for_date"]) {
    assert(
      created[column] === null,
      `tasks.create must not confer ${column} at INSERT, got ${created[column]}`,
    );
  }
  assert(created.created_at.getFullYear() >= 2024, "created_at must be reset");
  log("COLUMN-FENCE", "A tasks.create-only grant gained no UPDATE surface at INSERT: no focus rank, no archive state, no planning.");

  // And the coupling 0070 removed: creating a task in the caller's OWN project
  // must not require the projects.read permission that would let it see the
  // project row.
  await mcpSession(sql, { clientId: "create-only-client" }).run((tx) =>
    tx.unsafe(
      `INSERT INTO public.tasks (project_id, title) VALUES ($1::uuid, 'own project probe')`,
      [PROJECT_A],
    ),
  );
  const [ownProject] = await sql`
    SELECT count(*)::int AS count FROM public.tasks WHERE title = 'own project probe'
  `;
  assert(ownProject.count === 1, "task creation must not be coupled to the projects.read permission");
  log("COLUMN-FENCE", "Task creation in the caller's own project no longer depends on a projects.read grant.");
  } finally {
    // Restored in a finally so a failed assertion above cannot leave the
    // document constraint absent and quietly disarm the GRANT-SHAPE section.
    // The synthetic grant is removed first: ADD CONSTRAINT validates existing
    // rows, and its permissions are deliberately not a real document.
    await sql.unsafe(
      `DELETE FROM public.mcp_authorization_grants WHERE oauth_client_id = 'create-only-client'`,
    );
    await sql.unsafe(
      `ALTER TABLE public.mcp_authorization_grants ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check ${documentCheck.definition}`,
    );
  }

  // DELETE is a separate policy surface from INSERT/UPDATE and the fence is a
  // BEFORE INSERT OR UPDATE trigger, so column authorization does not reach it.
  // 0051 left task_reminders_mcp_delete_access in place through this whole wave,
  // which let an MCP bearer destroy a pending reminder outright - a more
  // complete suppression of a user-facing notification than anything the column
  // fence closes, using an operation with no schema, handler or audit identity.
  // RETURNING 1 rather than RETURNING id: several of these tables key on
  // user_id, not id, and a probe that names the wrong column fails as a
  // relation error rather than as the authorization result it is asserting.
  const deleteTables = [
    "projects", "goals", "tasks", "task_sessions", "task_reminders",
    ...NEW_DOMAIN_TABLES, ...V1_READABLE_TABLES,
    "idea_notes", "task_recurrences", "week_reviews", "task_status_events",
  ].filter((table) => !aclRevokedTables.has(table));

  for (const table of deleteTables) {
    await expectNoRows(`${table} DELETE by an MCP principal`, () =>
      session.run((tx) => tx.unsafe(`DELETE FROM public.${table} RETURNING 1`)),
    );
  }
  const survivors = await sql`
    SELECT count(*)::int AS count FROM public.task_reminders
  `;
  assert(survivors.count > 0, "the DELETE sweep must not have removed the seeded reminder");
  log("COLUMN-FENCE", "DELETE is closed on every fenced table and every previously leaked domain.");

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
  // ega_cancel_task_reminder is an advertised tool gated on tasks.update. Before
  // 0069 it issued an UPDATE that affected zero rows because task_reminders had
  // no MCP UPDATE policy, and the repository reported success anyway - so the
  // tool claimed to cancel a reminder that stayed pending and was still
  // delivered. Prove the tool's own transition now works.
  await session.run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.task_reminders SET status = 'cancelled', updated_at = now()
       WHERE id = $1::uuid RETURNING status`,
      [REMINDER_A],
    );
    assert(rows.length === 1, "ega_cancel_task_reminder must be able to change a reminder's status");
    assert(rows[0].status === "cancelled", `expected status 'cancelled', got ${rows[0].status}`);
  });
  log("COLUMN-FENCE", "ega_cancel_task_reminder now actually cancels; it previously reported success over zero rows.");

  // Worker-owned delivery state remains unreachable on UPDATE.
  await expectNoRows("task_reminders.sent_at out-of-contract write", () =>
    session.run((tx) =>
      tx.unsafe(`UPDATE public.task_reminders SET sent_at = now(), processed_at = now() WHERE id = $1::uuid RETURNING id`, [REMINDER_A]),
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
// TASK-COMPLETION
// ---------------------------------------------------------------------------

/**
 * The 0063 completion trigger owns tasks.completed_at, and 0071 correctly refused
 * to authorise the column because no repository payload sets it. That left the
 * fence observing a completed_at that normalize_task_completed_at had just
 * written and reporting the trigger's own write as a caller modification, so
 * `ega_update_task {status: "done"}` failed for EVERY MCP principal:
 *
 *   ERROR:  MCP write fence: an MCP OAuth principal may not modify
 *           completed_at on public.tasks
 *
 * 0078 fixes it with private.capture_tasks_mcp_caller_completed_at, which records
 * whether the caller changed completed_at at all, before the normalizer touches
 * it, and the fence exempts the column only when that record says the caller
 * supplied nothing.
 *
 * The fix has TWO halves and each is asserted here, plus the installed trigger
 * order that 0078's own header names as the mechanism being corrected:
 *
 *   1. The honest path WORKS, asserted on ROWS RETURNED rather than on the
 *      absence of an exception - `RETURNING` makes a silently filtered RLS
 *      update visible as zero rows.
 *   2. The forged path is still REFUSED 42501, so the exemption has not become
 *      "allow completed_at".
 *
 * Without (1) the whole advertised capability is dead and this section stays
 * green, because 0071's refusal is itself a correct-looking denial.
 */
async function assertTaskCompletion(sql) {
  const session = mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT });

  // ---- The installed trigger order ----------------------------------------
  //
  // PostgreSQL fires same-timing row triggers in alphabetical order by name, so
  // the ordering IS the mechanism: 'c' < 'n' < 't'. Asserted from the catalog
  // rather than inferred from a passing write, because renaming the capture
  // trigger would restore the breakage silently while the behavioural cases
  // below would keep reporting whatever they happened to observe.
  //
  // pg_trigger is a heap, so its natural scan order is creation order and says
  // nothing about firing order. Ordered by NAME here because that IS the firing
  // order PostgreSQL uses for same-timing row triggers, which is why the capture
  // trigger was named to sort first rather than merely created first.
  const triggers = await sql`
    SELECT t.tgname AS name
      FROM pg_trigger AS t
     WHERE t.tgrelid = 'public.tasks'::regclass
       AND NOT t.tgisinternal
     ORDER BY t.tgname
  `;
  const order = triggers.map((row) => row.name);
  const positionOf = (name) => {
    const index = order.indexOf(name);
    assert(index >= 0, `the trigger 0078 installs (${name}) must exist on public.tasks; found: ${order.join(", ")}`);
    return index;
  };
  const capture = positionOf("capture_tasks_mcp_caller_completed_at");
  const normalize = positionOf("normalize_task_completed_at");
  const fence = positionOf("tasks_mcp_write_fence");
  assert(
    capture < normalize,
    `capture_tasks_mcp_caller_completed_at must sort before normalize_task_completed_at or the fence cannot tell a caller write from the trigger's own; installed order is ${order.join(", ")}`,
  );
  assert(
    normalize < fence,
    `the fence must run after normalize_task_completed_at for the exemption to have anything to exempt; installed order is ${order.join(", ")}`,
  );
  log("COLUMN-FENCE", `public.tasks trigger order is ${order.join(" -> ")}; the capture trigger precedes the normalizer, which precedes the fence.`);

  // ---- A row to transition -------------------------------------------------
  await session.run((tx) =>
    tx.unsafe(
      `INSERT INTO public.tasks (project_id, title) VALUES ($1::uuid, 'completion probe') RETURNING id`,
      [PROJECT_A],
    ),
  );
  const [probe] = await sql`SELECT id FROM public.tasks WHERE title = 'completion probe'`;
  assert(probe, "the completion probe task must exist");
  // Prefer the dedicated id if the fence ever lets a caller choose it; the point
  // is that the row exists, not which uuid it carries.
  const taskId = probe.id;

  // ---- 1. The honest done transition, on ROWS RETURNED --------------------
  //
  // The two error shapes are separated explicitly rather than letting the raw
  // PostgresError escape, because they are different failures of the same
  // capability and a mutation report has to name which one it is:
  //   * 0 rows returned      -> RLS filtered the write; capability is dead
  //   * an exception         -> the fence refused the trigger's own write
  const doneOutcome = await captureMcpOutcome(() =>
    session.run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET status = 'done' WHERE id = $1::uuid RETURNING status, completed_at`, [taskId]),
    ),
  );
  assert(
    doneOutcome.error === null,
    `ega_update_task {status:"done"} is an advertised capability that must complete a task for an MCP principal, but the database REFUSED it (SQLSTATE ${doneOutcome.error}): ${doneOutcome.message}. 0078's capture trigger and its completed_at exemption are what make this path work; with 0078 absent the fence sees normalize_task_completed_at's own write and reports it as a caller modification.`,
  );
  assert(
    doneOutcome.rows.length === 1,
    `ega_update_task {status:"done"} must return exactly 1 row for an MCP principal, got ${doneOutcome.rows.length} (0 rows means the write was silently filtered)`,
  );
  assert(doneOutcome.rows[0].status === "done", `expected status 'done', got ${doneOutcome.rows[0].status}`);
  assert(
    doneOutcome.rows[0].completed_at !== null,
    "the done transition must stamp completed_at from the trigger, not leave it NULL",
  );
  log("COLUMN-FENCE", "ega_update_task {status:'done'} completes a task for an MCP principal and the trigger stamped completed_at.");

  // ---- The honest reopen ---------------------------------------------------
  const reopenOutcome = await captureMcpOutcome(() =>
    session.run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET status = 'todo' WHERE id = $1::uuid RETURNING status, completed_at`, [taskId]),
    ),
  );
  assert(
    reopenOutcome.error === null,
    `ega_update_task {status:"todo"} is an advertised capability that must reopen a task for an MCP principal, but the database REFUSED it (SQLSTATE ${reopenOutcome.error}): ${reopenOutcome.message}`,
  );
  assert(
    reopenOutcome.rows.length === 1,
    `ega_update_task {status:"todo"} must return exactly 1 row for an MCP principal, got ${reopenOutcome.rows.length}`,
  );
  assert(reopenOutcome.rows[0].status === "todo", `expected status 'todo', got ${reopenOutcome.rows[0].status}`);
  assert(
    reopenOutcome.rows[0].completed_at === null,
    `reopening a task must clear completed_at, got ${reopenOutcome.rows[0].completed_at}`,
  );
  log("COLUMN-FENCE", "ega_update_task {status:'todo'} reopens the same task and completed_at is cleared.");

  // ---- 2. The forged contrast ---------------------------------------------
  //
  // Pairs against the honest transition above on the same principal and the same
  // row: the exemption must be "the caller supplied nothing", not "allow
  // completed_at". normalize_task_completed_at uses COALESCE(NEW.completed_at,
  // now()), so a caller-supplied value survives it - which is precisely why the
  // column was removed from the allowlist in 0071 and must stay removed.
  await expectDenied("back-dated completion through the MCP UPDATE path", () =>
    session.run((tx) =>
      tx.unsafe(
        `UPDATE public.tasks SET status = 'done', completed_at = '2000-01-01T00:00:00Z'::timestamptz
          WHERE id = $1::uuid RETURNING status, completed_at`,
        [taskId],
      ),
    ),
  );
  const [afterRefusal] = await sql`
    SELECT status, completed_at FROM public.tasks WHERE id = ${taskId}::uuid
  `;
  assert(afterRefusal.status === "todo", `the refused write must leave status alone, got ${afterRefusal.status}`);
  assert(
    afterRefusal.completed_at === null,
    `the refused write must leave completed_at NULL, got ${afterRefusal.completed_at}`,
  );
  log("COLUMN-FENCE", "A caller-supplied completed_at on the same transition is still refused 42501 and changes nothing, so the honest path is not 'allow the column'.");

  // ---- The direct-user path is unaffected ----------------------------------
  await directUserSession(sql).run(async (tx) => {
    const rows = await tx.unsafe(
      `UPDATE public.tasks SET status = 'done', completed_at = now() WHERE id = $1::uuid RETURNING status, completed_at`,
      [taskId],
    );
    assert(rows.length === 1, "the MCP write fence must not constrain an owner setting completed_at directly");
    assert(rows[0].completed_at !== null, "the owner-set completed_at must survive");
  });
  log("COLUMN-FENCE", "An owner session still sets completed_at directly; 0078 constrains MCP principals only.");
}

// ---------------------------------------------------------------------------
// OPERATION-IDENTITY
// ---------------------------------------------------------------------------

/**
 * `mcp_client_id` is the caller's OAuth client identity, and the database must
 * derive it rather than accept it.
 *
 * private.mcp_writable_columns / private.mcp_insertable_columns (0071) list
 * `mcp_client_id` beside `mcp_operation_id` as caller-settable on all five
 * fenced tables, on the reasoning that the application writes both on every
 * operationId-carrying mutation (0059). But `mcp_operation_id` is a caller-chosen
 * idempotency KEY and `mcp_client_id` is not - it is verified identity, and every
 * read-back and replay lookup keys on the pair:
 *
 *   .eq("mcp_client_id", identity.mcpClientId).eq("mcp_operation_id", …)
 *
 * So an owner holding TWO grants can, with the v1 bearer, INSERT a row stamped
 * `mcp_client_id = 'v2-workspace-client'`, and the v2 integration's replay then
 * returns the attacker's row as its own operation result. Measured on the journal
 * at HEAD with executed SQL: the forged row persisted with the v2 client id, and a
 * v2-session lookup on (v2, that operation id) returned it. That is a hole in
 * exactly the key 0074 exists to fence, and the existing proof passed over it
 * because the only probe asserted the column stays WRITABLE.
 *
 * Asserted in both directions, because either alone is half a fix:
 *
 *   INSERT  a mismatched mcp_client_id is corrected to the caller's own (or the
 *           write is refused), and never persists as another client's.
 *   UPDATE  changing mcp_client_id on an existing row affects zero rows or is
 *           refused - the second direction is what stops an attacker re-stamping
 *           a row it created legitimately earlier.
 *
 * Paired with the permitted case in each direction, so a fence that simply
 * refused every identity write would fail here: the application writes both
 * columns together on create, and that must still work.
 */
async function assertOperationIdentity(sql) {
  const attacker = mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT });
  const victim = mcpSession(sql, { clientId: V2_WORKSPACE_CLIENT });
  const forgedOperationId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

  // ---- INSERT: a mismatched client id must not survive --------------------
  await attacker.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.tasks (
         project_id, title, mcp_operation_id, mcp_client_id
       ) VALUES (
         $1::uuid, 'forged client identity', $2::uuid, $3
       ) RETURNING id, mcp_client_id, mcp_operation_id`,
      [PROJECT_A, forgedOperationId, V2_WORKSPACE_CLIENT],
    );
    assert(row, "the INSERT must succeed so the correction can be observed; 0074 pairs both columns and both were supplied");
    assert(
      row.mcp_client_id === V1_WORKSPACE_CLIENT,
      `the fence must derive tasks.mcp_client_id from the verified JWT, not the caller: a v1 bearer stamped the row '${row.mcp_client_id}' (the v2 client's id) and the v2 integration's replay lookup keys on that pair`,
    );
    assert(row.mcp_operation_id === forgedOperationId, "the caller-chosen operation id must still be honoured");
  });
  log("OPERATION-IDENTITY", "An INSERT stamped with another client's mcp_client_id was corrected to the caller's own verified client id.");

  // The durable effect, read back by an independent observer: the v2 session's
  // own replay/read-back key must not resolve to the attacker's row. This is the
  // harm 0074 exists to prevent, asserted on the lookup the application
  // actually performs rather than on the stored column alone.
  const forgedRow = await attacker.run((tx) =>
    tx.unsafe(
      `SELECT id, mcp_client_id, mcp_operation_id
         FROM public.tasks
        WHERE mcp_operation_id = $1::uuid`,
      [forgedOperationId],
    ),
  );
  assert(forgedRow.length === 1, "the attacker's own row must exist, or the correction assertion passed vacuously");
  const victimLookup = await victim.run((tx) =>
    tx.unsafe(
      `SELECT id, title FROM public.tasks WHERE mcp_client_id = $1 AND mcp_operation_id = $2::uuid`,
      [V2_WORKSPACE_CLIENT, forgedOperationId],
    ),
  );
  assert(
    victimLookup.length === 0,
    `the v2 integration's replay lookup returned ${victimLookup.length} row(s) for an operation the v1 bearer performed; the operation-identity pair is the key 0074 fences`,
  );
  log("OPERATION-IDENTITY", "The v2 client's replay/read-back lookup resolves nothing for an operation only the v1 bearer performed.");

  // ---- UPDATE: an existing row's client id must not be re-stamped ----------
  await expectNoRows("tasks.mcp_client_id re-stamped to another client", () =>
    attacker.run((tx) =>
      tx.unsafe(
        `UPDATE public.tasks SET mcp_client_id = $1 WHERE id = $2::uuid RETURNING id, mcp_client_id`,
        [V2_WORKSPACE_CLIENT, forgedRow[0].id],
      ),
    ),
  );
  const [afterUpdate] = await sql`
    SELECT mcp_client_id FROM public.tasks WHERE id = ${forgedRow[0].id}::uuid
  `;
  assert(
    afterUpdate.mcp_client_id === V1_WORKSPACE_CLIENT,
    `the refused re-stamp must leave mcp_client_id at the caller's own id, got ${afterUpdate.mcp_client_id}`,
  );
  log("OPERATION-IDENTITY", "An UPDATE re-stamping mcp_client_id to another client affected zero rows and changed nothing.");

  // ---- The permitted case: the application's own identity write -----------
  //
  // Without this the two assertions above would also pass on a fence that
  // refuses every identity write, which would break 0059/0074 for every real MCP
  // create. Proved on rows returned, on the same session and the same table.
  await attacker.run(async (tx) => {
    const [row] = await tx.unsafe(
      `INSERT INTO public.tasks (
         project_id, title, mcp_operation_id, mcp_client_id
       ) VALUES (
         $1::uuid, 'honest identity write', $2::uuid, $3
       ) RETURNING id, mcp_client_id, mcp_operation_id`,
      [PROJECT_A, "dddddddd-dddd-4ddd-8ddd-ddddddddddd2", V1_WORKSPACE_CLIENT],
    );
    assert(row, "an honest identity-carrying INSERT must succeed");
    assert(
      row.mcp_client_id === V1_WORKSPACE_CLIENT && row.mcp_operation_id === "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      `the application's own identity write must be accepted unchanged; got client ${row.mcp_client_id}, operation ${row.mcp_operation_id}`,
    );
  });
  log("OPERATION-IDENTITY", "The application's own operation-identity write is still accepted unchanged.");

  // ---- The pairing constraint still governs both halves -------------------
  //
  // The correction must not turn the fence into "supply either half": 0074's
  // CHECK requires both-or-neither, and a partial identity must still be refused
  // so the unique index key is never partially NULL.
  await expectRefused(
    "tasks INSERT carrying only an operation id",
    // 23514 check_violation: 0074's tasks_mcp_operation_identity_pair.
    ["23514"],
    () =>
      attacker.run((tx) =>
        tx.unsafe(
          `INSERT INTO public.tasks (project_id, title, mcp_operation_id)
           VALUES ($1::uuid, 'half identity', $2::uuid)`,
          [PROJECT_A, "dddddddd-dddd-4ddd-8ddd-ddddddddddd3"],
        ),
      ),
  );
  log("OPERATION-IDENTITY", "A partial operation identity is still refused with 23514; the correction did not open a half-pairing path.");

  // ---- Every fenced table, not just the one probed above -------------------
  //
  // The behavioural cases above run against public.tasks because it is the table
  // the replay harm is easiest to read there, but 0079 changes the allowlist for
  // all five fenced tables. A table-by-table regression - someone re-adding
  // 'mcp_client_id' to one branch, or removing the derivation from one INSERT
  // path - would leave every assertion above green. Read both allowlists per
  // table from the database, under a real MCP session so the permission branches
  // are actually evaluated, and assert the intended shape of each.
  const FENCED_TABLES = ["projects", "goals", "tasks", "task_sessions", "task_reminders"];
  await attacker.run(async (tx) => {
    for (const table of FENCED_TABLES) {
      const [row] = await tx.unsafe(
        `SELECT private.mcp_writable_columns($1) AS updatable,
                private.mcp_insertable_columns($1) AS insertable`,
        [table],
      );
      assert(
        row.updatable !== null && row.insertable !== null,
        `${table}: the fence must reach both allowlists under an MCP session, or the assertions above pass vacuously`,
      );
      assert(
        !row.updatable.includes("mcp_client_id"),
        `${table}: mcp_client_id must not be authorisable on UPDATE; private.mcp_writable_columns returned ${JSON.stringify(row.updatable)}`,
      );
      assert(
        row.updatable.includes("mcp_operation_id"),
        `${table}: mcp_operation_id must remain authorisable on UPDATE; the application writes its own operation key there`,
      );
      assert(
        row.insertable.includes("mcp_client_id"),
        `${table}: mcp_client_id must remain authorisable at INSERT, because the fence derives it rather than resetting it and 0074's pairing needs the caller able to supply the pair`,
      );
    }
  });
  log(
    "OPERATION-IDENTITY",
    `Across all ${FENCED_TABLES.length} fenced tables, mcp_client_id is insertable-but-derived and absent from the UPDATE allowlist, while mcp_operation_id stays authorisable on UPDATE.`,
  );
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

/**
 * Cross-owner INSERT, which the row-filter assertions above cannot see.
 *
 * An UPDATE policy is a USING row filter, so it is straightforward to assert that
 * a principal cannot reach another owner's row. INSERT has no USING clause: the
 * only thing standing between an MCP bearer and a cross-tenant write edge is the
 * WITH CHECK. The referential ownership clauses restored by 0064 and hardened by
 * 0069/0070 (private.user_owns_project / user_owns_task) exist solely in that
 * position, and removing all three leaves the verifier fully green while a live
 * bearer creates reminders, sessions and tasks pointing at another owner's rows.
 *
 * Each case is asserted twice: the caller's own transaction must be refused, AND
 * an independent superuser read-back must show no row was created. The second is
 * not redundant - a silently filtered insert raises no error, so a refusal
 * assertion alone cannot distinguish it from a policy that quietly did nothing.
 */
async function assertCrossOwnerInsert(sql, clientIds) {
  const crossOwnerEdgeCounts = `
    SELECT
      (SELECT count(*)::int FROM public.tasks WHERE project_id = $1::uuid) AS tasks_in_b,
      (SELECT count(*)::int FROM public.task_reminders WHERE task_id = $2::uuid) AS reminders_on_b,
      (SELECT count(*)::int FROM public.task_sessions WHERE task_id = $2::uuid) AS sessions_on_b
  `;
  const [before] = await sql.unsafe(crossOwnerEdgeCounts, [PROJECT_B, TASK_B]);

  for (const [label, clientId] of clientIds) {
    const session = mcpSession(sql, { clientId });

    await expectDenied(`${label} task INSERT into another owner's project`, () =>
      session.run((tx) =>
        tx.unsafe(`INSERT INTO public.tasks (project_id, title) VALUES ($1::uuid, 'cross-owner task')`, [PROJECT_B]),
      ),
    );
    await expectDenied(`${label} reminder INSERT on another owner's task`, () =>
      session.run((tx) =>
        tx.unsafe(
          `INSERT INTO public.task_reminders (task_id, remind_at, channel, delivery_mode)
           VALUES ($1::uuid, now() + interval '4 hours', 'email', 'email')`,
          [TASK_B],
        ),
      ),
    );
    // The product allows one open session per owner, so close this owner's first;
    // otherwise the refusal would come from the open-session index and would prove
    // nothing about ownership.
    await session.run((tx) =>
      tx.unsafe(
        `UPDATE public.task_sessions SET ended_at = now()
         WHERE owner_user_id = $1::uuid AND ended_at IS NULL`,
        [OWNER_A],
      ),
    );
    await expectDenied(`${label} session INSERT on another owner's task`, () =>
      session.run((tx) =>
        tx.unsafe(
          `INSERT INTO public.task_sessions (task_id, started_at) VALUES ($1::uuid, now())`,
          [TASK_B],
        ),
      ),
    );
    await expectDenied(`${label} goal INSERT into another owner's project`, () =>
      session.run((tx) =>
        tx.unsafe(`INSERT INTO public.goals (project_id, title) VALUES ($1::uuid, 'cross-owner goal')`, [PROJECT_B]),
      ),
    );
  }

  const [after] = await sql.unsafe(crossOwnerEdgeCounts, [PROJECT_B, TASK_B]);
  assert(
    after.tasks_in_b === before.tasks_in_b,
    `cross-owner task INSERT created a durable edge into another tenant's project (${before.tasks_in_b} -> ${after.tasks_in_b})`,
  );
  assert(
    after.reminders_on_b === before.reminders_on_b,
    `cross-owner reminder INSERT created a durable edge on another owner's task (${before.reminders_on_b} -> ${after.reminders_on_b})`,
  );
  assert(
    after.sessions_on_b === before.sessions_on_b,
    `cross-owner session INSERT created a durable edge on another owner's task (${before.sessions_on_b} -> ${after.sessions_on_b})`,
  );
  log("CROSS-OWNER", "No MCP principal could INSERT a task, goal, reminder or session across the owner boundary, and no durable cross-tenant edge was created.");
}

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

/**
 * Assert one grant row, however it was revoked, has lost every capability.
 *
 * Each case is asserted on rows/rows-affected, never on the absence of an
 * exception: `private.has_active_mcp_permission` is a STABLE predicate feeding
 * RLS, so a widened grant filters nothing and every statement below succeeds.
 *
 * @param expected the shape the fixture row is asserted to actually hold, so the
 *   fixture cannot silently become a both-set row and pass for the wrong reason.
 */
async function assertRevokedClientHasNoCapability(sql, { label, clientId, expected }) {
  const [row] = await sql.unsafe(
    `SELECT status, revoked_at IS NOT NULL AS has_revoked_at
       FROM public.mcp_authorization_grants
      WHERE oauth_client_id = $1`,
    [clientId],
  );
  assert(row, `${label}: the revocation fixture grant must exist`);
  assert(row.status === expected.status, `${label}: fixture status must be '${expected.status}', got '${row.status}'`);
  assert(
    row.has_revoked_at === expected.hasRevokedAt,
    `${label}: fixture revoked_at must be ${expected.hasRevokedAt ? "set" : "NULL"}, got ${row.has_revoked_at ? "set" : "NULL"}`,
  );

  await mcpSession(sql, { clientId }).run(async (tx) => {
    for (const table of ["projects", "goals", "tasks", "task_sessions", ...NEW_DOMAIN_TABLES, ...MCP_INTERNAL_TABLES]) {
      await assertInvisible(tx, label, table);
    }
  });
  await expectNoRows(`${label} task write`, () =>
    mcpSession(sql, { clientId }).run((tx) =>
      tx.unsafe(`UPDATE public.tasks SET title = 'after revocation' WHERE id = $1::uuid RETURNING id`, [TASK_A]),
    ),
  );
  const grants = await mcpSession(sql, { clientId }).run((tx) =>
    tx.unsafe(`SELECT count(*)::int AS count FROM public.mcp_authorization_grants`),
  );
  assert(grants[0].count === 0, `${label} must not be able to read the grant table`);

  // The audit RPC is SECURITY DEFINER over the same predicate, so it would
  // happily write an attributed row for a grant that is no longer active. Assert
  // the refusal leaves nothing behind rather than trusting the raise.
  const requestId = `revocation-${clientId}`;
  await expectDenied(`${label} audit write`, () =>
    mcpSession(sql, { clientId }).run((tx) =>
      tx.unsafe(`SELECT public.record_mcp_audit_event($1, 'ega_list_projects', 'denied', 1, NULL, '{}'::jsonb)`, [requestId]),
    ),
  );
  const [audited] = await sql`
    SELECT count(*)::int AS count
      FROM public.agent_integration_events
     WHERE request_id = ${requestId}
  `;
  assert(audited.count === 0, `${label} must leave zero audit rows behind, got ${audited.count}`);
}

/**
 * REVOCATION, in both halves.
 *
 * `private.has_active_mcp_permission` reads
 *
 *   AND grant_record.status = 'active'
 *   AND grant_record.revoked_at IS NULL
 *
 * and both conditions are load-bearing, because revocation is representable in
 * two independent ways. The schema admits status='active' alongside a set
 * revoked_at, and nothing in the journal couples them; an operator revoking a
 * grant by stamping revoked_at is the ordinary way to express "this is over now",
 * and it must not leave a fully privileged grant behind.
 *
 * The previous proof seeded exactly one revoked fixture, which set BOTH columns
 * at once, so it could not tell the two conditions apart. Deleting `AND
 * grant_record.revoked_at IS NULL` from 0051 left it fully green and immediately
 * restored full read + write authority for every revoked_at-only grant.
 */
async function assertRevocation(sql) {
  await assertRevokedClientHasNoCapability(sql, {
    label: "revoked grant (status + revoked_at)",
    clientId: REVOKED_CLIENT,
    expected: { status: "revoked", hasRevokedAt: true },
  });
  log("REVOCATION", "A grant revoked the ordinary way (status='revoked' AND revoked_at set) lost every database capability immediately, including the newer domains.");

  // The discriminating case: revoked_at stamped, status still 'active'. The label
  // names the guard, so a mutation of that guard fails HERE and reads as the
  // revocation gap rather than as an anonymous table-visibility failure.
  await assertRevokedClientHasNoCapability(sql, {
    label: "revocation gap: revoked_at-only grant (revoked_at IS NULL guard removed or ineffective)",
    clientId: REVOKED_AT_CLIENT,
    expected: { status: "active", hasRevokedAt: true },
  });
  log("REVOCATION", "A grant revoked by revoked_at ALONE (status left 'active') lost every capability too; the revoked_at IS NULL guard is load-bearing and now proven to be.");

  // And the mirror image, so neither ordering can pass by accident.
  await assertRevokedClientHasNoCapability(sql, {
    label: "revocation gap: status-only grant (status = 'active' guard removed or ineffective)",
    clientId: STATUS_REVOKED_CLIENT,
    expected: { status: "revoked", hasRevokedAt: false },
  });
  log("REVOCATION", "A grant revoked by status ALONE (revoked_at left NULL) lost every capability too; the two halves are proven independent in both directions.");
}

/**
 * The active-grant predicate is written out by hand in several places, and only
 * one of them (private.has_active_mcp_permission) is the authority the RLS
 * policies call. Every copy has to keep BOTH conditions, or a copy that resolved
 * the grant more loosely than the policies do would hand authority back.
 *
 * Read from the catalog rather than from the migration files, because what
 * matters is what the deployed functions and policies say, not what a file once
 * contained. Today this finds the predicate duplicated across the grant
 * resolution functions below, and in NO row-level policy: every policy calls
 * private.has_active_mcp_permission() instead of inlining it, so the policies
 * cannot drift from the authority. The migration-line history (0037:116,
 * 0038:29, 0040:80, 0041:30, 0042:35, 0060:39, 0061:72, 0064:52, 0065:351,
 * 0071:96, 0073:231) is the reason this assertion exists; it is a catalog check
 * on the deployed result, not a file-diff.
 */
const GRANT_PREDICATE_STATUS_RE = /status\s*=\s*'active'/;

async function assertActiveGrantPredicateParity(sql) {
  // Every function that reads the grant table and declares the active predicate.
  // `prosrc` is the installed body, so a function redefined by a later migration
  // is judged on its final definition.
  const functions = await sql`
    SELECT n.nspname AS schema, p.proname AS name, p.prosrc AS source
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private')
       AND p.prokind = 'f'
       AND p.prosrc LIKE '%mcp_authorization_grants%'
  `;

  const [authority] = functions.filter((row) => row.name === "has_active_mcp_permission");
  assert(authority, "private.has_active_mcp_permission must exist as the single active-grant authority");

  // The authority itself must carry both halves, named in the assertion that
  // fails, so a mutation of 0051 is reported as a revocation gap rather than as a
  // catalog drift.
  assert(
    GRANT_PREDICATE_STATUS_RE.test(authority.source),
    "private.has_active_mcp_permission must require status = 'active'",
  );
  assert(
    /revoked_at\s+IS\s+NULL/.test(authority.source),
    "private.has_active_mcp_permission must require revoked_at IS NULL (the revocation guard 0051 declares)",
  );

  const copies = functions.filter(
    (row) => row.name !== "has_active_mcp_permission" && GRANT_PREDICATE_STATUS_RE.test(row.source),
  );
  assert(
    copies.length > 0,
    "the active-grant predicate must be asserted against its known copies, not against an empty set",
  );
  const drift = copies.filter((row) => !/revoked_at\s+IS\s+NULL/.test(row.source));
  assert(
    drift.length === 0,
    `every copy of the active-grant predicate must also require revoked_at IS NULL; these do not: ${drift.map((row) => `${row.schema}.${row.name}`).join(", ")}`,
  );

  // Row-level policies: assert they do not inline the predicate at all. Inlining
  // is what would let a policy resolve the grant more loosely than the authority,
  // and asserting it is absent is stronger than asserting each copy is correct.
  const inlined = await sql`
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual LIKE '%status = ''active''%' OR with_check LIKE '%status = ''active''%')
  `;
  assert(
    inlined.length === 0,
    `no row-level policy may inline the active-grant predicate; these do, and can drift from private.has_active_mcp_permission: ${inlined.map((row) => `${row.tablename}.${row.policyname}`).join(", ")}`,
  );

  log(
    "REVOCATION",
    `The active-grant predicate appears in ${copies.length} function(s) besides the authority (${copies.map((row) => `${row.schema}.${row.name}`).join(", ")}) and every one requires revoked_at IS NULL; 0 row-level policies inline it.`,
  );
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
 * The number of cases this file's header claims DIRECT-USER-PARITY runs.
 *
 * The header prose, the array literal and the run's own log line were three
 * separate claims about one number, and they drifted: the header said 42 while
 * the list held 43 and the log printed 43. Asserting the list against this
 * constant is what keeps a later case added or removed from leaving the header
 * quietly misstating it - a comment cannot be interpolated, so it needs
 * something to be checked against.
 */
const DOCUMENTED_PARITY_CASES = 43;

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

    // Timer sessions: the product allows only one open session per owner+task,
    // and earlier sections have opened sessions, so close the seeded one and
    // start a fresh open session the way the start/stop path does.
    ["task_sessions closed", `UPDATE public.task_sessions SET ended_at = now() + interval '45 minutes',
        duration_seconds = 2700 WHERE id = $1::uuid RETURNING id`, [SESSION_A]],
    // Setup for the case below, not an operation under test: earlier sections
    // opened sessions and the product allows one open session per owner. Wrapped
    // in a CTE that always returns a row, because a setup step that legitimately
    // matches zero rows must not be asserted as "must affect rows" - that shape
    // silently stops testing anything once the precondition changes.
    ["open timer sessions closed", `WITH closed AS (
        UPDATE public.task_sessions SET ended_at = now(), duration_seconds = 60
        WHERE owner_user_id = $1::uuid AND ended_at IS NULL RETURNING 1
      ) SELECT count(*)::int AS closed FROM closed`, [OWNER_A]],
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

  // The header states a count; this is what holds it to that number.
  assert(
    cases.length === DOCUMENTED_PARITY_CASES,
    `DIRECT-USER-PARITY runs ${cases.length} cases but this file's header documents ` +
      `${DOCUMENTED_PARITY_CASES}; update the header and DOCUMENTED_PARITY_CASES together`,
  );

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

  // Re-seed one owner-A row per table the cases above created and deleted. The
  // isolation assertions are only meaningful against a populated table: an empty
  // one returns zero foreign rows whether or not the policy is correct.
  await owner.run(async (tx) => {
    await tx.unsafe(
      `INSERT INTO public.user_time_context (user_id, iana_timezone)
       VALUES ($1::uuid, 'Europe/Berlin')`,
      [OWNER_A],
    );
    await tx.unsafe(
      `INSERT INTO public.notification_preferences (owner_user_id, notification_type, push_enabled, email_enabled)
       VALUES ($1::uuid, 'task_reminder', true, true)`,
      [OWNER_A],
    );
    await tx.unsafe(
      `INSERT INTO public.task_recurrences (owner_user_id, task_id, rule, anchor_date, timezone,
         next_occurrence_date)
       VALUES ($1::uuid, $2::uuid, 'weekly:monday', current_date, 'Europe/Berlin', current_date + 7)`,
      [OWNER_A, TASK_A],
    );
    await tx.unsafe(
      `INSERT INTO public.idea_notes (owner_user_id, title, status, type)
       VALUES ($1::uuid, 'isolation probe', 'inbox', 'idea')`,
      [OWNER_A],
    );
    await tx.unsafe(
      `INSERT INTO public.week_reviews (owner_user_id, week_start, week_end)
       VALUES ($1::uuid, date_trunc('week', current_date)::date,
         date_trunc('week', current_date)::date + 6)`,
      [OWNER_A],
    );
  });

  // Parity must not become a cross-owner leak.
  //
  // The baseline is measured as OWNER A, in owner A's own session. Measuring it
  // from owner B cannot work: RLS filters every owner-A row out, so the total is
  // zero by construction and "owner B saw none of owner A's rows" passes against
  // a policy widened to the whole table. Asserting the row exists first - as the
  // owner who owns it - is what makes the second half discriminating.
  const isolationTables = [
    "projects", "goals", "tasks", "task_sessions", "task_reminders",
    ...NEW_DOMAIN_TABLES, ...V1_READABLE_TABLES,
    "idea_notes", "task_recurrences", "week_reviews",
  ].filter((table) => !aclRevokedTables.has(table));

  for (const table of isolationTables) {
    const ownerColumn = table === "user_time_context" ? "user_id" : "owner_user_id";
    const [owned] = await owner.run((tx) =>
      tx.unsafe(
        `SELECT count(*)::int AS own FROM public.${table} WHERE ${ownerColumn} = $1::uuid`,
        [OWNER_A],
      ),
    );
    assert(
      owned.own > 0,
      `DIRECT-USER-PARITY: ${table} must hold an owner-A row before owner isolation can be asserted; the assertion would otherwise pass vacuously`,
    );

    const [leak] = await otherOwner.run((tx) =>
      tx.unsafe(
        `SELECT count(*)::int AS leaked FROM public.${table} WHERE ${ownerColumn} = $1::uuid`,
        [OWNER_A],
      ),
    );
    assert(
      leak.leaked === 0,
      `DIRECT-USER-PARITY: owner B must not read owner A's ${table} (${leak.leaked} row(s) leaked)`,
    );
  }
  log("DIRECT-USER-PARITY", `Owner isolation still holds for direct sessions: all ${isolationTables.length} tables held an owner-A row and owner B read none of them.`);

  // The fence must be inert, not merely permissive, for direct owners. The
  // cases above are the real evidence - they wrote every column the MCP fence
  // forbids for MCP principals. This only asserts the fence is actually
  // installed on every table it is supposed to guard, so a dropped trigger
  // cannot make the parity cases pass for the wrong reason.
  const expectedFencedTables = [
    "projects", "goals", "tasks", "task_sessions", "task_reminders",
  ];
  const triggers = await sql`
    SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
           (t.tgtype & 1) > 0 AS fires_row,
           (t.tgtype & 4) > 0 AS fires_insert,
           (t.tgtype & 16) > 0 AS fires_update,
           (t.tgtype & 8) > 0 AS fires_delete
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE '%_mcp_write_fence'
    ORDER BY c.relname
  `;
  const fenced = new Map(triggers.map((row) => [row.table_name, row]));
  for (const table of expectedFencedTables) {
    const trigger = fenced.get(table);
    assert(trigger, `the ${table} write-fence trigger must exist`);
    // The event mask matters as much as existence. A trigger reduced to
    // BEFORE UPDATE would pass an existence check while silently re-opening
    // every INSERT hole the fence closes, and tgenabled 'R' fires in replica
    // mode only, i.e. never in production.
    assert(trigger.fires_row, `${table} write fence must be FOR EACH ROW`);
    assert(trigger.fires_insert, `${table} write fence must fire on INSERT`);
    assert(trigger.fires_update, `${table} write fence must fire on UPDATE`);
    assert(
      ["O", "A"].includes(trigger.tgenabled),
      `${table} write fence must be enabled in production, got tgenabled='${trigger.tgenabled}'`,
    );
  }
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
    "private.mcp_tool_audit_permissions",
    "private.mcp_writable_columns",
    "private.mcp_insertable_columns",
    "private.enforce_mcp_write_fence",
    "private.user_owns_project",
    "private.user_owns_goal",
    "private.user_owns_task",
  ];

  // Fence internals that must stay uncallable by an authenticated principal.
  // They are only reachable from the SECURITY DEFINER trigger, which runs as the
  // migration role, so granting EXECUTE to authenticated would be unnecessary
  // surface rather than a convenience.
  const PRIVATE_INTERNAL = ["private.mcp_known_fenced_columns"];

  const unclassified = [...authenticatedRpcs.keys()].filter(
    (name) => ![...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS, ...PRIVATE_INTERNAL].includes(name),
  );
  assert(
    unclassified.length === 0,
    `every authenticated-executable function must be classified; unclassified: ${unclassified.join(", ")}`,
  );
  log("RPC-SURFACE", "Every function authenticated may execute is classified; no unclassified entry point exists.");

  // Nothing in the MCP-internal, direct-user-only or predicate-helper sets may
  // have lost its EXECUTE grant - that would break the product, not secure it.
  for (const name of [...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS]) {
    assert(authenticatedRpcs.has(name), `${name} must remain executable by authenticated`);
  }
  for (const name of PRIVATE_INTERNAL) {
    assert(
      !authenticatedRpcs.has(name),
      `${name} is a fence internal reachable only from the SECURITY DEFINER trigger and must not be executable by authenticated`,
    );
  }
  log("RPC-SURFACE", `${PRIVATE_INTERNAL.length} fence internal(s) are not reachable as authenticated RPCs.`);

  // Every SECURITY DEFINER function reachable by authenticated must be
  // deliberately classified: a new definer function is exactly how a
  // privilege escalation would enter.
  const definers = [...authenticatedRpcs.values()]
    .filter((row) => row.security_definer)
    .map((row) => `${row.schema}.${row.name}`);
  const unclassifiedDefiners = definers.filter(
    (name) => ![...MCP_INTERNAL_ALLOWED, ...DIRECT_USER_ONLY, ...PRIVATE_HELPERS, ...PRIVATE_INTERNAL].includes(name),
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
    tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit('ega_list_projects')`),
  );
  assert(rate[0]?.allowed === true, `consume_mcp_rate_limit must allow an MCP bearer under its own grant, got ${JSON.stringify(rate[0])}`);

  // The production limit, not a test-sized one. The previous proof called this
  // with p_limit = 1, which never showed the shipped allowance engaging.
  const [signature] = await sql`
    SELECT p.pronargs::int AS argument_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'consume_mcp_rate_limit'
  `;
  assert(
    signature?.argument_count === 1,
    `consume_mcp_rate_limit must take only a window name; the limit and window length are policy. It exposes ${signature?.argument_count} argument(s).`,
  );

  // The SHIPPED thresholds, not test-sized ones. The previous proof called this
  // with p_limit = 1, so it only ever demonstrated that a limit of one works -
  // it never showed the allowance that actually ships engaging.
  //
  // Each call here is the server's own limit, so the refusal index IS the
  // configured allowance. That is the assertion that would have caught the
  // caller-controlled p_limit: a client passing 10000 would push the refusal
  // index out of range instead of to the expected value.
  const shippedLimits = [
    ["ega_aggregate_read", 600],
    ["ega_aggregate_write", 300],
    ["ega_aggregate_sensitive_write", 60],
    ["ega_list_projects", 120],
  ];
  // The 60s bucket is WALL CLOCK: consume_mcp_rate_limit derives
  // to_timestamp(floor(epoch / window_seconds) * window_seconds). A sweep that
  // crosses a minute boundary restarts its own counter mid-measurement, so the
  // refusal index shifts and the assertion below fails for a reason that has
  // nothing to do with the code. That made this proof fail roughly 1 run in 3 on
  // any host, on the unmodified base as well - measured here at 15/21 passing.
  //
  // The fix is to observe, not to sleep. Every call reports the window the RPC
  // derived for it, in the same statement that consumes the allowance, and a
  // measurement is only judged when all of its calls landed in ONE window. A
  // measurement that straddles is re-run rather than scored, bounded so a
  // genuinely broken limiter cannot loop forever - and a broken limiter cannot
  // roll the window, so retrying is not retry-until-green.
  const windowSeconds = 60;

  for (const [windowName, expectedLimit] of shippedLimits) {
    let scored = null;
    let straddled = 0;
    for (let attempt = 1; attempt <= 4 && scored === null; attempt += 1) {
      // Start each measurement from an empty window. The reachability probes
      // above already consumed part of some of these, and the assertion is about
      // where the shipped limit bites, not about how many probes preceded it.
      await sql.unsafe(
        `DELETE FROM public.mcp_rate_limit_windows
         WHERE owner_user_id = $1::uuid AND oauth_client_id = $2 AND tool_name = $3`,
        [OWNER_A, V1_WORKSPACE_CLIENT, windowName],
      );
      const outcomes = await mcpSession(sql, { clientId: V1_WORKSPACE_CLIENT }).run(async (tx) => {
        const out = [];
        // Bounded so a regression that removes the limit cannot hang the proof.
        for (let i = 0; i <= expectedLimit + 5; i += 1) {
          const [row] = await tx.unsafe(
            `SELECT r.*,
                    to_timestamp(
                      floor(extract(epoch FROM clock_timestamp()) / $2::integer) * $2::integer
                    ) AS window_started_at
             FROM public.consume_mcp_rate_limit($1) AS r`,
            [windowName, windowSeconds],
          );
          out.push(row);
        }
        return out;
      });
      // Compare by VALUE. The driver hands back a fresh Date per row, so a Set of
      // Date objects compares by reference and reports every row as a distinct
      // window even when they are all the same instant.
      const windows = new Set(
        outcomes
          .map((row) => row?.window_started_at)
          .filter((value) => value !== null && value !== undefined)
          .map((value) => (value instanceof Date ? value.getTime() : new Date(value).getTime())),
      );
      if (windows.size > 1) {
        straddled += 1;
        continue;
      }
      scored = { outcomes, windows: windows.size };
    }
    assert(
      scored !== null,
      `${windowName}: the ${windowName} sweep spanned more than one 60s window on all 4 attempts (${straddled} straddles), so the refusal index cannot be attributed to the threshold. This is a harness limit, not a limiter verdict.`,
    );
    const { outcomes } = scored;
    const refusedAt = outcomes.findIndex((row) => row?.allowed === false);
    assert(
      refusedAt === expectedLimit,
      `${windowName} must allow exactly ${expectedLimit} calls per minute and refuse call ${expectedLimit + 1}; it first refused at call ${refusedAt + 1}`,
    );
    assert(
      Number(outcomes[expectedLimit]?.retry_after_seconds) > 0,
      `${windowName} must report a retry_after once refused`,
    );
  }
  log(
    "RPC-SURFACE",
    `The shipped limits engage exactly at their configured values (120/600/300/60 per minute) and the caller supplies neither limit nor window length.`,
  );
  // The window is bound to owner+client+tool+resource, so a different client
  // under the same owner with the same limit is unaffected by the exhausted one.
  const otherClient = await mcpSession(sql, { clientId: V1_READ_CLIENT }).run((tx) =>
    tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit('ega_aggregate_read')`),
  );
  assert(otherClient[0]?.allowed === true, "the aggregate rate-limit window must be client bound");

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
// AUDIT-AUTHORITY
// ---------------------------------------------------------------------------

/**
 * The audit ledger must not be forgeable by the actor it audits.
 *
 * 0073 is a regression proof for a defect reproduced against the real journal:
 * record_mcp_audit_event proved the tool name was REGISTERED and that the
 * caller held an active grant, but never that the grant HELD the capability
 * permission the named tool requires. A permissions_version 1 read_only grant
 * wrote 'success' rows naming ega_create_project, ega_archive_task,
 * ega_start_timer and ega_clear_completed_today.
 *
 * Every assertion is written as a PERMITTED/DENIED PAIR on the same principal
 * and the same tool shape, so a check that silently stopped running fails here
 * rather than passing vacuously, and every outcome is asserted on rows
 * returned or rows affected. Absence of an exception is never the evidence:
 * SECURITY DEFINER means an unfiltered statement raises nothing, and RLS filters
 * silently rather than raising.
 */
async function assertAuditCapabilityAuthority(sql) {
  // A task_manager grant is required by the specification (a task_manager
  // principal must not be able to claim a project-management capability) and is
  // not among the v1 fixtures, so it is seeded here. permissions_version 1 is
  // the only version task_manager has a document for, per 0066.
  await insertGrant(sql, {
    owner: OWNER_A,
    client: V1_TASK_CLIENT,
    profile: "task_manager",
    permissions: V1_TASK_PERMISSIONS,
    version: 1,
  });
  // A pending grant holding the full workspace_manager document satisfies every
  // authority condition except being active, which isolates grant resolution
  // from the capability check in the assertions below.
  await insertGrant(sql, {
    owner: OWNER_A,
    client: V1_PENDING_CLIENT,
    profile: "workspace_manager",
    permissions: V1_PERMISSIONS.workspace_manager,
    version: 1,
    status: "pending",
  });

  /** One audit write; returns the returned event id, or null if refused. */
  const audit = ({ clientId, toolName, outcome = "success", userId = OWNER_A, resource = RESOURCE_URI, requestId }) =>
    mcpSession(sql, { userId, clientId, resource }).run((tx) =>
      tx.unsafe(
        `SELECT public.record_mcp_audit_event($1, $2, $3, 1, NULL, '{}'::jsonb) AS event_id`,
        [requestId, toolName, outcome],
      ),
    );

  /** Row count for a request id. The observable effect, independent of raising. */
  const rowsFor = async (requestId) => {
    const [row] = await sql`
      SELECT count(*)::int AS count
      FROM public.agent_integration_events
      WHERE request_id = ${requestId}
    `;
    return row.count;
  };

  // request_id is bounded at 64 characters by the RPC, so ids are supplied
  // explicitly and kept short rather than derived from the assertion label.
  const requestIdFor = (spec) => spec.requestId ?? `audit-authority-${spec.toolName}`;

  /** Assert a write is refused AND left no row. */
  const assertRefused = async (label, spec) => {
    const requestId = requestIdFor(spec);
    assert(requestId.length <= 64, `proof request id must fit the RPC's 64-char bound: ${requestId}`);
    await expectDenied(label, () => audit({ ...spec, requestId }));
    const count = await rowsFor(requestId);
    assert(count === 0, `${label} must leave zero rows behind, got ${count}`);
  };

  /** Assert a write succeeded AND returned an id. */
  const assertAccepted = async (label, spec) => {
    const requestId = requestIdFor(spec);
    assert(requestId.length <= 64, `proof request id must fit the RPC's 64-char bound: ${requestId}`);
    const rows = await audit({ ...spec, requestId });
    const eventId = rows?.[0]?.event_id;
    assert(typeof eventId === "string", `${label} must return an inserted event id`);
    const count = await rowsFor(requestId);
    assert(count === 1, `${label} must persist exactly one row, got ${count}`);
    return eventId;
  };

  // ---- The capability the grant does NOT hold -----------------------------
  //
  // These are the rows a read_only principal wrote before 0073. Each is paired
  // below with the read capability the same principal legitimately holds.
  const readOnlyWriteClaims = [
    "ega_create_project",
    "ega_archive_task",
    "ega_start_timer",
    "ega_stop_timer",
    "ega_clear_completed_today",
    "ega_plan_task_for_today",
  ];
  for (const toolName of readOnlyWriteClaims) {
    await assertRefused(`read_only claims write capability ${toolName}`, {
      clientId: V1_READ_CLIENT,
      toolName,
      requestId: `audit-ro-write-${toolName}`,
    });
  }
  log(
    "AUDIT-AUTHORITY",
    `A read_only principal recorded success rows for ${readOnlyWriteClaims.length} write capabilities before 0073; each is now refused and leaves zero rows.`,
  );

  // ---- task_manager must not claim project-management capabilities --------
  //
  // task_manager holds tasks.create and tasks.update but no projects.* write
  // permission, so projects and goals capabilities are outside its authority.
  const taskManagerWriteClaims = [
    "ega_create_project",
    "ega_update_project_status",
    "ega_archive_project",
    "ega_unarchive_project",
    "ega_create_goal",
    "ega_archive_goal",
  ];
  for (const toolName of taskManagerWriteClaims) {
    await assertRefused(`task_manager claims ${toolName}`, {
      clientId: V1_TASK_CLIENT,
      toolName,
      requestId: `audit-tm-write-${toolName}`,
    });
  }
  log(
    "AUDIT-AUTHORITY",
    `A task_manager principal was refused ${taskManagerWriteClaims.length} project- and goal-management capabilities, which its tasks.create/tasks.update document does not authorize.`,
  );

  // ---- The permitted/denied PAIRS ----------------------------------------
  //
  // Each principal must still be able to record the capabilities it genuinely
  // holds. Without these, a migration that refused EVERY success write would
  // satisfy every assertion above and still be wrong.
  await assertAccepted("read_only records its own read capability", {
    clientId: V1_READ_CLIENT,
    toolName: "ega_list_projects",
    requestId: "audit-ro-ok-list-projects",
  });
  await assertAccepted("read_only records the always-authorized capability", {
    clientId: V1_READ_CLIENT,
    toolName: "ega_get_capabilities",
    requestId: "audit-ro-ok-capabilities",
  });
  await assertAccepted("task_manager records a tasks capability it holds", {
    clientId: V1_TASK_CLIENT,
    toolName: "ega_create_task",
    requestId: "audit-tm-ok-create-task",
  });
  await assertAccepted("task_manager records a task read it holds", {
    clientId: V1_TASK_CLIENT,
    toolName: "ega_list_tasks",
    requestId: "audit-tm-ok-list-tasks",
  });
  // The paired denial, and the reason a whole-profile check would be wrong:
  // task_manager holds today.READ and two task write permissions, so a check
  // that only asked "does this principal hold any write permission" would let it
  // claim ega_plan_task_for_today.
  await assertRefused("task_manager claims a today.update capability", {
    clientId: V1_TASK_CLIENT,
    toolName: "ega_plan_task_for_today",
    requestId: "audit-tm-write-today",
  });
  log(
    "AUDIT-AUTHORITY",
    "The same read_only and task_manager principals still record the capabilities their documents authorize (projects.read, tasks.read, tasks.create, and the `always` capability).",
  );

  // The pair to the read_only write-claim refusals above: a workspace_manager
  // grant holding every write permission records the identical tool names.
  await assertAccepted("workspace_manager records a write capability it holds", {
    clientId: V1_WORKSPACE_CLIENT,
    toolName: "ega_create_project",
    requestId: "audit-wm-ok-create-project",
  });
  await assertAccepted("workspace_manager records a sensitive write capability", {
    clientId: V1_WORKSPACE_CLIENT,
    toolName: "ega_clear_completed_today",
    requestId: "audit-wm-ok-clear-today",
  });

  // ---- Non-success outcomes are NOT gated --------------------------------
  //
  // The handlers record outcome 'denied' with errorCode PERMISSION_DENIED for
  // exactly the calls a principal was NOT authorized to make. If 0073 gated
  // every outcome, the product's own denial record would become unwritable.
  const deniedRows = await mcpSession(sql, { clientId: V1_READ_CLIENT }).run((tx) =>
    tx.unsafe(
      `SELECT public.record_mcp_audit_event($1, $2, 'denied', 1, 'PERMISSION_DENIED', '{}'::jsonb) AS event_id`,
      ["audit-authority-read-only-denied-write", "ega_create_project"],
    ),
  );
  assert(
    typeof deniedRows?.[0]?.event_id === "string",
    "a principal must still be able to record that it was DENIED an unauthorized capability; otherwise the product cannot audit its own refusals",
  );
  const [deniedRow] = await sql`
    SELECT outcome, error_code
    FROM public.agent_integration_events
    WHERE request_id = 'audit-authority-read-only-denied-write'
  `;
  assert(
    deniedRow?.outcome === "denied" && deniedRow?.error_code === "PERMISSION_DENIED",
    `the denial row must store the refusal it claims, got ${JSON.stringify(deniedRow)}`,
  );
  log(
    "AUDIT-AUTHORITY",
    "A 'denied' outcome naming an unauthorized capability is still recorded, so the product's own refusal record stays writable; only 'success' asserts an exercised capability.",
  );

  // ---- Identity: the RPC selects nothing -------------------------------
  //
  // The RPC takes no owner/client/grant parameter, so "another owner's identity
  // cannot be selected" is proven by showing OWNER_B cannot write a row
  // attributed to OWNER_A under OWNER_A's client, and that no row was created
  // under OWNER_B's identity either.
  await expectDenied("another owner's client_id", () =>
    audit({
      userId: OWNER_B,
      clientId: V1_WORKSPACE_CLIENT,
      toolName: "ega_list_projects",
      requestId: "audit-authority-foreign-owner",
    }),
  );
  const [foreignRows] = await sql`
    SELECT count(*)::int AS count
    FROM public.agent_integration_events
    WHERE request_id = 'audit-authority-foreign-owner'
  `;
  assert(foreignRows.count === 0, "a foreign owner must not leave an audit row behind");

  // And every row this section produced is attributed to the JWT's own subject.
  const [mismatched] = await sql`
    SELECT count(*)::int AS count
    FROM public.agent_integration_events
    WHERE request_id LIKE 'audit-%'
      AND owner_user_id <> ${OWNER_A}::uuid
  `;
  assert(
    mismatched.count === 0,
    `every audit row must carry the verified subject as owner_user_id, got ${mismatched.count} row(s) attributed elsewhere`,
  );
  log("AUDIT-AUTHORITY", "Audit identity is derived from the verified JWT only; another owner's client_id is refused and no row is attributed elsewhere.");

  // ---- Wrong client, wrong resource, revoked grant ---------------------
  //
  // Pairs against the accepted workspace_manager write above, so a widened
  // grant-resolution predicate fails here.
  await assertRefused("wrong client_id", {
    clientId: "not-a-real-client",
    toolName: "ega_list_projects",
    requestId: "audit-wrong-client",
  });
  await assertRefused("wrong resource", {
    clientId: V1_WORKSPACE_CLIENT,
    toolName: "ega_list_projects",
    resource: "https://evil.example.com/api/mcp",
    requestId: "audit-wrong-resource",
  });
  await assertRefused("revoked grant", {
    clientId: REVOKED_CLIENT,
    toolName: "ega_list_projects",
    requestId: "audit-revoked",
  });
  // The revoked fixture holds the full workspace_manager document, so it passes
  // the capability check and is refused by grant resolution alone. Stating that
  // is what makes this a revocation assertion rather than a duplicate of the
  // capability assertions. The pending grant likewise satisfies every authority
  // condition except being active.
  await assertRefused("pending grant is not active authority", {
    clientId: V1_PENDING_CLIENT,
    toolName: "ega_list_projects",
    requestId: "audit-pending",
  });
  log(
    "AUDIT-AUTHORITY",
    "Wrong client_id, wrong aud, a revoked grant and a pending grant are each refused, while the identical call under the active workspace_manager grant is accepted.",
  );

  // ---- Unregistered tool names ------------------------------------------
  await assertRefused("unregistered tool name", {
    clientId: V1_WORKSPACE_CLIENT,
    toolName: "forged_tool_that_does_not_exist",
    requestId: "audit-unregistered-tool",
  });
  log("AUDIT-AUTHORITY", "An unregistered tool name is refused under a grant that satisfies every other authority condition.");

  // ---- The direct-user audit path is NOT narrowed ----------------------
  //
  // The direct-user shape is a plain INSERT with client_id IS NULL, permitted by
  // the agent_events_direct_user_insert policy from 0056 and still used by
  // apps/web/src/lib/services/agent-task-service.ts. 0073 touches only the RPC,
  // so this must keep working; asserted positively rather than inferred from the
  // MCP denial passing, because the same policy change could refuse both.
  const directUser = directUserSession(sql, { userId: OWNER_A });
  const directRows = await directUser.run((tx) =>
    tx.unsafe(
      `INSERT INTO public.agent_integration_events (
         owner_user_id, token_id, action, resource_type, resource_id, outcome
       ) VALUES ($1::uuid, gen_random_uuid(), 'task.updated', 'task', gen_random_uuid(), 'success')
       RETURNING id`,
      [OWNER_A],
    ),
  );
  assert(
    typeof directRows?.[0]?.id === "string",
    "the direct-user audit INSERT path must still succeed; 0073 must not narrow ordinary owner sessions",
  );
  await sql`DELETE FROM public.agent_integration_events WHERE action = 'task.updated' AND resource_type = 'task' AND token_id IS NOT NULL`;
  log(
    "AUDIT-AUTHORITY",
    "The direct-user (client_id IS NULL) audit INSERT path still succeeds, so the capability check narrowed only the MCP RPC.",
  );

  // ---- Idempotency ------------------------------------------------------
  //
  // The journal is up-only, and every other verifier re-applies the whole
  // journal, so a non-idempotent 0073 would break all of them.
  await applyFile(sql, "0073_mcp_audit_capability_authority");
  log("IDEMPOTENCE", "Re-applied 0073_mcp_audit_capability_authority; up-only convention holds.");

  // Re-prove the boundary after the re-apply: a re-apply that widened
  // registration or dropped the capability check would show here.
  await assertRefused("post-re-apply read_only write claim", {
    clientId: V1_READ_CLIENT,
    toolName: "ega_create_project",
    requestId: "audit-reapply-denied",
  });
  await assertAccepted("post-re-apply permitted capability", {
    clientId: V1_READ_CLIENT,
    toolName: "ega_list_projects",
    requestId: "audit-reapply-allowed",
  });
  log("AUDIT-AUTHORITY", "The capability boundary still holds after re-applying the migration.");
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
    // The two half-revoked rows REVOCATION needs. Both hold the full
    // workspace_manager document, so grant resolution is the only thing that can
    // refuse them - see assertRevocation's header for why each column is set
    // alone.
    await insertGrant(sql, {
      owner: OWNER_A,
      client: REVOKED_AT_CLIENT,
      profile: "workspace_manager",
      permissions: V1_PERMISSIONS.workspace_manager,
      version: 1,
      status: "active",
      revokedAt: sql`now()`,
    });
    await insertGrant(sql, {
      owner: OWNER_A,
      client: STATUS_REVOKED_CLIENT,
      profile: "workspace_manager",
      permissions: V1_PERMISSIONS.workspace_manager,
      version: 1,
      status: "revoked",
      revokedAt: null,
    });
    log("SEED", "Grants seeded: v1 read_only, v1 workspace_manager, v1 revoked (both columns), v1 revoked by revoked_at alone, v1 revoked by status alone");

    // The v1-only assertions run first so the surface proof still produces
    // discriminating output on a revision that does not yet know about
    // permissions_version 2.
    await assertScopeV1(sql);
    await assertColumnFence(sql);
    await assertTaskCompletion(sql);
    await assertRpcSurface(sql);
    await assertRevocation(sql);
    await assertActiveGrantPredicateParity(sql);
    await assertWrongIdentity(sql);
    await assertInternalUnreachable(sql, V1_WORKSPACE_CLIENT);
    await assertAuditToolAllowlist(sql);
    await assertAuditCapabilityAuthority(sql);
    await assertGrantShape(sql);
    await assertCrossOwner(sql, [["v1", V1_WORKSPACE_CLIENT]]);
    await assertCrossOwnerInsert(sql, [["v1", V1_WORKSPACE_CLIENT]]);

    await insertGrant(sql, {
      owner: OWNER_A,
      client: V2_WORKSPACE_CLIENT,
      profile: "workspace_manager",
      permissions: V2_PERMISSIONS.workspace_manager,
      version: 2,
    });
    log("SEED", "permissions_version 2 grant seeded");

    await assertScopeV2(sql);
    // Needs the v2 grant: every probe here is driven by a principal that can
    // already read the row, so that the client_id gate is the only thing left
    // that can refuse the write.
    await assertWriteGates(sql);
    await assertCrossOwner(sql, [["v2", V2_WORKSPACE_CLIENT]]);
    await assertCrossOwnerInsert(sql, [["v2", V2_WORKSPACE_CLIENT]]);

    // After the v2 grant exists: the operation-identity proof needs TWO grants
    // for the same owner, because the harm it asserts is one client's bearer
    // stamping a row as another client's.
    await assertOperationIdentity(sql);

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
