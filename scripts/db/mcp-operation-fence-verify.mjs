#!/usr/bin/env node
/**
 * Ephemeral-database proof for the MCP domain operation fences created by
 * drizzle/0059_mcp_domain_operation_fencing.sql.
 *
 * WHY A SEPARATE PROOF. mcp-receipt-invariant-verify.mjs also touches these
 * indexes, but it asserts them as a DISJUNCTION: `indexNames.some(name =>
 * errorText.includes(name))`. That is satisfied when ANY unique index on the
 * table refuses the insert. task_sessions carries two other unique indexes
 * (task_sessions_owner_open_unique, keyed on the owner alone, and
 * task_sessions_pkey) and projects carries projects_owner_user_id_slug_unique,
 * so an incidental index can stand in for the operation fence and the whole
 * domain phase stays green with the operation fence absent. This proof never
 * accepts a substitute: every refusal is attributed to one named index by
 * `error.constraint`, and every duplicate attempt is built so that no other
 * unique index on the table can fire.
 *
 * Applies the full drizzle migration journal (plus the same minimal Supabase
 * shim the other proofs use) to a disposable Postgres, then proves:
 *
 *   PAIRING-RED     - at the 0072 baseline a row whose mcp_client_id is NULL
 *                     while mcp_operation_id is set escapes the fence
 *                     entirely: the same operation id lands twice. This is the
 *                     defect drizzle/0074_mcp_operation_identity_pair.sql fixes,
 *                     reproduced rather than assumed.
 *   PAIRING-GREEN   - after 0074 a partial identity is refused with 23514 by
 *                     the named CHECK, an independent read-back shows no row
 *                     was created, and a complete identity still inserts.
 *   CATALOG         - per fenced table and per expected index, read from
 *                     pg_index/pg_class/pg_constraint: the index exists, it is
 *                     on that exact table, it is UNIQUE, VALID and READY, it is
 *                     not a primary key, its key columns are exactly
 *                     (owner_user_id, mcp_client_id, mcp_operation_id) in that
 *                     order with no INCLUDE columns, its partial predicate is
 *                     exactly `mcp_operation_id IS NOT NULL`, and no second
 *                     index duplicates that shape.
 *   DUPLICATE       - per fenced table: a second row carrying the same
 *                     (owner, client, operation) is refused with SQLSTATE 23505
 *                     and `error.constraint` equal to that table's operation
 *                     index - named, not matched - even though every other
 *                     unique key on the row is fresh. The durable state is then
 *                     read back: exactly one row carries the identity, and it
 *                     is the row the first insert returned.
 *   SCOPE           - the same operation id under a different owner, and the
 *                     same operation id under a different client, both insert
 *                     successfully. Without these, an index over a strict
 *                     subset of the three columns would pass DUPLICATE while
 *                     silently refusing unrelated legitimate writes.
 *   INCIDENTAL      - the competing unique indexes are proven to still refuse
 *                     their OWN collisions by their OWN names, so the 23505 in
 *                     DUPLICATE cannot be one of them wearing a different
 *                     label, and no NEW incidental index can silently become
 *                     the fence.
 *   CONCURRENT      - per fenced table, N real connections (one transaction
 *                     each, all released from a shared barrier before any
 *                     INSERT is issued) attempt the same operation identity at
 *                     the same time. An independent observer must see the
 *                     losing backends blocked on a lock inside the index, which
 *                     is what makes the concurrency real rather than a
 *                     sequential retry loop. Exactly one attempt commits and
 *                     every loser is refused by the named operation index; the
 *                     table is then read back to show one durable row.
 *   INVENTORY       - the full unique-index set per fenced table is printed,
 *                     so an incidental index added later is reviewed against
 *                     the fence instead of being absorbed by it.
 *   IDEMPOTENCE     - re-applying 0059 and 0074 succeeds and leaves both the
 *                     index and the constraint exactly as specified.
 *
 * PROVEN SENSITIVE. Two independent breaks in the migration stream, each of
 * which this proof rejects by naming the table and index:
 *   (a) 0059's task_reminders index demoted from UNIQUE to a plain index under
 *       the same name: "CATALOG task_reminders/task_reminders_mcp_operation_unique
 *       must be UNIQUE; indisunique=false".
 *   (b) 0059's task_sessions index demoted the same way, leaving the unrelated
 *       task_sessions_owner_open_unique as the only unique index that could
 *       refuse a duplicate: "CATALOG task_sessions/task_sessions_mcp_operation_unique
 *       must be UNIQUE; indisunique=false". Under this break the pre-existing
 *       mcp-receipt-invariant-verify.mjs still exits 0, because its disjunctive
 *       indexNames list accepts task_sessions_owner_open_unique, and a direct
 *       probe confirms the fence is genuinely inert (two durable rows for one
 *       operation id once the sessions are closed). That is the blind spot this
 *       proof closes.
 *
 * SCOPE BOUNDARY. These tables are RLS-enabled with FORCE, and every fenced
 * INSERT here runs as the bootstrap superuser, which bypasses RLS. This proof
 * is about the physical unique-index invariant, which is enforced identically
 * for every role; authorization, the MCP write column fence and request-scoped
 * RLS are proven by mcp-receipt-invariant-verify.mjs and
 * mcp-oauth-surface-verify.mjs. A policy refusal would raise 42501, which
 * cannot satisfy the 23505 + named-constraint assertions below.
 *
 * Usage:
 *   node scripts/db/mcp-operation-fence-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const FENCE_MIGRATION = "0059_mcp_domain_operation_fencing";
const PAIRING_MIGRATION = "0074_mcp_operation_identity_pair";

// The fence identity, stated once. Every CATALOG assertion is derived from
// these three columns and this predicate, so there is no second description of
// the contract to drift.
const FENCE_KEY_COLUMNS = ["owner_user_id", "mcp_client_id", "mcp_operation_id"];
const FENCE_PREDICATE = "mcp_operation_id IS NOT NULL";
const PAIRING_PREDICATE = "(mcp_operation_id IS NULL) = (mcp_client_id IS NULL)";

const OWNER_MAIN = "11110000-0000-4000-8000-000000000001";
const OWNER_OTHER = "11110000-0000-4000-8000-000000000002";
const OWNER_CONCURRENT = "11110000-0000-4000-8000-000000000003";
const OWNER_PAIRING = "11110000-0000-4000-8000-000000000004";
const OWNER_INCIDENTAL = "11110000-0000-4000-8000-000000000005";
const CLIENT_MAIN = "fence-client-a";
const CLIENT_OTHER = "fence-client-b";

const OBSERVER_DEADLINE_MS = 30_000;

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

let assertionCount = 0;

function log(section, message) {
  console.log(`[${section}] ${message}`);
}

function assert(condition, message) {
  assertionCount += 1;
  if (!condition) {
    console.error(`[PROOF] FAILED: ${message}`);
    console.error(`[PROOF] ${assertionCount} assertion(s) evaluated before the failure.`);
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
  // Migrations 0035+ alter automation.implementation_runs additively and
  // document that its base table predates the journal.
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

let sequence = 0;

function nextUuid() {
  sequence += 1;
  return `f0000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

/**
 * Catalog expressions are compared with every parenthesis, quote and space
 * removed rather than verbatim, so a reworded-but-equivalent expression is not
 * a false failure while a different expression still is. Removing parentheses
 * cannot hide a difference: the operands and the operator survive it.
 */
