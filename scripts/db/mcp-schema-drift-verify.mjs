#!/usr/bin/env node
/**
 * Ephemeral-database proof that the DECLARATIVE schema
 * (`src/db/mcp-schema.ts`) cannot regress the MCP permission-version security
 * model, and that `drizzle-kit push` does not regress it either.
 *
 * WHY THIS IS NOT THE SAME CLAIM AS mcp-schema-drift.test.mjs. That test
 * compares RENDERED SQL against the migration text. This file compares PARSED,
 * EVALUATED constraints against the live catalog and then runs the real tool. A
 * rendered string can be right while the tool still drops the constraint, and
 * two constraints can differ in acceptance while their texts look close.
 *
 * SECTIONS
 *   JOURNAL-APPLIED   the full journal is applied per-file inside per-file
 *                     transactions, the way `drizzle-kit migrate` applies it,
 *                     with the same `--> statement-breakpoint` splitting as
 *                     mcp-upgrade-path-verify.mjs. That verifier and this one
 *                     drop the same schemas, so they must not share a database.
 *   CATALOG-TRUTH     the real constraint set is read from `pg_constraint`.
 *   DECLARED-DDL      the DDL drizzle-kit emits for the table is applied to a
 *                     shadow schema, so PostgreSQL parses both sides.
 *   BYTE-EQUALITY     `pg_get_constraintdef` of each constraint is identical on
 *                     both sides: the strongest available statement that two SQL
 *                     predicates are the same tree.
 *   ACCEPTANCE        a corpus of rows is evaluated against both sides. It
 *                     covers every document the journal pins plus every widening
 *                     0077 names in its header, so a difference text comparison
 *                     could miss still shows up behaviourally.
 *   CORPUS-BEHAVIOUR  both sides must agree with the corpus verdict: legitimate
 *                     rows accepted, widening rows refused. The legitimate half
 *                     is the vacuity gate - it proves the refused half is not
 *                     passing because the table rejects everything.
 *   PUSH-IS-SAFE      `drizzle-kit push --force` is executed against the
 *                     journal-built database; afterwards the version check and the
 *                     (profile, version) -> document check must still be present,
 *                     byte-identical, and still refusing every widening row.
 *
 * Usage:
 *   node scripts/db/mcp-schema-drift-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE, then `drizzle-kit push` rewrites it). Only
 * point it at a throwaway container.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const TABLE = "public.mcp_authorization_grants";
const SHADOW_TABLE = "declared.mcp_authorization_grants";

/**
 * The constraints this proof requires to survive.
 *
 * `permissions_version_check` and `profile_permissions_check` together are the
 * security model: the first says which versions exist, the second says which
 * document each (profile, version) names. `profile_check` is included because
 * 0057 restated it, and a stale copy narrows the retired delivery_observer
 * profile out of existence, which makes a legacy terminal grant untouchable.
 */
const REQUIRED_CONSTRAINTS = [
  "mcp_authorization_grants_permissions_version_check",
  "mcp_authorization_grants_profile_permissions_check",
  "mcp_authorization_grants_profile_check",
];

/**
 * Divergences this proof tolerates, each with the reason it is not fixed here.
 * A constraint outside this map must be byte-equal or the proof fails.
 *
 * `mcp_authorization_grants_resource_uri_check`: drizzle/0037 wrote the loopback
 * alternation over-escaped. In a `standard_conforming_strings` literal,
 * `127\\.0\\.0\\.1` reaches the regex engine as `\\.`, which matches a literal
 * backslash followed by any character, so the migration's own pattern cannot
 * match `127.0.0.1`. The declarative schema spells the same regex correctly and
 * is the side that behaves as 0037's comment intends. Migration truth is
 * therefore NOT unambiguous for this constraint, so neither side is changed:
 * reproducing the broken escaping would enshrine a bug in the schema authority,
 * and correcting the migration is outside this change's scope.
 */
