#!/usr/bin/env node
/**
 * Ephemeral-database proof that the MCP hardening migration TAIL is safe to
 * apply on top of REAL EXISTING DATA, not merely on an empty database.
 *
 * WHY THIS IS A SEPARATE FILE FROM mcp-receipt-invariant-verify.mjs. That
 * verifier owns the receipt claim/store/fail protocol and the 0059 domain
 * fences, and its `--upgrade-from 0049` mode exists to prove ONE transition:
 * that 0050 terminalises the pre-0050 consent documents. Its fixture is
 * necessarily grant-only, because at the 0049 boundary those legacy documents
 * are the only insertable ones - see BOUNDARY below. It therefore cannot state
 * the complementary claim: that a healthy, active, current v1 grant SURVIVES
 * the tail with byte-identical authority. This file states that claim, plus
 * every other existing-data question the tail raises, and it owns no receipt
 * behaviour at all. It also deliberately does not re-run the receipt protocol
 * phases: CI already does that against this same tail.
 *
 * BOUNDARY. Two boundaries are used, and both are necessary:
 *
 *   0049_operator_proposals   The last tag before the hardening wave (0050 is
 *                              the first hardening migration), so it is the
 *                              correct PRE-HARDENING boundary and CI's choice
 *                              is right. Proved here: the tail accepts a full
 *                              corpus of pre-existing domain rows and
 *                              owner-scoped rows from 0045-0049, and every
 *                              legacy consent document is terminalised
 *                              without mutating any stored permission document.
 *                              It CANNOT prove survival: at 0049 the pre-0050
 *                              document CHECK admits only the legacy
 *                              3/5/3-permission documents, so no current v1
 *                              grant can exist there to survive (asserted, not
 *                              assumed - see assertCanonicalSetIsNonEmpty).
 *
 *   0063_task_status_events    The last tag before the write-column fence (0064)
 *                              and the permission-version keying (0066). At
 *                              this boundary the canonical v1 documents ARE
 *                              insertable, so an active v1 read_only,
 *                              task_manager and workspace_manager grant can be
 *                              seeded and must survive 0064-0072 with
 *                              unchanged status, document, version and
 *                              EFFECTIVE authority.
 *
 * HOW THE JOURNAL IS APPLIED. Each migration file is applied inside its own
 * transaction, which is what `drizzle-kit migrate` does and what makes the
 * atomicity assertions meaningful: a file that fails mid-way leaves the prior
 * schema intact. (0044 records why no index uses CONCURRENTLY, so every
 * statement in the journal is transaction-safe.)
 *
 * SECTIONS
 *   SEED-NONEMPTY   every fixture table has rows and every fixture grant has
 *                   its expected pre-state, asserted BEFORE any survival claim
 *                   so no assertion below can be vacuously true.
 *   DATA-SURVIVAL   every seeded row is byte-identical afterwards on the
 *                   columns the tail does not legitimately own.
 *   GRANTS-VALID    canonical v1 grants keep status/revoked_at/document/
 *                   version.
 *   AUTHORITY-EQ    the EFFECTIVE authority set of every grant - what
 *                   private.has_active_mcp_permission() actually resolves for
 *                   each of the 19 MCP permissions - is identical before and
 *                   after. This is what "authority does not widen" means; it is
 *                   strictly stronger than comparing the stored jsonb.
 *   NO-EXTRA-REVOKE no grant outside the legacy-document set changed status.
 *   REACH          for an active v1 grant, every change in which tables are
 *                  reachable for read and for write must be one the migrations
 *                  declare. Exactly one declared movement is a widening -
 *                  0069 F-6 opens task_reminders UPDATE - and it is asserted
 *                  in both directions against the permission, so neither a
 *                  missing fix nor an unconditional open passes.
 *   CONSTRAINTS-OK  every CHECK constraint in the final catalog, evaluated with
 *                   its OWN predicate, has zero violating rows among the
 *                   seeded corpus; every NOT NULL column has zero NULLs.
 *   DIRECT-USER     existing rows stay usable from an ordinary authenticated
 *                   session (client_id IS NULL), proven by observable row
 *                   counts on SELECT and UPDATE.
 *   UNKNOWN-FAIL    unknown/unrecognised permission documents still fail
 *                   closed for active and terminal rows, with the constraint
 *                   still present and the row count unchanged.
 *   TAIL-REAPPLY    re-applying the tail raises only duplicate-object errors
 *                   and leaves the catalog and every data digest identical.
 *   ATOMIC-0050     an unknown pre-0050 document fails 0050 closed with the
 *                   catalog and the row untouched.
 *   ATOMIC-0066     a drifted permissions_version fails 0066 closed with the
 *                   0063 constraint definition still in place and the row
 *                   untouched.
 *   IDENTITY-PAIR    0074's five NOT VALID pairing constraints, on the REALISTIC
 *                   seeded corpus: each exists on its own table with exactly
 *                   0074's predicate, each is still recorded NOT VALID (0074's
 *                   deliberate final state, asserted rather than assumed), each
 *                   refuses an operation-id-only INSERT, a client-id-only INSERT
 *                   and a half-pairing UPDATE with 23514 attributed to that
 *                   constraint by name, and no seeded row was touched.
 *   IDENTITY-PAIR-LEGACY
 *                   the deliberately-VIOLATING legacy database: rows carrying
 *                   exactly one half of the identity are inserted at the 0063
 *                   boundary, the whole tail applies over them (0074 included),
 *                   0074's header pre-flight query - extracted from the
 *                   migration file at run time, so the documented query and this
 *                   proof cannot drift - names exactly those rows and nothing
 *                   else, and VALIDATE refuses 23514 on every table holding one.
 *                   This is why the final state is NOT VALID and not VALIDATED.
 *
 * Usage:
 *   node scripts/db/mcp-upgrade-path-verify.mjs --url <postgres-url>
 *   node scripts/db/mcp-upgrade-path-verify.mjs --url <postgres-url>
 *     --only-boundary 0063_task_status_events
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

const PRE_HARDENING_BOUNDARY = "0049_operator_proposals";
const SURVIVAL_BOUNDARY = "0063_task_status_events";

/** The migration that adds the five NOT VALID identity-pairing constraints. */
const PAIRING_MIGRATION = "0074_mcp_operation_identity_pair";

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
    if (rest[i] === "--only-boundary") args.onlyBoundary = rest[++i];
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

/**
 * Catalog expressions are compared with every parenthesis, quote and space
 * removed rather than verbatim, so a reworded-but-equivalent predicate is not a
 * false failure while a genuinely different predicate still is. Removing
 * parentheses cannot hide a difference: the operands and the operator survive.
 */
function flatten(expression) {
  return String(expression ?? "")
    .replace(/[\s"'()]+/g, "")
    .toLowerCase();
}

/**
 * Apply one migration file inside a single transaction, the way
 * `drizzle-kit migrate` applies it. Returns the statement count, or the
 * SQLSTATE when the file was rejected (in which case nothing it did survives).
 */
async function applyFileInTransaction(sql, tag) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  const statements = splitStatements(text);
  try {
    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
    });
  } catch (error) {
    return { applied: false, statements: statements.length, code: error?.code ?? "UNKNOWN", message: String(error?.message ?? error) };
  }
  return { applied: true, statements: statements.length };
}

/**
 * The operator pre-flight query a migration HEADER documents, extracted from the
 * migration file itself rather than restated here.
 *
 * The point is that the documented query and the proof cannot drift: if a header
 * edit ever makes the query non-executable again - as f8f81f4d had to fix for
 * 0077, whose pre-flight referenced a SELECT alias from its own WHERE clause -
 * the section below runs the header's bytes and fails, instead of quietly
 * testing a paraphrase that nobody ever executes.
 */
async function headerPreflightQuery(tag, firstLineNeedle) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("--") && line.slice(2).trimStart().startsWith(firstLineNeedle),
  );
  assert(start >= 0, `${tag} no longer documents a pre-flight query starting with "${firstLineNeedle}"`);
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    assert(
      lines[i].startsWith("--"),
      `${tag} pre-flight query is not a contiguous comment block; it cannot be extracted verbatim`,
    );
    body.push(lines[i].replace(/^--\s?/, ""));
    if (lines[i].includes(";")) break;
  }
  const query = body.join("\n");
  assert(
    query.trimEnd().endsWith(";"),
    `${tag} pre-flight query does not terminate in ';', so it cannot be extracted as one statement`,
  );
  return query;
}

/**
 * Execute a header's pre-flight query and return its rows, failing with a NAMED
 * message if the documented query is not executable.
 *
 * The point is diagnosability. f8f81f4d had to fix 0077's pre-flight because it
 * referenced a SELECT alias from its own WHERE clause, which PostgreSQL rejects;
 * had that been exercised as a raw query it would have surfaced as a bare
 * `[FATAL] column "n" does not exist` with no indication of which documented
 * query was at fault. Here it names the migration, the query and the SQLSTATE.
 */
async function runHeaderPreflight(sql, tag, firstLineNeedle) {
  const query = await headerPreflightQuery(tag, firstLineNeedle);
  try {
    return await sql.unsafe(query);
  } catch (error) {
    assert(
      false,
      `${tag}'s header pre-flight query is not executable: SQLSTATE ${error?.code ?? "UNKNOWN"} ${error?.message ?? error}. The query an operator is told to run must answer the question it exists to answer; query:\n${query}`,
    );
  }
}

/**
 * Run `fn` inside a transaction that is ALWAYS rolled back, so a probe that
 * writes cannot perturb the digests DATA-SURVIVAL and TAIL-REAPPLY compare
 * against. The sentinel is required because postgres.js commits a transaction
 * whose callback returns normally; there is no "always abort" option, and
 * aborting on the sentinel is the only way to guarantee the rollback happens.
 */
const ROLLBACK_SENTINEL = "ROLLBACK_PROBE";

async function inRolledBackTransaction(sql, fn) {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (error?.message !== ROLLBACK_SENTINEL) throw error;
  }
}

/**
 * `inRolledBackTransaction` for a probe whose RESULT is the point. The sentinel
 * aborts the transaction, so the value has to travel out through a closure
 * rather than a return - the return value of the transaction callback is
 * discarded by the rollback.
 */
async function inRolledBackTransactionReturning(sql, fn) {
  let captured = null;
  await inRolledBackTransaction(sql, async (tx) => {
    captured = await fn(tx);
  });
  assert(captured !== null, "a rolled-back probe must capture its result before the sentinel abort");
  return captured;
}

/**
 * A refusal, observed in a transaction that is then rolled back.
 *
 * Each refusing statement needs its OWN transaction. Postgres aborts the whole
 * transaction on the first error and refuses everything after it with 25P02, so
 * running several expected-refusals in one transaction would silently measure
 * "current transaction is aborted" from the second onwards - which is not 23514
 * and names no constraint. One transaction per refusal is what makes the second
 * probe mean what it says.
 */
async function refusedBy(sql, fn) {
  try {
    await inRolledBackTransaction(sql, fn);
    return { code: null, constraint: null, describe: () => "ACCEPTED (no error raised)" };
  } catch (error) {
    return {
      code: error?.code ?? "UNKNOWN",
      constraint: error?.constraint_name ?? null,
      describe: () =>
        `code=${error?.code ?? "UNKNOWN"} constraint=${error?.constraint_name ?? "none"} message=${String(error?.message ?? error).split("\n")[0]}`,
    };
  }
}

/**
 * Line-level differences between two digests. Used only to make a failure
 * message actionable: an assertion that says two snapshots differ without
 * saying how is a diagnostic, not a diagnosis.
 */
function diffLines(before, after) {
  const beforeLines = new Set(before.split("\n"));
  const afterLines = new Set(after.split("\n"));
  const removed = [...beforeLines].filter((line) => !afterLines.has(line));
  const added = [...afterLines].filter((line) => !beforeLines.has(line));
  return [
    ...removed.map((line) => `  - ${line}`),
    ...added.map((line) => `  + ${line}`),
  ].slice(0, 20);
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const RESOURCE_URI = "https://ega.example.com/api/mcp";

/**
 * Stable ids for the pairing probes, derived from a label rather than
 * randomised, so a failing probe names the same row on every run and the
 * re-apply and digest assertions cannot be perturbed by a fresh id.
 */
function deterministicUuid(label) {
  const hex = [...label].reduce((acc, character) => (acc * 31 + character.charCodeAt(0)) >>> 0, 7);
  const tail = hex.toString(16).padStart(12, "0");
  return `ab000000-0000-4000-8000-${tail}`;
}

const DETERMINISTIC_OPERATION_ID = deterministicUuid("identity-pair-operation");

/**
 * The pairing predicate 0074 requires, stated once. Every constraint assertion
 * compares against this, so there is no second description of the contract to
 * drift from the migration.
 */
const PAIRING_PREDICATE = "(mcp_operation_id IS NULL) = (mcp_client_id IS NULL)";

/**
 * The 19 permissions of the MCP permission universe. Mirrors
 * apps/web/src/lib/mcp/permissions.ts MCP_PERMISSIONS; this proof resolves
 * authority through the database, so it needs the strings, not the TS types.
 */
const MCP_PERMISSION_UNIVERSE = [
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
  "friction.read",
  "inbox.read",
  "notifications.read",
  "operator.read",
  "workload.read",
];

// The canonical permissions_version 1 documents, exactly as 0050 pins them.
const V1_READ_ONLY = ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"];
const V1_TASK_MANAGER = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "timer.read",
];
const V1_WORKSPACE_MANAGER = [
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

// The superseded pre-0050 documents. 0050 terminalises exactly these.
const LEGACY_READ_ONLY = ["projects.read", "goals.read", "tasks.read"];
const LEGACY_TASK_MANAGER = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
];
const LEGACY_DELIVERY_OBSERVER = ["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"];

/** The three canonical documents, keyed by profile, for equality assertions. */
const CANONICAL_V1_DOCUMENTS = new Map([
  ["read_only", V1_READ_ONLY],
  ["task_manager", V1_TASK_MANAGER],
  ["workspace_manager", V1_WORKSPACE_MANAGER],
]);

function isCanonicalV1(profile, permissions) {
  const expected = CANONICAL_V1_DOCUMENTS.get(profile);
  if (!expected) return false;
  if (permissions.length !== expected.length) return false;
  const actual = new Set(permissions);
  return expected.every((permission) => actual.has(permission));
}

const PROJECT_A = "44444444-4444-4444-8444-444444444441";
const PROJECT_A2 = "44444444-4444-4444-8444-444444444443";
const PROJECT_B = "44444444-4444-4444-8444-444444444442";
const GOAL_A = "55555555-5555-4555-8555-555555555551";
const GOAL_A2 = "55555555-5555-4555-8555-555555555553";
const GOAL_B = "55555555-5555-4555-8555-555555555552";
const TASK_A = "66666666-6666-4666-8666-666666666661";
const TASK_A_DONE = "66666666-6666-4666-8666-6666666666a1";
const TASK_A_SCHEDULED = "66666666-6666-4666-8666-6666666666a2";
const TASK_B = "66666666-6666-4666-8666-666666666662";
const SESSION_A_OPEN = "77777777-7777-4777-8777-777777777771";
const SESSION_A_CLOSED = "77777777-7777-4777-8777-777777777772";
const SESSION_B_OPEN = "77777777-7777-4777-8777-777777777773";
const REMINDER_A_PENDING = "88888888-8888-4888-8888-888888888881";
const REMINDER_A_SENT = "88888888-8888-4888-8888-888888888882";
const REMINDER_B_PENDING = "88888888-8888-4888-8888-888888888883";
const IDEA_A = "99999999-9999-4999-8999-999999999991";
const IDEA_A2 = "99999999-9999-4999-8999-99999999999a";
const IDEA_B = "99999999-9999-4999-8999-999999999992";
const NOTIFICATION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOTIFICATION_A_READ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const NOTIFICATION_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const DEVICE_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const DEVICE_A_STALE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const DELIVERY_A_ACCEPTED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const DELIVERY_A_FAILED = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const DELIVERY_B = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const PROPOSAL_A = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const PROPOSAL_A_APPLIED = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const PROPOSAL_B = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const INBOX_KEY_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const INBOX_KEY_A2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const INBOX_KEY_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const RECURRENCE_A = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const RECURRENCE_B = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const AUDIT_A = "12121212-1212-4121-8121-121212121201";

/**
 * Fixture grants.
 *
 *   canonical: true   carries a current v1 document; must survive the tail
 *                     with unchanged status, document, version and authority.
 *   legacy: true      carries a superseded document. `status` is its state at
 *                     0049 and `statusAt0063` its state once 0050/0057 have
 *                     terminalised it - which is exactly what a real 0063
 *                     database holds. `preTerminal: true` rows were already
 *                     terminal at the boundary and must not be touched at all.
 */
