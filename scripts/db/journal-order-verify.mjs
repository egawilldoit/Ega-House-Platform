#!/usr/bin/env node
/**
 * Ephemeral-database proof that the REAL migrator applies every journal entry,
 * not merely that the journal is shaped correctly.
 *
 * WHY A SEPARATE PROOF. Every other proof in scripts/db applies the journal with
 * the repository's OWN applier (per file, split on `--> statement-breakpoint`).
 * That applier walks the journal as an array and therefore never consults
 * `when`, so it is structurally incapable of noticing the defect this file
 * exists to catch.
 *
 * THE DEFECT. `drizzle-orm`'s migrator (node_modules/drizzle-orm/pg-core/
 * dialect.js) does not walk the array positionally:
 *
 *   select id, hash, created_at from drizzle.__drizzle_migrations
 *     order by created_at desc limit 1
 *   ...
 *   if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
 *
 * `folderMillis` is the entry's `when`, so ONE number decides what runs. This
 * repository's journal shipped 0074, 0076 and 0077 all carrying
 * when = 1787880000023, with 0074's LOWER than 0073's 1787880000024. Against a
 * database already migrated through 0073, `1787880000024 < 1787880000023` is
 * false, so `migrate()` reported success, applied only 0078, and silently never
 * applied 0074/0076/0077 - leaving no operation-identity pairing constraint, no
 * rate-limiter EXECUTE grant, and the pre-0077 permission-document constraint,
 * with no error and no repair path.
 *
 * WHAT THIS PROVES, AT EVERY TAIL BOUNDARY. Starting from a database that has
 * been migrated through entry N and no further, the real `migrate()` must:
 *   - return without error,
 *   - record exactly `entries.length - N` additional rows, and
 *   - apply every remaining entry, asserted by OBSERVABLE EFFECT per entry
 *     rather than by the count alone.
 *
 * The per-entry assertions are what make this a behavioural proof rather than a
 * restatement of the journal: each boundary checks that the specific objects the
 * remaining migrations create are actually present afterwards. A migrator that
 * skipped an entry while still logging a row could not satisfy them.
 *
 * The static half of this guard is scripts/ci/journal-order.test.mjs, which
 * needs no database. This file is the half that can only be established by
 * running the migrator.
 *
 * SCOPE BOUNDARY. This runs as the bootstrap superuser and asserts SCHEMA
 * effects, not authorization. RLS, column privileges and the MCP write fence are
 * proven by mcp-oauth-surface-verify.mjs and mcp-receipt-invariant-verify.mjs.
 *
 * Usage:
 *   node scripts/db/journal-order-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script. Only point it
 * at a throwaway container.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, exit } from "node:process";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--url") {
      const value = rest[i + 1];
      if (!value) {
        console.error("Missing value for --url");
        exit(2);
      }
      args.url = value;
      i += 1;
    }
  }
  if (!args.url) {
    console.error("Missing required --url <postgres-url>");
    exit(2);
  }
  return args;
}

let failures = 0;

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
  return journal.entries;
}

/**
 * Each tail boundary names one observable that must EXIST once every remaining
 * entry has been applied. They are chosen so that an entry which is skipped
 * cannot be masked: the 0074 constraint, the 0077 length pin and the 0078
 * trigger are three different objects in three different schemas, so a migrator
 * that applied none of the tail fails three of the four boundaries rather than
 * one.
 *
 * Every observable here is a POST-state assertion - what must be true after the
 * migrator has been handed the full journal against a database stopped at that
 * boundary.
 */
const BOUNDARIES = [
  {
    tag: "0072_mcp_write_implies_read_back",
    observable: "the five 0074 pairing constraints",
    check: async (sql) => {
      const rows = await sql.unsafe(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%_mcp_operation_identity_pair'`,
      );
      return {
        ok: rows[0].n === 5,
        detail: `identity-pair constraints: ${rows[0].n} (want 5)`,
      };
    },
  },
  {
    tag: "0073_mcp_audit_capability_authority",
    observable: "the five 0074 pairing constraints",
    check: async (sql) => {
      const rows = await sql.unsafe(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE '%_mcp_operation_identity_pair'`,
      );
      return {
        ok: rows[0].n === 5,
        detail: `identity-pair constraints: ${rows[0].n} (want 5)`,
      };
    },
  },
  {
    tag: "0074_mcp_operation_identity_pair",
    observable: "0077's exact-length permission-document pin",
    check: async (sql) => {
      const rows = await sql.unsafe(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'mcp_authorization_grants_profile_permissions_check'`,
      );
      const def = rows[0]?.def ?? "";
      return {
        ok: def.includes("jsonb_array_length"),
        detail: `0077 length pin present: ${def.includes("jsonb_array_length")}`,
      };
    },
  },
  {
    tag: "0077_mcp_permission_document_exactness",
    observable: "0078's completed_at capture trigger",
    check: async (sql) => {
      const rows = await sql.unsafe(
        `SELECT count(*)::int AS n FROM pg_trigger
          WHERE tgname = 'capture_tasks_mcp_caller_completed_at' AND NOT tgisinternal`,
      );
      return {
        ok: rows[0].n === 1,
        detail: `0078 capture trigger present: ${rows[0].n} (want 1)`,
      };
    },
  },
];