const KNOWN_DIVERGENCES = {
  "mcp_authorization_grants_resource_uri_check": {
    reason: "0037 over-escaped the loopback alternation; reported, deliberately not changed",
    equivalentAfter: (predicate) => predicate.replaceAll("\\\\", "\\"),
  },
};

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--url") args.url = rest[++index];
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

let assertions = 0;
function assert(condition, message) {
  assertions += 1;
  if (!condition) {
    console.error(`[PROOF] FAILED: ${message}`);
    exit(1);
  }
}

// ---------------------------------------------------------------------------
// Journal application - the same per-file / per-transaction / statement-break
// splitting mcp-upgrade-path-verify.mjs uses, so both verifiers exercise the
// journal the same way `drizzle-kit migrate` applies it.
// ---------------------------------------------------------------------------

function splitStatements(sqlText) {
  return sqlText
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function readJournal() {
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"));
  return journal.entries.map((entry) => entry.tag);
}

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
    return {
      applied: false,
      code: error?.code ?? "UNKNOWN",
      message: String(error?.message ?? error).slice(0, 400),
    };
  }
  return { applied: true, statements: statements.length };
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
}

/** The Supabase stand-in the journal's policies and functions expect. */
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
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);`);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
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
      project_id varchar(64), linear_issue_id varchar(64), linear_issue_identifier varchar(64),
      linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1, status varchar(48) NOT NULL DEFAULT 'queued',
      claimed_by varchar(64), heartbeat_at timestamptz, lease_expires_at timestamptz,
      started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), finished_at timestamptz,
      failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now()
    );
  `);
}

// ---------------------------------------------------------------------------
// Corpus: what the constraint must accept, and what it must refuse
// ---------------------------------------------------------------------------

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
const V2_ADDITIONS = ["friction.read", "inbox.read", "notifications.read", "operator.read", "workload.read"];
const V2_READ_ONLY = [...V1_READ_ONLY, ...V2_ADDITIONS];
const V2_WORKSPACE_MANAGER = [...V1_WORKSPACE_MANAGER, ...V2_ADDITIONS];
const LEGACY_READ_ONLY = ["projects.read", "goals.read", "tasks.read"];
const LEGACY_TASK_MANAGER = ["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"];
const DELIVERY_OBSERVER = ["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"];