const FIXTURE_GRANTS = [
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a01",
    owner: OWNER_A,
    client: "canon-read",
    profile: "read_only",
    permissions: V1_READ_ONLY,
    status: "active",
    canonical: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a02",
    owner: OWNER_A,
    client: "canon-task",
    profile: "task_manager",
    permissions: V1_TASK_MANAGER,
    status: "active",
    canonical: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a03",
    owner: OWNER_B,
    client: "canon-workspace",
    profile: "workspace_manager",
    permissions: V1_WORKSPACE_MANAGER,
    status: "active",
    canonical: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a04",
    owner: OWNER_A,
    client: "canon-read-pending",
    profile: "read_only",
    permissions: V1_READ_ONLY,
    status: "pending",
    canonical: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a05",
    owner: OWNER_A,
    client: "legacy-read-active",
    profile: "read_only",
    permissions: LEGACY_READ_ONLY,
    status: "active",
    statusAt0063: "revoked",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a06",
    owner: OWNER_B,
    client: "legacy-read-active-b",
    profile: "read_only",
    permissions: LEGACY_READ_ONLY,
    status: "active",
    statusAt0063: "revoked",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a07",
    owner: OWNER_A,
    client: "legacy-task-active",
    profile: "task_manager",
    permissions: LEGACY_TASK_MANAGER,
    status: "active",
    statusAt0063: "revoked",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a08",
    owner: OWNER_A,
    client: "legacy-read-pending",
    profile: "read_only",
    permissions: LEGACY_READ_ONLY,
    status: "pending",
    statusAt0063: "failed",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a09",
    owner: OWNER_A,
    client: "legacy-task-pending",
    profile: "task_manager",
    permissions: LEGACY_TASK_MANAGER,
    status: "pending",
    statusAt0063: "failed",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a0a",
    owner: OWNER_A,
    client: "legacy-delivery-active",
    profile: "delivery_observer",
    permissions: LEGACY_DELIVERY_OBSERVER,
    status: "active",
    statusAt0063: "revoked",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a0b",
    owner: OWNER_A,
    client: "legacy-delivery-pending",
    profile: "delivery_observer",
    permissions: LEGACY_DELIVERY_OBSERVER,
    status: "pending",
    statusAt0063: "failed",
    legacy: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a0c",
    owner: OWNER_A,
    client: "legacy-delivery-revoked",
    profile: "delivery_observer",
    permissions: LEGACY_DELIVERY_OBSERVER,
    status: "revoked",
    statusAt0063: "revoked",
    legacy: true,
    preTerminal: true,
  },
  {
    id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a0d",
    owner: OWNER_A,
    client: "legacy-task-failed",
    profile: "task_manager",
    permissions: LEGACY_TASK_MANAGER,
    status: "failed",
    statusAt0063: "failed",
    legacy: true,
    preTerminal: true,
  },
];

/**
 * Per-table projections for the survival digest. Only columns the tail does
 * not legitimately own are listed: 0059 appends mcp_operation_id /
 * mcp_client_id to the five fenced tables, 0050/0057 own a grant's status /
 * revoked_at / updated_at, and 0063 owns tasks.completed_at. Every other
 * seeded column must be byte-identical across the tail.
 */
const SURVIVAL_PROJECTIONS = {
  projects: ["id", "owner_user_id", "name", "slug", "description", "status", "created_at", "updated_at"],
  goals: ["id", "owner_user_id", "project_id", "title", "slug", "description", "status", "next_step", "health", "created_at", "updated_at"],
  tasks: [
    "id", "owner_user_id", "project_id", "goal_id", "title", "description", "status", "priority",
    "created_at", "updated_at", "due_date", "focus_rank", "estimate_minutes", "planned_for_date",
    "blocked_reason", "archived_at", "archived_by", "scheduled_start_at", "scheduled_end_at",
    "calendar_sync_enabled", "calendar_reminder_minutes", "calendar_event_id", "calendar_sync_status",
    "calendar_sync_failure_reason",
  ],
  task_sessions: ["id", "owner_user_id", "task_id", "started_at", "ended_at", "duration_seconds", "created_at", "updated_at"],
  task_reminders: [
    "id", "owner_user_id", "task_id", "remind_at", "channel", "status", "sent_at", "failure_reason",
    "created_at", "updated_at", "delivery_mode", "processed_at", "processing_error", "source", "source_id",
  ],
  notifications: ["id", "owner_user_id", "type", "title", "body", "target_type", "target_id", "idempotency_key", "read_at", "opened_at", "created_at", "updated_at"],
  notification_preferences: ["owner_user_id", "notification_type", "push_enabled", "email_enabled", "created_at", "updated_at"],
  notification_devices: [
    "id", "owner_user_id", "installation_id", "platform", "provider", "provider_token", "is_active",
    "last_seen_at", "invalidated_at", "created_at", "updated_at",
  ],
  notification_deliveries: [
    "id", "notification_id", "owner_user_id", "channel", "device_id", "provider", "status",
    "provider_message_id", "attempt_count", "next_attempt_at", "last_error_code", "last_error_reason",
    "provider_accepted_at", "failed_at", "created_at", "updated_at",
  ],
  user_time_context: ["user_id", "iana_timezone", "created_at", "updated_at"],
  operator_proposals: [
    "id", "revision", "owner_user_id", "local_date", "time_context_id", "baseline_hash",
    "proposed_task_ids", "task_versions", "parent_proposal_id", "idempotency_key", "status",
    "created_at", "updated_at", "approved_at", "applied_at", "dismissed_at", "result", "ai_ref",
  ],
  inbox_idempotency_keys: ["id", "owner_user_id", "key", "inbox_item_id", "fingerprint", "created_at"],
  idea_notes: ["id", "owner_user_id", "title", "body", "status", "created_at", "updated_at", "type", "project_id", "priority", "tags"],
  task_recurrences: ["id", "owner_user_id", "task_id", "rule", "created_at", "updated_at", "anchor_date", "timezone", "next_occurrence_date", "last_generated_at"],
  task_status_events: ["id", "owner_user_id", "task_id", "from_status", "to_status", "occurred_at", "operation_metadata", "created_at"],
  // status / revoked_at / updated_at are owned by 0050/0057, so they are
  // excluded from the survival digest but their CHECK constraints are still
  // evaluated below.
  mcp_authorization_grants: [
    "id", "owner_user_id", "oauth_client_id", "resource_uri", "client_name",
    "permission_profile", "permissions", "permissions_version", "approved_at", "created_at",
  ],
  agent_integration_events: [
    "id", "owner_user_id", "token_id", "action", "resource_type", "resource_id", "outcome", "ip_address",
    "created_at", "oauth_client_id", "grant_id", "request_id", "tool_name", "metadata", "duration_ms", "error_code",
  ],
};


/** Tables that must exist and be seeded at BOTH boundaries. */
const ALWAYS_SEEDED_TABLES = [
  "projects",
  "goals",
  "tasks",
  "task_sessions",
  "task_reminders",
  "notifications",
  "notification_devices",
  "notification_deliveries",
  "notification_preferences",
  "user_time_context",
  "inbox_idempotency_keys",
  "operator_proposals",
  "idea_notes",
  "task_recurrences",
  "agent_integration_events",
];

/** task_status_events is created by 0063, so it is seeded only at 0063. */
const POST_0063_TABLES = ["task_status_events"];

/**
 * The five tables 0074 adds a pairing constraint to, with the INSERT shape this
 * proof uses for each. Every shape carries only columns the table's NOT NULL
 * list requires, so a refusal can only be the pairing constraint's doing.
 *
 * `clientOnly` is the inverse half of the pair: the header's proof is about an
 * operation id with no client, and a constraint that only noticed that direction
 * would be half a constraint. Both directions are asserted, per table.
 */
const IDENTITY_PAIR_TABLES = [
  {
    table: "projects",
    constraint: "projects_mcp_operation_identity_pair",
    columns: "id, owner_user_id, name, slug",
    values: ({ id, owner, tag }) =>
      `'${id}'::uuid, '${owner}'::uuid, 'Identity pair ${tag}', 'identity-pair-${tag}'`,
  },
  {
    table: "goals",
    constraint: "goals_mcp_operation_identity_pair",
    columns: "id, owner_user_id, project_id, title, slug",
    values: ({ id, owner, tag, projectId }) =>
      `'${id}'::uuid, '${owner}'::uuid, '${projectId}'::uuid, 'Identity pair ${tag}', 'identity-pair-${tag}'`,
  },
  {
    table: "tasks",
    constraint: "tasks_mcp_operation_identity_pair",
    columns: "id, owner_user_id, project_id, title",
    values: ({ id, owner, tag, projectId }) =>
      `'${id}'::uuid, '${owner}'::uuid, '${projectId}'::uuid, 'Identity pair ${tag}'`,
  },
  {
    table: "task_reminders",
    constraint: "task_reminders_mcp_operation_identity_pair",
    columns: "id, owner_user_id, task_id, remind_at",
    values: ({ id, owner, taskId }) =>
      `'${id}'::uuid, '${owner}'::uuid, '${taskId}'::uuid, '2026-05-01 07:00:00+00'`,
  },
  {
    table: "task_sessions",
    constraint: "task_sessions_mcp_operation_identity_pair",
    // ended_at/duration_seconds are supplied so the row is a CLOSED session:
    // task_sessions_owner_open_unique admits only one open session per owner, so
    // an open probe row would be refused by that index instead of reaching 0074.
    columns: "id, owner_user_id, task_id, started_at, ended_at, duration_seconds",
    values: ({ id, owner, taskId }) =>
      `'${id}'::uuid, '${owner}'::uuid, '${taskId}'::uuid, '2026-05-01 09:00:00+00', '2026-05-01 10:00:00+00', 3600`,
  },
];

/** Columns the fixture asserts are NOT NULL, to catch a migration that adds one. */
async function seedDomainRows(sql) {
  await sql.unsafe(`
    INSERT INTO public.projects (id, owner_user_id, name, slug, description, status, created_at, updated_at)
    VALUES
      ('${PROJECT_A}', '${OWNER_A}', 'Owner A workspace', 'owner-a-workspace', 'the primary project', 'active', '2026-01-04 09:00:00+00', '2026-02-01 09:00:00+00'),
      ('${PROJECT_A2}', '${OWNER_A}', 'Owner A second', 'owner-a-second', 'a second project', 'planned', '2026-01-05 09:00:00+00', '2026-02-02 09:00:00+00'),
      ('${PROJECT_B}', '${OWNER_B}', 'Owner B workspace', 'owner-b-workspace', 'another tenant', 'active', '2026-01-06 09:00:00+00', '2026-02-03 09:00:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.goals (id, owner_user_id, project_id, title, slug, description, status, next_step, health, created_at, updated_at)
    VALUES
      ('${GOAL_A}', '${OWNER_A}', '${PROJECT_A}', 'Ship the hardening wave', 'ship-hardening', 'close every lane', 'active', 'review the findings', 'on_track', '2026-01-07 09:00:00+00', '2026-02-04 09:00:00+00'),
      ('${GOAL_A2}', '${OWNER_A}', '${PROJECT_A2}', 'Keep the proof green', null, null, 'draft', null, null, '2026-01-08 09:00:00+00', '2026-01-08 09:00:00+00'),
      ('${GOAL_B}', '${OWNER_B}', '${PROJECT_B}', 'Owner B goal', null, 'other tenant', 'active', null, 'at_risk', '2026-01-09 09:00:00+00', '2026-02-05 09:00:00+00')
  `);
  // tasks: an open task, a completed task carrying a trustworthy completion
  // instant (so 0063's backfill has something real to copy), and a task with
  // the scheduling/calendar columns populated - the exact shape 0064's
  // column fence and 0071's classification guard have to tolerate.
  await sql.unsafe(`
    INSERT INTO public.tasks (
      id, owner_user_id, project_id, goal_id, title, description, status, priority,
      created_at, updated_at, due_date, focus_rank, estimate_minutes, planned_for_date,
      blocked_reason, completed_at, scheduled_start_at, scheduled_end_at,
      calendar_sync_enabled, calendar_reminder_minutes, calendar_event_id,
      calendar_sync_status, calendar_sync_failure_reason
    )
    VALUES
      ('${TASK_A}', '${OWNER_A}', '${PROJECT_A}', '${GOAL_A}', 'Prove the upgrade path',
       'seeded before the MCP hardening tail', 'in_progress', 'high',
       '2026-03-01 08:00:00+00', '2026-03-02 08:00:00+00', '2026-03-20', 3, 240, '2026-03-18',
       'waiting on review', NULL, NULL, NULL, false, 10, NULL, NULL, NULL),
      ('${TASK_A_DONE}', '${OWNER_A}', '${PROJECT_A}', '${GOAL_A}', 'Already completed',
       'carries a trustworthy completed_at', 'done', 'medium',
       '2026-02-10 08:00:00+00', '2026-02-12 08:00:00+00', NULL, NULL, 60, NULL,
       NULL, '2026-02-12 08:00:00+00', NULL, NULL, false, 10, NULL, NULL, NULL),
      ('${TASK_A_SCHEDULED}', '${OWNER_A}', '${PROJECT_A2}', '${GOAL_A2}', 'Scheduled on the calendar',
       'has calendar mirror columns populated', 'todo', 'low',
       '2026-03-03 08:00:00+00', '2026-03-03 08:00:00+00', '2026-03-21', NULL, 30, '2026-03-21',
       NULL, NULL, '2026-03-21 09:00:00+00', '2026-03-21 10:00:00+00', true, 15,
       'cal-event-1', 'synced', NULL),
      ('${TASK_B}', '${OWNER_B}', '${PROJECT_B}', '${GOAL_B}', 'Owner B task', 'other tenant',
       'todo', 'medium', '2026-03-04 08:00:00+00', '2026-03-04 08:00:00+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       false, 10, NULL, NULL, NULL)
  `);
  await sql.unsafe(`
    INSERT INTO public.task_sessions (id, owner_user_id, task_id, started_at, ended_at, duration_seconds, created_at, updated_at)
    VALUES
      ('${SESSION_A_OPEN}', '${OWNER_A}', '${TASK_A}', '2026-03-05 09:00:00+00', NULL, NULL, '2026-03-05 09:00:00+00', '2026-03-05 09:00:00+00'),
      ('${SESSION_A_CLOSED}', '${OWNER_A}', '${TASK_A_DONE}', '2026-02-11 09:00:00+00', '2026-02-11 10:30:00+00', 5400, '2026-02-11 09:00:00+00', '2026-02-11 10:30:00+00'),
      ('${SESSION_B_OPEN}', '${OWNER_B}', '${TASK_B}', '2026-03-05 10:00:00+00', NULL, NULL, '2026-03-05 10:00:00+00', '2026-03-05 10:00:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.task_reminders (
      id, owner_user_id, task_id, remind_at, channel, status, sent_at, failure_reason,
      created_at, updated_at, delivery_mode, processed_at, processing_error, source, source_id
    )
    VALUES
      ('${REMINDER_A_PENDING}', '${OWNER_A}', '${TASK_A}', '2026-03-19 07:00:00+00', 'email', 'pending', NULL, NULL,
       '2026-03-01 08:05:00+00', '2026-03-01 08:05:00+00', 'email', NULL, NULL, NULL, NULL),
      ('${REMINDER_A_SENT}', '${OWNER_A}', '${TASK_A_DONE}', '2026-02-12 08:00:00+00', 'push', 'sent', '2026-02-12 08:00:05+00', NULL,
       '2026-02-10 08:05:00+00', '2026-02-12 08:00:05+00', 'push', '2026-02-12 08:00:05+00', NULL, 'timer', 'timer-1'),
      ('${REMINDER_B_PENDING}', '${OWNER_B}', '${TASK_B}', '2026-03-22 07:00:00+00', 'email', 'pending', NULL, NULL,
       '2026-03-04 08:05:00+00', '2026-03-04 08:05:00+00', 'email', NULL, NULL, NULL, NULL)
  `);
  await sql.unsafe(`
    INSERT INTO public.notifications (id, owner_user_id, type, title, body, target_type, target_id, idempotency_key, read_at, opened_at, created_at, updated_at)
    VALUES
      ('${NOTIFICATION_A}', '${OWNER_A}', 'task_reminder', 'Reminder due', 'a pending reminder', 'task', '${TASK_A}', 'upgrade-path-key-1', NULL, NULL, '2026-03-01 08:06:00+00', '2026-03-01 08:06:00+00'),
      ('${NOTIFICATION_A_READ}', '${OWNER_A}', 'task_reminder', 'Already read', 'a read reminder', 'task', '${TASK_A_DONE}', 'upgrade-path-key-2', '2026-02-12 09:00:00+00', '2026-02-12 09:05:00+00', '2026-02-10 08:06:00+00', '2026-02-12 09:00:00+00'),
      ('${NOTIFICATION_B}', '${OWNER_B}', 'task_reminder', 'Owner B reminder', 'other tenant', 'task', '${TASK_B}', 'upgrade-path-key-3', NULL, NULL, '2026-03-04 08:06:00+00', '2026-03-04 08:06:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_devices (id, owner_user_id, installation_id, platform, provider, provider_token, is_active, last_seen_at, invalidated_at, created_at, updated_at)
    VALUES
      ('${DEVICE_A}', '${OWNER_A}', 'installation-a', 'android', 'fcm', 'fcm-token-a', true, '2026-03-05 08:00:00+00', NULL, '2026-03-01 08:07:00+00', '2026-03-05 08:00:00+00'),
      ('${DEVICE_A_STALE}', '${OWNER_A}', 'installation-a-stale', 'android', 'fcm', 'fcm-token-a-stale', false, '2026-02-01 08:00:00+00', '2026-02-20 08:00:00+00', '2026-02-01 08:07:00+00', '2026-02-20 08:00:00+00'),
      ('${DEVICE_B}', '${OWNER_B}', 'installation-b', 'android', 'fcm', 'fcm-token-b', true, '2026-03-05 08:00:00+00', NULL, '2026-03-04 08:07:00+00', '2026-03-05 08:00:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_deliveries (
      id, notification_id, owner_user_id, channel, device_id, provider, status, provider_message_id,
      attempt_count, next_attempt_at, last_error_code, last_error_reason, provider_accepted_at,
      failed_at, created_at, updated_at
    )
    VALUES
      ('${DELIVERY_A_ACCEPTED}', '${NOTIFICATION_A}', '${OWNER_A}', 'push', '${DEVICE_A}', 'fcm', 'retry_scheduled', NULL,
       1, '2026-03-05 08:05:00+00', 'provider_throttled', 'the provider asked us to back off', NULL, NULL, '2026-03-05 08:00:00+00', '2026-03-05 08:00:10+00'),
      ('${DELIVERY_A_FAILED}', '${NOTIFICATION_A_READ}', '${OWNER_A}', 'email', NULL, 'resend', 'failed', NULL,
       3, NULL, 'provider_rejected', 'the address bounced', NULL, '2026-02-12 09:01:00+00', '2026-02-12 08:06:00+00', '2026-02-12 09:01:00+00'),
      ('${DELIVERY_B}', '${NOTIFICATION_B}', '${OWNER_B}', 'email', NULL, 'resend', 'queued', NULL,
       0, '2026-03-05 09:00:00+00', NULL, NULL, NULL, NULL, '2026-03-04 08:06:00+00', '2026-03-04 08:06:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.notification_preferences (owner_user_id, notification_type, push_enabled, email_enabled, created_at, updated_at)
    VALUES
      ('${OWNER_A}', 'task_reminder', true, true, '2026-01-04 09:10:00+00', '2026-01-04 09:10:00+00'),
      ('${OWNER_B}', 'task_reminder', false, true, '2026-01-06 09:10:00+00', '2026-01-06 09:10:00+00')
    ON CONFLICT (owner_user_id, notification_type) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.user_time_context (user_id, iana_timezone, created_at, updated_at)
    VALUES
      ('${OWNER_A}', 'Europe/Berlin', '2026-01-04 09:11:00+00', '2026-03-05 07:00:00+00'),
      ('${OWNER_B}', 'America/New_York', '2026-01-06 09:11:00+00', '2026-03-05 07:00:00+00')
    ON CONFLICT (user_id) DO NOTHING
  `);
  await sql.unsafe(`
    INSERT INTO public.idea_notes (id, owner_user_id, title, body, status, created_at, updated_at, type, project_id, priority, tags)
    VALUES
      ('${IDEA_A}', '${OWNER_A}', 'Capture an inbox idea', 'the raw capture', 'inbox', '2026-03-01 08:08:00+00', '2026-03-01 08:08:00+00', 'idea', '${PROJECT_A}', 'medium', '{inbox,seeded}'::text[]),
      ('${IDEA_A2}', '${OWNER_A}', 'Second capture', 'another capture', 'reviewing', '2026-03-02 08:08:00+00', '2026-03-02 08:08:00+00', 'bug', NULL, 'high', '{}'::text[]),
      ('${IDEA_B}', '${OWNER_B}', 'Owner B capture', 'other tenant', 'inbox', '2026-03-04 08:08:00+00', '2026-03-04 08:08:00+00', 'idea', '${PROJECT_B}', 'low', '{}'::text[])
  `);
  await sql.unsafe(`
    INSERT INTO public.inbox_idempotency_keys (id, owner_user_id, key, inbox_item_id, fingerprint, created_at)
    VALUES
      ('${INBOX_KEY_A}', '${OWNER_A}', 'capture-key-1', '${IDEA_A}', 'fingerprint-1', '2026-03-01 08:09:00+00'),
      ('${INBOX_KEY_A2}', '${OWNER_A}', 'capture-key-2', '${IDEA_A2}', 'fingerprint-2', '2026-03-02 08:09:00+00'),
      ('${INBOX_KEY_B}', '${OWNER_B}', 'capture-key-b', '${IDEA_B}', 'fingerprint-b', '2026-03-04 08:09:00+00')
  `);
  await sql.unsafe(`
    INSERT INTO public.operator_proposals (
      id, revision, owner_user_id, local_date, time_context_id, baseline_hash, proposed_task_ids,
      task_versions, parent_proposal_id, idempotency_key, status, created_at, updated_at,
      approved_at, applied_at, dismissed_at, result, ai_ref
    )
    VALUES
      ('${PROPOSAL_A}', 1, '${OWNER_A}', '2026-03-19', 'Europe/Berlin', 'baseline-a',
       jsonb_build_array('${TASK_A}'::text), '[]'::jsonb, NULL, 'proposal-key-1', 'generated',
       '2026-03-18 20:00:00+00', '2026-03-18 20:00:00+00', NULL, NULL, NULL, NULL, NULL),
      ('${PROPOSAL_A_APPLIED}', 2, '${OWNER_A}', '2026-03-12', 'Europe/Berlin', 'baseline-b',
       jsonb_build_array('${TASK_A_DONE}'::text), '[]'::jsonb, '${PROPOSAL_A}', 'proposal-key-2', 'applied',
       '2026-03-11 20:00:00+00', '2026-03-11 21:00:00+00',
       '2026-03-11 20:30:00+00', '2026-03-11 20:45:00+00', NULL, '{"applied": 1}'::jsonb, 'ref-a'),
      ('${PROPOSAL_B}', 1, '${OWNER_B}', '2026-03-18', 'America/New_York', 'baseline-c',
       '[]'::jsonb, '[]'::jsonb, NULL, 'proposal-key-b', 'dismissed',
       '2026-03-17 20:00:00+00', '2026-03-17 20:00:00+00',
       NULL, NULL, '2026-03-17 20:15:00+00', NULL, NULL)
  `);
  await sql.unsafe(`
    INSERT INTO public.task_recurrences (id, owner_user_id, task_id, rule, created_at, updated_at, anchor_date, timezone, next_occurrence_date, last_generated_at)
    VALUES
      ('${RECURRENCE_A}', '${OWNER_A}', '${TASK_A}', 'weekly:monday', '2026-01-11 09:00:00+00', '2026-03-02 09:00:00+00', '2026-03-16', 'Europe/Berlin', '2026-03-23', '2026-03-02 09:00:00+00'),
      ('${RECURRENCE_B}', '${OWNER_B}', '${TASK_B}', 'monthly:day-of-month', '2026-01-12 09:00:00+00', '2026-01-12 09:00:00+00', '2026-03-04', 'America/New_York', '2026-04-04', NULL)
  `);
}

