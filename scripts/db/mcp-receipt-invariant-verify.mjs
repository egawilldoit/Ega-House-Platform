#!/usr/bin/env node
/**
 * Ephemeral-database migration proof for the MCP mutation-receipt fenced claim
 * API (drizzle/0052_mcp_mutation_receipts.sql). The receipt phases cover the
 * ledger's idempotency contract. The domain phase proves the 0059 operation
 * fences at the database boundary, including a receipt claim, domain commit,
 * lost receipt, lease expiry, fresh claim, and canonical replay for all five
 * create tables. Application/repository replay mapping is covered by the
 * package tests.
 *
 * Applies the full drizzle migration journal (plus a minimal Supabase shim:
 * auth schema, GUC-backed auth.uid()/auth.jwt() stubs, Supabase roles, one
 * auth.users row required by 0043, and the automation.implementation_runs
 * stand-in) to a disposable Postgres, seeds one active mcp_authorization_grants
 * row, then proves the receipt contract end to end:
 *
 *   CLAIM-FIRST   - first claim for a fresh (owner, client, tool, operation_id)
 *                   returns CLAIM_GRANTED with a claim token.
 *   CLAIM-DUP     - a second claim with the same operation id + fingerprint
 *                   returns IN_PROGRESS while the first executor's lease is
 *                   live (caller must NOT mutate).
 *   STORE-REPLAY  - after mcp_store_mutation_result, the claim returns REPLAY
 *                   carrying the stored result_payload.
 *   CONFLICT      - the same operation id claimed with a different fingerprint
 *                   returns CONFLICT (never mutates).
 *   TOKEN-GUARD   - storing with a stale/foreign claim token raises SQLSTATE
 *                   02000 and leaves the receipt untouched.
 *   LEASE-RECOVERY- an expired lease is recovered: claim returns CLAIM_GRANTED
 *                   with a fresh token; the stale executor can no longer store.
 *   FAIL-FINAL    - fail(final=true) marks FAILED_FINAL (terminal); the
 *                   next claim replays the stored error payload, no re-mutation.
 *   FAIL-RETRY    - fail(final=false) marks FAILED_RETRYABLE; the next claim
 *                   resets to CLAIM_GRANTED with a fresh token (safe retry).
 *   FAIL-CLOSED   - missing auth context or a revoked grant raises SQLSTATE
 *                   42501 (no receipt is created).
 *   DOMAIN-FENCE  - each of projects, goals, tasks, task_reminders, and
 *                   task_sessions claims a receipt, commits once, loses the
 *                   receipt before store, expires the lease, reclaims with a
 *                   fresh token, and resolves the retry to the original row;
 *                   two-way and representative ten-way concurrent inserts are
 *                   also fenced.
 *
 * Usage:
 *   node scripts/db/mcp-receipt-invariant-verify.mjs --url <postgres-url>
 *   node scripts/db/mcp-receipt-invariant-verify.mjs --url <postgres-url>
 *     --upgrade-from 0049_operator_proposals
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
    if (rest[i] === "--upgrade-from") args.upgradeFrom = rest[++i];
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

async function assertCurrentMainBaseline(sql) {
  const expectedTables = [
    "notifications",
    "notification_devices",
    "notification_deliveries",
    "notification_preferences",
    "user_time_context",
    "inbox_idempotency_keys",
    "operator_proposals",
  ];
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${sql.array(expectedTables)})
  `;
  const actualTables = new Set(tables.map((row) => row.table_name));
  assert(
    expectedTables.every((table) => actualTables.has(table)),
    `current-main baseline is missing expected tables: ${expectedTables.filter((table) => !actualTables.has(table)).join(", ")}`,
  );

  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_reminders'
      AND column_name = ANY(${sql.array(["delivery_mode", "processed_at", "processing_error", "source", "source_id"])})
  `;
  const actualColumns = new Set(columns.map((row) => row.column_name));
  const expectedColumns = ["delivery_mode", "processed_at", "processing_error", "source", "source_id"];
  assert(
    expectedColumns.every((column) => actualColumns.has(column)),
    `current-main baseline is missing task_reminders columns: ${expectedColumns.filter((column) => !actualColumns.has(column)).join(", ")}`,
  );
  log("MIGRATE-BASELINE", "0049 current-main schema verified before applying the MCP tail.");
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
  // GUC-backed auth stubs so the proof can act as an authenticated MCP session:
  // each proof transaction sets request.jwt.claim.sub / request.jwt.claims with
  // set_config(..., is_local => true) instead of ALTER FUNCTION stubs.
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
  // Migrations 0035+ alter automation.implementation_runs additively and
  // document that its base table predates the journal ("already exist in
  // production via manual/supabase setup"). The proof harness stands in the
  // Runner's documented base columns so those additive migrations and their
  // indexes still apply end-to-end.
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
const GRANT_ID = "55555555-5555-4555-8555-555555555551";
const READ_GRANT_ID = "55555555-5555-4555-8555-555555555552";
const CLIENT_ID = "hermes-client";
const READ_CLIENT_ID = "read-only-client";
const RESOURCE_URI = "https://ega.example.com/api/mcp";

const LEGACY_READ_ONLY_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
];
const LEGACY_TASK_MANAGER_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
];
const LEGACY_DELIVERY_OBSERVER_PERMISSIONS = [
  "delivery_runs.read",
  "delivery_events.read",
  "delivery_artifacts.read",
];
const CURRENT_READ_ONLY_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "today.read",
  "timer.read",
];
const CURRENT_TASK_MANAGER_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "timer.read",
];
const CURRENT_WORKSPACE_MANAGER_PERMISSIONS = [
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
];

const LEGACY_READ_ACTIVE_GRANTS = [
  { id: "55555555-5555-4555-8555-555555555601", owner: "55555555-5555-4555-8555-555555555611", client: "legacy-read-client-1" },
  { id: "55555555-5555-4555-8555-555555555602", owner: "55555555-5555-4555-8555-555555555612", client: "legacy-read-client-2" },
  { id: "55555555-5555-4555-8555-555555555603", owner: "55555555-5555-4555-8555-555555555613", client: "legacy-read-client-3" },
];
const LEGACY_READ_PENDING_GRANT = {
  id: "55555555-5555-4555-8555-555555555604",
  owner: "55555555-5555-4555-8555-555555555614",
  client: "legacy-read-pending",
};
const LEGACY_TASK_ACTIVE_GRANT = {
  id: "55555555-5555-4555-8555-555555555605",
  owner: "55555555-5555-4555-8555-555555555615",
  client: "legacy-task-client",
};
const LEGACY_TASK_PENDING_GRANT = {
  id: "55555555-5555-4555-8555-555555555606",
  owner: "55555555-5555-4555-8555-555555555616",
  client: "legacy-task-pending",
};
const LEGACY_DELIVERY_ACTIVE_GRANT = {
  id: "55555555-5555-4555-8555-555555555607",
  owner: "55555555-5555-4555-8555-555555555617",
  client: "legacy-delivery-client",
};
const LEGACY_DELIVERY_PENDING_GRANT = {
  id: "55555555-5555-4555-8555-555555555608",
  owner: "55555555-5555-4555-8555-555555555618",
  client: "legacy-delivery-pending",
};
const LEGACY_DELIVERY_REVOKED_GRANT = {
  id: "55555555-5555-4555-8555-555555555609",
  owner: "55555555-5555-4555-8555-555555555619",
  client: "legacy-delivery-revoked",
  revokedAt: "2026-08-30T00:00:00.000Z",
};
const TOOL = "ega_create_task";
const OP_FIRST = "66666666-6666-4666-8666-666666666661";
const OP_TOKEN_GUARD = "66666666-6666-4666-8666-666666666662";
const OP_FAIL_FINAL = "66666666-6666-4666-8666-666666666663";
const OP_FAIL_RETRY = "66666666-6666-4666-8666-666666666664";
const DOMAIN_PROJECT_OP = "88888888-8888-4888-8888-888888888801";
const DOMAIN_GOAL_OP = "88888888-8888-4888-8888-888888888802";
const DOMAIN_TASK_OP = "88888888-8888-4888-8888-888888888803";
const DOMAIN_REMINDER_OP = "88888888-8888-4888-8888-888888888804";
const DOMAIN_SESSION_OP = "88888888-8888-4888-8888-888888888805";
const DOMAIN_CONCURRENT_PROJECT_OP = "88888888-8888-4888-8888-888888888811";
const DOMAIN_CONCURRENT_GOAL_OP = "88888888-8888-4888-8888-888888888812";
const DOMAIN_CONCURRENT_TASK_OP = "88888888-8888-4888-8888-888888888813";
const DOMAIN_CONCURRENT_REMINDER_OP = "88888888-8888-4888-8888-888888888814";
const DOMAIN_CONCURRENT_SESSION_OP = "88888888-8888-4888-8888-888888888815";
const DOMAIN_CONCURRENT_TASK_TEN_OP = "88888888-8888-4888-8888-888888888816";

const DOMAIN_PROJECT_ID = "88888888-8888-4888-8888-888888888821";
const DOMAIN_GOAL_ID = "88888888-8888-4888-8888-888888888822";
const DOMAIN_TASK_ID = "88888888-8888-4888-8888-888888888823";
const DOMAIN_REMINDER_ID = "88888888-8888-4888-8888-888888888824";
const DOMAIN_SESSION_ID = "88888888-8888-4888-8888-888888888825";

function fingerprint(args, tool = TOOL) {
  // Mirrors canonicalMutationFingerprint's hashed shape ({tool, args}); the
  // invariants under proof only need stable, distinct, argument-derived hashes.
  return createHash("sha256").update(JSON.stringify({ tool, args })).digest("hex");
}

async function seedActiveGrant(sql) {
  await sql.unsafe(
    `
    INSERT INTO public.mcp_authorization_grants
      (id, owner_user_id, oauth_client_id, resource_uri, client_name, status, permission_profile, permissions, permissions_version)
    VALUES
      ($1::uuid, $2::uuid, $3, $4, 'Hermes', 'active', 'workspace_manager',
       '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb, 1)
    ON CONFLICT (id) DO NOTHING
  `,
    [GRANT_ID, OWNER_A, CLIENT_ID, RESOURCE_URI],
  );
  await sql.unsafe(
    `
    INSERT INTO public.mcp_authorization_grants
      (id, owner_user_id, oauth_client_id, resource_uri, client_name, status, permission_profile, permissions, permissions_version)
    VALUES
      ($1::uuid, $2::uuid, $3, $4, 'Read-only client', 'active', 'read_only',
       '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb, 1)
    ON CONFLICT (id) DO NOTHING
  `,
    [READ_GRANT_ID, OWNER_B, READ_CLIENT_ID, RESOURCE_URI],
  );
  log("SEED", "Active workspace_manager and read_only grants inserted for the proof owners");
}

async function insertGrant(sql, grant, status, permissionProfile, permissions) {
  await sql.unsafe(
    `
    INSERT INTO public.mcp_authorization_grants
      (id, owner_user_id, oauth_client_id, resource_uri, client_name, status, permission_profile, permissions, permissions_version, revoked_at)
    VALUES ($1::uuid, $2::uuid, $3, $4, 'Migration fixture', $5, $6, $7::jsonb, 1, $8::timestamptz)
    `,
    [
      grant.id,
      grant.owner,
      grant.client,
      RESOURCE_URI,
      status,
      permissionProfile,
      JSON.stringify(permissions),
      grant.revokedAt ?? null,
    ],
  );
}

async function seedLegacyGrantFixture(sql) {
  for (const grant of LEGACY_READ_ACTIVE_GRANTS) {
    await insertGrant(sql, grant, "active", "read_only", LEGACY_READ_ONLY_PERMISSIONS);
  }
  await insertGrant(sql, LEGACY_READ_PENDING_GRANT, "pending", "read_only", LEGACY_READ_ONLY_PERMISSIONS);
  await insertGrant(sql, LEGACY_TASK_ACTIVE_GRANT, "active", "task_manager", LEGACY_TASK_MANAGER_PERMISSIONS);
  await insertGrant(sql, LEGACY_TASK_PENDING_GRANT, "pending", "task_manager", LEGACY_TASK_MANAGER_PERMISSIONS);
  await insertGrant(sql, LEGACY_DELIVERY_ACTIVE_GRANT, "active", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  await insertGrant(sql, LEGACY_DELIVERY_PENDING_GRANT, "pending", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  await insertGrant(sql, LEGACY_DELIVERY_REVOKED_GRANT, "revoked", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  log("LEGACY-SEED", "Production-shaped legacy read_only, task_manager, and delivery_observer grants inserted before 0050.");
}

async function assertGrant(sql, grant, expectedStatus, expectedProfile, expectedPermissions) {
  const [row] = await sql`
    SELECT status, permission_profile, permissions, permissions_version, revoked_at
    FROM public.mcp_authorization_grants
    WHERE id = ${grant.id}::uuid
  `;
  assert(row?.status === expectedStatus, `${grant.client} expected ${expectedStatus}, got ${row?.status}`);
  assert(row?.permission_profile === expectedProfile, `${grant.client} profile changed unexpectedly`);
  assert(
    JSON.stringify(row?.permissions) === JSON.stringify(expectedPermissions),
    `${grant.client} permissions changed unexpectedly`,
  );
  assert(row?.permissions_version === 1, `${grant.client} permissions_version changed unexpectedly`);
  if (expectedStatus === "active" || expectedStatus === "pending") {
    assert(row?.revoked_at === null, `${grant.client} unexpectedly has revoked_at`);
  } else {
    assert(row?.revoked_at !== null, `${grant.client} terminal transition must set revoked_at`);
    if (grant.revokedAt) {
      assert(
        new Date(row.revoked_at).toISOString() === new Date(grant.revokedAt).toISOString(),
        `${grant.client} existing revoked_at was changed unexpectedly`,
      );
    }
  }
}

async function assertLegacyGrantMigration(sql) {
  for (const grant of LEGACY_READ_ACTIVE_GRANTS) {
    await assertGrant(sql, grant, "revoked", "read_only", LEGACY_READ_ONLY_PERMISSIONS);
  }
  await assertGrant(sql, LEGACY_READ_PENDING_GRANT, "failed", "read_only", LEGACY_READ_ONLY_PERMISSIONS);
  await assertGrant(sql, LEGACY_TASK_ACTIVE_GRANT, "revoked", "task_manager", LEGACY_TASK_MANAGER_PERMISSIONS);
  await assertGrant(sql, LEGACY_TASK_PENDING_GRANT, "failed", "task_manager", LEGACY_TASK_MANAGER_PERMISSIONS);
  await assertGrant(sql, LEGACY_DELIVERY_ACTIVE_GRANT, "revoked", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  await assertGrant(sql, LEGACY_DELIVERY_PENDING_GRANT, "failed", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  await assertGrant(sql, LEGACY_DELIVERY_REVOKED_GRANT, "revoked", "delivery_observer", LEGACY_DELIVERY_OBSERVER_PERMISSIONS);
  log("LEGACY-UPGRADE", "Known legacy active grants were revoked, pending grants failed, and permission documents were preserved.");
}

async function assertCurrentGrantConstraints(sql) {
  const currentGrants = [
    {
      id: "55555555-5555-4555-8555-555555555621",
      owner: "55555555-5555-4555-8555-555555555631",
      client: "current-read-client",
      profile: "read_only",
      permissions: CURRENT_READ_ONLY_PERMISSIONS,
    },
    {
      id: "55555555-5555-4555-8555-555555555622",
      owner: "55555555-5555-4555-8555-555555555632",
      client: "current-task-client",
      profile: "task_manager",
      permissions: CURRENT_TASK_MANAGER_PERMISSIONS,
    },
    {
      id: "55555555-5555-4555-8555-555555555623",
      owner: "55555555-5555-4555-8555-555555555633",
      client: "current-workspace-client",
      profile: "workspace_manager",
      permissions: CURRENT_WORKSPACE_MANAGER_PERMISSIONS,
    },
  ];
  for (const grant of currentGrants) {
    await insertGrant(sql, grant, "active", grant.profile, grant.permissions);
    await assertGrant(sql, grant, "active", grant.profile, grant.permissions);
  }
  log("CURRENT-GRANTS", "Fresh active grants accepted only with the canonical current permission documents.");

  const unknownActive = {
    id: "55555555-5555-4555-8555-555555555624",
    owner: "55555555-5555-4555-8555-555555555634",
    client: "unknown-active-client",
  };
  const unknownTerminal = {
    id: "55555555-5555-4555-8555-555555555625",
    owner: "55555555-5555-4555-8555-555555555635",
    client: "unknown-terminal-client",
  };
  const unknownPermissions = ["projects.read", "unknown.permission"];
  const activeError = await capturePostgresError(() =>
    insertGrant(sql, unknownActive, "active", "read_only", unknownPermissions),
  );
  const terminalError = await capturePostgresError(() =>
    insertGrant(sql, unknownTerminal, "revoked", "read_only", unknownPermissions),
  );
  assert(activeError === "23514", `unknown active permission shape must fail closed, got ${activeError}`);
  assert(terminalError === "23514", `unknown terminal permission shape must fail closed, got ${terminalError}`);
  log("UNKNOWN-GRANT", "Unknown permission documents were rejected for both active and terminal rows.");
}

// Runs `fn` inside one transaction carrying a transaction-local MCP auth
// context (request.jwt.claim.sub / request.jwt.claims), matching how the
// migration RPCs read auth.uid()/auth.jwt() in Supabase.
function mcpSession(sql, { userId = OWNER_A, clientId = CLIENT_ID, resource = RESOURCE_URI } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        if (userId) {
          await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        }
        if (userId && clientId && resource) {
          await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ client_id: clientId, aud: resource }),
          ]);
        }
        return fn(tx);
      });
    },
  };
}

async function expectDenied(label, fn) {
  const code = await capturePostgresError(fn);
  assert(code !== null, `${label} must be denied`);
  log("RLS", `${label} denied (${code}).`);
}

async function insertProject(conn, id, ownerId, slug) {
  await conn.unsafe(
    `INSERT INTO public.projects (id, name, slug, owner_user_id)
     VALUES ($1::uuid, $2::uuid, $3, $2::uuid)`,
    [id, ownerId, slug],
  );
}

async function runConcurrencyProof(sql, session) {
  const fp = fingerprint({ title: "concurrent task", projectId: "p1" });
  const opTwo = "66666666-6666-4666-8666-666666666665";
  const twoWay = await Promise.all(
    [0, 1].map(() => session.run((tx) => claimReceipt(tx, TOOL, opTwo, fp))),
  );
  assert(twoWay.filter((row) => row?.claim_outcome === "CLAIM_GRANTED").length === 1, "2-way claim has one grant");
  assert(twoWay.filter((row) => row?.claim_outcome === "IN_PROGRESS").length === 1, "2-way claim has one in-progress result");
  log("2-WAY", "Two concurrent same-operation claims produced one grant and one IN_PROGRESS.");

  const opTen = "66666666-6666-4666-8666-666666666666";
  const tenWay = await Promise.all(
    Array.from({ length: 10 }, () => session.run((tx) => claimReceipt(tx, TOOL, opTen, fp))),
  );
  assert(tenWay.filter((row) => row?.claim_outcome === "CLAIM_GRANTED").length === 1, "10-way claim has one grant");
  assert(tenWay.filter((row) => row?.claim_outcome === "IN_PROGRESS").length === 9, "10-way claim has nine in-progress results");
  log("10-WAY", "Ten concurrent same-operation claims produced one grant and nine IN_PROGRESS.");
}

async function runRlsProof(sql) {
  const workspace = mcpSession(sql);
  const readOnly = mcpSession(sql, { userId: OWNER_B, clientId: READ_CLIENT_ID });
  const ownProjectId = "77777777-7777-4777-8777-777777777771";
  const otherProjectId = "77777777-7777-4777-8777-777777777772";

  await sql`
    INSERT INTO public.projects (id, name, slug, owner_user_id)
    VALUES (${otherProjectId}::uuid, 'Other owner project', 'other-owner-project', ${OWNER_B}::uuid)
  `;
  await workspace.run((tx) => insertProject(tx, ownProjectId, OWNER_A, "workspace-project"));
  log("RLS", "workspace_manager own project mutation succeeded.");

  await expectDenied("read_only project insert", () =>
    readOnly.run((tx) => insertProject(tx, "77777777-7777-4777-8777-777777777773", OWNER_B, "read-only-project")),
  );
  await expectDenied("cross-owner project insert", () =>
    workspace.run((tx) => insertProject(tx, "77777777-7777-4777-8777-777777777774", OWNER_B, "cross-owner-project")),
  );

  await sql`
    UPDATE public.mcp_authorization_grants SET status = 'revoked', revoked_at = now()
    WHERE id = ${GRANT_ID}::uuid
  `;
  await expectDenied("revoked grant project insert", () =>
    workspace.run((tx) => insertProject(tx, "77777777-7777-4777-8777-777777777775", OWNER_A, "revoked-project")),
  );
  await sql`
    UPDATE public.mcp_authorization_grants SET status = 'active', revoked_at = NULL
    WHERE id = ${GRANT_ID}::uuid
  `;
  await expectDenied("wrong client project insert", () =>
    mcpSession(sql, { clientId: "wrong-client" }).run((tx) => insertProject(tx, "77777777-7777-4777-8777-777777777776", OWNER_A, "wrong-client-project")),
  );
  await expectDenied("wrong resource project insert", () =>
    mcpSession(sql, { resource: "https://evil.example.com/api/mcp" }).run((tx) => insertProject(tx, "77777777-7777-4777-8777-777777777777", OWNER_A, "wrong-resource-project")),
  );

  const deleteCount = await workspace.run(async (tx) => {
    const rows = await tx.unsafe(`DELETE FROM public.projects WHERE id = $1::uuid RETURNING id`, [otherProjectId]);
    return rows.length;
  });
  assert(deleteCount === 0, "cross-owner physical DELETE must affect zero rows");
  const [otherProject] = await sql`SELECT id FROM public.projects WHERE id = ${otherProjectId}::uuid`;
  assert(otherProject?.id === otherProjectId, "cross-owner project remains after unauthorized DELETE");
  log("RLS", "cross-owner physical DELETE affected zero rows and preserved the row.");

  await expectDenied("direct mutation-receipt table SELECT", () =>
    workspace.run((tx) => tx.unsafe(`SELECT * FROM public.mcp_mutation_receipts`)),
  );
  await expectDenied("direct mutation-receipt table DELETE", () =>
    workspace.run((tx) => tx.unsafe(`DELETE FROM public.mcp_mutation_receipts`)),
  );
}

async function claimReceipt(conn, tool, operationId, argsHash) {
  const rows = await conn.unsafe(`SELECT * FROM public.mcp_claim_mutation_receipt($1, $2, $3)`, [
    tool,
    operationId,
    argsHash,
  ]);
  return rows[0];
}

async function storeResult(conn, tool, operationId, claimToken, payload) {
  await conn.unsafe(`SELECT public.mcp_store_mutation_result($1, $2, $3, $4)`, [
    tool,
    operationId,
    claimToken,
    JSON.stringify(payload),
  ]);
}

async function failResult(conn, tool, operationId, claimToken, final) {
  await conn.unsafe(`SELECT public.mcp_fail_mutation_result($1, $2, $3, $4)`, [
    tool,
    operationId,
    claimToken,
    final,
  ]);
}

async function capturePostgresError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? null;
  }
}

async function capturePostgresErrorObject(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
}

function postgresErrorText(error) {
  return [error?.constraint, error?.message, error?.detail, error?.details, error?.hint]
    .filter((value) => typeof value === "string")
    .join("\n");
}

async function proveDomainCrashReplay(
  sql,
  {
    label,
    table,
    indexNames,
    toolName,
    operationId,
    insertSql,
    firstParams,
    retryParams,
  },
) {
  const session = mcpSession(sql);
  const argsHash = fingerprint({ domain: label, operationId }, toolName);
  const firstClaim = await session.run((tx) => claimReceipt(tx, toolName, operationId, argsHash));
  assert(firstClaim?.claim_outcome === "CLAIM_GRANTED", `${label} crash setup must claim the receipt`);
  assert(typeof firstClaim.claim_token === "string", `${label} crash setup must receive a claim token`);

  const firstRows = await session.run((tx) => tx.unsafe(insertSql, firstParams));
  const firstId = firstRows[0]?.id;
  assert(typeof firstId === "string", `${label} first INSERT must return an id`);

  // The domain transaction committed, then the process crashed before the
  // receipt store. Expire the uncompleted lease and let a fresh executor
  // reclaim the operation under a new token.
  const [expired] = await sql.unsafe(
    `UPDATE public.mcp_mutation_receipts
     SET lease_expires_at = now() - interval '1 second'
     WHERE owner_user_id = $1::uuid
       AND oauth_client_id = $2
       AND tool_name = $3
       AND operation_id = $4::uuid
       AND status = 'EXECUTING'
     RETURNING operation_id`,
    [OWNER_A, CLIENT_ID, toolName, operationId],
  );
  assert(expired?.operation_id === operationId, `${label} crash setup must expire the claimed receipt`);
  const recoveredClaim = await session.run((tx) => claimReceipt(tx, toolName, operationId, argsHash));
  assert(recoveredClaim?.claim_outcome === "CLAIM_GRANTED", `${label} expired receipt must be reclaimable`);
  assert(recoveredClaim.claim_token !== firstClaim.claim_token, `${label} recovery must rotate the claim token`);

  // The fresh executor repeats the same domain INSERT. The named operation
  // fence rejects the duplicate; the repository can then load the canonical
  // row and store its result under the recovered receipt claim.
  const retryError = await capturePostgresErrorObject(() =>
    session.run((tx) => tx.unsafe(insertSql, retryParams)),
  );
  assert(retryError?.code === "23505", `${label} retry must hit SQLSTATE 23505`);
  assert(
    indexNames.some((indexName) => postgresErrorText(retryError).includes(indexName)),
    `${label} retry must identify one of ${indexNames.join(", ")}; got ${postgresErrorText(retryError)}`,
  );

  const [canonical] = await session.run((tx) =>
    tx.unsafe(
      `SELECT id, owner_user_id, mcp_client_id, mcp_operation_id
       FROM public.${table}
       WHERE owner_user_id = $1::uuid
         AND mcp_client_id = $2
         AND mcp_operation_id = $3::uuid`,
      [OWNER_A, CLIENT_ID, operationId],
    ),
  );
  assert(canonical?.id === firstId, `${label} replay must return the original row`);
  assert(canonical.owner_user_id === OWNER_A, `${label} replay must remain owner scoped`);
  assert(canonical.mcp_client_id === CLIENT_ID, `${label} replay must remain client scoped`);

  const [count] = await sql.unsafe(
    `SELECT count(*)::int AS count
     FROM public.${table}
     WHERE owner_user_id = $1::uuid
       AND mcp_client_id = $2
       AND mcp_operation_id = $3::uuid`,
    [OWNER_A, CLIENT_ID, operationId],
  );
  assert(Number(count?.count) === 1, `${label} must leave exactly one domain row`);

  await session.run((tx) => storeResult(tx, toolName, operationId, recoveredClaim.claim_token, {
    ok: true,
    domain: label,
    id: firstId,
  }));
  const replay = await session.run((tx) => claimReceipt(tx, toolName, operationId, argsHash));
  const replayPayload = typeof replay?.existing_result === "string"
    ? JSON.parse(replay.existing_result)
    : replay?.existing_result;
  assert(replay?.claim_outcome === "REPLAY", `${label} recovered receipt must replay after store`);
  assert(replayPayload?.id === firstId, `${label} receipt replay must carry the original row id`);
  log("DOMAIN-CRASH", `${label}: claim → commit → lease expiry → fresh claim → canonical replay left one row.`);
  return firstId;
}

async function proveDomainConcurrency(
  sql,
  {
    label,
    table,
    indexNames,
    operationId,
    attemptIds,
    insertSql,
    paramsForAttempt,
  },
) {
  const outcomes = await Promise.all(
    attemptIds.map(async (attemptId, ordinal) => {
      try {
        await sql.unsafe(insertSql, paramsForAttempt(attemptId, ordinal));
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error };
      }
    }),
  );
  const winners = outcomes.filter((outcome) => outcome.ok);
  const losers = outcomes.filter((outcome) => !outcome.ok);
  assert(winners.length === 1, `${label} concurrency must have one winner`);
  assert(losers.length === attemptIds.length - 1, `${label} concurrency must fence all other attempts`);
  for (const loser of losers) {
    assert(loser.error?.code === "23505", `${label} loser must hit SQLSTATE 23505`);
    assert(
      indexNames.some((indexName) => postgresErrorText(loser.error).includes(indexName)),
      `${label} loser must identify an expected unique index; got ${postgresErrorText(loser.error)}`,
    );
  }

  const [count] = await sql.unsafe(
    `SELECT count(*)::int AS count
     FROM public.${table}
     WHERE owner_user_id = $1::uuid
       AND mcp_client_id = $2
       AND mcp_operation_id = $3::uuid`,
    [OWNER_A, CLIENT_ID, operationId],
  );
  assert(Number(count?.count) === 1, `${label} concurrency must leave one domain row`);
  log("DOMAIN-CONCURRENCY", `${label}: ${attemptIds.length} simultaneous inserts left one domain row.`);
}

async function runDomainFencingProof(sql) {
  const expectedIndexes = [
    "projects_mcp_operation_unique",
    "goals_mcp_operation_unique",
    "tasks_mcp_operation_unique",
    "task_reminders_mcp_operation_unique",
    "task_sessions_mcp_operation_unique",
  ];
  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${sql.array(expectedIndexes)})
  `;
  for (const indexName of expectedIndexes) {
    assert(indexes.some((row) => row.indexname === indexName), `0059 must create ${indexName}`);
  }
  log("DOMAIN-SCHEMA", "0059 operation indexes exist for all five create tables.");

  const projectInsert = `
    INSERT INTO public.projects
      (id, name, slug, description, owner_user_id, mcp_operation_id, mcp_client_id)
    VALUES ($1::uuid, 'Domain fenced project', 'domain-fenced-project', NULL, $2::uuid, $3::uuid, $4)
    RETURNING id
  `;
  const goalInsert = `
    INSERT INTO public.goals
      (id, project_id, title, owner_user_id, mcp_operation_id, mcp_client_id)
    VALUES ($1::uuid, $2::uuid, 'Domain fenced goal', $3::uuid, $4::uuid, $5)
    RETURNING id
  `;
  const taskInsert = `
    INSERT INTO public.tasks
      (id, project_id, goal_id, title, owner_user_id, mcp_operation_id, mcp_client_id)
    VALUES ($1::uuid, $2::uuid, NULL, 'Domain fenced task', $3::uuid, $4::uuid, $5)
    RETURNING id
  `;
  const reminderInsert = `
    INSERT INTO public.task_reminders
      (id, owner_user_id, task_id, remind_at, mcp_operation_id, mcp_client_id)
    VALUES ($1::uuid, $2::uuid, $3::uuid, '2030-08-29T10:00:00Z', $4::uuid, $5)
    RETURNING id
  `;
  const sessionInsert = `
    INSERT INTO public.task_sessions
      (id, owner_user_id, task_id, started_at, mcp_operation_id, mcp_client_id)
    VALUES ($1::uuid, $2::uuid, $3::uuid, '2026-08-29T10:00:00Z', $4::uuid, $5)
    RETURNING id
  `;

  await proveDomainCrashReplay(sql, {
    label: "PROJECT_CREATE",
    table: "projects",
    indexNames: ["projects_mcp_operation_unique", "projects_owner_user_id_slug_unique"],
    toolName: "ega_create_project",
    operationId: DOMAIN_PROJECT_OP,
    insertSql: projectInsert,
    firstParams: [DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_PROJECT_OP, CLIENT_ID],
    retryParams: ["88888888-8888-4888-8888-888888888826", OWNER_A, DOMAIN_PROJECT_OP, CLIENT_ID],
  });
  await proveDomainCrashReplay(sql, {
    label: "GOAL_CREATE",
    table: "goals",
    indexNames: ["goals_mcp_operation_unique"],
    toolName: "ega_create_goal",
    operationId: DOMAIN_GOAL_OP,
    insertSql: goalInsert,
    firstParams: [DOMAIN_GOAL_ID, DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_GOAL_OP, CLIENT_ID],
    retryParams: ["88888888-8888-4888-8888-888888888827", DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_GOAL_OP, CLIENT_ID],
  });
  await proveDomainCrashReplay(sql, {
    label: "TASK_CREATE",
    table: "tasks",
    indexNames: ["tasks_mcp_operation_unique"],
    toolName: "ega_create_task",
    operationId: DOMAIN_TASK_OP,
    insertSql: taskInsert,
    firstParams: [DOMAIN_TASK_ID, DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_TASK_OP, CLIENT_ID],
    retryParams: ["88888888-8888-4888-8888-888888888828", DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_TASK_OP, CLIENT_ID],
  });
  await proveDomainCrashReplay(sql, {
    label: "REMINDER_CREATE",
    table: "task_reminders",
    indexNames: ["task_reminders_mcp_operation_unique"],
    toolName: "ega_create_task_reminder",
    operationId: DOMAIN_REMINDER_OP,
    insertSql: reminderInsert,
    firstParams: [DOMAIN_REMINDER_ID, OWNER_A, DOMAIN_TASK_ID, DOMAIN_REMINDER_OP, CLIENT_ID],
    retryParams: ["88888888-8888-4888-8888-888888888829", OWNER_A, DOMAIN_TASK_ID, DOMAIN_REMINDER_OP, CLIENT_ID],
  });
  await proveDomainCrashReplay(sql, {
    label: "SESSION_CREATE",
    table: "task_sessions",
    indexNames: ["task_sessions_mcp_operation_unique", "task_sessions_owner_open_unique"],
    toolName: "ega_start_timer",
    operationId: DOMAIN_SESSION_OP,
    insertSql: sessionInsert,
    firstParams: [DOMAIN_SESSION_ID, OWNER_A, DOMAIN_TASK_ID, DOMAIN_SESSION_OP, CLIENT_ID],
    retryParams: ["88888888-8888-4888-8888-888888888830", OWNER_A, DOMAIN_TASK_ID, DOMAIN_SESSION_OP, CLIENT_ID],
  });

  const concurrentProjectInsert = projectInsert.replace("domain-fenced-project", "domain-concurrent-project");
  await proveDomainConcurrency(sql, {
    label: "PROJECT_CREATE",
    table: "projects",
    indexNames: ["projects_mcp_operation_unique", "projects_owner_user_id_slug_unique"],
    operationId: DOMAIN_CONCURRENT_PROJECT_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888831",
      "88888888-8888-4888-8888-888888888832",
    ],
    insertSql: concurrentProjectInsert,
    paramsForAttempt: (attemptId) => [attemptId, OWNER_A, DOMAIN_CONCURRENT_PROJECT_OP, CLIENT_ID],
  });

  await proveDomainConcurrency(sql, {
    label: "GOAL_CREATE",
    table: "goals",
    indexNames: ["goals_mcp_operation_unique"],
    operationId: DOMAIN_CONCURRENT_GOAL_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888833",
      "88888888-8888-4888-8888-888888888834",
    ],
    insertSql: goalInsert,
    paramsForAttempt: (attemptId) => [attemptId, DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_CONCURRENT_GOAL_OP, CLIENT_ID],
  });

  await proveDomainConcurrency(sql, {
    label: "TASK_CREATE",
    table: "tasks",
    indexNames: ["tasks_mcp_operation_unique"],
    operationId: DOMAIN_CONCURRENT_TASK_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888835",
      "88888888-8888-4888-8888-888888888836",
    ],
    insertSql: taskInsert,
    paramsForAttempt: (attemptId) => [attemptId, DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_CONCURRENT_TASK_OP, CLIENT_ID],
  });

  await proveDomainConcurrency(sql, {
    label: "REMINDER_CREATE",
    table: "task_reminders",
    indexNames: ["task_reminders_mcp_operation_unique"],
    operationId: DOMAIN_CONCURRENT_REMINDER_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888837",
      "88888888-8888-4888-8888-888888888838",
    ],
    insertSql: reminderInsert,
    paramsForAttempt: (attemptId) => [attemptId, OWNER_A, DOMAIN_TASK_ID, DOMAIN_CONCURRENT_REMINDER_OP, CLIENT_ID],
  });

  // Close the crash-proof session before exercising the owner-open invariant
  // with a distinct operation. The operation fence remains persisted.
  await sql.unsafe(
    `UPDATE public.task_sessions
     SET ended_at = '2026-08-29T11:00:00Z', duration_seconds = 3600
     WHERE id = $1::uuid`,
    [DOMAIN_SESSION_ID],
  );
  await proveDomainConcurrency(sql, {
    label: "SESSION_CREATE",
    table: "task_sessions",
    indexNames: ["task_sessions_mcp_operation_unique", "task_sessions_owner_open_unique"],
    operationId: DOMAIN_CONCURRENT_SESSION_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888839",
      "88888888-8888-4888-8888-888888888840",
    ],
    insertSql: sessionInsert,
    paramsForAttempt: (attemptId) => [attemptId, OWNER_A, DOMAIN_TASK_ID, DOMAIN_CONCURRENT_SESSION_OP, CLIENT_ID],
  });

  await proveDomainConcurrency(sql, {
    label: "TASK_CREATE_10_WAY",
    table: "tasks",
    indexNames: ["tasks_mcp_operation_unique"],
    operationId: DOMAIN_CONCURRENT_TASK_TEN_OP,
    attemptIds: [
      "88888888-8888-4888-8888-888888888841",
      "88888888-8888-4888-8888-888888888842",
      "88888888-8888-4888-8888-888888888843",
      "88888888-8888-4888-8888-888888888844",
      "88888888-8888-4888-8888-888888888845",
      "88888888-8888-4888-8888-888888888846",
      "88888888-8888-4888-8888-888888888847",
      "88888888-8888-4888-8888-888888888848",
      "88888888-8888-4888-8888-888888888849",
      "88888888-8888-4888-8888-888888888850",
    ],
    insertSql: taskInsert,
    paramsForAttempt: (attemptId) => [attemptId, DOMAIN_PROJECT_ID, OWNER_A, DOMAIN_CONCURRENT_TASK_TEN_OP, CLIENT_ID],
  });
}

async function receiptStatus(sql, operationId) {
  const [row] = await sql`
    SELECT status FROM public.mcp_mutation_receipts WHERE operation_id = ${operationId}::uuid
  `;
  return row?.status ?? null;
}

async function runProofPhases(sql) {
  await seedActiveGrant(sql);
  const session = mcpSession(sql);
  const fpA = fingerprint({ title: "Proof task", projectId: "p1" });
  const fpB = fingerprint({ title: "Different task", projectId: "p1" });

  // CLAIM-FIRST: fresh receipt is granted under a live lease.
  const first = await session.run((tx) => claimReceipt(tx, TOOL, OP_FIRST, fpA));
  assert(first?.claim_outcome === "CLAIM_GRANTED", `expected CLAIM_GRANTED, got ${JSON.stringify(first)}`);
  assert(typeof first.claim_token === "string" && first.claim_token.length > 0, "CLAIM_GRANTED must carry a token");
  log("CLAIM-FIRST", `Fresh claim granted with token ${first.claim_token.slice(0, 8)}...`);

  // CLAIM-DUP: same op + args while the lease is live → IN_PROGRESS.
  const duplicate = await session.run((tx) => claimReceipt(tx, TOOL, OP_FIRST, fpA));
  assert(duplicate?.claim_outcome === "IN_PROGRESS", `expected IN_PROGRESS, got ${JSON.stringify(duplicate)}`);
  log("CLAIM-DUP", "Duplicate claim while lease live returned IN_PROGRESS (no double mutation).");

  // STORE-REPLAY: only the token holder can store; next claim replays the payload.
  const storedPayload = { ok: true, task: { id: "proof-task" } };
  await session.run((tx) => storeResult(tx, TOOL, OP_FIRST, first.claim_token, storedPayload));
  const replay = await session.run((tx) => claimReceipt(tx, TOOL, OP_FIRST, fpA));
  assert(replay?.claim_outcome === "REPLAY", `expected REPLAY, got ${JSON.stringify(replay)}`);
  const replayPayload = typeof replay.existing_result === "string"
    ? JSON.parse(replay.existing_result)
    : replay.existing_result;
  assert(
    JSON.stringify(replayPayload) === JSON.stringify(storedPayload),
    `replayed payload mismatch: ${JSON.stringify(replayPayload)}`,
  );
  log("STORE-REPLAY", "Store succeeded with the granted token; subsequent claim returned REPLAY.");

  // CONFLICT: same operation_id, different fingerprint.
  const conflict = await session.run((tx) => claimReceipt(tx, TOOL, OP_FIRST, fpB));
  assert(conflict?.claim_outcome === "CONFLICT", `expected CONFLICT, got ${JSON.stringify(conflict)}`);
  log("CONFLICT", "operationId reuse with different args returned CONFLICT.");

  // TOKEN-GUARD: storing with a foreign token raises 02000 and mutates nothing.
  const guardOp = await session.run((tx) => claimReceipt(tx, TOOL, OP_TOKEN_GUARD, fpA));
  assert(guardOp?.claim_outcome === "CLAIM_GRANTED", "TOKEN-GUARD setup expected CLAIM_GRANTED");
  const foreignToken = "99999999-9999-4999-8999-999999999999";
  const storeErrorCode = await capturePostgresError(() =>
    session.run((tx) => storeResult(tx, TOOL, OP_TOKEN_GUARD, foreignToken, { ok: true })),
  );
  assert(storeErrorCode === "02000", `foreign-token store expected SQLSTATE 02000, got ${storeErrorCode}`);
  const afterRejectedStore = await session.run((tx) => claimReceipt(tx, TOOL, OP_TOKEN_GUARD, fpA));
  assert(
    afterRejectedStore?.claim_outcome === "IN_PROGRESS",
    `receipt should be untouched after rejected store, got ${JSON.stringify(afterRejectedStore)}`,
  );
  log("TOKEN-GUARD", "Foreign claim token rejected with SQLSTATE 02000; receipt untouched.");

  // LEASE-RECOVERY: expired lease is recovered with a fresh token.
  await sql`
    UPDATE public.mcp_mutation_receipts
    SET lease_expires_at = now() - interval '1 second'
    WHERE operation_id = ${OP_TOKEN_GUARD}::uuid AND status = 'EXECUTING'
  `;
  const recovered = await session.run((tx) => claimReceipt(tx, TOOL, OP_TOKEN_GUARD, fpA));
  assert(recovered?.claim_outcome === "CLAIM_GRANTED", `expected lease-recovery CLAIM_GRANTED, got ${JSON.stringify(recovered)}`);
  assert(recovered.claim_token !== guardOp.claim_token, "lease recovery must rotate the claim token");
  const staleStoreCode = await capturePostgresError(() =>
    session.run((tx) => storeResult(tx, TOOL, OP_TOKEN_GUARD, guardOp.claim_token, { ok: true })),
  );
  assert(staleStoreCode === "02000", `stale-token store after recovery expected 02000, got ${staleStoreCode}`);
  log("LEASE-RECOVERY", "Expired lease recovered with a fresh token; stale executor rejected.");

  // FAIL-FINAL: terminal deterministic failure → replay, no retry.
  const failOp = await session.run((tx) => claimReceipt(tx, TOOL, OP_FAIL_FINAL, fpA));
  assert(failOp?.claim_outcome === "CLAIM_GRANTED", "FAIL-FINAL setup expected CLAIM_GRANTED");
  await session.run((tx) => failResult(tx, TOOL, OP_FAIL_FINAL, failOp.claim_token, true));
  assert((await receiptStatus(sql, OP_FAIL_FINAL)) === "FAILED_FINAL", "expected FAILED_FINAL after final failure");
  const finalReplay = await session.run((tx) => claimReceipt(tx, TOOL, OP_FAIL_FINAL, fpA));
  assert(finalReplay?.claim_outcome === "REPLAY", `FAILED_FINAL re-claim expected REPLAY, got ${JSON.stringify(finalReplay)}`);
  assert(finalReplay.existing_result && finalReplay.existing_result.ok === false, "FAILED_FINAL replay must carry error payload");
  log("FAIL-FINAL", "fail(final=true) recorded FAILED_FINAL; next claim replayed terminal error, no retry.");

  // FAIL-RETRY: transient failure → safe retry with fresh token.
  const retryOp = await session.run((tx) => claimReceipt(tx, TOOL, OP_FAIL_RETRY, fpA));
  assert(retryOp?.claim_outcome === "CLAIM_GRANTED", "FAIL-RETRY setup expected CLAIM_GRANTED");
  await session.run((tx) => failResult(tx, TOOL, OP_FAIL_RETRY, retryOp.claim_token, false));
  assert((await receiptStatus(sql, OP_FAIL_RETRY)) === "FAILED_RETRYABLE", "expected FAILED_RETRYABLE after retryable failure");
  const retryReset = await session.run((tx) => claimReceipt(tx, TOOL, OP_FAIL_RETRY, fpA));
  assert(retryReset?.claim_outcome === "CLAIM_GRANTED", `FAILED_RETRYABLE re-claim expected CLAIM_GRANTED, got ${JSON.stringify(retryReset)}`);
  assert(retryReset.claim_token !== retryOp.claim_token, "FAILED_RETRYABLE reset must rotate the claim token");
  log("FAIL-RETRY", "fail(final=false) recorded FAILED_RETRYABLE; next claim reset to CLAIM_GRANTED with fresh token.");

  // FAIL-CLOSED: no auth context → 42501 and no receipt row.
  const anonymous = mcpSession(sql, { userId: null });
  const noAuthCode = await capturePostgresError(() =>
    anonymous.run((tx) => claimReceipt(tx, TOOL, OP_FIRST, fpA)),
  );
  assert(noAuthCode === "42501", `missing auth context expected SQLSTATE 42501, got ${noAuthCode}`);

  // FAIL-CLOSED: revoked grant → 42501.
  await sql`
    UPDATE public.mcp_authorization_grants
    SET status = 'revoked', revoked_at = now()
    WHERE id = ${GRANT_ID}::uuid
  `;
  const revokedCode = await capturePostgresError(() =>
    session.run((tx) => claimReceipt(tx, TOOL, OP_TOKEN_GUARD, fpA)),
  );
  assert(revokedCode === "42501", `revoked grant expected SQLSTATE 42501, got ${revokedCode}`);
  await sql`
    UPDATE public.mcp_authorization_grants
    SET status = 'active', revoked_at = NULL
    WHERE id = ${GRANT_ID}::uuid
  `;
  log("FAIL-CLOSED", "Missing auth context and revoked grant both rejected with SQLSTATE 42501.");
}

async function main() {
  const { url, upgradeFrom } = parseArgs();
  const tags = await readJournal();
  if (!tags.includes("0052_mcp_mutation_receipts")) {
    console.error("Journal does not contain 0052_mcp_mutation_receipts; cannot run the receipt proof.");
    exit(2);
  }
  if (upgradeFrom && !tags.includes(upgradeFrom)) {
    console.error(`Unknown --upgrade-from migration: ${upgradeFrom}`);
    exit(2);
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    const baselineIndex = upgradeFrom ? tags.indexOf(upgradeFrom) : tags.length - 1;
    for (const tag of tags.slice(0, baselineIndex + 1)) {
      const statements = await applyFile(sql, tag);
      applied += 1;
      log("MIGRATE", `${tag}: ${statements} statement(s) applied`);
    }
    if (upgradeFrom) {
      await assertCurrentMainBaseline(sql);
      await seedLegacyGrantFixture(sql);
      for (const tag of tags.slice(baselineIndex + 1)) {
        const statements = await applyFile(sql, tag);
        applied += 1;
        log("MIGRATE", `${tag}: ${statements} statement(s) applied`);
      }
    }
    log("MIGRATE", `${applied} journal migrations applied`);

    // Supabase supplies these ordinary table grants outside the migration
    // journal. Keep receipt access excluded so this proof exercises the same
    // least-privilege boundary as the deployed API roles.
    await sql.unsafe(`
      GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.projects, public.goals, public.tasks, public.task_sessions, public.task_reminders
      TO authenticated
    `);
    await sql.unsafe(`REVOKE ALL ON TABLE public.mcp_mutation_receipts FROM authenticated, anon, public`);

    const policy = await sql`
      SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'mcp_mutation_receipts'
    `;
    const flags = await sql`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'public.mcp_mutation_receipts'::regclass
    `;
    const denyAll = policy.length === 1 && policy[0].qual === "false" && policy[0].with_check === "false";
    assert(denyAll, `expected exactly one RESTRICTIVE deny-all policy, got ${JSON.stringify(policy)}`);
    assert(flags[0]?.relrowsecurity === true, "mcp_mutation_receipts must have RLS enabled");
    log("RLS", "mcp_mutation_receipts keeps its RESTRICTIVE deny-all policy with RLS enabled.");

    if (upgradeFrom) {
      await assertLegacyGrantMigration(sql);
    }
    await assertCurrentGrantConstraints(sql);
    await runProofPhases(sql);
    await runDomainFencingProof(sql);
    await runConcurrencyProof(sql, mcpSession(sql));
    await runRlsProof(sql);

    console.log("MCP-RECEIPT-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