const CORPUS = [
  // Legitimate: every document the journal pins, on every status class that may
  // hold it. The accepted half is the vacuity gate for the refused half.
  { accept: true, label: "read_only v1 active", status: "active", profile: "read_only", version: 1, permissions: V1_READ_ONLY },
  { accept: true, label: "read_only v1 pending", status: "pending", profile: "read_only", version: 1, permissions: V1_READ_ONLY },
  { accept: true, label: "task_manager v1 active", status: "active", profile: "task_manager", version: 1, permissions: V1_TASK_MANAGER },
  { accept: true, label: "task_manager v1 pending", status: "pending", profile: "task_manager", version: 1, permissions: V1_TASK_MANAGER },
  { accept: true, label: "workspace_manager v1 active", status: "active", profile: "workspace_manager", version: 1, permissions: V1_WORKSPACE_MANAGER },
  { accept: true, label: "read_only v2 active", status: "active", profile: "read_only", version: 2, permissions: V2_READ_ONLY },
  { accept: true, label: "workspace_manager v2 active", status: "active", profile: "workspace_manager", version: 2, permissions: V2_WORKSPACE_MANAGER },
  { accept: true, label: "read_only v1 revoked", status: "revoked", profile: "read_only", version: 1, permissions: V1_READ_ONLY },
  { accept: true, label: "read_only v2 revoked", status: "revoked", profile: "read_only", version: 2, permissions: V2_READ_ONLY },
  { accept: true, label: "task_manager v1 failed", status: "failed", profile: "task_manager", version: 1, permissions: V1_TASK_MANAGER },
  { accept: true, label: "workspace_manager v1 revoked", status: "revoked", profile: "workspace_manager", version: 1, permissions: V1_WORKSPACE_MANAGER },
  { accept: true, label: "workspace_manager v2 failed", status: "failed", profile: "workspace_manager", version: 2, permissions: V2_WORKSPACE_MANAGER },
  { accept: true, label: "legacy read_only revoked", status: "revoked", profile: "read_only", version: 1, permissions: LEGACY_READ_ONLY },
  { accept: true, label: "legacy read_only failed", status: "failed", profile: "read_only", version: 1, permissions: LEGACY_READ_ONLY },
  { accept: true, label: "legacy task_manager failed", status: "failed", profile: "task_manager", version: 1, permissions: LEGACY_TASK_MANAGER },
  { accept: true, label: "delivery_observer revoked", status: "revoked", profile: "delivery_observer", version: 1, permissions: DELIVERY_OBSERVER },
  { accept: true, label: "delivery_observer failed", status: "failed", profile: "delivery_observer", version: 1, permissions: DELIVERY_OBSERVER },
  // 0066's promise: order stays non-semantic, so a reordered grant is valid.
  { accept: true, label: "read_only v1 reordered", status: "active", profile: "read_only", version: 1, permissions: [...V1_READ_ONLY].reverse() },

  // 0077 defect 1: multiplicity. `<@` / `@>` are set operations over jsonb
  // arrays, so a repeated entry satisfies both directions against the same
  // N-element literal.
  { accept: false, label: "read_only v1 with a repeated permission", status: "active", profile: "read_only", version: 1, permissions: ["projects.read", "projects.read", "goals.read", "tasks.read", "today.read", "timer.read"] },

  // 0077 defect 2: the terminal branch carried no permissions_version
  // predicate and used a containment WINDOW rather than a document.
  { accept: false, label: "task_manager v2 (no v2 document exists)", status: "active", profile: "task_manager", version: 2, permissions: V1_TASK_MANAGER },
  { accept: false, label: "task_manager v2 revoked", status: "revoked", profile: "task_manager", version: 2, permissions: V1_TASK_MANAGER },
  { accept: false, label: "read_only v1 carrying the v2 document", status: "active", profile: "read_only", version: 1, permissions: V2_READ_ONLY },
  { accept: false, label: "read_only v2 carrying the legacy document", status: "active", profile: "read_only", version: 2, permissions: LEGACY_READ_ONLY },
  { accept: false, label: "workspace_manager v1 carrying the v2 document", status: "active", profile: "workspace_manager", version: 1, permissions: V2_WORKSPACE_MANAGER },
  { accept: false, label: "workspace_manager v1 carrying a 15-of-19 set", status: "active", profile: "workspace_manager", version: 1, permissions: [...V2_WORKSPACE_MANAGER, "inbox.read"] },
  { accept: false, label: "read_only v1 carrying a 3-of-5 set", status: "active", profile: "read_only", version: 1, permissions: LEGACY_READ_ONLY },
  { accept: false, label: "task_manager v1 carrying a 5-of-7 set", status: "active", profile: "task_manager", version: 1, permissions: LEGACY_TASK_MANAGER },
  { accept: false, label: "read_only v1 with one permission removed", status: "active", profile: "read_only", version: 1, permissions: V1_READ_ONLY.slice(1) },
  { accept: false, label: "read_only v1 with an unknown permission added", status: "active", profile: "read_only", version: 1, permissions: [...V1_READ_ONLY, "secrets.read"] },
  { accept: false, label: "legacy read_only still active", status: "active", profile: "read_only", version: 1, permissions: LEGACY_READ_ONLY },
  { accept: false, label: "delivery_observer active (retired profile)", status: "active", profile: "delivery_observer", version: 1, permissions: DELIVERY_OBSERVER },
  { accept: false, label: "delivery_observer revoked with the wrong document", status: "revoked", profile: "delivery_observer", version: 1, permissions: V1_READ_ONLY },

  // 0066: the version is half the key, so an unregistered version has no
  // document at all. This is the row a `permissions_version > 0` version check
  // would let through once the document check is gone.
  { accept: false, label: "read_only v3 (no v3 document exists)", status: "active", profile: "read_only", version: 3, permissions: V2_READ_ONLY },
  { accept: false, label: "read_only v7 revoked", status: "revoked", profile: "read_only", version: 7, permissions: LEGACY_READ_ONLY },
];

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