async function seedTaskStatusEvents(sql) {
  // 0063 creates this table, so at the 0063 boundary the ledger already holds
  // historical rows. Their survival across 0064-0072 is part of the proof.
  await sql.unsafe(`
    INSERT INTO public.task_status_events (id, owner_user_id, task_id, from_status, to_status, occurred_at, operation_metadata, created_at)
    VALUES
      ('5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e01', '${OWNER_A}', '${TASK_A_DONE}', 'in_progress', 'done', '2026-02-12 08:00:00+00', '{"seed": true}'::jsonb, '2026-02-12 08:00:00+00'),
      ('5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e02', '${OWNER_A}', '${TASK_A}', NULL, 'in_progress', '2026-03-01 08:00:00+00', NULL, '2026-03-01 08:00:00+00'),
      ('5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e03', '${OWNER_B}', NULL, 'todo', 'done', '2026-02-20 08:00:00+00', NULL, '2026-02-20 08:00:00+00')
  `);
}

/**
 * Which fixture grants a boundary can hold, and in what state.
 *
 * At 0049 the pre-0050 document CHECK admits ONLY the legacy documents, so no
 * canonical v1 grant can exist there - which is precisely why 0063 is the
 * survival boundary. At 0063 the reverse holds: 0050/0057 have already
 * terminalised every active/pending legacy row, so an ACTIVE row carrying a
 * legacy document is not representable and is not seeded.
 */
function grantsForBoundary(boundary) {
  const grants =
    boundary === PRE_HARDENING_BOUNDARY
      ? FIXTURE_GRANTS.filter((grant) => grant.legacy)
      : [...FIXTURE_GRANTS];
  return grants.map((grant) => ({
    ...grant,
    status: boundary === PRE_HARDENING_BOUNDARY ? grant.status : (grant.statusAt0063 ?? grant.status),
  }));
}

async function seedGrants(sql, boundary) {
  const grants = grantsForBoundary(boundary);
  for (const grant of grants) {
    await sql.unsafe(
      `
      INSERT INTO public.mcp_authorization_grants (
        id, owner_user_id, oauth_client_id, resource_uri, client_name, status,
        permission_profile, permissions, permissions_version, approved_at, revoked_at, created_at, updated_at
      )
      VALUES (
        $1::uuid, $2::uuid, $3, $4, 'Upgrade-path fixture', $5::text,
        $6::text, $7::text::jsonb, 1,
        CASE WHEN $5 IN ('active', 'pending') THEN '2026-01-04 09:20:00+00'::timestamptz ELSE NULL END,
        CASE WHEN $5 IN ('revoked', 'failed') THEN '2026-02-01 09:20:00+00'::timestamptz ELSE NULL END,
        '2026-01-04 09:20:00+00', '2026-01-04 09:20:00+00'
      )
    `,
      [
        grant.id,
        grant.owner,
        grant.client,
        RESOURCE_URI,
        grant.status,
        grant.profile,
        JSON.stringify(grant.permissions),
      ],
    );
  }
  // The audit row's actor CHECK requires (oauth_client_id, grant_id), so it
  // points at whichever active grant this boundary can actually hold.
  const auditGrant = grants.find((grant) => grant.canonical && grant.status === "active")
    ?? grants.find((grant) => grant.status === "active");
  await sql.unsafe(`
    INSERT INTO public.agent_integration_events (
      id, owner_user_id, token_id, action, resource_type, resource_id, outcome, ip_address,
      created_at, oauth_client_id, grant_id, request_id, tool_name, metadata, duration_ms, error_code
    )
    VALUES (
      '${AUDIT_A}', '${OWNER_A}', NULL, 'mcp_tool_call', 'mcp_tool', NULL, 'success', '203.0.113.7',
      '2026-03-05 08:00:00+00', '${auditGrant.client}', '${auditGrant.id}', 'upgrade-path-request',
      'ega_list_tasks', '{"seed": true}'::jsonb, 42, NULL
    )
  `);
}

/** Tables this boundary must have seeded, in the order they are reported. */
function seededTablesFor(boundary) {
  return boundary === PRE_HARDENING_BOUNDARY
    ? [...ALWAYS_SEEDED_TABLES]
    : [...ALWAYS_SEEDED_TABLES, ...POST_0063_TABLES];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * `rollback` makes a session's writes invisible to everything that follows, so
 * a usability probe cannot perturb the digests the survival and re-apply
 * assertions compare against.
 */
function session(sql, { userId, claims }, { rollback = false } = {}) {
  return {
    async run(fn) {
      if (rollback) {
        const connection = await sql.reserve();
        try {
          await connection.unsafe(`BEGIN`);
          await connection.unsafe(`SET LOCAL ROLE authenticated`);
          await connection.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
          const jwt = claims ? { role: "authenticated", sub: userId, ...claims } : { role: "authenticated", sub: userId };
          await connection.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(jwt)]);
          try {
            return await fn(connection);
          } finally {
            await connection.unsafe(`ROLLBACK`).catch(() => {});
          }
        } finally {
          connection.release();
        }
      }
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        const jwt = claims ? { role: "authenticated", sub: userId, ...claims } : { role: "authenticated", sub: userId };
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(jwt)]);
        return fn(tx);
      });
    },
  };
}

/**
 * An MCP OAuth principal: exactly what PostgREST builds from an MCP bearer.
 * `rollback: true` makes the session's writes invisible to later assertions.
 */
function mcpSession(sql, { userId, clientId }, options = {}) {
  return session(sql, { userId, claims: { client_id: clientId, aud: RESOURCE_URI } }, options);
}

/**
 * An ordinary authenticated browser session (no client_id claim). Rolled back
 * by default: these probes write, and the digests compared by DATA-SURVIVAL
 * and TAIL-REAPPLY must see the tail's effects only.
 */
function directUserSession(sql, { userId }, options = {}) {
  return session(sql, { userId, claims: null }, { rollback: true, ...options });
}

async function capturePostgresError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

async function tableDigest(sql, table, columns) {
  const [row] = await sql.unsafe(`
    SELECT count(*)::int AS row_count, coalesce(md5(string_agg(row_text, '|' ORDER BY row_text)), '') AS digest
    FROM (
      SELECT concat_ws(',', ${columns.map((column) => `t.${column}::text`).join(", ")}) AS row_text
      FROM public.${table} AS t
    ) AS projected
  `);
  return { rowCount: row.row_count, digest: row.digest };
}

async function dataDigests(sql, tables) {
  const digests = new Map();
  for (const table of tables) {
    digests.set(table, await tableDigest(sql, table, SURVIVAL_PROJECTIONS[table]));
  }
  return digests;
}