function flatten(expression) {
  return String(expression ?? "")
    .replace(/[\s"'()]+/g, "")
    .toLowerCase();
}

/**
 * Every fence INSERT is built to RETURNING id, so the caller always receives the
 * canonical row id rather than inferring it from the id it supplied. A fence
 * that silently rewrote the id would then be caught by the canonical-row
 * comparison rather than passing unnoticed.
 */
const RETURNING_ID = " RETURNING id";

/**
 * The five operation-fenced tables, each with the INSERT shape this proof uses.
 * Every shape is built so that a duplicate attempt can differ in primary key and
 * in every other unique key the table has, which is what makes a refusal
 * attributable to the operation fence alone.
 */
const FENCES = [
  {
    table: "projects",
    index: "projects_mcp_operation_unique",
    pairing: "projects_mcp_operation_identity_pair",
    incidental: "projects_owner_user_id_slug_unique",
    incidentalNote:
      "projects_owner_user_id_slug_unique is keyed on (owner_user_id, slug), so every " +
      "duplicate attempt here carries a distinct slug and cannot be refused by it",
    insert: ({ id, owner, operationId, clientId, tag }) => ({
      text: `INSERT INTO public.projects
               (id, name, slug, owner_user_id, mcp_operation_id, mcp_client_id)
             VALUES ($1::uuid, $5, $6, $2::uuid, $3::uuid, $4)${RETURNING_ID}`,
      values: [id, owner, operationId, clientId, `Operation fence ${tag}`, `op-fence-${tag}`],
    }),
  },
  {
    table: "goals",
    index: "goals_mcp_operation_unique",
    pairing: "goals_mcp_operation_identity_pair",
    incidental: "goals_pkey",
    incidentalNote: "the only other unique index on goals is its primary key, which every attempt randomises",
    insert: ({ id, owner, operationId, clientId, tag, projectId }) => ({
      text: `INSERT INTO public.goals
               (id, project_id, title, owner_user_id, mcp_operation_id, mcp_client_id)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6)${RETURNING_ID}`,
      values: [id, projectId, `Operation fence ${tag}`, owner, operationId, clientId],
    }),
  },
  {
    table: "tasks",
    index: "tasks_mcp_operation_unique",
    pairing: "tasks_mcp_operation_identity_pair",
    incidental: "tasks_pkey",
    incidentalNote: "the only other unique index on tasks is its primary key, which every attempt randomises",
    insert: ({ id, owner, operationId, clientId, tag, projectId }) => ({
      text: `INSERT INTO public.tasks
               (id, project_id, title, owner_user_id, mcp_operation_id, mcp_client_id)
             VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6)${RETURNING_ID}`,
      values: [id, projectId, `Operation fence ${tag}`, owner, operationId, clientId],
    }),
  },
  {
    table: "task_reminders",
    index: "task_reminders_mcp_operation_unique",
    pairing: "task_reminders_mcp_operation_identity_pair",
    incidental: "task_reminders_owner_source_source_id_unique",
    incidentalNote:
      "task_reminders_owner_source_source_id_unique only covers rows whose source and source_id " +
      "are both set, and every attempt here leaves both NULL",
    insert: ({ id, owner, operationId, clientId, tag, taskId }) => ({
      text: `INSERT INTO public.task_reminders
               (id, owner_user_id, task_id, remind_at, mcp_operation_id, mcp_client_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid, '2031-01-02T03:04:05Z', $4::uuid, $5)${RETURNING_ID}`,
      values: [id, owner, taskId, operationId, clientId],
    }),
  },
  {
    table: "task_sessions",
    index: "task_sessions_mcp_operation_unique",
    pairing: "task_sessions_mcp_operation_identity_pair",
    incidental: "task_sessions_owner_open_unique",
    incidentalNote:
      "task_sessions_owner_open_unique covers every open session of an owner regardless of " +
      "operation id, so every task_sessions attempt here inserts a CLOSED session; the first " +
      "row of the pair is closed before the duplicate is attempted, which excludes it from that " +
      "index's predicate entirely",
    insert: ({ id, owner, operationId, clientId, tag, taskId }) => ({
      text: `INSERT INTO public.task_sessions
               (id, owner_user_id, task_id, started_at, ended_at, duration_seconds,
                mcp_operation_id, mcp_client_id)
             VALUES ($1::uuid, $2::uuid, $3::uuid, '2031-01-02T03:04:05Z',
                     '2031-01-02T04:04:05Z', 3600, $4::uuid, $5)${RETURNING_ID}`,
      values: [id, owner, taskId, operationId, clientId],
    }),
  },
];

async function attempt(fn) {
  try {
    const value = await fn();
    return { ok: true, value, error: null };
  } catch (error) {
    return { ok: false, value: null, error };
  }
}

function describeError(error) {
  return [
    `code=${error?.code ?? "none"}`,
    `constraint_name=${error?.constraint_name ?? "none"}`,
    `message=${error?.message ?? "none"}`,
  ].join(" ");
}

/**
 * Assert that a refusal was produced by one named index or constraint.
 *
 * The comparison is equality on the server-reported constraint_name and never a
 * substring search over a candidate list. Postgres reports the name of the
 * index or constraint it actually violated, so equality is both the strongest
 * and the only attribution that cannot be satisfied by a substitute. Reading
 * the name out of the free-text message instead would reintroduce exactly the
 * disjunction this proof exists to remove.
 */
function assertRefusedBy(outcome, { expectedConstraint, expectedCode, label }) {
  assert(
    outcome.ok === false,
    `${label} must be refused by ${expectedConstraint}; it succeeded instead (${describeError(outcome.error)})`,
  );
  assert(
    outcome.error?.code === expectedCode,
    `${label} must raise SQLSTATE ${expectedCode}; got ${describeError(outcome.error)}`,
  );
  assert(
    outcome.error?.constraint_name === expectedConstraint,
    `${label} must be refused by exactly ${expectedConstraint}; got ${describeError(outcome.error)}`,
  );
}

/**
 * goals, tasks, task_reminders and task_sessions all carry a NOT NULL
 * reference to a row the same owner already owns. RLS is enabled and FORCED on
 * every fenced table, so a reference crossing owners would be filtered rather
 * than raising, and the proof would be reading an absence instead of a
 * refusal. Every fixture is therefore created inside the owning owner's scope.
 */
async function seedOwnerFixtures(sql, owner, tag) {
  const projectId = nextUuid();
  const taskId = nextUuid();
  await sql.unsafe(
    `INSERT INTO public.projects (id, name, slug, owner_user_id)
     VALUES ($1::uuid, $2, $3, $4::uuid)${RETURNING_ID}`,
    [projectId, `Fence fixture ${tag}`, `fixture-${tag}`, owner],
  );
  await sql.unsafe(
    `INSERT INTO public.tasks (id, project_id, title, owner_user_id)
     VALUES ($1::uuid, $2::uuid, $3, $4::uuid)${RETURNING_ID}`,
    [taskId, projectId, `Fence fixture task ${tag}`, owner],
  );
  return { projectId, taskId };
}

async function countIdentityRows(sql, table, { owner, clientId, operationId }) {
  const [row] = await sql.unsafe(
    `SELECT count(*)::int AS count
       FROM public.${table}
      WHERE owner_user_id = $1::uuid
        AND mcp_client_id = $2
        AND mcp_operation_id = $3::uuid`,
    [owner, clientId, operationId],
  );
  return Number(row?.count ?? -1);
}

async function loadIdentityRow(sql, table, { owner, clientId, operationId }) {
  const rows = await sql.unsafe(
    `SELECT id, owner_user_id, mcp_client_id, mcp_operation_id
       FROM public.${table}
      WHERE owner_user_id = $1::uuid
        AND mcp_client_id = $2
        AND mcp_operation_id = $3::uuid
      ORDER BY id`,
    [owner, clientId, operationId],
  );
  return { rows, row: rows[0] ?? null };
}

async function countOperationRows(sql, table, operationId) {
  const [row] = await sql.unsafe(
    `SELECT count(*)::int AS count FROM public.${table} WHERE mcp_operation_id = $1::uuid`,
    [operationId],
  );
  return Number(row?.count ?? -1);
}

async function countOwnerRows(sql, table, owner) {
  const [row] = await sql.unsafe(
    `SELECT count(*)::int AS count FROM public.${table} WHERE owner_user_id = $1::uuid`,
    [owner],
  );
  return Number(row?.count ?? -1);
}

/**
 * PAIRING-RED then PAIRING-GREEN, around the application of 0074.
 *
 * The RED half runs against the journal exactly as it stood at 0072. It proves
 * the fence hole this proof found rather than asserting it: with
 * mcp_client_id NULL, the 0059 index key contains a NULL, btree unique indexes
 * treat NULLs as distinct, and the same operation id lands twice with no error
 * at all. The GREEN half then applies 0074 and proves the hole is closed and
 * that closing it does not block a complete identity.
 */
async function runPairingProof(sql, applyPairingMigration) {
  for (const fence of FENCES) {
    const tag = `pairing-${fence.table}`;
    const fixtures = await seedOwnerFixtures(sql, OWNER_PAIRING, tag);
    const operationId = nextUuid();
    const first = fence.insert({
      id: nextUuid(),
      owner: OWNER_PAIRING,
      operationId,
      clientId: null,
      tag: `${tag}-first`,
      ...fixtures,
    });
    const second = fence.insert({
      id: nextUuid(),
      owner: OWNER_PAIRING,
      operationId,
      clientId: null,
      tag: `${tag}-second`,
      ...fixtures,
    });

    const firstOutcome = await attempt(() => sql.unsafe(first.text, first.values));
    assert(
      firstOutcome.ok,
      `PAIRING-RED ${fence.table} must accept a partial operation identity at the 0072 baseline; got ${describeError(firstOutcome.error)}`,
    );
    const secondOutcome = await attempt(() => sql.unsafe(second.text, second.values));
    assert(
      secondOutcome.ok,
      `PAIRING-RED ${fence.table} must let a second partial identity with the SAME operation id through at the 0072 baseline (the defect); got ${describeError(secondOutcome.error)}`,
    );
    const redCount = await countOperationRows(sql, fence.table, operationId);
    assert(
      redCount === 2,
      `PAIRING-RED ${fence.table} must hold exactly two rows for one partial operation id before 0074; got ${redCount}`,
    );
    log(
      "PAIRING-RED",
      `${fence.table}: one operation id landed twice while mcp_client_id was NULL; ${fence.index} did not fence it.`,
    );
  }

  await applyPairingMigration();

  for (const fence of FENCES) {
    const tag = `pairing-green-${fence.table}`;
    const fixtures = await seedOwnerFixtures(sql, OWNER_PAIRING, tag);
    const refusedOperationId = nextUuid();
    const refused = fence.insert({
      id: nextUuid(),
      owner: OWNER_PAIRING,
      operationId: refusedOperationId,
      clientId: null,
      tag: `${tag}-refused`,
      ...fixtures,
    });
    const refusedOutcome = await attempt(() => sql.unsafe(refused.text, refused.values));
    assertRefusedBy(refusedOutcome, {
      expectedConstraint: fence.pairing,
      expectedCode: "23514",
      label: `PAIRING-GREEN ${fence.table} partial identity`,
    });
    // An INSERT can also be refused without an error being visible to the
    // caller (a filtered row). Read the durable state back independently
    // instead of trusting the refusal alone.
    const refusedCount = await countOperationRows(sql, fence.table, refusedOperationId);
    assert(
      refusedCount === 0,
      `PAIRING-GREEN ${fence.table} must leave no row behind when the partial identity is refused; got ${refusedCount}`,
    );

    const acceptedOperationId = nextUuid();
    const accepted = fence.insert({
      id: nextUuid(),
      owner: OWNER_PAIRING,
      operationId: acceptedOperationId,
      clientId: CLIENT_MAIN,
      tag: `${tag}-accepted`,
      ...fixtures,
    });
    const acceptedOutcome = await attempt(() => sql.unsafe(accepted.text, accepted.values));
    assert(
      acceptedOutcome.ok,
      `PAIRING-GREEN ${fence.table} must still accept a complete operation identity; got ${describeError(acceptedOutcome.error)}`,
    );
    const acceptedCount = await countOperationRows(sql, fence.table, acceptedOperationId);
    assert(
      acceptedCount === 1,
      `PAIRING-GREEN ${fence.table} must durably hold the one complete identity it accepted; got ${acceptedCount}`,
    );
    log(
      "PAIRING-GREEN",
      `${fence.table}: partial identity refused by ${fence.pairing} (23514) with no row created; complete identity still accepted.`,
    );
  }
}

/**
 * CATALOG: read the real catalog and compare it against the single statement of
 * the contract at the top of this file. Nothing here accepts a substitute
 * index, a renamed index, a subset of the columns, a dropped predicate, or an
 * index that exists but is not enforcing (indisvalid / indisready false, which
 * is what a failed CREATE UNIQUE INDEX CONCURRENTLY leaves behind).
 */
async function runCatalogProof(sql) {
  for (const fence of FENCES) {
    const rows = await sql.unsafe(
      `SELECT idx.relname AS index_name,
              idx_ns.nspname AS index_schema,
              tbl.relname AS table_name,
              tbl_ns.nspname AS table_schema,
              i.indisunique,
              i.indisvalid,
              i.indisready,
              i.indisprimary,
              i.indnkeyatts,
              i.indnatts,
              pg_get_indexdef(i.indexrelid) AS index_definition,
              pg_get_expr(i.indpred, i.indrelid) AS predicate,
              (SELECT array_agg(att.attname ORDER BY key_columns.ordinality)
                 FROM unnest(i.indkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
                 JOIN pg_attribute att
                   ON att.attrelid = i.indrelid AND att.attnum = key_columns.attnum
                WHERE key_columns.ordinality <= i.indnkeyatts) AS key_columns,
              (SELECT count(*)
                 FROM unnest(i.indkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
                WHERE key_columns.ordinality > i.indnkeyatts) AS included_columns
         FROM pg_index i
         JOIN pg_class idx ON idx.oid = i.indexrelid
         JOIN pg_namespace idx_ns ON idx_ns.oid = idx.relnamespace
         JOIN pg_class tbl ON tbl.oid = i.indrelid
         JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
        WHERE idx.relname = $1`,
      [fence.index],
    );
    const label = `CATALOG ${fence.table}/${fence.index}`;
    assert(
      rows.length === 1,
      `${label} must resolve to exactly one index; found ${rows.length}`,
    );
    const row = rows[0];
    assert(
      row.index_schema === "public" && row.table_schema === "public",
      `${label} must live in the public schema on a public table; got ${row.index_schema}.${row.table_name} in ${row.table_schema}`,
    );
    assert(
      row.table_name === fence.table,
      `${label} must be defined on ${fence.table}; it is defined on ${row.table_name}`,
    );
    assert(
      row.indisunique === true,
      `${label} must be UNIQUE; indisunique=${row.indisunique} (index_definition: ${row.index_definition})`,
    );
    assert(
      row.indisvalid === true,
      `${label} must be a valid index; indisvalid=${row.indisvalid} (an invalid index is not enforced)`,
    );
    assert(
      row.indisready === true,
      `${label} must be a ready index; indisready=${row.indisready}`,
    );
    assert(
      row.indisprimary === false,
      `${label} must be the operation fence, not the primary key`,
    );
    assert(
      Number(row.included_columns) === 0,
      `${label} must key on exactly ${FENCE_KEY_COLUMNS.join(", ")} with no INCLUDE columns; got ${row.included_columns}`,
    );
    // Compared as an ordered list, so both the SET and the ORDER of the key
    // columns are asserted: an index on (mcp_client_id, owner_user_id,
    // mcp_operation_id) has the same set and is a different index.
    assert(
      JSON.stringify(row.key_columns) === JSON.stringify(FENCE_KEY_COLUMNS),
      `${label} key columns must be exactly [${FENCE_KEY_COLUMNS.join(", ")}] in that order; got [${(row.key_columns ?? []).join(", ")}] (index_definition: ${row.index_definition})`,
    );
    assert(
      flatten(row.predicate) === flatten(FENCE_PREDICATE),
      `${label} partial predicate must be exactly \`${FENCE_PREDICATE}\`; got "${row.predicate}"`,
    );
    assert(
      /^CREATE UNIQUE INDEX\b/.test(String(row.index_definition)),
      `${label} catalog definition must begin with CREATE UNIQUE INDEX; got "${row.index_definition}"`,
    );

    // A second index with the same shape would make "any unique index exists"
    // true for reasons that have nothing to do with the fence, and would be an
    // accidental duplicate of the constraint.
    const duplicates = await sql.unsafe(
      `SELECT idx.relname AS index_name,
              pg_get_indexdef(i.indexrelid) AS index_definition
         FROM pg_index i
         JOIN pg_class idx ON idx.oid = i.indexrelid
         JOIN pg_class tbl ON tbl.oid = i.indrelid
         JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
        WHERE tbl_ns.nspname = 'public'
          AND tbl.relname = $1
          AND idx.relname <> $2
          AND i.indisunique
          AND (SELECT array_agg(att.attname::text ORDER BY key_columns.ordinality)
                 FROM unnest(i.indkey) WITH ORDINALITY AS key_columns(attnum, ordinality)
                 JOIN pg_attribute att
                   ON att.attrelid = i.indrelid AND att.attnum = key_columns.attnum
                WHERE key_columns.ordinality <= i.indnkeyatts) = $3::text[]
          AND pg_get_expr(i.indpred, i.indrelid) IS NOT DISTINCT FROM $4::text`,
      [fence.table, fence.index, FENCE_KEY_COLUMNS, row.predicate],
    );
    assert(
      duplicates.length === 0,
      `${label} must be the only index on ${fence.table} with the operation-fence shape; also present: ${duplicates.map((d) => d.index_name).join(", ")}`,
    );

    const constraintRows = await sql.unsafe(
      `SELECT con.conname, con.contype, con.convalidated,
              pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class tbl ON tbl.oid = con.conrelid
         JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
        WHERE tbl_ns.nspname = 'public' AND con.conname = $1`,
      [fence.pairing],
    );
    assert(
      constraintRows.length === 1,
      `CATALOG ${fence.table}: 0074 must add exactly one constraint named ${fence.pairing}; found ${constraintRows.length}`,
    );
    const constraint = constraintRows[0];
    assert(
      constraint.contype === "c",
      `CATALOG ${fence.table}: ${fence.pairing} must be a CHECK constraint; contype=${constraint.contype}`,
    );
    assert(
      constraint.convalidated === false,
      `CATALOG ${fence.table}: ${fence.pairing} must stay NOT VALID as 0074 documents (existing rows are not rewritten); convalidated=${constraint.convalidated}`,
    );
    assert(
      flatten(constraint.definition) === flatten(`CHECK (${PAIRING_PREDICATE}) NOT VALID`),
      `CATALOG ${fence.table}: ${fence.pairing} must be exactly \`CHECK (${PAIRING_PREDICATE}) NOT VALID\`; got "${constraint.definition}"`,
    );

    log(
      "CATALOG",
      `${fence.table}: ${fence.index} is a unique, valid, ready partial index on (${row.key_columns.join(", ")}) WHERE ${row.predicate}.`,
    );
  }
}

/**
 * DUPLICATE: the core repair. Each second attempt repeats the operation
 * identity and changes everything else the table can collide on, and the
 * refusal must name this table's operation index and nothing else.
 */
async function runDuplicateProof(sql) {
  for (const fence of FENCES) {
    const tag = `duplicate-${fence.table}`;
    const fixtures = await seedOwnerFixtures(sql, OWNER_MAIN, tag);
    const operationId = nextUuid();

    const first = fence.insert({
      id: nextUuid(),
      owner: OWNER_MAIN,
      operationId,
      clientId: CLIENT_MAIN,
      tag: `${tag}-first`,
      ...fixtures,
    });
    const firstOutcome = await attempt(() => sql.unsafe(first.text, first.values));
    assert(
      firstOutcome.ok,
      `DUPLICATE ${fence.table} must accept the first operation identity; got ${describeError(firstOutcome.error)}`,
    );
    const firstId = firstOutcome.value?.[0]?.id;
    assert(
      typeof firstId === "string",
      `DUPLICATE ${fence.table} first INSERT must return the canonical row id`,
    );
    const ownerRowsAfterFirst = await countOwnerRows(sql, fence.table, OWNER_MAIN);

    const second = fence.insert({
      id: nextUuid(),
      owner: OWNER_MAIN,
      operationId,
      clientId: CLIENT_MAIN,
      tag: `${tag}-second`,
      ...fixtures,
    });
    const secondOutcome = await attempt(() => sql.unsafe(second.text, second.values));
    assertRefusedBy(secondOutcome, {
      expectedConstraint: fence.index,
      expectedCode: "23505",
      label: `DUPLICATE ${fence.table} repeated operation identity`,
    });

    const { row: canonical, rows: canonicalRows } = await loadIdentityRow(sql, fence.table, {
      owner: OWNER_MAIN,
      clientId: CLIENT_MAIN,
      operationId,
    });
    assert(
      canonicalRows.length === 1,
      `DUPLICATE ${fence.table} must leave exactly one row for the repeated operation identity; found ${canonicalRows.length}: ${canonicalRows.map((r) => r.id).join(", ")}`,
    );
    assert(
      canonical?.id === firstId,
      `DUPLICATE ${fence.table} must resolve a repeated operation identity to the row the first INSERT returned; got ${canonical?.id ?? "no row"}`,
    );
    assert(
      canonical?.owner_user_id === OWNER_MAIN && canonical?.mcp_client_id === CLIENT_MAIN,
      `DUPLICATE ${fence.table} canonical row must stay owner and client scoped`,
    );
    const identityRows = await countIdentityRows(sql, fence.table, {
      owner: OWNER_MAIN,
      clientId: CLIENT_MAIN,
      operationId,
    });
    assert(
      identityRows === 1,
      `DUPLICATE ${fence.table} owner/client/operation triple must count one row; got ${identityRows}`,
    );
    const ownerRowsAfterSecond = await countOwnerRows(sql, fence.table, OWNER_MAIN);
    assert(
      ownerRowsAfterSecond === ownerRowsAfterFirst,
      `DUPLICATE ${fence.table} must not add a durable row for a refused duplicate; owner row count went ${ownerRowsAfterFirst} -> ${ownerRowsAfterSecond}`,
    );
    log(
      "DUPLICATE",
      `${fence.table}: a repeated operation identity was refused by ${fence.index} and still reads back as one canonical row.`,
    );
  }
}

/**
 * SCOPE: the fence keys on three columns, so each of the three must actually
 * participate. A unique index over a strict subset would pass DUPLICATE while
 * refusing unrelated legitimate writes, which is a correctness regression in
 * the other direction.
 */
async function runScopeProof(sql) {
  for (const fence of FENCES) {
    const tag = `scope-${fence.table}`;
    const ownerFixtures = await seedOwnerFixtures(sql, OWNER_MAIN, tag);
    const otherFixtures = await seedOwnerFixtures(sql, OWNER_OTHER, tag);
    const operationId = nextUuid();

    const otherOwner = fence.insert({
      id: nextUuid(),
      owner: OWNER_OTHER,
      operationId,
      clientId: CLIENT_MAIN,
      tag: `${tag}-other-owner`,
      ...otherFixtures,
    });
    const otherOwnerOutcome = await attempt(() => sql.unsafe(otherOwner.text, otherOwner.values));
    assert(
      otherOwnerOutcome.ok,
      `SCOPE ${fence.table} must let a different owner reuse the same operation id; got ${describeError(otherOwnerOutcome.error)}`,
    );

    const otherClient = fence.insert({
      id: nextUuid(),
      owner: OWNER_MAIN,
      operationId,
      clientId: CLIENT_OTHER,
      tag: `${tag}-other-client`,
      ...ownerFixtures,
    });
    const otherClientOutcome = await attempt(() => sql.unsafe(otherClient.text, otherClient.values));
    assert(
      otherClientOutcome.ok,
      `SCOPE ${fence.table} must let a different client reuse the same operation id under the same owner; got ${describeError(otherClientOutcome.error)}`,
    );

    const otherOperation = nextUuid();
    const otherOperationInsert = fence.insert({
      id: nextUuid(),
      owner: OWNER_MAIN,
      operationId: otherOperation,
      clientId: CLIENT_MAIN,
      tag: `${tag}-other-operation`,
      ...ownerFixtures,
    });
    const otherOperationOutcome = await attempt(() =>
      sql.unsafe(otherOperationInsert.text, otherOperationInsert.values),
    );
    assert(
      otherOperationOutcome.ok,
      `SCOPE ${fence.table} must let the same owner and client reuse the fence with a different operation id; got ${describeError(otherOperationOutcome.error)}`,
    );

    const perOperation = await countOperationRows(sql, fence.table, operationId);
    assert(
      perOperation === 2,
      `SCOPE ${fence.table} must hold exactly the two owner/client scopes for that operation id; got ${perOperation}`,
    );
    log(
      "SCOPE",
      `${fence.table}: owner_user_id, mcp_client_id and mcp_operation_id each participate in the fence key.`,
    );
  }
}

/**
 * INCIDENTAL: the competing unique indexes on the same tables are proven to
 * still refuse their own collisions, under their own names. Without this,
 * "the duplicate raised 23505" could be satisfied by an index the fence has
 * nothing to do with; with it, each refusal is attributed to a specific,
 * independently verified index.
 */
async function runIncidentalProof(sql) {
  for (const fence of FENCES) {
    const tag = `incidental-${fence.table}`;
    const fixtures = await seedOwnerFixtures(sql, OWNER_INCIDENTAL, tag);
    let incidentalIndex = fence.incidental;

    if (fence.table === "projects") {
      const first = fence.insert({
        id: nextUuid(),
        owner: OWNER_INCIDENTAL,
        operationId: nextUuid(),
        clientId: CLIENT_MAIN,
        tag: `${tag}-first`,
        ...fixtures,
      });
      const firstOutcome = await attempt(() => sql.unsafe(first.text, first.values));
      assert(
        firstOutcome.ok,
        `INCIDENTAL projects first INSERT must succeed; got ${describeError(firstOutcome.error)}`,
      );
      // Reuse this project's slug (values[5]) with a FRESH operation id and a
      // fresh primary key: only projects_owner_user_id_slug_unique can refuse
      // it, and it must refuse it under its own name.
      const collision = {
        text: `INSERT INTO public.projects (id, name, slug, owner_user_id, mcp_operation_id, mcp_client_id)
               VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid, $6)`,
        values: [nextUuid(), "Incidental slug collision", first.values[5], OWNER_INCIDENTAL, nextUuid(), CLIENT_MAIN],
      };
      const collisionOutcome = await attempt(() => sql.unsafe(collision.text, collision.values));
      assertRefusedBy(collisionOutcome, {
        expectedConstraint: fence.incidental,
        expectedCode: "23505",
        label: "INCIDENTAL projects owner+slug collision",
      });
    }

    if (fence.table === "task_reminders") {
      const first = {
        text: `INSERT INTO public.task_reminders
                 (id, owner_user_id, task_id, remind_at, source, source_id,
                  mcp_operation_id, mcp_client_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, '2031-02-03T04:05:06Z', $4, $5, $6::uuid, $7)`,
        values: [nextUuid(), OWNER_INCIDENTAL, fixtures.taskId, "e.g.a", "external-1", nextUuid(), CLIENT_MAIN],
      };
      const collision = {
        text: `INSERT INTO public.task_reminders
                 (id, owner_user_id, task_id, remind_at, source, source_id,
                  mcp_operation_id, mcp_client_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, '2031-02-03T04:05:06Z', $4, $5, $6::uuid, $7)`,
        values: [nextUuid(), OWNER_INCIDENTAL, fixtures.taskId, "e.g.a", "external-1", nextUuid(), CLIENT_MAIN],
      };
      const firstOutcome = await attempt(() => sql.unsafe(first.text, first.values));
      assert(
        firstOutcome.ok,
        `INCIDENTAL task_reminders first INSERT must succeed; got ${describeError(firstOutcome.error)}`,
      );
      const collisionOutcome = await attempt(() => sql.unsafe(collision.text, collision.values));
      assertRefusedBy(collisionOutcome, {
        expectedConstraint: fence.incidental,
        expectedCode: "23505",
        label: "INCIDENTAL task_reminders owner+source+source_id collision",
      });
    }

    if (fence.table === "task_sessions") {
      // The open-session index covers a row regardless of its operation id.
      // One open session for the owner must refuse a second insert carrying a
      // DIFFERENT operation id - precisely the substitution that made the old
      // disjunctive proof satisfiable. Closing it then proves the same owner
      // can create again, which is what lets DUPLICATE attribute its own
      // refusal to the operation index alone.
      const open = fence.insert({
        id: nextUuid(),
        owner: OWNER_INCIDENTAL,
        operationId: nextUuid(),
        clientId: CLIENT_MAIN,
        tag: `${tag}-open`,
        ...fixtures,
      });
      // fence.insert always produces a CLOSED session, which is what keeps the
      // open-session index out of the DUPLICATE attribution. The incidental
      // index needs the opposite case, so this is an explicit open-session
      // insert rather than a post-hoc UPDATE: the point is to show what a real
      // second timer start hits.
      const openSession = () => ({
        text: `INSERT INTO public.task_sessions
                 (id, owner_user_id, task_id, started_at, mcp_operation_id, mcp_client_id)
               VALUES ($1::uuid, $2::uuid, $3::uuid, '2031-03-04T05:06:07Z', $4::uuid, $5)${RETURNING_ID}`,
        values: [
          nextUuid(),
          OWNER_INCIDENTAL,
          fixtures.taskId,
          nextUuid(),
          CLIENT_MAIN,
        ],
      });

      const firstOpen = openSession();
      const firstOpenOutcome = await attempt(() => sql.unsafe(firstOpen.text, firstOpen.values));
      assert(
        firstOpenOutcome.ok,
        `INCIDENTAL task_sessions first open INSERT must succeed; got ${describeError(firstOpenOutcome.error)}`,
      );
      const openId = firstOpenOutcome.value?.[0]?.id;
      assert(
        typeof openId === "string",
        "INCIDENTAL task_sessions first open INSERT must return a row id",
      );

      const secondOpen = openSession();
      const secondOpenOutcome = await attempt(() =>
        sql.unsafe(secondOpen.text, secondOpen.values),
      );
      assertRefusedBy(secondOpenOutcome, {
        expectedConstraint: fence.incidental,
        expectedCode: "23505",
        label: "INCIDENTAL task_sessions second open session under a different operation id",
      });

      // Close it: the same owner, a fresh operation id, must be accepted again.
      // That is the reason DUPLICATE can attribute its own refusal to the
      // operation index - nothing else on this table is in play for a closed
      // row.
      await sql.unsafe(
        `UPDATE public.task_sessions SET ended_at = now(), duration_seconds = 1 WHERE id = $1::uuid`,
        [openId],
      );
      const afterClose = openSession();
      const afterCloseOutcome = await attempt(() =>
        sql.unsafe(afterClose.text, afterClose.values),
      );
      assert(
        afterCloseOutcome.ok,
        `INCIDENTAL task_sessions must let the owner start again once the session is closed; got ${describeError(afterCloseOutcome.error)}`,
      );
    }

    if (fence.table === "goals" || fence.table === "tasks") {
      const first = {
        text: `INSERT INTO public.${fence.table} (id, project_id, title, owner_user_id)
               VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
        values: [nextUuid(), fixtures.projectId, "Incidental primary key", OWNER_INCIDENTAL],
      };
      const collision = {
        text: `INSERT INTO public.${fence.table} (id, project_id, title, owner_user_id)
               VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
        values: [
          first.values[0],
          fixtures.projectId,
          "Incidental primary key collision",
          OWNER_INCIDENTAL,
        ],
      };
      const firstOutcome = await attempt(() => sql.unsafe(first.text, first.values));
      assert(
        firstOutcome.ok,
        `INCIDENTAL ${fence.table} first INSERT must succeed; got ${describeError(firstOutcome.error)}`,
      );
      const collisionOutcome = await attempt(() => sql.unsafe(collision.text, collision.values));
      assertRefusedBy(collisionOutcome, {
        expectedConstraint: incidentalIndex,
        expectedCode: "23505",
        label: `INCIDENTAL ${fence.table} primary key collision`,
      });
    }

    log(
      "INCIDENTAL",
      `${fence.table}: ${incidentalIndex} still refuses its own collision under its own name, so the operation fence is not standing in for it.`,
    );
  }
}

function makeBarrier(size) {
  let arrived = 0;
  let open;
  const released = new Promise((resolve) => {
    open = resolve;
  });
  return {
    async reach() {
      arrived += 1;
      if (arrived === size) open();
      await released;
    },
  };
}

/**
 * Waits until at least `needed` backends tagged with our application_name are
 * blocked on a lock. This is what makes CONCURRENT a concurrency proof rather
 * than a sequential retry loop: the winner is held inside its open transaction
 * until the observer has seen every other attempt stuck in the index, so those
 * attempts provably ran before the winner committed.
 */
async function countBlockedAttempts(url, applicationName, needed, deadlineAt) {
  const observer = postgres(url, { max: 1, onnotice: () => {} });
  let blocked = 0;
  try {
    while (Date.now() < deadlineAt) {
      const rows = await observer.unsafe(
        `SELECT count(*)::int AS blocked
           FROM pg_stat_activity
          WHERE application_name LIKE $1
            AND wait_event_type = 'Lock'
            AND state = 'active'`,
        [`${applicationName}%`],
      );
      blocked = Number(rows[0]?.blocked ?? 0);
      if (blocked >= needed) return blocked;
      // Yield to the event loop between polls so the observer's own socket
      // cannot starve the attempts it is watching. This is a spin on
      // observable database state, not a sleep.
      await new Promise((resolve) => setImmediate(resolve));
    }
    return blocked;
  } finally {
    await observer.end({ timeout: 5 });
  }
}

async function proveConcurrentFence(sql, url, fence, attempts, tag) {
  const fixtures = await seedOwnerFixtures(sql, OWNER_CONCURRENT, tag);
  const operationId = nextUuid();
  const connections = Array.from(
    { length: attempts },
    () => postgres(url, { max: 1, onnotice: () => {} }),
  );
  const applicationName = `fence-proof-${fence.table}-${tag}`;
  const ready = makeBarrier(attempts);
  let releaseWinner;
  const winnerReleased = new Promise((resolve) => {
    releaseWinner = resolve;
  });

  // Each attempt gets its own pool so the barrier genuinely holds N separate
  // backends inside their own transaction at the same moment. If the attempts
  // shared a connection they would serialise and the "simultaneous" claim would
  // be untested.
  const transactions = Promise.all(
    connections.map(async (connection, ordinal) => {
      const attemptInsert = fence.insert({
        id: nextUuid(),
        owner: OWNER_CONCURRENT,
        operationId,
        clientId: CLIENT_MAIN,
        tag: `${tag}-${ordinal}`,
        ...fixtures,
      });
      let winnerId = null;
      try {
        winnerId = await connection.begin(async (tx) => {
          await tx`SELECT set_config('application_name', ${`${applicationName}-${ordinal}`}, true)`;
          // No INSERT may be issued until every attempt is inside its own
          // transaction and holding its own connection.
          await ready.reach();
          const rows = await tx.unsafe(attemptInsert.text, attemptInsert.values);
          // This attempt won the fence. Hold the row uncommitted so the others
          // are observed blocked rather than simply arriving after it.
          await winnerReleased;
          return rows[0]?.id ?? null;
        });
        return { ok: true, id: winnerId, error: null };
      } catch (error) {
        return { ok: false, id: null, error };
      }
    }),
  );

  const blocked = await countBlockedAttempts(
    url,
    applicationName,
    attempts - 1,
    Date.now() + OBSERVER_DEADLINE_MS,
  );
  releaseWinner();
  const outcomes = await transactions;
  await Promise.all(connections.map((connection) => connection.end({ timeout: 5 })));

  assert(
    blocked >= attempts - 1,
    `CONCURRENT ${fence.table} must have ${attempts - 1} attempt(s) blocked inside the fence while the winner was still open; the observer saw ${blocked}. A sequential retry loop cannot satisfy this.`,
  );

  const winners = outcomes.filter((outcome) => outcome.ok);
  const losers = outcomes.filter((outcome) => !outcome.ok);
  assert(
    winners.length === 1,
    `CONCURRENT ${fence.table} must leave exactly one winner among ${attempts} simultaneous attempts; got ${winners.length}`,
  );
  assert(
    losers.length === attempts - 1,
    `CONCURRENT ${fence.table} must fence ${attempts - 1} of ${attempts} simultaneous attempts; got ${losers.length}`,
  );
  for (const [ordinal, loser] of losers.entries()) {
    assert(
      loser.error?.code === "23505",
      `CONCURRENT ${fence.table} loser ${ordinal} must raise SQLSTATE 23505; got ${describeError(loser.error)}`,
    );
    assert(
      loser.error?.constraint_name === fence.index,
      `CONCURRENT ${fence.table} loser ${ordinal} must be refused by exactly ${fence.index}; got ${describeError(loser.error)}`,
    );
  }

  const identityRows = await countIdentityRows(sql, fence.table, {
    owner: OWNER_CONCURRENT,
    clientId: CLIENT_MAIN,
    operationId,
  });
  assert(
    identityRows === 1,
    `CONCURRENT ${fence.table} must leave exactly one durable row for ${attempts} simultaneous attempts; got ${identityRows}`,
  );
  assert(
    typeof winners[0].id === "string",
    `CONCURRENT ${fence.table} winner must have returned a row id`,
  );
  const { row: canonical, rows: canonicalRows } = await loadIdentityRow(sql, fence.table, {
    owner: OWNER_CONCURRENT,
    clientId: CLIENT_MAIN,
    operationId,
  });
  assert(
    canonicalRows.length === 1,
    `CONCURRENT ${fence.table} must hold exactly one canonical row for the operation identity; found ${canonicalRows.length}: ${canonicalRows.map((r) => r.id).join(", ")}`,
  );
  assert(
    canonical?.id === winners[0].id,
    `CONCURRENT ${fence.table} must leave the winner's row as the canonical row for the operation identity; got ${canonical?.id ?? "no row"} vs ${winners[0].id}`,
  );
  log(
    "CONCURRENT",
    `${fence.table}: ${attempts} connections released together left ${blocked} blocked attempt(s), one durable row, and every loser refused by ${fence.index}.`,
  );
}

async function runConcurrencyProof(sql, url) {
  // The tag is per table because every fence shares OWNER_CONCURRENT, and a
  // shared fixture slug would collide on projects_owner_user_id_slug_unique
  // instead of on the index under test.
  for (const fence of FENCES) {
    const attempts = fence.table === "tasks" ? 9 : 4;
    await proveConcurrentFence(sql, url, fence, attempts, `conc-${fence.table}`);
  }
}

/**
 * INVENTORY: printed, not asserted as a closed set, so an incidental unique
 * index added to a fenced table later is visible in review instead of being
 * silently absorbed into the fence. The CATALOG and DUPLICATE assertions are
 * what keep it from being absorbed.
 */
async function runInventoryProof(sql) {
  for (const fence of FENCES) {
    const rows = await sql.unsafe(
      `SELECT idx.relname AS index_name, pg_get_indexdef(i.indexrelid) AS index_definition
         FROM pg_index i
         JOIN pg_class idx ON idx.oid = i.indexrelid
         JOIN pg_class tbl ON tbl.oid = i.indrelid
         JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
        WHERE tbl_ns.nspname = 'public' AND tbl.relname = $1 AND i.indisunique
        ORDER BY idx.relname`,
      [fence.table],
    );
    const names = rows.map((row) => row.index_name);
    assert(
      names.includes(fence.index),
      `INVENTORY ${fence.table} must include ${fence.index}; got ${names.join(", ")}`,
    );
    log("INVENTORY", `${fence.table} unique indexes: ${names.join(", ")} (fence: ${fence.index})`);
  }
}

/**
 * IDEMPOTENCE: 0059 and 0074 are both written to be re-appliable. Re-applying
 * them must succeed and must leave the index and the constraint exactly as
 * specified, so a re-run cannot quietly drop or rename either.
 */
async function runIdempotenceProof(sql) {
  const fenceReapplied = await applyFile(sql, FENCE_MIGRATION);
  const pairingReapplied = await applyFile(sql, PAIRING_MIGRATION);
  assert(
    fenceReapplied > 0 && pairingReapplied > 0,
    "IDEMPOTENCE must actually re-apply both migrations",
  );
  const pairingRows = await sql.unsafe(
    `SELECT count(*)::int AS count
       FROM pg_constraint con
       JOIN pg_class tbl ON tbl.oid = con.conrelid
       JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
      WHERE tbl_ns.nspname = 'public' AND con.conname = $1`,
    ["projects_mcp_operation_identity_pair"],
  );
  assert(
    Number(pairingRows[0]?.count) === 1,
    `IDEMPOTENCE re-applying 0074 must leave exactly one projects pairing constraint; got ${pairingRows[0]?.count}`,
  );
  log(
    "IDEMPOTENCE",
    `Re-applying ${FENCE_MIGRATION} (${fenceReapplied} statements) and ${PAIRING_MIGRATION} (${pairingReapplied} statements) succeeded with the fence unchanged.`,
  );
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  if (!tags.includes(FENCE_MIGRATION)) {
    console.error(`Journal does not contain ${FENCE_MIGRATION}; cannot run the operation-fence proof.`);
    exit(2);
  }
  if (!tags.includes(PAIRING_MIGRATION)) {
    console.error(`Journal does not contain ${PAIRING_MIGRATION}; cannot run the operation-fence proof.`);
    exit(2);
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    // Apply the journal as it stood before 0074 so PAIRING-RED runs against
    // the pre-fix schema, then let runPairingProof apply 0074 itself.
    const beforePairing = tags.slice(0, tags.indexOf(PAIRING_MIGRATION));
    for (const tag of beforePairing) {
      const statements = await applyFile(sql, tag);
      log("MIGRATE", `${tag}: ${statements} statement(s) applied`);
    }
    log("MIGRATE", `${beforePairing.length} journal migrations applied through 0072`);

    let pairingApplied = false;
    const applyPairingMigration = async () => {
      if (pairingApplied) return;
      const statements = await applyFile(sql, PAIRING_MIGRATION);
      pairingApplied = true;
      log("MIGRATE", `${PAIRING_MIGRATION}: ${statements} statement(s) applied`);
    };

    await runPairingProof(sql, applyPairingMigration);
    await runCatalogProof(sql);
    await runDuplicateProof(sql);
    await runScopeProof(sql);
    await runIncidentalProof(sql);
    await runInventoryProof(sql);
    await runConcurrencyProof(sql, url);
    await runIdempotenceProof(sql);

    console.log(
      `MCP-OPERATION-FENCE-VERIFY PASS (${FENCES.length} fenced tables, ${assertionCount} assertions)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});