async function checkDefinitions(sql, relation) {
  const rows = await sql.unsafe(
    `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conrelid = $1::regclass AND contype = 'c'
      ORDER BY conname`,
    [relation],
  );
  return new Map(rows.map((row) => [row.conname, row.definition]));
}

/**
 * The bare predicate behind a `CHECK`, so it can be attached to a scratch table
 * whose columns carry the same names.
 */
function predicateOfDefinition(definition) {
  const match = /^CHECK \(([\s\S]*)\)$/.exec(definition);
  assert(Boolean(match), `cannot read a predicate out of ${definition}`);
  return match[1];
}

/**
 * Insert one corpus row into the REAL table and report the SQLSTATE.
 *
 * This is the claim that matters at the boundary: not "a predicate evaluates to
 * false" but "PostgreSQL refuses to store this grant". 23514 is the refusal the
 * security model depends on; anything else (a missing column, a bad cast) is a
 * bug in the proof, so it is returned rather than swallowed.
 */
async function insertOutcome(sql, candidate) {
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(
        `INSERT INTO ${TABLE} (owner_user_id, oauth_client_id, resource_uri, status, permission_profile, permissions, permissions_version)
         VALUES ('11111111-1111-4111-8111-111111111111'::uuid, $1, 'https://ega.example.com/api/mcp', $2, $3, $4, $5)`,
        [
          `drift-probe-${candidate.label.replaceAll(/\W+/g, "-")}`,
          candidate.status,
          candidate.profile,
          candidate.permissions,
          candidate.version,
        ],
      );
    });
    return "ACCEPTED";
  } catch (error) {
    return error?.code ?? "UNKNOWN";
  }
}

async function assertRefused(sql, candidate) {
  const outcome = await insertOutcome(sql, candidate);
  assert(outcome === "23514", `the real table returned ${outcome} for "${candidate.label}", expected 23514`);
}

async function assertAccepted(sql, candidate) {
  const outcome = await insertOutcome(sql, candidate);
  assert(outcome === "ACCEPTED", `the real table refused "${candidate.label}" with ${outcome}`);
}

/**
 * Evaluate one candidate row against one CHECK predicate in a throwaway
 * transaction, and report whether the constraint accepts it.
 *
 * A refusal is a 23514 and is the interesting answer; any other error is a bug
 * in the predicate or the scratch table and is rethrown, so a broken proof
 * cannot masquerade as a refusal.
 */
async function predicateAccepts(sql, predicate, candidate, label) {
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(
        `CREATE TEMP TABLE probe (status text, permission_profile text, permissions jsonb, permissions_version integer) ON COMMIT DROP`,
      );
      await transaction.unsafe(`ALTER TABLE probe ADD CONSTRAINT probe_check CHECK (${predicate})`);
      await transaction.unsafe(
        `INSERT INTO probe (status, permission_profile, permissions, permissions_version) VALUES ($1, $2, $3, $4)`,
        // The array is passed as a value, not as JSON.stringify output: this
        // driver JSON-encodes a `json`/`jsonb` parameter, so handing it the text
        // would store a JSON string scalar and every evaluation would fail with
        // 22023 instead of answering the question.
        [candidate.status, candidate.profile, candidate.permissions, candidate.version],
      );
    });
    return true;
  } catch (error) {
    if (error?.code === "23514") return false;
    throw new Error(`evaluating ${label ?? "predicate"} for "${candidate.label}" raised ${error?.code}: ${error?.message}`);
  }
}