/** A digest of every constraint, policy, trigger and function in the catalog. */
async function catalogDigest(sql) {
  const parts = [];
  const constraints = await sql`
    SELECT conrelid::regclass::text AS relation, conname, contype, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY relation, conname
  `;
  for (const row of constraints) parts.push(`C|${row.relation}|${row.conname}|${row.contype}|${row.definition}`);
  const policies = await sql`
    SELECT tablename, policyname, cmd, coalesce(qual, '-'), coalesce(with_check, '-')
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `;
  for (const row of policies) {
    parts.push(`P|${row.tablename}|${row.policyname}|${row.cmd}|${row.qual}|${row.with_check}`);
  }
  const triggers = await sql`
    SELECT tgrelid::regclass::text AS relation, tgname, pg_get_triggerdef(oid) AS definition
    FROM pg_trigger
    WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE '%'
    ORDER BY relation, tgname
  `;
  for (const row of triggers) parts.push(`T|${row.relation}|${row.tgname}|${row.definition}`);
  const functions = await sql`
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
    ORDER BY n.nspname, p.proname, args
  `;
  for (const row of functions) parts.push(`F|${row.nspname}|${row.proname}|${row.args}|${row.definition}`);
  const rls = await sql`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  for (const row of rls) parts.push(`R|${row.relname}|${row.relrowsecurity}|${row.relforcerowsecurity}`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async function grantSnapshot(sql) {
  const rows = await sql`
    SELECT
      id::text AS id,
      oauth_client_id AS client,
      status,
      permission_profile AS profile,
      permissions,
      permissions_version AS version,
      (revoked_at IS NOT NULL) AS has_revoked_at,
      revoked_at::text AS revoked_at
    FROM public.mcp_authorization_grants
    ORDER BY oauth_client_id
  `;
  return new Map(rows.map((row) => [row.client, row]));
}

/**
 * The authority a principal ACTUALLY has: which of the 19 permissions the
 * database resolves for it. Comparing stored jsonb would only prove the
 * document was not edited; this proves the resolved authority did not change,
 * which is the property the migration claims.
 */
async function effectiveAuthority(sql, grant) {
  return mcpSession(sql, { userId: grant.owner, clientId: grant.client }).run(async (tx) => {
    const resolved = new Set();
    for (const permission of MCP_PERMISSION_UNIVERSE) {
      const [row] = await tx`SELECT private.has_active_mcp_permission(${permission}) AS granted`;
      if (row.granted) resolved.add(permission);
    }
    return [...resolved].sort();
  });
}

async function authoritySnapshot(sql, grants) {
  const snapshot = new Map();
  for (const grant of grants) {
    snapshot.set(grant.client, await effectiveAuthority(sql, grant));
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * VACUITY GATE. Every claim below is conditional on the fixture actually
 * existing, so this runs first and asserts non-zero counts plus the exact
 * pre-state of every fixture grant. Without it, a seeding typo would make
 * DATA-SURVIVAL, AUTHORITY-EQ and NO-EXTRA-REVOKE all pass vacuously.
 */
async function assertSeedNonEmpty(sql, boundary) {
  const tables = seededTablesFor(boundary);
  const digests = await dataDigests(sql, tables);
  const empty = [...digests.entries()].filter(([, value]) => value.rowCount === 0).map(([table]) => table);
  assert(empty.length === 0, `seed precondition failed: ${empty.join(", ")} hold zero rows`);
  const counts = [...digests.entries()].map(([table, value]) => `${table}=${value.rowCount}`).join(" ");
  log("SEED-NONEMPTY", `boundary ${boundary}: ${counts}`);

  const grants = grantsForBoundary(boundary);
  const snapshot = await grantSnapshot(sql);
  assert(snapshot.size === grants.length, `expected ${grants.length} fixture grants, found ${snapshot.size}`);
  for (const grant of grants) {
    const row = snapshot.get(grant.client);
    assert(row, `fixture grant ${grant.client} is missing before the tail`);
    assert(row.status === grant.status, `fixture grant ${grant.client} expected status ${grant.status}, got ${row.status}`);
    assert(row.version === 1, `fixture grant ${grant.client} must seed at permissions_version 1`);
    assert(
      JSON.stringify(row.permissions) === JSON.stringify(grant.permissions),
      `fixture grant ${grant.client} seeded the wrong permission document`,
    );
    if (grant.canonical) {
      assert(
        isCanonicalV1(grant.profile, grant.permissions),
        `fixture grant ${grant.client} is marked canonical but does not carry a canonical v1 document`,
      );
    }
    if (grant.preTerminal) {
      assert(row.has_revoked_at === true, `fixture grant ${grant.client} must seed with a revoked_at instant`);
      assert(
        row.revoked_at === "2026-02-01 09:20:00+00",
        `fixture grant ${grant.client} seeded an unexpected revoked_at: ${row.revoked_at}`,
      );
    }
  }
  log("SEED-NONEMPTY", `${grants.length} fixture grants present with the expected status, version and document.`);
  return { digests, snapshot };
}

/**
 * The 0049 boundary admits only the legacy documents, so its canonical set is
 * empty by construction. Proving that emptiness is what licenses the claim
 * that 0063 - not 0049 - is the boundary that carries the survival proof.
 */
function assertCanonicalSetIsNonEmpty(boundary, canonicalGrants) {
  if (boundary === PRE_HARDENING_BOUNDARY) {
    assert(
      canonicalGrants.length === 0,
      "the 0049 boundary must not admit canonical v1 documents; if it does, the boundary rationale needs revisiting",
    );
    log("BOUNDARY", "0049 admitted 0 canonical v1 grants: the pre-0050 document CHECK admits only legacy documents, so survival is untestable here.");
    return;
  }
  const profiles = new Set(canonicalGrants.map((grant) => grant.profile));
  for (const profile of ["read_only", "task_manager", "workspace_manager"]) {
    assert(profiles.has(profile), `survival boundary is missing a canonical v1 ${profile} grant`);
  }
  log("BOUNDARY", `0063 admitted ${canonicalGrants.length} canonical v1 grants covering ${[...profiles].sort().join(", ")}.`);
}

async function assertDataSurvival(sql, tables, before) {
  const after = await dataDigests(sql, tables);
  for (const table of tables) {
    const previous = before.get(table);
    const current = after.get(table);
    assert(
      current.rowCount === previous.rowCount,
      `${table}: row count changed across the tail (${previous.rowCount} -> ${current.rowCount})`,
    );
    assert(
      current.rowCount > 0,
      `${table}: row count is zero, so the survival assertion would be vacuous`,
    );
    assert(
      current.digest === previous.digest,
      `${table}: seeded rows were mutated across the tail (digest ${previous.digest} -> ${current.digest})`,
    );
  }
  const total = [...after.values()].reduce((sum, value) => sum + value.rowCount, 0);
  log("DATA-SURVIVAL", `${tables.length} tables / ${total} seeded rows are byte-identical on every non-tail-owned column.`);
}

async function assertGrantsValid(sql, boundary, before) {
  const after = await grantSnapshot(sql);
  const scoped = grantsForBoundary(boundary);
  const canonical = scoped.filter((grant) => grant.canonical);
  const legacy = scoped.filter((grant) => grant.legacy && grant.status !== "revoked" && grant.status !== "failed");
  const preTerminal = scoped.filter((grant) => grant.status === "revoked" || grant.status === "failed");

  for (const grant of canonical) {
    const row = after.get(grant.client);
    assert(row, `canonical grant ${grant.client} disappeared across the tail`);
    assert(row.status === grant.status, `canonical grant ${grant.client} changed status ${grant.status} -> ${row.status}`);
    assert(
      row.has_revoked_at === false,
      `canonical grant ${grant.client} was revoked across the tail (revoked_at set)`,
    );
    assert(row.version === 1, `canonical grant ${grant.client} changed permissions_version to ${row.version}`);
    assert(
      JSON.stringify(row.permissions) === JSON.stringify(grant.permissions),
      `canonical grant ${grant.client} changed its permission document across the tail`,
    );
    const previous = before.get(grant.client);
    assert(previous, `canonical grant ${grant.client} was absent from the pre-tail snapshot`);
  }

  // 0050 terminalises active -> revoked and pending -> failed; 0057 does the
  // same for delivery_observer. The stored document must be untouched.
  for (const grant of legacy) {
    const row = after.get(grant.client);
    assert(row, `legacy grant ${grant.client} disappeared across the tail`);
    const expected = grant.status === "active" ? "revoked" : "failed";
    assert(
      row.status === expected,
      `legacy grant ${grant.client} expected ${expected} after the tail, got ${row.status}`,
    );
    assert(row.has_revoked_at === true, `legacy grant ${grant.client} was terminalised without a revoked_at instant`);
    assert(row.version === 1, `legacy grant ${grant.client} changed permissions_version`);
    assert(
      JSON.stringify(row.permissions) === JSON.stringify(grant.permissions),
      `legacy grant ${grant.client} had its permission document rewritten by the tail`,
    );
  }

  // A row that was already terminal before the tail must be left completely
  // alone: same status, same revoked_at instant, same document.
  for (const grant of preTerminal) {
    const row = after.get(grant.client);
    assert(row, `pre-terminal grant ${grant.client} disappeared across the tail`);
    assert(
      row.status === grant.status,
      `pre-terminal grant ${grant.client} changed status ${grant.status} -> ${row.status}`,
    );
    assert(
      row.revoked_at === "2026-02-01 09:20:00+00",
      `pre-terminal grant ${grant.client} had its revoked_at instant rewritten to ${row.revoked_at}`,
    );
    assert(
      JSON.stringify(row.permissions) === JSON.stringify(grant.permissions),
      `pre-terminal grant ${grant.client} had its permission document rewritten`,
    );
  }

  const label = boundary === PRE_HARDENING_BOUNDARY ? "0050/0057" : "the tail";
  log(
    "GRANTS-VALID",
    `${canonical.length} canonical v1 grants unchanged; ${legacy.length} legacy grants terminalised by ${label} with documents preserved; ${preTerminal.length} pre-terminal grants untouched.`,
  );
}

/**
 * "Authority does not widen" proved through resolution, not through the
 * stored document: the set of permissions the database grants each principal
 * must be identical before and after.
 */
async function assertAuthorityEquality(sql, boundary, before) {
  const canonical = grantsForBoundary(boundary).filter((grant) => grant.canonical);
  const after = await authoritySnapshot(sql, canonical);
  assertCanonicalSetIsNonEmpty(boundary, canonical);

  for (const grant of canonical) {
    const previous = before.get(grant.client);
    const current = after.get(grant.client);
    assert(Array.isArray(previous), `no pre-tail authority snapshot for ${grant.client}`);
    assert(
      JSON.stringify(previous) === JSON.stringify(current),
      `${grant.client} effective authority changed across the tail: [${previous.join(",")}] -> [${current.join(",")}]`,
    );
    if (grant.status === "active") {
      assert(
        previous.length > 0,
        `active canonical grant ${grant.client} resolved zero permissions before the tail, so AUTHORITY-EQ would be vacuous`,
      );
      assert(
        JSON.stringify(current.slice().sort()) === JSON.stringify([...grant.permissions].sort()),
        `${grant.client} effective authority no longer equals its consented document`,
      );
    } else {
      assert(current.length === 0, `pending grant ${grant.client} resolved ${current.length} permissions after the tail`);
    }
    log(
      "AUTHORITY-EQ",
      `${grant.client} (${grant.profile}, ${grant.status}): ${current.length} permission(s), identical before and after.`,
    );
  }

  // A legacy grant must lose exactly the authority it was terminalised out of.
  const terminalLegacy = grantsForBoundary(boundary).filter((grant) => grant.legacy);
  const terminalisedNow = terminalLegacy.filter(
    (grant) => grant.status === "active" || grant.status === "pending",
  );
  for (const grant of terminalisedNow) {
    const current = await effectiveAuthority(sql, grant);
    assert(
      current.length === 0,
      `legacy grant ${grant.client} still resolves ${current.length} permissions after being terminalised`,
    );
  }
  // A row that was already terminal at the boundary must also resolve nothing,
  // which is the point of terminalising it at all.
  for (const grant of terminalLegacy.filter((entry) => entry.status === "revoked" || entry.status === "failed")) {
    const current = await effectiveAuthority(sql, grant);
    assert(current.length === 0, `terminal legacy grant ${grant.client} still resolves ${current.length} permissions`);
  }
  log(
    "AUTHORITY-EQ",
    `${terminalLegacy.length} terminalised legacy grant(s), of which ${terminalisedNow.length} were terminalised by this tail, resolve zero permissions afterwards.`,
  );
}

/**
 * No grant outside the legacy set changed status. Stated as a set difference
 * over ids rather than a count, so an implementation that revokes one extra
 * grant while leaving one expected row alone still fails.
 */
async function assertNoExtraRevocations(sql, boundary, before) {
  const scoped = grantsForBoundary(boundary);
  const canonicalClients = new Set(scoped.filter((grant) => grant.canonical).map((grant) => grant.client));
  const nonTerminalBefore = new Set(
    scoped.filter((grant) => grant.status === "active" || grant.status === "pending").map((grant) => grant.client),
  );
  const mustTerminalise = [...nonTerminalBefore].filter((client) => !canonicalClients.has(client));
  const mustSurvive = [...canonicalClients].filter((client) => nonTerminalBefore.has(client));

  const after = await grantSnapshot(sql);
  const changed = [];
  for (const grant of scoped) {
    const previous = before.get(grant.client);
    const current = after.get(grant.client);
    assert(current, `grant ${grant.client} vanished across the tail`);
    assert(previous, `grant ${grant.client} was absent from the pre-tail snapshot`);
    if (previous.status !== current.status) changed.push({ client: grant.client, from: previous.status, to: current.status });
  }
  const unexpectedChanges = changed.filter(
    (entry) => !mustTerminalise.includes(entry.client),
  );
  assert(
    unexpectedChanges.length === 0,
    `the tail changed a status it had no reason to touch: ${unexpectedChanges
      .map((entry) => `${entry.client} ${entry.from}->${entry.to}`)
      .join(", ")}`,
  );
  for (const client of mustTerminalise) {
    const current = after.get(client);
    const expected = before.get(client).status === "active" ? "revoked" : "failed";
    assert(
      current.status === expected,
      `legacy grant ${client} should have become ${expected}, got ${current.status}`,
    );
  }
  for (const client of mustSurvive) {
    const current = after.get(client);
    assert(
      current.status === "active" || current.status === "pending",
      `canonical grant ${client} was terminalised by the tail (now ${current.status})`,
    );
  }
  log(
    "NO-EXTRA-REVOKE",
    `exactly ${changed.length} status change(s), all of them the ${mustTerminalise.length} legacy grant(s) 0050/0057 must terminalise; the ${mustSurvive.length} canonical non-terminal grant(s) are untouched (boundary ${boundary}).`,
  );
}

/**
 * Every CHECK constraint in the final catalog is evaluated with its OWN
 * predicate against the seeded corpus, and every NOT NULL column is counted.
 * Asserting the constraint EXISTS would pass even if it rejected a legitimate
 * historical row, so the assertion is on violating-row count.
 */
async function assertNewConstraintsAcceptExistingRows(sql) {
  // Coverage is derived from the catalog, never assumed: every public table
  // that holds rows is evaluated, so a populated table cannot silently escape
  // this section.
  const populated = await sql`
    SELECT c.relname AS name
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `;
  const evaluation = [];
  for (const { name } of populated) {
    const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM public.${name}`);
    if (row.n === 0) continue;
    evaluation.push(name);
  }
  assert(
    evaluation.length > 0,
    "no public table holds rows, so the constraint evaluation would be vacuous",
  );
  const unprojected = evaluation.filter((table) => !SURVIVAL_PROJECTIONS[table]);
  assert(
    unprojected.length === 0,
    `these populated public tables have no column projection and so cannot be evaluated: ${unprojected.join(", ")}`,
  );

  let constraintCount = 0;
  let evaluatedRows = 0;
  const notValidConstraints = [];
  for (const table of evaluation) {
    const checks = await sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
      FROM pg_constraint
      WHERE conrelid = to_regclass(${`public.${table}`}) AND contype = 'c'
      ORDER BY conname
    `;
    const [totals] = await sql.unsafe(`SELECT count(*)::int AS n FROM public.${table}`);
    assert(totals.n > 0, `${table}: no rows to evaluate constraints against`);
    for (const check of checks) {
      // pg_get_constraintdef appends " NOT VALID" for a constraint added
      // NOT VALID, so anchoring the closing paren at end-of-string made every
      // such constraint unparseable - and an unreadable constraint is an
      // unproven one, silently skipped rather than reported.
      const match = /^CHECK \((.*)\)( NOT VALID)?$/s.exec(check.definition);
      assert(
        match,
        `${table}: could not parse CHECK ${check.conname} from ${check.definition}`,
      );
      // A NOT VALID constraint was never checked against the rows that already
      // existed. Evaluating it here proves what 0074-style constraints actually
      // say about historical data, which the catalog alone does not record.
      if (match[2]) notValidConstraints.push(`${table}.${check.conname}`);
      const rows = await sql.unsafe(`
        SELECT
          count(*)::int AS evaluated,
          count(*) FILTER (WHERE NOT (${match[1]}))::int AS violating,
          count(*) FILTER (WHERE (${match[1]}) IS NULL)::int AS null_predicate
        FROM public.${table}
      `);
      constraintCount += 1;
      evaluatedRows += rows[0].evaluated;
      assert(
        rows[0].violating === 0,
        `${table}: ${check.conname} rejects ${rows[0].violating} historically valid seeded row(s): ${check.definition}`,
      );
      assert(
        rows[0].null_predicate === 0,
        `${table}: ${check.conname} evaluates to NULL for ${rows[0].null_predicate} seeded row(s), which a CHECK treats as satisfied`,
      );
    }
  }

  const notNull = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND is_nullable = 'NO'
      AND table_name = ANY(${sql.array(evaluation)})
    ORDER BY table_name, column_name
  `;
  for (const column of notNull) {
    const rows = await sql.unsafe(
      `SELECT count(*) FILTER (WHERE ${column.column_name} IS NULL)::int AS nulls FROM public.${column.table_name}`,
    );
    assert(
      rows[0].nulls === 0,
      `${column.table_name}.${column.column_name} is NOT NULL but holds ${rows[0].nulls} NULL(s) among the seeded rows`,
    );
  }
  log(
    "CONSTRAINTS-OK",
    `${constraintCount} CHECK constraints evaluated over ${evaluatedRows} row evaluations across ${evaluation.length} populated tables found zero violations and zero NULL predicates; ${notNull.length} NOT NULL columns hold zero NULLs.${
      notValidConstraints.length
        ? ` ${notValidConstraints.length} constraint(s) are NOT VALID, so the catalog records no validation of the rows that predate them; they were evaluated here against the seeded corpus and hold: ${notValidConstraints.join(", ")}.`
        : ""
    }`,
  );
}

/**
 * 0074's five NOT VALID pairing constraints, asserted as they actually stand on
 * the realistic seeded corpus.
 *
 * WHY NOT VALID IS THE CORRECT FINAL STATE, not an unfinished state. The
 * lifecycle ADD NOT VALID -> prove existing rows -> VALIDATE only reaches
 * VALIDATE when existing rows are provably conforming. They are NOT, and the
 * reason is not hypothetical: on the journal as it stood at 0072 - which is what
 * every deployment runs, because the fencing columns arrived in 0059 and 0069
 * deliberately put both of them in private.mcp_insertable_columns() - an MCP
 * principal holding the ordinary create permission can INSERT one half of the
 * pair on its own, and the row lands. mcp-operation-fence-verify.mjs reproduces
 * that hole as PAIRING-RED. So a deployment that took MCP writes before 0074 may
 * legitimately hold such a row, and a migration that VALIDATEs would refuse to
 * apply to exactly those deployments.
 *
 * WHAT IS PROVEN INSTEAD, which is the security property that actually matters:
 * the constraint is enforced for every new write from the moment it exists, in
 * both directions and on UPDATE, so no NEW partial identity can be created. What
 * NOT VALID declines to do is scan the rows that predate it, and it therefore
 * leaves those rows alone instead of rewriting or deleting domain data - which
 * is why the constraint stays NOT VALID rather than being dropped and re-added
 * as VALID.
 *
 * The predicate is compared flattened (no whitespace, quotes or parentheses)
 * rather than verbatim, for the reason mcp-operation-fence-verify.mjs documents:
 * a reworded-but-equivalent predicate is not a failure, a different predicate is.
 */
