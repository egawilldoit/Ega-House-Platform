#!/usr/bin/env node
/**
 * Ephemeral-database proof for MONEY-01 finance grants and Money RLS.
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, then proves:
 *
 *   PROFILES  - personal_operations, personal_operations_writer,
 *               workspace_money_reader and workspace_money_writer accept exactly
 *               their advertised unions; a write permission on the reader
 *               profile is rejected by the constraint.
 *   NO GRANT  - an OAuth-shaped client_id token without a grant reads/writes
 *               nothing (RLS returns no rows / rejects the insert).
 *   READER    - personal_ops.read reads own rows; INSERT and UPDATE are denied.
 *   WRITER    - personal_ops.write reads, inserts and updates own rows.
 *   DENIED    - pending, revoked, wrong resource, wrong client and cross-owner
 *               grants never read the row.
 *   DIRECT    - a direct user token (no client_id) keeps owner-scoped access.
 *   EXECUTE   - anon cannot call the grant helper; authenticated can.
 *
 * Usage:
 *   node scripts/db/money-01-finance-grants-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const RESOURCE = "https://ega.example.com/api/mcp";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const EXPENSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPENSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const READ_PERMISSIONS = ["today.read", "timer.read", "personal_ops.read"];
const WRITE_PERMISSIONS = [...READ_PERMISSIONS, "personal_ops.write"];
const WORKSPACE_PERMISSIONS = [
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

function receiptFingerprint(label) {
  return createHash("sha256").update(String(label)).digest("hex");
}

async function readJournal() {
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"),
  );
  return journal.entries.map((entry) => entry.tag);
}

function splitStatements(text) {
  return text
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyFile(sql, tag) {
  const text = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  for (const statement of splitStatements(text)) await sql.unsafe(statement);
}

async function resetDatabase(sql) {
  await sql.unsafe(
    `DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS automation CASCADE; CREATE SCHEMA public;`,
  );
  log("RESET", "public/auth/automation dropped and public recreated");
}

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
  await sql.unsafe(
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`,
  );
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
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
  await sql.unsafe(`
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER_A}'::uuid, 'ab.mortaki@gmail.com'),
      ('${OWNER_B}'::uuid, 'owner-b@example.test')
    ON CONFLICT (id) DO NOTHING;
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

function claims(owner, clientId) {
  return JSON.stringify(
    clientId
      ? { sub: owner, role: "authenticated", client_id: clientId, aud: RESOURCE }
      : { sub: owner, role: "authenticated", aud: "authenticated" },
  );
}

function asUser(sql, owner, { clientId = null } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
          owner,
        ]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          claims(owner, clientId),
        ]);
        return fn(tx);
      });
    },
  };
}

function asAnon(sql) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE anon`);
        return fn(tx);
      });
    },
  };
}

async function expectDenied(label, fn) {
  try {
    await fn();
  } catch (error) {
    assert(
      error.code === "42501",
      `${label}: expected 42501, got ${error.code} ${error.message}`,
    );
    log("DENIED", `${label} (42501)`);
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

function insertExpense(tx, { id, owner, amount = 1100, key }) {
  return tx.unsafe(
    `INSERT INTO public.personal_expenses
       (id, owner_user_id, occurred_at, amount_minor, category, need_vs_want,
        idempotency_key, create_fingerprint)
     VALUES ($1::uuid, $2::uuid, '2026-11-11T09:00:00Z', $3, 'coffee', 'want',
             $4, $5)
     RETURNING id, amount_minor, version`,
    [id, owner, amount, key, receiptFingerprint(key)],
  );
}

async function seedGrant(sql, input) {
  await sql`
    INSERT INTO public.mcp_authorization_grants
      (owner_user_id, oauth_client_id, resource_uri, client_name, status,
       permission_profile, permissions, permissions_version, approved_at,
       revoked_at)
    VALUES
      (${input.owner}::uuid, ${input.clientId}, ${input.resource ?? RESOURCE},
       'Proof client', ${input.status ?? "active"}, ${input.profile},
       ${sql.json(input.permissions)}, 1,
       ${(input.status ?? "active") === "active" ? new Date().toISOString() : null}::timestamptz,
       ${(input.status ?? "active") === "revoked" ? new Date().toISOString() : null}::timestamptz)
  `;
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  const sql = postgres(url, { max: 4, onnotice: () => {} });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    for (const tag of tags) await applyFile(sql, tag);
    log("MIGRATE", `${tags.length} journal migrations applied through ${tags.at(-1)}`);

    // PROFILES ---------------------------------------------------------------
    for (const [profile, permissions] of [
      ["personal_operations", READ_PERMISSIONS],
      ["personal_operations_writer", WRITE_PERMISSIONS],
      ["workspace_money_reader", ["projects.read", "goals.read", "tasks.read", "today.read", "timer.read", "personal_ops.read"]],
      ["workspace_money_writer", [...WORKSPACE_PERMISSIONS, "personal_ops.read", "personal_ops.write"]],
    ]) {
      await seedGrant(sql, {
        owner: OWNER_A,
        clientId: `profile-${profile}`,
        profile,
        permissions,
      });
    }
    log("PROFILES", "all finance and combined profiles stored with exact unions");

    let invalidUnionCode = null;
    try {
      await sql`
        INSERT INTO public.mcp_authorization_grants
          (owner_user_id, oauth_client_id, resource_uri, status,
           permission_profile, permissions)
        VALUES
          (${OWNER_A}::uuid, ${"bad-reader"}, ${RESOURCE}, 'active',
           'workspace_money_reader', ${sql.json(WRITE_PERMISSIONS)})
      `;
    } catch (error) {
      invalidUnionCode = error.code;
    }
    assert(
      invalidUnionCode === "23514",
      `reader profile with a write permission must fail the check constraint, got ${invalidUnionCode}`,
    );
    log("DENIED", "reader profile with a write permission (23514)");

    // Seed one row per owner as superuser.
    await insertExpense(sql, { id: EXPENSE_A, owner: OWNER_A, key: "seed-a" });
    await insertExpense(sql, { id: EXPENSE_B, owner: OWNER_B, amount: 2200, key: "seed-b" });

    // NO GRANT ---------------------------------------------------------------
    const noGrant = asUser(sql, OWNER_A, { clientId: "no-grant-client" });
    const noGrantRows = await noGrant.run((tx) =>
      tx.unsafe(`SELECT id FROM public.personal_expenses`),
    );
    assert(noGrantRows.length === 0, "no-grant token must read zero rows");
    await expectDenied("no-grant insert", () =>
      noGrant.run((tx) =>
        insertExpense(tx, {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          owner: OWNER_A,
          key: "no-grant",
        }),
      ),
    );

    // READER -----------------------------------------------------------------
    const reader = asUser(sql, OWNER_A, { clientId: "profile-personal_operations" });
    const readerRows = await reader.run((tx) =>
      tx.unsafe(`SELECT id, amount_minor FROM public.personal_expenses`),
    );
    assert(readerRows.length === 1, "reader grant reads exactly the owner's row");
    assert(Number(readerRows[0].amount_minor) === 1100, "reader sees 1100 centimes");
    await expectDenied("reader insert", () =>
      reader.run((tx) =>
        insertExpense(tx, {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          owner: OWNER_A,
          key: "reader-insert",
        }),
      ),
    );
    const readerUpdate = await reader.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor = 1300,
           version = version + 1, updated_at = now()
         WHERE id = '${EXPENSE_A}' RETURNING id`,
      ),
    );
    assert(readerUpdate.length === 0, "reader grant must not update");

    // WRITER -----------------------------------------------------------------
    const writer = asUser(sql, OWNER_A, {
      clientId: "profile-personal_operations_writer",
    });
    const writerInsert = await writer.run((tx) =>
      insertExpense(tx, {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        owner: OWNER_A,
        amount: 2500,
        key: "writer-insert",
      }),
    );
    assert(writerInsert.length === 1, "writer grant inserts");
    const writerUpdate = await writer.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor = 1200,
           version = version + 1, updated_at = now()
         WHERE id = '${EXPENSE_A}' RETURNING id, amount_minor`,
      ),
    );
    assert(writerUpdate.length === 1, "writer grant updates");
    assert(Number(writerUpdate[0].amount_minor) === 1200, "writer update persists 1200");

    // CHECK-INS (same personal_ops grant) -----------------------------------
    await sql`
      INSERT INTO public.daily_checkins
        (owner_user_id, local_date, timezone, outcomes)
      VALUES (${OWNER_A}::uuid, '2026-11-11', 'Africa/Casablanca', 'proof')
    `;
    const checkinRead = await reader.run((tx) =>
      tx.unsafe(`SELECT id FROM public.daily_checkins`),
    );
    assert(checkinRead.length === 1, "reader grant reads the owner's check-in");
    await expectDenied("reader check-in insert", () =>
      reader.run((tx) =>
        tx.unsafe(
          `INSERT INTO public.daily_checkins
             (owner_user_id, local_date, timezone, outcomes)
           VALUES ('${OWNER_A}', '2026-11-12', 'Africa/Casablanca', 'denied')`,
        ),
      ),
    );
    const checkinWrite = await writer.run((tx) =>
      tx.unsafe(
        `INSERT INTO public.daily_checkins
           (owner_user_id, local_date, timezone, outcomes)
         VALUES ('${OWNER_A}', '2026-11-12', 'Africa/Casablanca', 'allowed')
         RETURNING id`,
      ),
    );
    assert(checkinWrite.length === 1, "writer grant saves a check-in");

    // COMBINED PROFILES ------------------------------------------------------
    const combinedReader = asUser(sql, OWNER_A, {
      clientId: "profile-workspace_money_reader",
    });
    const combinedReaderRows = await combinedReader.run((tx) =>
      tx.unsafe(`SELECT id FROM public.personal_expenses`),
    );
    assert(combinedReaderRows.length >= 1, "combined reader reads own money rows");
    await expectDenied("combined reader insert", () =>
      combinedReader.run((tx) =>
        insertExpense(tx, {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          owner: OWNER_A,
          key: "combined-reader-insert",
        }),
      ),
    );

    const combinedWriter = asUser(sql, OWNER_A, {
      clientId: "profile-workspace_money_writer",
    });
    const combinedWriterUpdate = await combinedWriter.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor = 1250,
           version = version + 1, updated_at = now()
         WHERE id = '${EXPENSE_A}' RETURNING id`,
      ),
    );
    assert(combinedWriterUpdate.length === 1, "combined writer updates own money rows");

    // DENIED VARIANTS --------------------------------------------------------
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "revoked-client",
      profile: "personal_operations_writer",
      permissions: WRITE_PERMISSIONS,
      status: "revoked",
    });
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "pending-client",
      profile: "personal_operations",
      permissions: READ_PERMISSIONS,
      status: "pending",
    });
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "wrong-resource-client",
      profile: "personal_operations_writer",
      permissions: WRITE_PERMISSIONS,
      resource: "https://other.example.com/api/mcp",
    });
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "workspace-only-client",
      profile: "workspace_manager",
      permissions: WORKSPACE_PERMISSIONS,
    });

    for (const [label, clientId] of [
      ["revoked", "revoked-client"],
      ["pending", "pending-client"],
      ["wrong resource", "wrong-resource-client"],
      ["workspace-only", "workspace-only-client"],
      ["unknown client", "unknown-client"],
    ]) {
      const denied = asUser(sql, OWNER_A, { clientId });
      const rows = await denied.run((tx) =>
        tx.unsafe(`SELECT id FROM public.personal_expenses`),
      );
      assert(rows.length === 0, `${label} grant must read zero rows`);
    }

    const crossOwner = asUser(sql, OWNER_B, {
      clientId: "profile-personal_operations_writer",
    });
    const crossRows = await crossOwner.run((tx) =>
      tx.unsafe(`SELECT id FROM public.personal_expenses`),
    );
    assert(crossRows.length === 0, "cross-owner token reads zero rows even with the client id");

    // DIRECT USER ------------------------------------------------------------
    const direct = asUser(sql, OWNER_A);
    const directRows = await direct.run((tx) =>
      tx.unsafe(`SELECT id FROM public.personal_expenses`),
    );
    assert(directRows.length >= 1, "direct-user token keeps owner-scoped access");

    // EXECUTE ----------------------------------------------------------------
    await expectDenied("anon execute of mcp_finance_grant_allows", () =>
      asAnon(sql).run((tx) =>
        tx.unsafe(`SELECT public.mcp_finance_grant_allows('personal_ops.read')`),
      ),
    );

    const [final] = await sql.unsafe(
      `SELECT count(*)::int AS n FROM public.personal_expenses`,
    );
    assert(final.n === 3, "three canonical rows remain (seed A, seed B, writer insert)");
    log(
      "DONE",
      "MONEY-01 profiles, grant-allow, no-grant deny, revocation, pending, wrong client/resource, cross-owner and direct-user behavior verified",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