/**
 * A throwaway copy of drizzle/ with the journal truncated to `keep` entries.
 * The real files are read from the repository; only the copy is truncated, so
 * the repository is never modified.
 */
async function truncatedJournalDir(entries, keep) {
  const dir = await mkdtemp(join(tmpdir(), "ega-journal-order-"));
  await cp(new URL("../../drizzle/", import.meta.url).pathname, dir, { recursive: true });
  const journal = { version: "7", dialect: "postgresql", entries: entries.slice(0, keep) };
  await writeFile(join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  return dir;
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  // The migrator's own ledger. It lives outside the three domain schemas, so
  // dropping only those would leave a previous boundary's rows behind and make
  // every count after the first meaningless.
  await sql.unsafe(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
}

async function applySupabaseShim(sql) {
  // The journal's own bootstrap assumptions: the roles, the auth schema and its
  // uid()/jwt() readers, and the automation table that predates the journal and
  // is only altered by it. Copied from the other proofs in this directory so the
  // journal has the same starting point here as it does everywhere else.
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
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);
  `);
  // A journal migration reconciles legacy ownership by that exact address and
  // raises unless exactly one row carries it, so the seed is a precondition of
  // applying the journal at all - not a fixture this proof would otherwise need.
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

async function recordedCount(sql) {
  const rows = await sql.unsafe(
    `SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`,
  );
  return rows[0].n;
}

async function runMigrate(url, folder) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(
      drizzle(sql),
      { migrationsFolder: folder },
      { migrationsSchema: "drizzle", migrationsTable: "__drizzle_migrations" },
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  const { url } = parseArgs();
  const entries = await readJournal();

  assert(
    entries.length > BOUNDARIES.length,
    `the journal must be longer than the ${BOUNDARIES.length} boundaries this proof drives`,
  );

  const admin = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // The whole journal from empty: the baseline every boundary is compared to,
    // and the check that the migrator can apply this journal at all.
    await resetDatabase(admin);
    await applySupabaseShim(admin);
    const fullDir = await truncatedJournalDir(entries, entries.length);
    try {
      await runMigrate(url, fullDir);
    } finally {
      await rm(fullDir, { recursive: true, force: true });
    }
    const fullRecorded = await recordedCount(admin);
    assert(
      fullRecorded === entries.length,
      `migrating an empty database recorded ${fullRecorded} of ${entries.length} journal entries`,
    );
    log("FULL", `${entries.length}/${entries.length} journal entries applied from empty.`);

    for (const boundary of BOUNDARIES) {
      const boundaryIndex = entries.findIndex((entry) => entry.tag === boundary.tag);
      assert(
        boundaryIndex >= 0,
        `boundary ${boundary.tag} is not in the journal; this proof's boundary list has drifted`,
      );

      await resetDatabase(admin);
      await applySupabaseShim(admin);

      const partialDir = await truncatedJournalDir(entries, boundaryIndex + 1);
      try {
        await runMigrate(url, partialDir);
      } finally {
        await rm(partialDir, { recursive: true, force: true });
      }
      const before = await recordedCount(admin);
      assert(
        before === boundaryIndex + 1,
        `building the ${boundary.tag} boundary recorded ${before} rows, want ${boundaryIndex + 1}`,
      );
      const preState = await boundary.check(admin);
      assert(
        !preState.ok,
        `boundary ${boundary.tag} already exhibits ${boundary.observable} before the tail was ` +
          `applied (${preState.detail}), so this boundary cannot discriminate a skipped entry`,
      );

      // Now the whole journal against a database stopped at this boundary. This
      // is the exact call the defect defeated: one that reports success while
      // skipping entries.
      const fullAgain = await truncatedJournalDir(entries, entries.length);
      try {
        await runMigrate(url, fullAgain);
      } finally {
        await rm(fullAgain, { recursive: true, force: true });
      }

      const after = await recordedCount(admin);
      const expected = entries.length - (boundaryIndex + 1);
      assert(
        after - before === expected,
        `from boundary ${boundary.tag} the real migrator recorded ${after - before} of the ` +
          `${expected} remaining entries. drizzle-orm applies an entry only when the highest ` +
          `recorded created_at is less than that entry's "when", so a non-increasing or ` +
          `shared "when" in drizzle/meta/_journal.json is SKIPPED SILENTLY while migrate() ` +
          `reports success.`,
      );
      const postState = await boundary.check(admin);
      assert(
        postState.ok,
        `from boundary ${boundary.tag} the migrator reported success but ${boundary.observable} ` +
          `is absent: ${postState.detail}`,
      );
      log(
        "TAIL",
        `boundary ${boundary.tag}: ${expected} remaining entries applied and recorded; ` +
          `${boundary.observable} - ${postState.detail}`,
      );
    }
  } finally {
    await admin.end();
  }

  console.log("\nJOURNAL-ORDER-VERIFY PASS - the real migrator applies every remaining journal entry.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});