async function assertIdentityPairNotValid(sql, boundary) {
  const tables = seededTablesFor(boundary).filter((table) =>
    IDENTITY_PAIR_TABLES.some((entry) => entry.table === table),
  );
  assert(
    tables.length === IDENTITY_PAIR_TABLES.length,
    `expected all ${IDENTITY_PAIR_TABLES.length} pairing tables in the seeded corpus, got ${tables.length}`,
  );

  // The seeded corpus is the realistic case: no row carries a partial identity,
  // because every shipped writer emits both columns or neither (proved from the
  // write paths in the 0074 header). Asserted from the DATA, not assumed, so a
  // future fixture change cannot quietly turn this into the legacy case.
  const existingViolations = await runHeaderPreflight(
    sql,
    PAIRING_MIGRATION,
    "SELECT 'projects' AS table_name",
  );
  assert(
    existingViolations.length === 0,
    `the realistic seeded corpus already holds ${existingViolations.length} partial-identity row(s): ${JSON.stringify(
      existingViolations,
    )}. Either the fixture stopped being realistic, or this section is no longer testing what it claims.`,
  );

  let refusals = 0;
  for (const entry of IDENTITY_PAIR_TABLES) {
    const catalog = await sql.unsafe(
      `SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
         FROM pg_constraint
        WHERE conrelid = to_regclass('public.${entry.table}') AND conname = $1`,
      [entry.constraint],
    );
    assert(
      catalog.length === 1,
      `${entry.table} must carry exactly one ${entry.constraint}; found ${catalog.length}`,
    );
    const definition = catalog[0].definition;
    const match = /^CHECK \((.*)\)( NOT VALID)?$/s.exec(definition);
    assert(match, `${entry.table}.${entry.constraint} is not a parsable CHECK: ${definition}`);
    assert(
      flatten(match[1]) === flatten(PAIRING_PREDICATE),
      `${entry.table}.${entry.constraint} must require exactly "${PAIRING_PREDICATE}"; it requires ${match[1]}`,
    );
    // The final state itself, asserted rather than described. A migration that
    // silently validated the constraint (or dropped it) changes what this file
    // can claim about pre-0074 rows, so it has to fail here.
    assert(
      catalog[0].convalidated === false,
      `${entry.table}.${entry.constraint} is recorded as VALIDATED (convalidated=true). 0074 is deliberately NOT VALID because a deployment that took MCP writes before it can legitimately hold a partial-identity row; see this section's header. If that has changed, this assertion and 0074's own rationale must both be revisited together.`,
    );
    assert(
      definition.includes("NOT VALID"),
      `${entry.table}.${entry.constraint} lost its NOT VALID marker in the catalog: ${definition}`,
    );

    // Enforced for new writes, BOTH directions. Each case names the constraint
    // it was refused by, so a refusal from any other gate cannot stand in.
    const id = deterministicUuid(`identity-pair-${entry.table}`);
    const values = entry.values({ id, owner: OWNER_A, tag: entry.table, projectId: PROJECT_A, taskId: TASK_A });
    const halves = [
      {
        label: "operation id only",
        columns: `${entry.columns}, mcp_operation_id`,
        extra: `'${DETERMINISTIC_OPERATION_ID}'::uuid`,
      },
      {
        label: "client id only",
        columns: `${entry.columns}, mcp_client_id`,
        extra: `'identity-pair-client'`,
      },
    ];
    for (const half of halves) {
      const refusal = await refusedBy(sql, () =>
        sql.unsafe(
          `INSERT INTO public.${entry.table} (${half.columns}) VALUES (${values}, ${half.extra})`,
        ),
      );
      assert(
        refusal.code === "23514",
        `${entry.table}: an INSERT carrying a ${half.label} must be refused with 23514 while 0074's constraint is NOT VALID; got ${refusal.describe()}`,
      );
      // Named, not matched: a refusal from any other gate on this table must
      // not be able to stand in for the pairing constraint.
      assert(
        refusal.constraint === entry.constraint,
        `${entry.table}: a ${half.label} INSERT must be refused by exactly ${entry.constraint}; got ${refusal.describe()}`,
      );
      refusals += 1;
    }

    // And the accepted half of the contract: a COMPLETE identity must still
    // insert, so the constraint is not simply refusing all MCP writes. The
    // accepted row is read back so the acceptance is observed, not inferred
    // from the absence of an exception.
    const complete = await inRolledBackTransactionReturning(sql, (tx) =>
      tx.unsafe(
        `INSERT INTO public.${entry.table} (${entry.columns}, mcp_operation_id, mcp_client_id)
         VALUES (${values}, '${DETERMINISTIC_OPERATION_ID}'::uuid, 'identity-pair-client')
         RETURNING id, mcp_operation_id, mcp_client_id`,
      ),
    );
    assert(
      complete.length === 1,
      `${entry.table}: a COMPLETE operation identity must still be accepted; got ${complete.length} row(s)`,
    );
    assert(
      complete[0].mcp_client_id === "identity-pair-client" && complete[0].mcp_operation_id !== null,
      `${entry.table}: the accepted complete identity did not carry both halves: ${JSON.stringify(complete[0])}`,
    );
    refusals += 1;

    // UPDATE cannot open a hole either: setting one half of a NULL/NULL pair on
    // a row that already exists makes that row partial, and NOT VALID does not
    // exempt UPDATE. Rolled back, so the seeded corpus stays as DATA-SURVIVAL
    // and TAIL-REAPPLY recorded it.
    const updateRefusal = await refusedBy(sql, () =>
      sql.unsafe(
        `UPDATE public.${entry.table}
            SET mcp_operation_id = '${DETERMINISTIC_OPERATION_ID}'::uuid
          WHERE owner_user_id = '${OWNER_A}'::uuid
          RETURNING id`,
      ),
    );
    assert(
      updateRefusal.code === "23514",
      `${entry.table}: an UPDATE that makes an existing row's identity partial must be refused with 23514 under NOT VALID; got ${updateRefusal.describe()}`,
    );
    assert(
      updateRefusal.constraint === entry.constraint,
      `${entry.table}: that UPDATE must be refused by exactly ${entry.constraint}; got ${updateRefusal.describe()}`,
    );
    refusals += 1;
  }

  const stillClean = await runHeaderPreflight(sql, PAIRING_MIGRATION, "SELECT 'projects' AS table_name");
  assert(
    stillClean.length === 0,
    `the pairing pre-flight reported ${stillClean.length} partial-identity row(s) after the probes: ${JSON.stringify(stillClean)}`,
  );
  log(
    "IDENTITY-PAIR",
    `boundary ${boundary}: ${IDENTITY_PAIR_TABLES.length} pairing constraints each require exactly "${PAIRING_PREDICATE}", each recorded convalidated=false with its NOT VALID marker intact, ${refusals} enforced writes refused (INSERT of either half on all 5 tables, the complete pair accepted on all 5, and the half-setting UPDATE on all 5), and 0074's own header pre-flight returns 0 row(s) both before and after them.`,
  );
}

/**
 * The crispest form of "authority does not widen": the five permissions that
 * ONLY permissions_version 2 documents carry must resolve false for every
 * permissions_version 1 grant, before and after the tail.
 */
async function assertNoV2AuthorityLeakedIntoV1(sql, grants) {
  const v2Only = ["friction.read", "inbox.read", "notifications.read", "operator.read", "workload.read"];
  for (const grant of grants.filter((entry) => entry.canonical)) {
    assert(
      grant.permissions.every((permission) => !v2Only.includes(permission)),
      `fixture grant ${grant.client} is labelled v1 but carries a v2-only permission`,
    );
    for (const permission of v2Only) {
      const resolved = await mcpSession(sql, { userId: grant.owner, clientId: grant.client }).run(async (tx) => {
        const [row] = await tx`SELECT private.has_active_mcp_permission(${permission}) AS granted`;
        return row.granted;
      });
      assert(
        resolved === false,
        `v1 grant ${grant.client} resolved the permissions_version 2 capability ${permission}`,
      );
    }
  }
  log(
    "AUTHORITY-EQ",
    `${grants.filter((entry) => entry.canonical).length} v1 grant(s) resolved none of the ${v2Only.length} permissions_version 2 capabilities (${v2Only.join(", ")}).`,
  );
}

/**
 * Existing rows stay usable from an ordinary authenticated session. Proved by
 * observable row counts on SELECT and on UPDATE with RETURNING, so an
 * implementation that silently filters every row cannot pass.
 */
async function assertDirectUserUsability(sql) {
  const direct = directUserSession(sql, { userId: OWNER_A });

  // One row-count probe and, where the table has a single-column key, one
  // UPDATE ... RETURNING, so the effect is observable rather than inferred
  // from the absence of an exception.
  const expectations = [
    { table: "projects", expected: 2, key: "id", update: "description", value: "'direct-user edit'" },
    { table: "goals", expected: 2, key: "id", update: "next_step", value: "'direct user wrote this'" },
    { table: "tasks", expected: 3, key: "id", update: "description", value: "'direct user wrote this'" },
    // task_sessions, notification_devices, notification_deliveries and
    // inbox_idempotency_keys carry no client UPDATE policy by design: the
    // timer RPC, the device-claim RPC, the delivery worker and the inbox
    // conversion own them. They are probed for SELECT only, and the SELECT
    // row count is the assertion that existing rows remain visible.
    { table: "task_sessions", expected: 2, key: "id", update: null, value: null },
    { table: "task_reminders", expected: 2, key: "id", update: "failure_reason", value: "'direct user note'" },
    { table: "notifications", expected: 2, key: "id", update: "body", value: "'direct user read it'" },
    { table: "notification_preferences", expected: 1, key: "owner_user_id", update: "email_enabled", value: "false" },
    { table: "notification_devices", expected: 2, key: "id", update: null, value: null },
    { table: "notification_deliveries", expected: 2, key: "id", update: null, value: null },
    { table: "user_time_context", expected: 1, key: "user_id", update: "iana_timezone", value: "'Europe/Paris'" },
    { table: "operator_proposals", expected: 2, key: "id", update: "ai_ref", value: "'direct-user-ref'" },
    { table: "inbox_idempotency_keys", expected: 2, key: "id", update: null, value: null },
    { table: "idea_notes", expected: 2, key: "id", update: "body", value: "'direct user edited this'" },
    { table: "task_recurrences", expected: 1, key: "id", update: "last_generated_at", value: "'2026-03-06 09:00:00+00'" },
    // agent_integration_events is the append-only audit ledger: readable by its
    // owner, writable only through the SECURITY DEFINER RPCs.
    { table: "agent_integration_events", expected: 1, key: "id", update: null, value: null },
  ];
  let updated = 0;

  await direct.run(async (tx) => {
    for (const expectation of expectations) {
      const visible = await tx.unsafe(`SELECT count(*)::int AS n FROM public.${expectation.table}`);
      assert(
        visible[0].n === expectation.expected,
        `direct user must see ${expectation.expected} row(s) in ${expectation.table}, saw ${visible[0].n}`,
      );
      if (!expectation.update) continue;
      const target = await tx.unsafe(
        `SELECT ${expectation.key} AS k FROM public.${expectation.table} LIMIT 1`,
      );
      assert(target[0]?.k, `${expectation.table} held no row to update`);
      const rows = await tx.unsafe(
        `UPDATE public.${expectation.table}
            SET ${expectation.update} = ${expectation.value}
          WHERE ${expectation.key} = $1
          RETURNING ${expectation.key}`,
        [target[0].k],
      );
      assert(
        rows.length === 1,
        `direct user UPDATE on ${expectation.table}.${expectation.update} affected ${rows.length} rows, expected 1`,
      );
      updated += 1;
    }
  });

  // The scheduling/calendar columns 0064 fences for MCP principals are exactly
  // the columns an ordinary owner session must still be free to write.
  const scheduled = await direct.run(async (tx) =>
    tx.unsafe(
      `UPDATE public.tasks
          SET scheduled_start_at = '2026-04-01 09:00:00+00',
              scheduled_end_at = '2026-04-01 10:00:00+00',
              calendar_sync_status = 'pending',
              calendar_reminder_minutes = 5
        WHERE id = '${TASK_A}'::uuid
        RETURNING scheduled_start_at, scheduled_end_at, calendar_sync_status, calendar_reminder_minutes`,
    ),
  );
  assert(scheduled.length === 1, `direct user could not reschedule its own task (${scheduled.length} rows)`);
  assert(
    scheduled[0].calendar_reminder_minutes === 5 && scheduled[0].calendar_sync_status === "pending",
    "direct user scheduling write did not take effect",
  );

  // And a direct user must still be able to reopen its own completed task,
  // which is the one transition 0063's normalize trigger performs.
  const reopened = await direct.run(async (tx) =>
    tx.unsafe(
      `UPDATE public.tasks SET status = 'todo' WHERE id = '${TASK_A_DONE}'::uuid RETURNING status, completed_at`,
    ),
  );
  assert(reopened.length === 1, `direct user could not reopen its own completed task (${reopened.length} rows)`);
  assert(reopened[0].completed_at === null, "reopening a task must clear completed_at");

  // Owner B must be unaffected by owner A's session: no cross-tenant write.
  const crossTenant = await capturePostgresError(() =>
    directUserSession(sql, { userId: OWNER_B }).run(async (tx) =>
      tx.unsafe(`UPDATE public.projects SET description = 'cross tenant' WHERE id = '${PROJECT_A}'::uuid RETURNING id`),
    ),
  );
  assert(
    crossTenant === null,
    `owner B must not be able to update owner A's project (SQLSTATE ${crossTenant})`,
  );
  const stillOwned = await sql`SELECT description FROM public.projects WHERE id = ${PROJECT_A}::uuid`;
  assert(
    stillOwned[0].description !== "cross tenant",
    "a cross-tenant write reached owner A's project",
  );

  log(
    "DIRECT-USER",
    `${expectations.length} owner-scoped tables readable, ${updated} updated with observable effect, scheduling columns writable, a completed task reopenable, and a cross-tenant write changed nothing.`,
  );
}

async function grantRowCount(sql) {
  const [row] = await sql`SELECT count(*)::int AS n FROM public.mcp_authorization_grants`;
  return row.n;
}

async function constraintExists(sql, name) {
  const rows = await sql`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.mcp_authorization_grants'::regclass AND conname = ${name}
  `;
  return rows.length > 0;
}

async function assertUnknownDocumentsFailClosed(sql, boundary) {
  const before = await grantRowCount(sql);
  assert(before > 0, "grant table is empty, so UNKNOWN-FAIL would be vacuous");
  assert(
    await constraintExists(sql, "mcp_authorization_grants_profile_permissions_check"),
    "the permission-document CHECK is absent, so unknown documents would be accepted",
  );
  const v1ReadOnly = JSON.stringify(V1_READ_ONLY);

  // (a) unknown permission element, active row
  const unknownActive = await capturePostgresError(() =>
    sql.unsafe(
      `
      INSERT INTO public.mcp_authorization_grants (
        id, owner_user_id, oauth_client_id, resource_uri, status, permission_profile,
        permissions, permissions_version, approved_at
      )
      VALUES (
        '5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b01'::uuid, '${OWNER_A}'::uuid, 'unknown-shape', '${RESOURCE_URI}',
        'active', 'read_only', '["projects.read","unknown.permission"]'::jsonb, 1, now()
      )
    `,
    ),
  );
  assert(unknownActive === "23514", `unknown active permission document must fail closed, got SQLSTATE ${unknownActive}`);

  // (b) unknown permission element, terminal row
  const unknownTerminal = await capturePostgresError(() =>
    sql.unsafe(
      `
      INSERT INTO public.mcp_authorization_grants (
        id, owner_user_id, oauth_client_id, resource_uri, status, permission_profile,
        permissions, permissions_version, revoked_at
      )
      VALUES (
        '5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b02'::uuid, '${OWNER_A}'::uuid, 'unknown-shape-terminal', '${RESOURCE_URI}',
        'revoked', 'read_only', '["projects.read","unknown.permission"]'::jsonb, 1, now()
      )
    `,
    ),
  );
  assert(unknownTerminal === "23514", `unknown terminal permission document must fail closed, got SQLSTATE ${unknownTerminal}`);

  // (c) an unknown permissions_version is refused as well, so a future version
  // cannot be smuggled in through the same door.
  const unknownVersion = await capturePostgresError(() =>
    sql.unsafe(
      `
      INSERT INTO public.mcp_authorization_grants (
        id, owner_user_id, oauth_client_id, resource_uri, status, permission_profile,
        permissions, permissions_version, approved_at
      )
      VALUES (
        '5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b03'::uuid, '${OWNER_A}'::uuid, 'unknown-version', '${RESOURCE_URI}',
        'active', 'read_only', ${`'${v1ReadOnly}'`}::jsonb, 7, now()
      )
    `,
    ),
  );
  assert(unknownVersion === "23514", `an unknown permissions_version must fail closed, got SQLSTATE ${unknownVersion}`);

  // (d) editing an existing healthy grant into an unknown shape is refused and
  // the stored document survives the attempt.
  const scoped = grantsForBoundary(boundary);
  const survivor =
    scoped.find((grant) => grant.canonical && grant.status === "active")
    ?? scoped.find((grant) => grant.status === "active" || grant.status === "pending")
    ?? scoped[0];
  assert(survivor, `no fixture grant is available at boundary ${boundary} to prove an in-place edit is refused`);
  const updateCode = await capturePostgresError(() =>
    sql.unsafe(
      `UPDATE public.mcp_authorization_grants
          SET permissions = '["projects.read","unknown.permission"]'::jsonb
        WHERE id = '${survivor.id}'::uuid`,
    ),
  );
  assert(updateCode === "23514", `editing a grant into an unknown document must fail closed, got SQLSTATE ${updateCode}`);
  const [after] = await sql`
    SELECT permissions FROM public.mcp_authorization_grants WHERE id = ${survivor.id}::uuid
  `;
  assert(
    JSON.stringify(after.permissions) === JSON.stringify(survivor.permissions),
    `a refused UPDATE still changed ${survivor.client}'s stored document`,
  );

  const afterCount = await grantRowCount(sql);
  assert(afterCount === before, `refused inserts changed the grant row count (${before} -> ${afterCount})`);
  assert(
    await constraintExists(sql, "mcp_authorization_grants_profile_permissions_check"),
    "the permission-document CHECK vanished after the refused inserts",
  );
  log(
    "UNKNOWN-FAIL",
    `boundary ${boundary}: unknown element (active), unknown element (terminal), unknown version and in-place document edit all refused with 23514; row count held at ${afterCount} and the CHECK is still present.`,
  );
}

/**
 * The reach census.
 *
 * `has_active_mcp_permission` resolves a grant's AUTHORITY, not what the grant
 * can actually reach. A migration that re-keys a policy onto a permission a v1
 * document already holds would widen reach while leaving the resolved
 * permission set identical, and an authority-set comparison alone would stay
 * green. So for every active v1 grant this records, as that principal, which
 * tables return rows and whether a benign write to each is accepted.
 *
 * Reach is NOT expected to be identical across the tail: 0065 deliberately
 * closes seven tables that 0045-0049 had left readable and writable by every
 * MCP bearer, and opens one it previously could not read. So the assertion is
 * against the DECLARED movement - exactly the closures and the single opening
 * 0065 documents - and any movement outside that set fails. Recording the
 * before/after pair is what makes a re-keyed policy visible: it would show up
 * as an undeclared movement.
 *
 * `WHERE false` keeps the write probe inert while still evaluating the
 * policy's WITH CHECK, and every probed table is granted to `authenticated`
 * first so a refusal is a policy decision rather than a missing ACL.
 */