// ---------------------------------------------------------------------------
// Declarative rendering
// ---------------------------------------------------------------------------

/**
 * The drizzle-kit CLI entry point, located through the package's own manifest
 * rather than a hard-coded path so a drizzle-kit layout change fails loudly here
 * instead of silently skipping the render.
 */
function drizzleKitBin() {
  const entry = createRequire(import.meta.url).resolve("drizzle-kit");
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(entry), "package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["drizzle-kit"];
  if (!bin) throw new Error("drizzle-kit's package.json declares no bin entry");
  return path.join(path.dirname(entry), bin);
}

/**
 * Ask drizzle-kit what the declarative schema means and return the CREATE TABLE
 * it emits for this table. The journal is copied outside the repository so this
 * writes nothing into it, and `node_modules` is symlinked beside the temporary
 * config because drizzle-kit resolves its own `defineConfig` import from the
 * config file's own directory. No database is contacted: `generate` reads only
 * the journal and the schema files.
 */
function renderDeclaredCreateTable() {
  const workdir = mkdtempSync(path.join(os.tmpdir(), "mcp-schema-drift-verify-"));
  try {
    cpSync(path.join(ROOT, "drizzle"), path.join(workdir, "drizzle"), { recursive: true });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(workdir, "node_modules"), "dir");
    writeFileSync(
      path.join(workdir, "drizzle.config.ts"),
      [
        'import { defineConfig } from "drizzle-kit";',
        "export default defineConfig({",
        `  schema: [${JSON.stringify(path.join(ROOT, "src", "db", "schema.ts"))}, ${JSON.stringify(path.join(ROOT, "src", "db", "mcp-schema.ts"))}],`,
        '  out: "./drizzle",',
        '  dialect: "postgresql",',
        '  dbCredentials: { url: "postgresql://postgres:postgres@127.0.0.1:5432/postgres" },',
        "});",
        "",
      ].join("\n"),
    );

    execFileSync(
      process.execPath,
      [
        drizzleKitBin(),
        "generate",
        "--config",
        "./drizzle.config.ts",
        "--name",
        "declared_probe",
      ],
      { cwd: workdir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );

    const journal = JSON.parse(readFileSync(path.join(workdir, "drizzle", "meta", "_journal.json"), "utf8"));
    const tag = journal.entries[journal.entries.length - 1].tag;
    const emitted = readFileSync(path.join(workdir, "drizzle", `${tag}.sql`), "utf8");
    const start = emitted.indexOf('CREATE TABLE "mcp_authorization_grants"');
    if (start === -1) throw new Error("drizzle-kit emitted no CREATE TABLE for mcp_authorization_grants");
    const end = emitted.indexOf("\n);", start);
    return emitted.slice(start, end === -1 ? undefined : end + 3);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs();
const sql = postgres(args.url, { max: 1, onnotice: () => {} });

try {
  // --- JOURNAL-APPLIED ---------------------------------------------------
  await resetDatabase(sql);
  await applySupabaseShim(sql);
  const tags = await readJournal();
  for (const tag of tags) {
    const result = await applyFileInTransaction(sql, tag);
    assert(result.applied, `${tag} was rejected: ${result.code} ${result.message}`);
  }
  log("JOURNAL-APPLIED", `applied ${tags.length}/${tags.length} journal files, last=${tags[tags.length - 1]}`);

  // --- CATALOG-TRUTH -----------------------------------------------------
  const journalChecks = await checkDefinitions(sql, TABLE);
  assert(journalChecks.size > 0, "the journal built no CHECK constraints on the table");
  for (const name of REQUIRED_CONSTRAINTS) {
    assert(journalChecks.has(name), `the journal-built catalog is missing ${name}`);
  }
  log("CATALOG-TRUTH", `${journalChecks.size} CHECK constraints: ${[...journalChecks.keys()].sort().join(", ")}`);

  // --- DECLARED-DDL ------------------------------------------------------
  const declaredCreateTable = renderDeclaredCreateTable();
  await sql.unsafe(`DROP SCHEMA IF EXISTS declared CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA declared;`);
  await sql.unsafe(`SET search_path TO declared, public;`);
  await sql.unsafe(declaredCreateTable);
  await sql.unsafe(`SET search_path TO public;`);
  const declaredChecks = await checkDefinitions(sql, SHADOW_TABLE);
  assert(declaredChecks.size > 0, "the emitted DDL declared no CHECK constraints");
  log("DECLARED-DDL", `the emitted DDL declares ${declaredChecks.size} CHECK constraints`);

  // --- BYTE-EQUALITY -----------------------------------------------------
  const allNames = [...new Set([...journalChecks.keys(), ...declaredChecks.keys()])].sort();
  const equalNames = [];
  for (const name of allNames) {
    assert(journalChecks.has(name), `${name} is only in the declarative schema; db:generate would emit a constraint no migration created`);
    assert(declaredChecks.has(name), `${name} is only in the journal catalog; drizzle-kit push drops it and never recreates it`);
    const journalSide = predicateOfDefinition(journalChecks.get(name));
    const declaredSide = predicateOfDefinition(declaredChecks.get(name));
    const known = KNOWN_DIVERGENCES[name];
    const resolve = known ? known.equivalentAfter : (predicate) => predicate;
    if (journalSide === declaredSide) {
      equalNames.push(name);
      log("BYTE-EQUALITY", `${name}: byte-identical after parsing`);
      continue;
    }
    assert(known, `${name} differs from the journal and is not a documented divergence`);
    assert(
      resolve(journalSide) === resolve(declaredSide),
      `${name} differs from the journal by MORE than the documented divergence (${known.reason})`,
    );
    log("BYTE-EQUALITY", `${name}: documented divergence, otherwise identical (${known.reason})`);
  }

  // --- ACCEPTANCE --------------------------------------------------------
  // Only the constraints that decide the (profile, version) -> document mapping;
  // the others are byte-equal and have no opinion about permission documents.
  const mappingConstraints = [
    "mcp_authorization_grants_permissions_version_check",
    "mcp_authorization_grants_profile_permissions_check",
    "mcp_authorization_grants_profile_check",
  ];
  for (const name of mappingConstraints) {
    assert(equalNames.includes(name), `${name} must be byte-equal before its behaviour can be compared`);
    const journalSide = predicateOfDefinition(journalChecks.get(name));
    const declaredSide = predicateOfDefinition(declaredChecks.get(name));
    for (const candidate of CORPUS) {
      const journalAccepts = await predicateAccepts(sql, journalSide, candidate, name);
      const declaredAccepts = await predicateAccepts(sql, declaredSide, candidate, name);
      assert(
        journalAccepts === declaredAccepts,
        `${name} ${declaredAccepts ? "accepts" : "refuses"} "${candidate.label}" declaratively but ${journalAccepts ? "accepts" : "refuses"} it in the journal`,
      );
    }
  }
  log("ACCEPTANCE", `${CORPUS.length} candidates evaluated against ${mappingConstraints.length} constraints on both sides`);

  // --- CORPUS-BEHAVIOUR --------------------------------------------------
  let accepted = 0;
  let refused = 0;
  for (const candidate of CORPUS) {
    const outcomes = [];
    for (const name of mappingConstraints) {
      const journalAccepts = await predicateAccepts(sql, predicateOfDefinition(journalChecks.get(name)), candidate);
      const declaredAccepts = await predicateAccepts(sql, predicateOfDefinition(declaredChecks.get(name)), candidate);
      outcomes.push({ name, journalAccepts, declaredAccepts });
    }
    const journalAcceptsAll = outcomes.every((outcome) => outcome.journalAccepts);
    const declaredAcceptsAll = outcomes.every((outcome) => outcome.declaredAccepts);
    const refusedBy = outcomes.filter((outcome) => !outcome.declaredAccepts).map((outcome) => outcome.name);
    assert(
      journalAcceptsAll === candidate.accept,
      `the journal constraints ${journalAcceptsAll ? "accepted" : "refused"} "${candidate.label}", expected ${candidate.accept ? "accepted" : "refused"}`,
    );
    assert(
      declaredAcceptsAll === candidate.accept,
      `the declarative constraints ${declaredAcceptsAll ? "accepted" : "refused"} "${candidate.label}", expected ${candidate.accept ? "accepted" : "refused"}${refusedBy.length ? ` (refused by ${refusedBy.join(", ")})` : ""}`,
    );
    if (candidate.accept) accepted += 1;
    else refused += 1;
  }
  assert(accepted > 0 && refused > 0, "the corpus must contain both accepted and refused rows, or it proves nothing");
  log("CORPUS-BEHAVIOUR", `${accepted} legitimate rows accepted and ${refused} widening rows refused on both sides`);

  // --- PUSH-IS-SAFE ------------------------------------------------------
  const pushOutput = execFileSync(
    process.execPath,
    [drizzleKitBin(), "push", "--force", "--verbose"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, DATABASE_URL: args.url } },
  );
  const pushStatements = pushOutput
    .split(/\r?\n/)
    .filter((line) => line.includes("mcp_authorization_grants") && line.trim().length > 0);
  for (const statement of pushStatements) log("PUSH-IS-SAFE", `push emitted: ${statement.trim()}`);
  assert(
    !pushStatements.some((statement) => statement.includes("mcp_authorization_grants_profile_permissions_check")),
    "drizzle-kit push emitted a statement touching mcp_authorization_grants_profile_permissions_check",
  );

  const afterChecks = await checkDefinitions(sql, TABLE);
  for (const name of REQUIRED_CONSTRAINTS) {
    assert(afterChecks.has(name), `drizzle-kit push removed ${name} from ${TABLE}`);
    assert(
      afterChecks.get(name) === journalChecks.get(name),
      `drizzle-kit push rewrote ${name}; before=${journalChecks.get(name)} after=${afterChecks.get(name)}`,
    );
  }
  log("PUSH-IS-SAFE", `all ${REQUIRED_CONSTRAINTS.length} security constraints survived push byte-identical`);

  // The catalog accepts a row only when EVERY constraint accepts it, so the
  // post-push claim is about the conjunction: a widening row must still be
  // refused by at least one surviving constraint, and the real table must still
  // refuse it with 23514.
  for (const candidate of CORPUS.filter((entry) => !entry.accept)) {
    const survivors = [];
    for (const name of mappingConstraints) {
      if (await predicateAccepts(sql, predicateOfDefinition(afterChecks.get(name)), candidate)) {
        survivors.push(name);
      }
    }
    assert(
      survivors.length < mappingConstraints.length,
      `after drizzle-kit push nothing refuses "${candidate.label}"; only ${survivors.join(", ") || "no constraint"} survived`,
    );
    await assertRefused(sql, candidate);
  }
  log(
    "PUSH-IS-SAFE",
    `after push all ${refused} widening rows are still refused by the surviving constraints and by the real table with 23514`,
  );

  // And the legitimate rows still INSERT, so the refusal above is not the table
  // refusing everything.
  for (const candidate of CORPUS.filter((entry) => entry.accept)) {
    await assertAccepted(sql, candidate);
  }
  log("PUSH-IS-SAFE", `after push all ${accepted} legitimate rows still insert into the real table`);

  console.log(`\nmcp-schema-drift-verify: ALL CHECKS PASSED (${assertions} assertions)`);
} finally {
  await sql.end({ timeout: 5 });
}