const REACH_PROBES = [
  { table: "projects" },
  { table: "goals" },
  { table: "tasks" },
  { table: "task_sessions" },
  { table: "task_reminders" },
  { table: "task_recurrences" },
  { table: "task_external_refs" },
  { table: "task_saved_views" },
  { table: "week_reviews" },
  { table: "idea_notes" },
  { table: "inbox_idempotency_keys" },
  { table: "notifications" },
  { table: "notification_devices" },
  { table: "notification_deliveries" },
  { table: "notification_preferences" },
  { table: "user_time_context" },
  { table: "operator_proposals" },
  { table: "calendar_integration_settings" },
  { table: "calendar_sync_jobs" },
  { table: "agent_integration_events" },
  { table: "mcp_authorization_grants" },
];

/** Created by the tail, so absent at the boundary and probed only afterwards. */
const REACH_TAIL_PROBES = [
  { table: "mcp_mutation_receipts" },
  { table: "mcp_rate_limit_windows" },
];

/**
 * Tables 0065 declares it seals from every v1 bearer, because 0045-0049 created
 * them with permissive owner policies and no client_id gate. Their new
 * mcp_*_access policies are all gated on permissions_version 2 capabilities no
 * v1 document holds, so read and write both go to zero rows.
 */
const REACH_SEALED_BY_0065 = [
  "notifications",
  "notification_devices",
  "notification_deliveries",
  "notification_preferences",
  "inbox_idempotency_keys",
  "operator_proposals",
];

/**
 * The one table 0065 seals only in part: user_time_context keeps an MCP READ
 * path, because today.read is a v1 capability and ega_get_today_plan needs the
 * owner's timezone. Only the WRITE is closed - a timezone is a device setting,
 * not a workspace mutation. Treating this as fully sealed would assert a
 * closure 0065 explicitly did not make.
 */
const REACH_WRITE_SEALED_BY_0065 = { table: "user_time_context", retainedBy: "today.read" };

/** The one table 0065 opens, read-only, under a permission every v1 document holds. */
const REACH_OPENED_BY_0065 = { table: "task_recurrences", permission: "tasks.read" };

/**
 * The one table the tail opens for WRITE, and this is the only assertion in the
 * file that expects authority to GROW.
 *
 * 0069 finding F-6 closed a real defect: task_reminders had NO MCP UPDATE
 * policy at all, so ega_cancel_task_reminder - an advertised tool - matched
 * zero rows under RLS and reported success while changing nothing. 0069 added
 * `task_reminders_mcp_update_access`, owner-scoped, client-gated, and gated on
 * `tasks.update`.
 *
 * Widening for a permission the principal ALREADY held is not a grant of new
 * authority: the v1 task_manager and workspace_manager documents carry
 * `tasks.update` before and after, which AUTHORITY-EQ asserts independently.
 * What the tail changed is reach, not authority - a previously inoperable tool
 * became operable by the principals who were always entitled to use it.
 *
 * The declaration is deliberately keyed on the PERMISSION, not on the client,
 * so it is discriminating in both directions:
 *   - a grant holding `tasks.update` must now be writable, or 0069's fix is
 *     absent/reverted and this fails;
 *   - a grant WITHOUT `tasks.update` must still be refused, or 0069 opened the
 *     table unconditionally and this fails.
 * A blanket allow or a blanket deny both fail. `canon-read` (read_only, no
 * `tasks.update`) is the negative case and is part of activeCanonical, so it is
 * always in the census.
 */
const REACH_WRITE_OPENED_BY_0069 = { table: "task_reminders", permission: "tasks.update" };

/**
 * Updatatable, non-generated columns per table, straight from the catalog.
 * Identity columns are excluded because Postgres forbids assigning them; every
 * other column is probed, so the census is column-complete rather than
 * sampling one representative column.
 */
async function updatableColumns(sql, table) {
  const rows = await sql.unsafe(`
    SELECT a.attname
    FROM pg_attribute AS a
    WHERE a.attrelid = to_regclass('public.${table}')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attidentity = ''
      AND a.attgenerated = ''
      AND a.attname <> 'owner_user_id'
      AND a.attname <> 'user_id'
    ORDER BY a.attname
  `);
  assert(rows.length > 0, `${table}: catalog returned no updatable columns to probe`);
  return rows.map((row) => row.attname);
}

async function resolveProbes(sql, probes) {
  const resolved = [];
  for (const probe of probes) {
    const exists = await sql.unsafe(`SELECT to_regclass('public.${probe.table}') IS NOT NULL AS present`);
    if (!exists[0].present) continue;
    resolved.push({ ...probe, columns: await updatableColumns(sql, probe.table) });
  }
  return resolved;
}

async function reachCensus(sql, grants, probes) {
  const census = new Map();
  for (const grant of grants) {
    const observed = {};
    await mcpSession(sql, { userId: grant.owner, clientId: grant.client }, { rollback: true }).run(async (tx) => {
      for (const probe of probes) {
        let read;
        try {
          const rows = await tx.unsafe(`SELECT count(*)::int AS n FROM public.${probe.table}`);
          read = `rows=${rows[0].n}`;
        } catch (error) {
          read = `refused:${error?.code ?? "UNKNOWN"}`;
        }
        // `SET col = col` is a real write with an unchanged value: it mutates
        // no data yet exercises the UPDATE policy's WITH CHECK, and RETURNING
        // makes the outcome observable. Probing with `WHERE false` instead
        // would match no row and so could not distinguish "writable" from
        // "silently filtered" - which is exactly the difference under test.
        //
        // Every updatable column is probed, NOT one representative column, so a
        // per-column ACL or per-column RLS difference cannot hide behind a
        // sample. It also lets the declarations below be checked in both
        // directions per column rather than once per table.
        //
        // WHAT THIS PROBE STILL CANNOT SEE, so nobody re-derives the same false
        // conclusion: it observes the ACL and RLS layers only. 0071's write fence
        // is a trigger, and its UPDATE branch builds its refusal set from
        // columns whose value actually CHANGED
        // (`v_new -> col IS DISTINCT FROM v_old -> col`). `SET col = col`
        // therefore trips no fence at all, so `private.mcp_writable_columns()`
        // is invisible here. Measured, on this journal: removing 'updated_at'
        // from `private.mcp_writable_columns('tasks')` leaves this census GREEN
        // - every one of tasks' 27 columns still reports `writable` - and it
        // does the same for 'completed_at', which 0071 deliberately refuses to
        // authorise. Closing that needs either a value-changing probe or an
        // independent declaration of the intended write surface to compare
        // against; neither exists in this file today.
        //
        // A column-level privilege change is also masked here: the GRANT below
        // is table-level, and PostgreSQL ignores a column-level REVOKE once a
        // table-level grant exists (`attacl` stays empty), so no per-column ACL
        // variation is observable under it.
        const writeByColumn = {};
        for (const column of probe.columns) {
          try {
            const rows = await tx.unsafe(
              `UPDATE public.${probe.table} SET ${column} = ${probe.table}.${column} RETURNING 1`,
            );
            writeByColumn[column] = rows.length > 0 ? "writable" : "filtered";
          } catch (error) {
            writeByColumn[column] = `refused:${error?.code ?? "UNKNOWN"}`;
          }
        }
        const writable = Object.entries(writeByColumn).filter(([, value]) => value === "writable").map(([column]) => column);
        observed[probe.table] = {
          read,
          writable: writable.sort().join(","),
          writeByColumn,
        };
      }
    });
    census.set(grant.client, observed);
  }
  return census;
}

/**
 * Every per-column outcome that moved, plus the table-level read movement.
 * Column-level granularity is what makes a single-column allowlist change
 * visible; a table-level "writable/not writable" summary is not.
 */
function censusDiffs(before, after) {
  const diffs = [];
  for (const [client, beforeTables] of before) {
    const afterTables = after.get(client) ?? {};
    for (const [table, value] of Object.entries(beforeTables)) {
      const now = afterTables[table];
      if (now === undefined) continue;
      if (now.read !== value.read) {
        diffs.push({ client, table, kind: "read", before: value.read, after: now.read });
        continue;
      }
      for (const column of Object.keys(value.writeByColumn)) {
        const previous = value.writeByColumn[column];
        const current = now.writeByColumn[column];
        if (previous !== current) {
          diffs.push({ client, table, kind: "write", column, before: previous, after: current });
        }
      }
    }
  }
  return diffs;
}

function describeDiff(diff) {
  return diff.kind === "read"
    ? `${diff.client}.${diff.table} read ${diff.before} -> ${diff.after}`
    : `${diff.client}.${diff.table}.${diff.column} ${diff.before} -> ${diff.after}`;
}

/**
 * Named artefacts each tail file installs. Asserted so a green run cannot be
 * explained by the tail having silently done nothing: the boundary catalog
 * genuinely lacks all of these.
 */
async function assertTailArtifactsInstalled(sql) {
  const checks = await sql`
    SELECT
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname = 'enforce_mcp_write_fence') AS fence_fn,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname = 'mcp_insertable_columns') AS insertable_fn,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname = 'mcp_known_fenced_columns') AS known_columns_fn,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname = 'user_owns_task') AS referential_fn,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname = 'is_registered_mcp_tool') AS tool_allowlist_fn,
      (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%\_mcp\_write\_fence') AS fence_triggers,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        AND policyname LIKE '%direct\_user%') AS direct_user_policies,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        AND policyname LIKE '%mcp%') AS mcp_policies,
      (SELECT count(*)::int FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'mcp_operation_id') AS fence_columns,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        AND policyname = 'task_reminders_mcp_delete_access') AS reminder_delete_policy,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
        AND policyname = 'task_sessions_mcp_write_access') AS broad_timer_write_policy,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'consume_mcp_rate_limit'
          AND pg_get_function_identity_arguments(p.oid) = 'p_window_name text') AS single_arg_limiter,
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'consume_mcp_rate_limit'
          AND pg_get_function_identity_arguments(p.oid) = 'p_window_name text, p_limit integer, p_window_seconds integer') AS caller_controlled_limiter
  `;
  const row = checks[0];
  const expected = {
    fence_fn: 1,
    insertable_fn: 1,
    known_columns_fn: 1,
    referential_fn: 1,
    tool_allowlist_fn: 1,
    fence_triggers: 5,
    reminder_delete_policy: 0,
    // 0053 split this FOR ALL timer write policy into INSERT/UPDATE so 0070
    // could attach referential ownership to it. Its survival would mean the
    // split never happened.
    broad_timer_write_policy: 0,
    single_arg_limiter: 1,
    caller_controlled_limiter: 0,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert(row[name] === value, `tail artefact ${name}: expected ${value}, got ${row[name]}`);
  }
  assert(row.direct_user_policies > 0, "the tail installed no direct-user policies");
  assert(row.mcp_policies > 0, "the tail installed no MCP policies");
  assert(row.fence_columns >= 5, `expected the fencing columns on five tables, found ${row.fence_columns}`);
  log(
    "TAIL-INSTALLED",
    `fence functions + ${row.fence_triggers} write-fence triggers, ${row.mcp_policies} MCP and ${row.direct_user_policies} direct-user policies, ${row.fence_columns} fencing columns, single-argument rate limiter present and the caller-controlled overload gone.`,
  );
}

/**
 * Re-applying the tail.
 *
 * What is asserted, and why only that:
 *
 *  - The tail is UP-ONLY. It is applied forward exactly once, and this
 *    boundary run already proved every file applies cleanly over existing
 *    data. Nothing here re-asserts that.
 *  - A re-applied file can never touch DATA. Every tail file is swept again
 *    and every failure must be a duplicate-object SQLSTATE, and every seeded
 *    table digest must be unchanged. This is the property that actually
 *    protects a database if the journal is ever replayed, and it is the one
 *    the non-idempotent DDL below cannot break, because those statements
 *    abort before writing.
 *  - The set of files that REFUSE a re-apply is pinned exactly. 0053, 0064
 *    and 0065 use bare CREATE POLICY / CREATE TRIGGER with no matching DROP,
 *    so replaying the journal re-adds objects 0053/0071 had already removed.
 *    That deviation is measured and reported here rather than asserted away,
 *    and pinning the set means a newly non-idempotent tail file fails the
 *    proof instead of joining the list unnoticed.
 *
 * The catalog is deliberately NOT asserted to be replay-stable: see UNRESOLVED
 * in this file's header. The drift is measured and logged so it stays visible.
 */
async function assertTailReapplyIsDataSafe(sql, tags, boundary, tables, digestsBefore, catalogBefore) {
  const duplicateObjectCodes = new Set(["42710", "42P07", "42701", "42P06"]);
  const knownNonIdempotent = new Set([
    "0053_mcp_task_sessions_split",
    "0064_mcp_write_column_fence",
    "0065_mcp_oauth_table_scope_hardening",
  ]);
  const rejected = [];
  const boundaryIndex = tags.indexOf(boundary);
  for (const tag of tags.slice(boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    if (result.applied) continue;
    rejected.push({ tag, code: result.code });
  }

  const unexpected = rejected.filter((entry) => !duplicateObjectCodes.has(entry.code));
  assert(
    unexpected.length === 0,
    `replaying the tail raised a non-duplicate-object error, which could have written data: ${unexpected
      .map((entry) => `${entry.tag}=${entry.code}`)
      .join(", ")}`,
  );
  const refused = new Set(rejected.map((entry) => entry.tag));
  const newlyNonIdempotent = [...refused].filter((tag) => !knownNonIdempotent.has(tag));
  assert(
    newlyNonIdempotent.length === 0,
    `these tail files now refuse a re-apply and are not recorded as non-idempotent: ${newlyNonIdempotent.join(", ")}`,
  );

  for (const table of tables) {
    const now = await tableDigest(sql, table, SURVIVAL_PROJECTIONS[table]);
    const previous = digestsBefore.get(table);
    assert(
      now.digest === previous.digest,
      `replaying the tail mutated ${table} (digest ${previous.digest} -> ${now.digest})`,
    );
  }

  const catalogAfter = await catalogDigest(sql);
  const beforeLines = new Set(catalogBefore.split("\n"));
  const afterLines = new Set(catalogAfter.split("\n"));
  const added = [...afterLines].filter((line) => !beforeLines.has(line));
  const removed = [...beforeLines].filter((line) => !afterLines.has(line));
  log(
    "TAIL-REAPPLY",
    `${tags.length - boundaryIndex - 1} tail files replayed; ${refused.size} refused with duplicate-object errors [${[...refused].sort().join(", ") || "none"}]; every seeded data digest unchanged. Catalog drift from the replay: +${added.length} / -${removed.length} entries.`,
  );
  if (added.length > 0) {
    const addedPolicies = added.filter((line) => line.startsWith("P|")).map((line) => line.split("|").slice(0, 3).join("."));
    log("TAIL-REAPPLY", `replay re-added: ${addedPolicies.join(", ") || "(non-policy objects)"}`);
  }
  assert(
    added.length === 0 || refused.size > 0,
    "the catalog gained entries from a replay although no file refused, which is unexplained",
  );
}

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

/**
 * An unknown pre-0050 permission document fails 0050 closed ATOMICALLY. The
 * pre-0050 CHECK is dropped in this disposable database only, because a
 * conforming 0049 database cannot hold the row; that is exactly the
 * corruption/drift case the migration has to reject.
 */
async function assertAtomicFailureAt0050(sql, tags) {
  const boundaryIndex = tags.indexOf(PRE_HARDENING_BOUNDARY);
  await resetDatabase(sql);
  await applySupabaseShim(sql);
  for (const tag of tags.slice(0, boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(result.applied, `setup failed applying ${tag}: ${result.code}`);
  }

  const catalogBefore = await catalogDigest(sql);
  const rowsBefore = await dataDigests(sql, ALWAYS_SEEDED_TABLES);

  // Rows 0050's own UPDATE genuinely rewrites, so the rollback claim is
  // observable rather than vacuous. The corrupt row alone cannot prove
  // atomicity: 0050's UPDATE only matches LEGACY documents, so it never
  // touches the corrupt row, and a non-transactional application would leave
  // these siblings terminalised while the corrupt row stayed pristine - which
  // is exactly the partial-application state this assertion must reject.
  await sql.unsafe(`
    INSERT INTO public.mcp_authorization_grants (
      id, owner_user_id, oauth_client_id, resource_uri, client_name, status,
      permission_profile, permissions, permissions_version, approved_at
    ) VALUES
      ('5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c02'::uuid, '${OWNER_A}'::uuid,
       'legacy-read-active-pre0050', '${RESOURCE_URI}', 'legacy read',
       'active', 'read_only', '${JSON.stringify(LEGACY_READ_ONLY)}'::jsonb, 1, now()),
      ('5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c03'::uuid, '${OWNER_B}'::uuid,
       'legacy-task-active-pre0050', '${RESOURCE_URI}', 'legacy task',
       'active', 'task_manager', '${JSON.stringify(LEGACY_TASK_MANAGER)}'::jsonb, 1, now()),
      ('5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c04'::uuid, '${OWNER_A}'::uuid,
       'legacy-delivery-active-pre0050', '${RESOURCE_URI}', 'legacy delivery',
       'active', 'delivery_observer', '${JSON.stringify(LEGACY_DELIVERY_OBSERVER)}'::jsonb, 1, now())
  `);
  const rollbackTargets = [
    { client: "legacy-read-active-pre0050", expected: "active" },
    { client: "legacy-task-active-pre0050", expected: "active" },
    { client: "legacy-delivery-active-pre0050", expected: "active" },
  ];
  for (const target of rollbackTargets) {
    const [before] = await sql`
      SELECT status FROM public.mcp_authorization_grants WHERE oauth_client_id = ${target.client}
    `;
    assert(
      before?.status === target.expected,
      `rollback fixture ${target.client} did not seed as ${target.expected}, got ${before?.status}`,
    );
  }

  await sql.unsafe(`
    ALTER TABLE public.mcp_authorization_grants
      DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check
  `);
  const corruptId = "5c5c5c5c-5c5c-45c5-85c5-5c5c5c5c5c01";
  await sql.unsafe(`
    INSERT INTO public.mcp_authorization_grants (
      id, owner_user_id, oauth_client_id, resource_uri, client_name, status,
      permission_profile, permissions, permissions_version, approved_at
    )
    VALUES (
      '${corruptId}'::uuid, '${OWNER_A}'::uuid, 'unknown-pre-0050', '${RESOURCE_URI}',
      'corrupt fixture', 'active', 'read_only', '["projects.read","unknown.permission"]'::jsonb, 1, now()
    )
  `);
  const [corruptBefore] = await sql`
    SELECT status, permission_profile, permissions, permissions_version
    FROM public.mcp_authorization_grants WHERE id = ${corruptId}::uuid
  `;

  const result = await applyFileInTransaction(sql, "0050_mcp_workspace_manager");
  assert(!result.applied, "0050 accepted an unknown pre-0050 permission document");
  assert(
    result.code === "23514",
    `0050 must fail closed with 23514 on an unknown pre-0050 document, got ${result.code}`,
  );

  const [corruptAfter] = await sql`
    SELECT status, permission_profile, permissions, permissions_version
    FROM public.mcp_authorization_grants WHERE id = ${corruptId}::uuid
  `;
  assert(corruptAfter.status === corruptBefore.status, "a failed 0050 partially terminalized the corrupt row");
  assert(corruptAfter.permission_profile === corruptBefore.permission_profile, "a failed 0050 rewrote the corrupt profile");
  assert(
    JSON.stringify(corruptAfter.permissions) === JSON.stringify(corruptBefore.permissions),
    "a failed 0050 normalised the corrupt permission document",
  );
  assert(corruptAfter.permissions_version === corruptBefore.permissions_version, "a failed 0050 changed the corrupt version");

  // THE ATOMICITY ASSERTION. 0050's first statement DROPs
  // profile_permissions_check, and its own ADD later rejects the corrupt row,
  // so a non-transactional application leaves that CHECK permanently absent
  // and every legacy sibling terminalised. Comparing the whole catalog digest
  // catches both at once and is the discriminating form: the previous
  // "is the CHECK gone?" test passed non-transactionally for the wrong reason.
  //
  // The baseline is captured AFTER the deliberate test-only DROP above, since
  // that DROP models pre-existing drift rather than anything 0050 does.
  assert(
    !(await constraintExists(sql, "mcp_authorization_grants_profile_permissions_check")),
    "the test setup must remove the pre-0050 document CHECK so the corrupt row is insertable",
  );
  const catalogAtBaseline = await catalogDigest(sql);
  for (const target of rollbackTargets) {
    const [after] = await sql`
      SELECT status FROM public.mcp_authorization_grants WHERE oauth_client_id = ${target.client}
    `;
    assert(
      after?.status === target.expected,
      `a failed 0050 left ${target.client} at ${after?.status}: the file applied partially instead of rolling back whole`,
    );
  }
  const catalogAfter = await catalogDigest(sql);
  assert(
    catalogAfter === catalogAtBaseline,
    `a failed 0050 did not restore the schema it had already changed. Differences:\n${diffLines(catalogAtBaseline, catalogAfter).join("\n")}`,
  );
  const rowsAfter = await dataDigests(sql, ALWAYS_SEEDED_TABLES);
  for (const table of ALWAYS_SEEDED_TABLES) {
    assert(
      rowsAfter.get(table).digest === rowsBefore.get(table).digest,
      `a failed 0050 mutated ${table}`,
    );
  }
  assert(
    catalogBefore.includes("mcp_authorization_grants_profile_check"),
    "catalog snapshot did not capture the pre-0050 constraints",
  );
  log(
    "ATOMIC-0050",
    `unknown pre-0050 document refused 0050 with 23514; the corrupt row, ${rollbackTargets.length} legacy sibling grant(s) 0050's own UPDATE would have rewritten, every seeded table digest and the whole constraint catalog are unchanged, so the file rolled back whole.`,
  );
}

/**
 * A drifted permissions_version fails 0066 closed ATOMICALLY. This is the one
 * incompatibility the tail genuinely contains, and it is the fail-closed kind:
 * 0037 validated permissions_version only as an integer > 0, so a drifted row
 * is insertable at 0063, and 0066 must refuse the whole file rather than
 * silently accepting it.
 */
async function assertAtomicFailureAt0066(sql, tags) {
  const boundaryIndex = tags.indexOf(SURVIVAL_BOUNDARY);
  await resetDatabase(sql);
  await applySupabaseShim(sql);
  for (const tag of tags.slice(0, boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(result.applied, `setup failed applying ${tag}: ${result.code}`);
  }

  const driftedId = "5d5d5d5d-5d5d-45d5-85d5-5d5d5d5d5d01";
  await sql.unsafe(`
    INSERT INTO public.mcp_authorization_grants (
      id, owner_user_id, oauth_client_id, resource_uri, client_name, status,
      permission_profile, permissions, permissions_version, approved_at
    )
    VALUES (
      '${driftedId}'::uuid, '${OWNER_A}'::uuid, 'drifted-version', '${RESOURCE_URI}',
      'drift fixture', 'active', 'read_only', '${JSON.stringify(V1_READ_ONLY)}'::jsonb, 3, now()
    )
  `);
  const [versionCheckBefore] = await sql`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.mcp_authorization_grants'::regclass
      AND conname = 'mcp_authorization_grants_permissions_version_check'
  `;
  assert(
    versionCheckBefore.definition.includes("> 0"),
    `unexpected pre-0066 version CHECK: ${versionCheckBefore.definition}`,
  );
  const [profileCheckBefore] = await sql`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.mcp_authorization_grants'::regclass
      AND conname = 'mcp_authorization_grants_profile_permissions_check'
  `;

  const result = await applyFileInTransaction(sql, "0066_mcp_permission_version_2");
  assert(!result.applied, "0066 accepted a drifted permissions_version");
  assert(
    result.code === "23514",
    `0066 must fail closed with 23514 on a drifted permissions_version, got ${result.code}: ${result.message}`,
  );

  // Atomicity is the load-bearing claim here: 0066's first statement DROPs
  // both checks before it re-adds them, so a non-transactional application
  // would leave the table with NO permission-document CHECK at all.
  assert(
    await constraintExists(sql, "mcp_authorization_grants_profile_permissions_check"),
    "a failed 0066 left the permission-document CHECK uninstalled",
  );
  const [versionCheckAfter] = await sql`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.mcp_authorization_grants'::regclass
      AND conname = 'mcp_authorization_grants_permissions_version_check'
  `;
  assert(
    versionCheckAfter.definition === versionCheckBefore.definition,
    `a failed 0066 changed the version CHECK to ${versionCheckAfter.definition}`,
  );
  const [profileCheckAfter] = await sql`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.mcp_authorization_grants'::regclass
      AND conname = 'mcp_authorization_grants_profile_permissions_check'
  `;
  assert(
    profileCheckAfter.definition === profileCheckBefore.definition,
    "a failed 0066 changed the permission-document CHECK",
  );
  const [drifted] = await sql`
    SELECT permissions_version, status FROM public.mcp_authorization_grants WHERE id = ${driftedId}::uuid
  `;
  assert(drifted.permissions_version === 3, "a failed 0066 rewrote the drifted row");
  assert(drifted.status === "active", "a failed 0066 terminalized the drifted row");
  log(
    "ATOMIC-0066",
    "drifted permissions_version refused 0066 with 23514; both original CHECK definitions are byte-identical afterwards, so the file rolled back whole.",
  );
}

/**
 * The deliberately-VIOLATING legacy database.
 *
 * This section is what settles whether 0074's NOT VALID is the right FINAL state
 * or an unfinished state, and it settles it the only way that counts: by
 * constructing the legacy shape the 0072 journal actually admitted and watching
 * what happens to it.
 *
 * The rows are created AT THE BOUNDARY, before 0074 exists, which is precisely
 * how a real deployment came to hold them. Then the whole tail is applied over
 * them and four things are asserted:
 *
 *   1. The tail applies. 0074 in particular. A migration that had used the
 *      validated form would abort here with 23514 and leave the deployment
 *      unable to upgrade at all - which is why the constraint is NOT VALID.
 *   2. 0074's header pre-flight query, read OUT OF THE MIGRATION FILE, executes
 *      and names exactly the seeded rows and nothing else. If the documented
 *      query is ever broken again the way f8f81f4d had to fix 0077's, this fails
 *      by name instead of silently passing on a paraphrase.
 *   3. VALIDATE CONSTRAINT refuses with 23514 on every table holding a violating
 *      row, and succeeds on the tables holding none. That asymmetry is the whole
 *      cost of NOT VALID stated in one line: the constraint cannot promise the
 *      predicate holds for rows it was never shown.
 *   4. The violating rows survive byte-identical. 0074 must not rewrite or
 *      delete domain data, and the header says so; this is the assertion.
 *
 * The enforcement probe runs last, because it is the property NOT VALID does not
 * give up: a NEW partial identity is still refused with 23514 while a
 * pre-existing one is merely tolerated.
 */
async function assertIdentityPairToleratesLegacyViolations(sql, tags) {
  const boundaryIndex = tags.indexOf(SURVIVAL_BOUNDARY);
  await resetDatabase(sql);
  await applySupabaseShim(sql);
  for (const tag of tags.slice(0, boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(result.applied, `setup failed applying ${tag}: ${result.code}`);
  }
  await seedDomainRows(sql);
  await seedTaskStatusEvents(sql);
  await seedGrants(sql, SURVIVAL_BOUNDARY);

  // Seed the legacy violating shape BEFORE 0074 exists: exactly one half of the
  // identity, which is what a 0069-journal deployment admitted and what the 0072
  // baseline in mcp-operation-fence-verify.mjs reproduces. Every seeded row
  // carries a DISTINCT operation id, so none of them can be refused by 0059's
  // unique fence and the only thing under test is 0074's tolerance.
  const legacyRows = [
    {
      table: "projects",
      id: deterministicUuid("legacy-violation-projects"),
      columns: "id, owner_user_id, name, slug",
      values: (operationId) =>
        `'${deterministicUuid("legacy-violation-projects")}'::uuid, '${OWNER_A}'::uuid, 'Legacy partial identity', 'legacy-partial-identity', '${operationId}'::uuid`,
      operationId: deterministicUuid("legacy-op-projects"),
    },
    {
      table: "goals",
      id: deterministicUuid("legacy-violation-goals"),
      columns: "id, owner_user_id, project_id, title, slug",
      values: (operationId) =>
        `'${deterministicUuid("legacy-violation-goals")}'::uuid, '${OWNER_A}'::uuid, '${PROJECT_A}'::uuid, 'Legacy partial identity', 'legacy-partial-goal', '${operationId}'::uuid`,
      operationId: deterministicUuid("legacy-op-goals"),
    },
    {
      table: "tasks",
      id: deterministicUuid("legacy-violation-tasks"),
      columns: "id, owner_user_id, project_id, title",
      values: (operationId) =>
        `'${deterministicUuid("legacy-violation-tasks")}'::uuid, '${OWNER_A}'::uuid, '${PROJECT_A}'::uuid, 'Legacy partial identity', '${operationId}'::uuid`,
      operationId: deterministicUuid("legacy-op-tasks"),
    },
    {
      table: "task_reminders",
      id: deterministicUuid("legacy-violation-task_reminders"),
      columns: "id, owner_user_id, task_id, remind_at",
      values: (operationId) =>
        `'${deterministicUuid("legacy-violation-task_reminders")}'::uuid, '${OWNER_A}'::uuid, '${TASK_A}'::uuid, '2026-06-01 07:00:00+00', '${operationId}'::uuid`,
      operationId: deterministicUuid("legacy-op-task_reminders"),
    },
    {
      table: "task_sessions",
      id: deterministicUuid("legacy-violation-task_sessions"),
      // A CLOSED session, for the same reason as IDENTITY_PAIR_TABLES: the
      // seeded corpus already holds owner A's one open session, so an open row
      // here would be refused by task_sessions_owner_open_unique and the insert
      // would never reach 0074 at all.
      columns: "id, owner_user_id, task_id, started_at, ended_at, duration_seconds",
      values: (operationId) =>
        `'${deterministicUuid("legacy-violation-task_sessions")}'::uuid, '${OWNER_A}'::uuid, '${TASK_A_DONE}'::uuid, '2026-06-01 09:00:00+00', '2026-06-01 10:00:00+00', 3600, '${operationId}'::uuid`,
      operationId: deterministicUuid("legacy-op-task_sessions"),
    },
  ];

  for (const row of legacyRows) {
    await sql.unsafe(
      `INSERT INTO public.${row.table} (${row.columns}, mcp_operation_id) VALUES (${row.values(row.operationId)})`,
    );
  }
  // VACUITY GATE: the legacy shape is only meaningful if it really is partial, and
  // only if it really landed before 0074 existed.
  const preTail = await sql.unsafe(
    `SELECT 'projects' AS table_name, count(*)::int AS n FROM public.projects
      WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
     UNION ALL SELECT 'goals', count(*)::int FROM public.goals
      WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
     UNION ALL SELECT 'tasks', count(*)::int FROM public.tasks
      WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
     UNION ALL SELECT 'task_reminders', count(*)::int FROM public.task_reminders
      WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
     UNION ALL SELECT 'task_sessions', count(*)::int FROM public.task_sessions
      WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)`,
  );
  const partialPerTable = new Map(preTail.map((row) => [row.table_name, row.n]));
  for (const row of legacyRows) {
    assert(
      partialPerTable.get(row.table) === 1,
      `${row.table}: expected exactly 1 seeded partial-identity row before the tail, found ${partialPerTable.get(row.table)}`,
    );
  }
  const digestsBefore = await dataDigests(sql, legacyRows.map((row) => row.table));
  const rowIds = new Map(
    legacyRows.map((row) => [row.table, row.id]),
  );

  // THE TAIL, over rows that violate 0074.
  for (const tag of tags.slice(boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(
      result.applied,
      `the tail refused ${tag} over a legacy partial-identity row: SQLSTATE ${result.code} ${result.message}. 0074 is deliberately NOT VALID precisely so this applies; a VALIDATE-form migration would block this deployment's upgrade.`,
    );
  }
  log(
    "IDENTITY-PAIR-LEGACY",
    `${tags.length - boundaryIndex - 1} tail migrations, 0074 included, applied over 5 seeded partial-identity rows (one per fenced table).`,
  );

  // 0074's documented pre-flight, read out of the migration file and run as
  // written. This is the check an operator is told to run, so running it here is
  // what makes the header guidance trustworthy rather than merely plausible.
  const named = await runHeaderPreflight(sql, PAIRING_MIGRATION, "SELECT 'projects' AS table_name");
  assert(
    named.length === legacyRows.length,
    `0074's header pre-flight named ${named.length} row(s), expected the ${legacyRows.length} seeded ones: ${JSON.stringify(named)}`,
  );
  for (const row of legacyRows) {
    const matched = named.filter((entry) => entry.table_name === row.table);
    assert(
      matched.length === 1,
      `0074's header pre-flight named ${matched.length} row(s) on ${row.table}, expected exactly 1`,
    );
    assert(
      matched[0].id === rowIds.get(row.table),
      `0074's header pre-flight named ${matched[0].id} on ${row.table}, but the seeded violating row is ${rowIds.get(row.table)}. A pre-flight that names the wrong row is worse than none.`,
    );
  }
  log(
    "IDENTITY-PAIR-LEGACY",
    `0074's header pre-flight query executed verbatim and named exactly the ${named.length} seeded violating row(s), one per fenced table, no others.`,
  );

  // THE VALIDATE PROBE. Refused where a violating row exists, accepted where none
  // does. Run inside a rolled-back transaction so this section observes the
  // asymmetry without changing the catalog any later assertion reads.
  let validated = 0;
  for (const row of legacyRows) {
    const constraint = `${row.table}_mcp_operation_identity_pair`;
    const refusal = await refusedBy(sql, () =>
      sql.unsafe(`ALTER TABLE public.${row.table} VALIDATE CONSTRAINT ${constraint}`),
    );
    assert(
      refusal.code === "23514",
      `${row.table}: VALIDATE must refuse with 23514 over a seeded partial-identity row; got ${refusal.describe()}. If it ever succeeds, the seeded row no longer violates the predicate and the NOT VALID rationale needs revisiting.`,
    );
    assert(
      refusal.constraint === constraint,
      `${row.table}: that refusal must name ${constraint}; got ${refusal.describe()}`,
    );
    validated += 1;
  }
  const catalogAfterValidate = await sql.unsafe(
    `SELECT conrelid::regclass::text AS table_name, convalidated
       FROM pg_constraint
      WHERE conname LIKE '%_mcp_operation_identity_pair'
      ORDER BY table_name`,
  );
  assert(
    catalogAfterValidate.every((entry) => entry.convalidated === false),
    `every pairing constraint must still be convalidated=false after the rolled-back VALIDATE probe: ${JSON.stringify(catalogAfterValidate)}`,
  );
  log(
    "IDENTITY-PAIR-LEGACY",
    `VALIDATE CONSTRAINT refused with 23514, attributed to the named constraint, on all ${validated} table(s) holding a seeded violating row, and the rollback left every constraint convalidated=false - the exact asymmetry that makes NOT VALID the right final state and a VALIDATE migration a deployment blocker.`,
  );

  // 0074 must not have touched the rows it tolerated.
  const digestsAfter = await dataDigests(sql, legacyRows.map((row) => row.table));
  for (const row of legacyRows) {
    assert(
      digestsAfter.get(row.table).digest === digestsBefore.get(row.table).digest,
      `${row.table}: applying 0074 over a legacy partial-identity row mutated it (digest ${digestsBefore.get(row.table).digest} -> ${digestsAfter.get(row.table).digest}). 0074 must leave pre-existing rows exactly as it found them.`,
    );
    assert(
      digestsAfter.get(row.table).rowCount === digestsBefore.get(row.table).rowCount,
      `${row.table}: applying 0074 over a legacy partial-identity row changed the row count`,
    );
  }
  const namedAfter = await runHeaderPreflight(sql, PAIRING_MIGRATION, "SELECT 'projects' AS table_name");
  assert(
    namedAfter.length === named.length,
    `0074's header pre-flight reported ${namedAfter.length} row(s) after the tail but ${named.length} before it`,
  );

  // THE SECURITY PROPERTY, last: NOT VALID does NOT exempt new writes. The
  // surviving legacy row is a tolerance; a fresh partial identity is still a
  // refusal, which is what keeps the 0059 fence from going inert again.
  let enforced = 0;
  for (const entry of IDENTITY_PAIR_TABLES) {
    const refusal = await refusedBy(sql, () =>
      sql.unsafe(
        `INSERT INTO public.${entry.table} (
           ${entry.columns}, mcp_operation_id
         ) VALUES (${entry.values({
           id: deterministicUuid(`legacy-enforced-${entry.table}`),
           owner: OWNER_B,
           tag: `legacy-${entry.table}`,
           projectId: PROJECT_A,
           taskId: TASK_A,
         })}, '${deterministicUuid(`legacy-enforced-op-${entry.table}`)}'::uuid)`,
      ),
    );
    assert(
      refusal.code === "23514",
      `${entry.table}: tolerating a legacy partial-identity row must NOT stop the constraint refusing a NEW one; got ${refusal.describe()}`,
    );
    assert(
      refusal.constraint === entry.constraint,
      `${entry.table}: that refusal must come from ${entry.constraint}; got ${refusal.describe()}`,
    );
    enforced += 1;
  }
  log(
    "IDENTITY-PAIR-LEGACY",
    `${legacyRows.length} table(s) unchanged by the tail; ${enforced} NEW partial-identity INSERT(s) still refused with 23514 alongside the tolerated legacy rows. NOT VALID is a tolerance for history, not a licence for the present.`,
  );
}

// ---------------------------------------------------------------------------
// Boundary runs
// ---------------------------------------------------------------------------

async function runBoundary(sql, tags, boundary) {
  log("BOUNDARY", `=== boundary ${boundary} ===`);
  const boundaryIndex = tags.indexOf(boundary);
  assert(boundaryIndex >= 0, `unknown boundary ${boundary}`);
  await resetDatabase(sql);
  await applySupabaseShim(sql);

  let applied = 0;
  for (const tag of tags.slice(0, boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(result.applied, `failed applying ${tag} up to the boundary: ${result.code} ${result.message}`);
    applied += 1;
  }
  log("MIGRATE", `${applied} journal migrations applied through ${boundary}`);

  // Supabase supplies ordinary table grants outside the migration journal.
  const tables = seededTablesFor(boundary);
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      ${tables.map((table) => `public.${table}`).join(", ")}
    TO authenticated
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated`);

  await seedDomainRows(sql);
  if (boundary === SURVIVAL_BOUNDARY) await seedTaskStatusEvents(sql);
  await seedGrants(sql, boundary);

  const { digests: digestsBefore, snapshot: grantsBefore } = await assertSeedNonEmpty(sql, boundary);
  const canonical = grantsForBoundary(boundary).filter((grant) => grant.canonical);
  const authorityBefore = await authoritySnapshot(sql, canonical);
  assertCanonicalSetIsNonEmpty(boundary, canonical);
  const activeCanonical = canonical.filter((grant) => grant.status === "active");
  for (const grant of activeCanonical) {
    const resolved = authorityBefore.get(grant.client);
    assert(
      resolved.length > 0,
      `active canonical grant ${grant.client} resolved zero permissions before the tail, so AUTHORITY-EQ would be vacuous`,
    );
  }
  // Every probed table is granted to `authenticated` so a refusal in the reach
  // census is a policy decision, never a missing ACL.
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      ${REACH_PROBES.map((probe) => `public.${probe.table}`).join(", ")}
    TO authenticated
  `);
  const reachBefore = await reachCensus(sql, activeCanonical, await resolveProbes(sql, REACH_PROBES));
  // A pending grant holds no authority at any point, so its resolved set must
  // be empty on BOTH sides of the tail. That is a real assertion, not a
  // vacuous one: it fails if a migration activates it or grants it authority.
  for (const grant of canonical.filter((entry) => entry.status === "pending")) {
    assert(
      authorityBefore.get(grant.client).length === 0,
      `pending grant ${grant.client} resolved authority before the tail, which cannot happen`,
    );
  }

  // THE TAIL.
  let tailApplied = 0;
  for (const tag of tags.slice(boundaryIndex + 1)) {
    const result = await applyFileInTransaction(sql, tag);
    assert(
      result.applied,
      `the tail failed applying ${tag} on top of existing data: SQLSTATE ${result.code} ${result.message}`,
    );
    tailApplied += 1;
    log("MIGRATE", `${tag}: ${result.statements} statement(s) applied over existing data`);
  }
  log("MIGRATE", `${tailApplied} tail migrations applied over a populated database`);

  await assertDataSurvival(sql, tables, digestsBefore);
  await assertGrantsValid(sql, boundary, grantsBefore);
  await assertAuthorityEquality(sql, boundary, authorityBefore);
  await assertNoV2AuthorityLeakedIntoV1(sql, grantsForBoundary(boundary));
  // The reach census complements AUTHORITY-EQ: the resolved permission set is
  // identical either way, but a migration could still re-key a policy onto a
  // permission the v1 document already holds. Only 0063 can state reach
  // EQUALITY, because only 0063 holds an active v1 grant across the tail. At
  // 0049 the tail's whole job is to revoke every seeded grant, so the census
  // there is recorded, not compared.
  if (activeCanonical.length > 0) {
    await sql.unsafe(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
        ${REACH_TAIL_PROBES.map((probe) => `public.${probe.table}`).join(", ")}
      TO authenticated
    `);
    const reachAfter = await reachCensus(sql, activeCanonical, await resolveProbes(sql, [...REACH_PROBES, ...REACH_TAIL_PROBES]));
    const diffs = censusDiffs(reachBefore, reachAfter);
    // Use the PRE-tail resolved permission sets, captured by authoritySnapshot
    // before the tail ran. A migration that granted tasks.update during the
    // tail therefore cannot influence this decision - the declaration is
    // evaluated against the authority the principal had going in.
    const heldPermissions = new Map(
      [...authorityBefore].map(([client, permissions]) => [client, new Set(permissions)]),
    );

    // Every movement must be one 0065 declared. Anything else - including a
    // policy re-keyed onto a permission the v1 document already holds - lands
    // here as an undeclared movement.
    const undeclared = [];
    for (const diff of diffs) {
      if (REACH_SEALED_BY_0065.includes(diff.table)) {
        // Declared: read AND write both go to zero for every v1 bearer.
        if (diff.kind === "read") {
          assert(
            diff.after.startsWith("rows=0"),
            `0065 sealed ${diff.table} from v1 bearers but ${describeDiff(diff)}`,
          );
        } else {
          assert(
            diff.after !== "writable",
            `0065 sealed ${diff.table} from v1 bearers but ${describeDiff(diff)}`,
          );
        }
        continue;
      }
      if (diff.table === REACH_WRITE_SEALED_BY_0065.table) {
        // Declared: read survives under today.read; every write column is
        // withdrawn. Both directions are checked, so neither an over-tight
        // seal (read lost) nor a leaked write passes.
        if (diff.kind === "read") {
          assert(
            diff.after.startsWith("rows=") && !diff.after.startsWith("rows=0"),
            `0065 keeps a v1 READ path on ${diff.table} under ${REACH_WRITE_SEALED_BY_0065.retainedBy}, but ${describeDiff(diff)}`,
          );
        } else {
          assert(
            diff.after !== "writable",
            `0065 declares the ${diff.table} WRITE a direct-user action, but ${describeDiff(diff)}`,
          );
        }
        continue;
      }
      if (diff.table === REACH_OPENED_BY_0065.table) {
        // Declared: newly readable, and read-only. 0065 adds only a SELECT
        // policy here, so an MCP UPDATE must change zero rows. "filtered" is
        // that outcome; "writable" is the bug. Kept as an exact match rather
        // than `!= "writable"`, so a column that stops being REACHABLE at all
        // (a `refused:` SQLSTATE, e.g. a revoked ACL) is not silently accepted
        // as "still closed" - the declaration is that it is closed by policy,
        // not that it vanished.
        if (diff.kind === "read") {
          assert(
            diff.after.startsWith("rows=") && !diff.after.startsWith("rows=0"),
            `${REACH_OPENED_BY_0065.table} was declared readable under ${REACH_OPENED_BY_0065.permission} but ${describeDiff(diff)}`,
          );
        } else {
          assert(
            diff.after === "filtered",
            `${REACH_OPENED_BY_0065.table} was declared READ-ONLY but ${describeDiff(diff)}`,
          );
        }
        continue;
      }
      if (diff.table === REACH_WRITE_OPENED_BY_0069.table) {
        // Movement here is permitted ONLY as the permission-scoped widening
        // 0069 F-6 declares, and only on the WRITE axis.
        assert(
          diff.kind !== "read",
          `${REACH_WRITE_OPENED_BY_0069.table} read reach moved for ${diff.client}: ${describeDiff(diff)}; 0069 declares a WRITE opening only`,
        );
        const holds = heldPermissions.get(diff.client)?.has(REACH_WRITE_OPENED_BY_0069.permission) ?? false;
        if (holds) {
          assert(
            diff.after === "writable",
            `${diff.client} holds ${REACH_WRITE_OPENED_BY_0069.permission}, so 0069 F-6 must have opened ${diff.column} on ${REACH_WRITE_OPENED_BY_0069.table}, but ${describeDiff(diff)}`,
          );
        } else {
          assert(
            diff.after === "filtered",
            `${diff.client} does NOT hold ${REACH_WRITE_OPENED_BY_0069.permission}, so ${diff.column} on ${REACH_WRITE_OPENED_BY_0069.table} must stay closed to it, but ${describeDiff(diff)}`,
          );
        }
        continue;
      }
      undeclared.push(describeDiff(diff));
    }
    assert(
      undeclared.length === 0,
      `an active v1 grant's reach moved in a way no migration declares: ${undeclared.join("; ")}`,
    );

    // The tail-created internals must stay RPC-only.
    for (const grant of activeCanonical) {
      const after = reachAfter.get(grant.client);
      for (const probe of REACH_TAIL_PROBES) {
        const outcome = after[probe.table];
        assert(
          outcome.read.startsWith("rows=0") || outcome.read.includes("refused"),
          `${grant.client} can read ${probe.table} directly after the tail: ${outcome.read}`,
        );
      }
    }

    // Positive confirmation of BOTH branches of the 0069 F-6 declaration, read
    // straight from the post-tail census rather than from the diff list. The
    // diff loop above only inspects tables that MOVED, so it cannot observe a
    // grant that should have become writable and did not. Asserting the final
    // state directly closes that gap: the widened principal must be writable
    // and the non-holder must not be, whatever the diff list happened to hold.
    const widenedClients = [];
    const withheldClients = [];
    for (const grant of activeCanonical) {
      const outcome = reachAfter.get(grant.client)[REACH_WRITE_OPENED_BY_0069.table];
      const holds = heldPermissions.get(grant.client).has(REACH_WRITE_OPENED_BY_0069.permission);
      const writableColumns = outcome.writable ? outcome.writable.split(",") : [];
      if (holds) {
        assert(
          writableColumns.length > 0,
          `${grant.client} holds ${REACH_WRITE_OPENED_BY_0069.permission}, so 0069 F-6 must leave ${REACH_WRITE_OPENED_BY_0069.table} with at least one writable column for it; got none`,
        );
        widenedClients.push(grant.client);
      } else {
        assert(
          writableColumns.length === 0,
          `${grant.client} lacks ${REACH_WRITE_OPENED_BY_0069.permission}, so no column of ${REACH_WRITE_OPENED_BY_0069.table} may be writable for it; got [${writableColumns.join(", ")}]`,
        );
        withheldClients.push(grant.client);
      }
    }
    assert(
      widenedClients.length > 0 && withheldClients.length > 0,
      `the ${REACH_WRITE_OPENED_BY_0069.permission} declaration needs BOTH a holder and a non-holder to be discriminating; widened=${widenedClients.length} withheld=${withheldClients.length}`,
    );
    // The SEAL declarations, confirmed from the final state rather than from the
    // diff list, for the same reason the 0069 declaration is: the diff loop only
    // inspects tables that MOVED, so a seal that never moved is invisible to it.
    //
    // That gap is reachable, not hypothetical. Measured on this journal: adding
    // an MCP UPDATE policy to user_time_context in 0065 leaves the diff-based
    // proof GREEN, because 0063 already had every principal able to write it and
    // it stays able to, so no movement is recorded for the loop to inspect. A
    // declaration is a statement about the state the tail must leave behind, so
    // it is read off the post-tail census - per column, which is the granularity
    // the probe now records.
    const sealedAfter = [
      ...REACH_SEALED_BY_0065,
      REACH_WRITE_SEALED_BY_0065.table,
      REACH_OPENED_BY_0065.table,
    ];
    for (const grant of activeCanonical) {
      const after = reachAfter.get(grant.client);
      for (const table of sealedAfter) {
        const outcome = after[table];
        assert(
          outcome !== undefined,
          `0065 declared ${table} closed to MCP writes but it is absent from ${grant.client}'s post-tail census`,
        );
        assert(
          outcome.writable === "",
          `0065 declared ${table} closed to MCP writes but ${grant.client} can still write [${outcome.writable}] after the tail; the diff loop cannot catch this when the table never moved`,
        );
      }
    }
    // Every probed table must be accounted for by exactly one declared
    // movement; the rest must not have moved at all. Deriving the count from
    // the data keeps the summary honest if the probe list changes.
    const declaredTables = new Set([
      ...REACH_SEALED_BY_0065,
      REACH_WRITE_SEALED_BY_0065.table,
      REACH_OPENED_BY_0065.table,
      REACH_WRITE_OPENED_BY_0069.table,
    ]);
    const unmoved = REACH_PROBES.filter((probe) => !declaredTables.has(probe.table)).length;
    log(
      "REACH",
      `${activeCanonical.length} active v1 grant(s): ${REACH_SEALED_BY_0065.length} declared seals confirmed (${REACH_SEALED_BY_0065.join(", ")}), ${REACH_WRITE_SEALED_BY_0065.table} confirmed write-sealed with its v1 read path intact, ${REACH_OPENED_BY_0065.table} confirmed opened read-only under ${REACH_OPENED_BY_0065.permission}, ${REACH_WRITE_OPENED_BY_0069.table} confirmed opened to ${REACH_WRITE_OPENED_BY_0069.permission} holders only (${widenedClients.join(", ")} writable; ${withheldClients.join(", ")} still closed), ${unmoved} other tables unmoved, ${REACH_TAIL_PROBES.length} tail-created internals still RPC-only, 0 undeclared movement.`,
    );
  } else {
    log("REACH", "0049 holds no active v1 grant, so the reach census is not applicable here; 0063 states it.");
  }
  await assertNoExtraRevocations(sql, boundary, grantsBefore);
  await assertIdentityPairNotValid(sql, boundary);
  await assertNewConstraintsAcceptExistingRows(sql);
  await assertDirectUserUsability(sql);
  await assertUnknownDocumentsFailClosed(sql, boundary);
  // Named tail artefacts, asserted present so the probes above cannot have
  // been reading a schema the tail silently failed to install.
  await assertTailArtifactsInstalled(sql);
  const catalogAfterTail = await catalogDigest(sql);
  await assertTailReapplyIsDataSafe(sql, tags, boundary, tables, digestsBefore, catalogAfterTail);
}

async function main() {
  const { url, onlyBoundary } = parseArgs();
  const tags = await readJournal();
  for (const required of [
    PRE_HARDENING_BOUNDARY,
    SURVIVAL_BOUNDARY,
    "0050_mcp_workspace_manager",
    "0066_mcp_permission_version_2",
    PAIRING_MIGRATION,
  ]) {
    assert(tags.includes(required), `journal does not contain ${required}; cannot run the upgrade-path proof`);
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    const boundaries = onlyBoundary ? [onlyBoundary] : [PRE_HARDENING_BOUNDARY, SURVIVAL_BOUNDARY];
    for (const boundary of boundaries) {
      await runBoundary(sql, tags, boundary);
    }
    if (!onlyBoundary) {
      await assertAtomicFailureAt0050(sql, tags);
      await assertAtomicFailureAt0066(sql, tags);
      await assertIdentityPairToleratesLegacyViolations(sql, tags);
    }
    console.log("MCP-UPGRADE-PATH-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});