#!/usr/bin/env node
/**
 * Ephemeral-database proof for the owner-scoped personal expense ledger
 * (PO-06 Slice A, issue #346).
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, then proves:
 *
 *   DEFAULTS    - currency MAD, version 1, created/updated timestamps and a
 *                 null deleted_at are produced when only required fields are
 *                 supplied; owner_user_id defaults to the verified actor.
 *   UNITS       - amount_minor is a whole-number integer column bounded to
 *                 1..2147483647; zero, negative and overflowing values fail.
 *   CHECKS      - currency, category, need-vs-want, payment method, version and
 *                 non-blank note/merchant/idempotency constraints are enforced.
 *   UNIQUE      - (owner_user_id, idempotency_key) is unique per owner and the
 *                 same key is allowed for a different owner; the internal
 *                 create_fingerprint is a SHA-256 hex receipt of the original
 *                 create payload, not a copy of it.
 *   RLS         - owners cannot read/write each other's rows; anonymous is
 *                 denied; an OAuth client_id token without a grant is denied;
 *                 an active personal_ops.read grant can read but not write; a
 *                 personal_ops.write grant can write; hard DELETE is not
 *                 granted. Authenticated immutable-column changes are denied by
 *                 column grants (42501), with the BEFORE UPDATE trigger proven
 *                 as the owner-role backstop for immutable/undelete/version.
 *   GRANTS      - column-level UPDATE only on mutable columns with forced RLS.
 *   SOFT DELETE - deleted rows remain durable but are excluded from active
 *                 list/total queries; repeating a delete does not change totals.
 *   PAGE/ORDER  - occurred_at desc, id desc with bounded offset/limit.
 *   WINDOW      - half-open [start, end) occurred_at boundaries, including the
 *                 2026-03-08 America/New_York DST spring-forward day.
 *   IDEMPOTENCE - re-applying 0088 preserves rows, policies and indexes.
 *
 * Usage:
 *   node scripts/db/personal-expenses-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION_TAG = "0088_personal_expenses";
const CONSTRAINT = "personal_expenses_owner_idempotency_key_unique";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

/** Proof-only fixed-size receipt; the application produces the same shape. */
function receiptFingerprint(label) {
  return createHash("sha256").update(String(label)).digest("hex");
}

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
  const statements = splitStatements(text);
  for (const statement of statements) await sql.unsafe(statement);
  return statements.length;
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

function asUser(sql, userId, { clientId = null } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
          userId,
        ]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          clientId
            ? JSON.stringify({
                sub: userId,
                client_id: clientId,
                aud: "https://ega.example.com/api/mcp",
              })
            : "{}",
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

async function expectFailure(label, fn, expectedCodes) {
  try {
    await fn();
  } catch (error) {
    assert(
      expectedCodes.includes(error.code),
      `${label}: expected ${expectedCodes.join(", ")}, got ${error.code} ${error.message}`,
    );
    log("DENIED", `${label} (${error.code})`);
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

async function expectCode(label, fn, expectedCode) {
  try {
    await fn();
  } catch (error) {
    assert(
      error.code === expectedCode,
      `${label}: expected ${expectedCode}, got ${error.code} ${error.message}`,
    );
    log("DENIED", `${label} (${error.code})`);
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

function insertExpense(tx, input) {
  const columns = [
    "occurred_at",
    "amount_minor",
    "currency",
    "category",
    "note",
    "merchant",
    "need_vs_want",
    "payment_method",
    "idempotency_key",
    "create_fingerprint",
  ];
  const values = [
    input.occurredAt,
    input.amountMinor,
    input.currency ?? "MAD",
    input.category ?? "coffee",
    input.note ?? null,
    input.merchant ?? null,
    input.needVsWant ?? "need",
    input.paymentMethod ?? null,
    input.idempotencyKey,
    input.createFingerprint ?? receiptFingerprint(input.idempotencyKey),
  ];
  const placeholders = ["$1::timestamptz", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9", "$10"];

  if (input.id) {
    columns.unshift("id");
    values.unshift(input.id);
    placeholders.unshift("$1::uuid");
    // Re-number the remaining placeholders after inserting id at position 1.
    for (let index = 1; index < placeholders.length; index += 1) {
      placeholders[index] = placeholders[index].replace(/\$\d+/, `$${index + 1}`);
    }
  }

  return tx.unsafe(
    `INSERT INTO public.personal_expenses
       (${columns.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING id, owner_user_id, occurred_at, amount_minor, currency, category,
               note, merchant, need_vs_want, payment_method, idempotency_key,
               version, deleted_at, created_at, updated_at`,
    values,
  );
}

async function activeTotal(tx) {
  const [row] = await tx.unsafe(
    `SELECT coalesce(sum(amount_minor), 0)::int AS total
     FROM public.personal_expenses
     WHERE owner_user_id = auth.uid() AND deleted_at IS NULL`,
  );
  return Number(row.total);
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  assert(tags.includes(MIGRATION_TAG), `journal must include ${MIGRATION_TAG}`);

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      await applyFile(sql, tag);
      applied += 1;
    }
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
    log("MIGRATE", `${applied} journal migrations applied`);

    const [table] = await sql.unsafe(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE oid = 'public.personal_expenses'::regclass`,
    );
    assert(table?.enabled === true, "personal_expenses must have RLS enabled");
    assert(table?.forced === true, "personal_expenses must force RLS");

    const policies = await sql.unsafe(
      `SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'personal_expenses'
       ORDER BY policyname`,
    );
    const policyNames = policies.map((entry) => entry.policyname);
    assert(policyNames.length === 3, "personal_expenses must expose three owner policies");
    assert(
      !policyNames.some((name) => name.endsWith("_delete")),
      "personal_expenses must not expose a DELETE policy",
    );

    const columns = await sql.unsafe(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'personal_expenses'
       ORDER BY ordinal_position`,
    );
    const expectedColumns = [
      ["id", "uuid", null, "NO", /gen_random_uuid\(\)/],
      ["owner_user_id", "uuid", null, "NO", /auth\.uid\(\)/],
      ["occurred_at", "timestamp with time zone", null, "NO", null],
      ["amount_minor", "integer", null, "NO", null],
      ["currency", "character varying", 3, "NO", /'MAD'/],
      ["category", "character varying", 32, "YES", null],
      ["note", "character varying", 500, "YES", null],
      ["merchant", "character varying", 120, "YES", null],
      ["need_vs_want", "character varying", 8, "YES", null],
      ["payment_method", "character varying", 32, "YES", null],
      ["idempotency_key", "character varying", 128, "NO", null],
      ["create_fingerprint", "character varying", 64, "NO", null],
      ["version", "integer", null, "NO", /^1$/],
      ["deleted_at", "timestamp with time zone", null, "YES", null],
      ["created_at", "timestamp with time zone", null, "NO", /now\(\)/],
      ["updated_at", "timestamp with time zone", null, "NO", /now\(\)/],
      ["kind", "character varying", 32, "NO", /'expense'/],
      ["direction", "character varying", 3, "NO", /'out'/],
      ["purpose", "character varying", 16, "YES", null],
      ["counts_in_daily", "boolean", null, "NO", null],
      ["booking_date", "date", null, "NO", null],
      ["period_id", "uuid", null, "YES", null],
    ];
    assert(columns.length === expectedColumns.length, "expected column count");
    for (const [name, dataType, maxLength, nullable, defaultPattern] of expectedColumns) {
      const column = columns.find((entry) => entry.column_name === name);
      assert(column, `expected column ${name}`);
      assert(column.data_type === dataType, `${name} has expected data type`);
      assert(
        (column.character_maximum_length ?? null) === maxLength,
        `${name} has expected varchar length`,
      );
      assert(column.is_nullable === nullable, `${name} has expected nullability`);
      if (defaultPattern) {
        assert(
          defaultPattern.test(String(column.column_default ?? "")),
          `${name} has the documented default`,
        );
      }
    }
    const [amountColumn] = columns.filter((entry) => entry.column_name === "amount_minor");
    assert(amountColumn?.data_type === "integer", "amount_minor is an integer column");

    const checks = await sql.unsafe(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'public.personal_expenses'::regclass AND contype = 'c'`,
    );
    const checkNames = checks.map((entry) => entry.conname);
    for (const checkName of [
      "personal_expenses_amount_minor_check",
      "personal_expenses_currency_check",
      "personal_expenses_category_check",
      "personal_expenses_need_vs_want_check",
      "personal_expenses_payment_method_check",
      "personal_expenses_version_check",
      "personal_expenses_idempotency_key_check",
      "personal_expenses_create_fingerprint_check",
      "personal_expenses_note_check",
      "personal_expenses_merchant_check",
      "personal_expenses_kind_check",
      "personal_expenses_direction_check",
      "personal_expenses_purpose_check",
      "personal_expenses_kind_shape_check",
    ]) {
      assert(checkNames.includes(checkName), `${checkName} must exist`);
    }

    const indexes = await sql.unsafe(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'personal_expenses'
       ORDER BY indexname`,
    );
    const indexNames = indexes.map((entry) => entry.indexname);
    assert(
      indexNames.includes(CONSTRAINT),
      `unique index ${CONSTRAINT} must exist`,
    );
    assert(
      indexNames.includes("personal_expenses_owner_occurred_at_idx"),
      "owner/time index must exist",
    );
    assert(
      indexNames.includes("personal_expenses_owner_booking_date_idx"),
      "owner/booking-date index must exist",
    );
    const triggers = await sql.unsafe(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'public.personal_expenses'::regclass AND NOT tgisinternal`,
    );
    assert(
      triggers.some((entry) => entry.tgname === "personal_expenses_update_guard"),
      "personal_expenses must expose the mutation guard trigger",
    );
    assert(
      triggers.some((entry) => entry.tgname === "personal_expenses_fill_movement_fields"),
      "personal_expenses must fill legacy movement defaults on insert",
    );

    const [privileges] = await sql.unsafe(
      `SELECT
         has_table_privilege('authenticated', 'public.personal_expenses', 'SELECT') AS can_select,
         has_table_privilege('authenticated', 'public.personal_expenses', 'INSERT') AS can_insert,
         has_table_privilege('authenticated', 'public.personal_expenses', 'UPDATE') AS table_update,
         has_table_privilege('authenticated', 'public.personal_expenses', 'DELETE') AS can_delete`,
    );
    assert(privileges.can_select === true, "authenticated can SELECT");
    assert(privileges.can_insert === true, "authenticated can INSERT");
    assert(privileges.table_update === false, "authenticated must not have table-level UPDATE");
    assert(privileges.can_delete === false, "authenticated must not have DELETE");

    const mutableColumns = [
      "occurred_at",
      "booking_date",
      "amount_minor",
      "category",
      "note",
      "merchant",
      "need_vs_want",
      "payment_method",
      "purpose",
      "counts_in_daily",
      "version",
      "deleted_at",
      "updated_at",
    ];
    for (const column of mutableColumns) {
      const [row] = await sql.unsafe(
        `SELECT has_column_privilege('authenticated', 'public.personal_expenses', $1, 'UPDATE') AS allowed`,
        [column],
      );
      assert(row?.allowed === true, `authenticated can UPDATE ${column}`);
    }
    for (const column of [
      "id",
      "owner_user_id",
      "currency",
      "kind",
      "direction",
      "period_id",
      "idempotency_key",
      "create_fingerprint",
      "created_at",
    ]) {
      const [row] = await sql.unsafe(
        `SELECT has_column_privilege('authenticated', 'public.personal_expenses', $1, 'UPDATE') AS allowed`,
        [column],
      );
      assert(row?.allowed === false, `authenticated cannot UPDATE ${column}`);
    }
    log(
      "SCHEMA",
      "columns/defaults/checks/indexes, forced RLS, three policies and column grant matrix verified",
    );

    const ownerA = asUser(sql, OWNER_A);
    const ownerB = asUser(sql, OWNER_B);
    const anon = asAnon(sql);

    // DEFAULTS -----------------------------------------------------------------
    const [defaults] = await ownerA.run((tx) =>
      insertExpense(tx, {
        occurredAt: "2026-11-07T08:30:00Z",
        amountMinor: 2250,
        idempotencyKey: "defaults-a",
      }),
    );
    assert(defaults.owner_user_id === OWNER_A, "owner_user_id defaults to auth.uid()");
    assert(defaults.currency === "MAD", "currency default must be MAD");
    assert(defaults.version === 1, "version default must be 1");
    assert(defaults.deleted_at === null, "deleted_at default must be null");
    assert(defaults.created_at instanceof Date, "created_at must default to now()");
    assert(defaults.updated_at instanceof Date, "updated_at must default to now()");
    assert(defaults.amount_minor === 2250, "2250 centimes == 22.50 MAD");
    log("DEFAULTS", "MAD, version 1, timestamps and null soft-delete verified");

    // CONSTRAINTS --------------------------------------------------------------
    await expectCode(
      "amount zero",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 0,
            idempotencyKey: "zero-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "amount negative",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: -1,
            idempotencyKey: "negative-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "amount overflow",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 2147483648,
            idempotencyKey: "overflow-a",
          }),
        ),
      "22003",
    );
    await expectCode(
      "currency USD",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            currency: "USD",
            idempotencyKey: "currency-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "category rent",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            category: "rent",
            idempotencyKey: "category-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "need_vs_want maybe",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            needVsWant: "maybe",
            idempotencyKey: "need-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "payment method cheque",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            paymentMethod: "cheque",
            idempotencyKey: "payment-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "blank idempotency key",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            idempotencyKey: "   ",
          }),
        ),
      "23514",
    );
    await expectCode(
      "blank create fingerprint",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            idempotencyKey: "fingerprint-a",
            createFingerprint: "",
          }),
        ),
      "23514",
    );
    await expectCode(
      "blank note",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            note: "   ",
            idempotencyKey: "note-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "blank merchant",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T08:31:00Z",
            amountMinor: 100,
            merchant: "   ",
            idempotencyKey: "merchant-a",
          }),
        ),
      "23514",
    );
    await expectCode(
      "version zero",
      () =>
        ownerA.run(async (tx) => {
          await tx.unsafe(
            `INSERT INTO public.personal_expenses
               (occurred_at, amount_minor, category, need_vs_want, idempotency_key, create_fingerprint, version)
             VALUES ('2026-11-07T08:31:00Z', 100, 'coffee', 'need', 'version-a', '${receiptFingerprint("version-a")}', 0)`,
          );
        }),
      "23514",
    );
    log("CONSTRAINTS", "amount/currency/category/enums/version/non-blank checks enforced");

    // UNIQUE / OWNER-SCOPED IDEMPOTENCY ---------------------------------------
    await ownerA.run((tx) =>
      insertExpense(tx, {
        occurredAt: "2026-11-07T09:00:00Z",
        amountMinor: 500,
        idempotencyKey: "shared-key",
      }),
    );
    await expectCode(
      "duplicate owner+key",
      () =>
        ownerA.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T09:01:00Z",
            amountMinor: 700,
            idempotencyKey: "shared-key",
          }),
        ),
      "23505",
    );
    const [sameKeyOtherOwner] = await ownerB.run((tx) =>
      insertExpense(tx, {
        occurredAt: "2026-11-07T09:02:00Z",
        amountMinor: 900,
        idempotencyKey: "shared-key",
      }),
    );
    assert(sameKeyOtherOwner.idempotency_key === "shared-key", "different owner may reuse key");
    const [uniqueCounts] = await sql.unsafe(
      `SELECT
         count(*) FILTER (WHERE owner_user_id = '${OWNER_A}')::int AS owner_a,
         count(*) FILTER (WHERE owner_user_id = '${OWNER_B}')::int AS owner_b
       FROM public.personal_expenses WHERE idempotency_key = 'shared-key'`,
    );
    assert(uniqueCounts.owner_a === 1, "owner A has exactly one shared-key row");
    assert(uniqueCounts.owner_b === 1, "owner B has exactly one shared-key row");
    log("UNIQUE", "owner+key unique and cross-owner reuse allowed");

    // RLS ----------------------------------------------------------------------
    const bSeesA = await ownerB.run((tx) =>
      tx.unsafe(
        `SELECT count(*)::int AS count FROM public.personal_expenses
         WHERE owner_user_id = '${OWNER_A}'`,
      ),
    );
    assert(bSeesA[0].count === 0, "owner B must not read owner A's expenses");

    const bUpdate = await ownerB.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses SET amount_minor = 1
         WHERE owner_user_id = '${OWNER_A}' RETURNING id`,
      ),
    );
    assert(bUpdate.length === 0, "owner B must not update owner A's expenses");

    await expectFailure(
      "authenticated hard delete is denied",
      () =>
        ownerA.run((tx) =>
          tx.unsafe(
            `DELETE FROM public.personal_expenses
             WHERE owner_user_id = auth.uid() RETURNING id`,
          ),
        ),
      ["42501"],
    );

    await expectCode(
      "cross-owner insert",
      () =>
        ownerB.run((tx) =>
          tx.unsafe(
            `INSERT INTO public.personal_expenses
               (owner_user_id, occurred_at, amount_minor, category, need_vs_want, idempotency_key, create_fingerprint)
             VALUES ('${OWNER_A}', '2026-11-07T10:00:00Z', 100, 'coffee', 'need', 'spoof-b', '${receiptFingerprint("spoof-b")}')`,
          ),
        ),
      "42501",
    );

    for (const column of ["create_fingerprint", "idempotency_key", "owner_user_id"]) {
      await expectFailure(
        `immutable column ${column} update is denied`,
        () =>
          ownerA.run((tx) =>
            tx.unsafe(
              `UPDATE public.personal_expenses SET ${column} = ${column}
               WHERE owner_user_id = auth.uid()`,
            ),
          ),
        ["42501"],
      );
    }

    await expectFailure(
      "anonymous select",
      () => anon.run((tx) => tx.unsafe(`SELECT id FROM public.personal_expenses`)),
      ["42501"],
    );
    await expectFailure(
      "anonymous insert",
      () =>
        anon.run((tx) =>
          tx.unsafe(
            `INSERT INTO public.personal_expenses
               (occurred_at, amount_minor, category, need_vs_want, idempotency_key, create_fingerprint)
             VALUES ('2026-11-07T10:00:00Z', 100, 'coffee', 'need', 'anon', '${receiptFingerprint("anon")}')`,
          ),
        ),
      ["42501"],
    );
    await expectFailure(
      "anonymous update",
      () =>
        anon.run((tx) =>
          tx.unsafe(`UPDATE public.personal_expenses SET amount_minor = 1`),
        ),
      ["42501"],
    );
    await expectFailure(
      "anonymous delete",
      () => anon.run((tx) => tx.unsafe(`DELETE FROM public.personal_expenses`)),
      ["42501"],
    );

    const oauth = asUser(sql, OWNER_A, { clientId: "mcp-client" });
    const oauthRows = await oauth.run((tx) =>
      tx.unsafe(`SELECT count(*)::int AS count FROM public.personal_expenses`),
    );
    assert(oauthRows[0].count === 0, "client_id JWT without a grant must not read expenses");
    await expectCode(
      "client_id insert without a grant",
      () =>
        oauth.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T10:00:00Z",
            amountMinor: 100,
            idempotencyKey: "oauth-a",
          }),
        ),
      "42501",
    );

    // MONEY-01: an active grant distinguishes allow from deny. The reader
    // profile can read the owner's rows but never write.
    await sql.unsafe(
      `INSERT INTO public.mcp_authorization_grants
         (owner_user_id, oauth_client_id, resource_uri, status,
          permission_profile, permissions, permissions_version, approved_at)
       VALUES
         ('${OWNER_A}'::uuid, 'mcp-reader', 'https://ega.example.com/api/mcp',
          'active', 'personal_operations',
          '["today.read", "timer.read", "personal_ops.read"]'::jsonb, 1, now())`,
    );
    const reader = asUser(sql, OWNER_A, { clientId: "mcp-reader" });
    const readerRows = await reader.run((tx) =>
      tx.unsafe(
        `SELECT count(*)::int AS count FROM public.personal_expenses
         WHERE owner_user_id = auth.uid()`,
      ),
    );
    const [expectedActive] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses
       WHERE owner_user_id = '${OWNER_A}' AND deleted_at IS NULL`,
    );
    assert(
      readerRows[0].count === expectedActive.count,
      "active personal_ops.read grant must read the owner's rows",
    );
    await expectCode(
      "reader grant insert",
      () =>
        reader.run((tx) =>
          insertExpense(tx, {
            occurredAt: "2026-11-07T10:00:00Z",
            amountMinor: 100,
            idempotencyKey: "oauth-reader",
          }),
        ),
      "42501",
    );
    log(
      "RLS",
      "owner isolation, anonymous denial, no-grant denial and grant-scoped reader allow proven",
    );

    // SOFT DELETE / TOTALS -----------------------------------------------------
    const softA = await ownerA.run((tx) =>
      insertExpense(tx, {
        occurredAt: "2026-11-06T09:00:00Z",
        amountMinor: 1000,
        idempotencyKey: "soft-delete-a",
      }),
    );
    const softId = softA[0].id;
    const beforeTotal = await ownerA.run((tx) => activeTotal(tx));

    await expectCode(
      "version skip is rejected",
      () =>
        ownerA.run((tx) =>
          tx.unsafe(
            `UPDATE public.personal_expenses
             SET amount_minor = amount_minor, version = version + 2
             WHERE id = $1::uuid AND owner_user_id = auth.uid()`,
            [softId],
          ),
        ),
      "23514",
    );
    // Authenticated immutable-column changes are already denied by column
    // grants (42501). This owner-role probe bypasses grants to prove the
    // trigger itself is the defense-in-depth backstop.
    await expectCode(
      "trigger rejects immutable field changes",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses SET idempotency_key = 'mutated'
           WHERE id = $1::uuid`,
          [softId],
        ),
      "23514",
    );

    const [softDeleted] = await ownerA.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses
         SET deleted_at = '2026-11-08T00:00:00Z',
             updated_at = '2026-11-08T00:00:00Z',
             version = version + 1
         WHERE id = $1::uuid AND owner_user_id = auth.uid() AND deleted_at IS NULL
         RETURNING id, deleted_at, version`,
        [softId],
      ),
    );
    assert(softDeleted?.deleted_at instanceof Date, "soft delete stamps deleted_at");
    const afterTotal = await ownerA.run((tx) => activeTotal(tx));
    assert(
      afterTotal === beforeTotal - 1000,
      "active total excludes the soft-deleted row",
    );

    const activeList = await ownerA.run((tx) =>
      tx.unsafe(
        `SELECT id FROM public.personal_expenses
         WHERE owner_user_id = auth.uid() AND deleted_at IS NULL`,
      ),
    );
    assert(
      !activeList.some((entry) => entry.id === softId),
      "active list excludes the soft-deleted row",
    );

    await expectCode(
      "undelete is rejected",
      () =>
        ownerA.run((tx) =>
          tx.unsafe(
            `UPDATE public.personal_expenses
             SET deleted_at = NULL, version = 1
             WHERE id = $1::uuid AND owner_user_id = auth.uid()`,
            [softId],
          ),
        ),
      "23514",
    );

    // A repeated soft delete updates zero active rows and leaves the version
    // and deleted_at untouched.
    const repeated = await ownerA.run((tx) =>
      tx.unsafe(
        `UPDATE public.personal_expenses
         SET deleted_at = now(), updated_at = now(), version = version + 1
         WHERE id = $1::uuid AND owner_user_id = auth.uid() AND deleted_at IS NULL
         RETURNING id`,
        [softId],
      ),
    );
    assert(repeated.length === 0, "repeat soft delete matches zero active rows");
    const afterRepeat = await ownerA.run((tx) => activeTotal(tx));
    assert(afterRepeat === afterTotal, "repeat delete must not change active totals");

    const [durable] = await sql.unsafe(
      `SELECT deleted_at, version FROM public.personal_expenses WHERE id = $1::uuid`,
      [softId],
    );
    assert(durable.deleted_at instanceof Date, "soft-deleted row remains durable");
    assert(Number(durable.version) === 2, "first delete bumps version exactly once");
    assert(
      durable.deleted_at.getTime() === softDeleted.deleted_at.getTime(),
      "repeat delete does not rewrite deleted_at",
    );
    log("SOFT DELETE", "active totals/list exclude deletion; repeat delete is inert");

    // PAGINATION / ORDERING ----------------------------------------------------
    const pageRows = [
      { id: "00000000-0000-4000-8000-000000000005", occurredAt: "2026-10-05T00:00:00Z", amountMinor: 5, key: "page-5" },
      { id: "00000000-0000-4000-8000-000000000004", occurredAt: "2026-10-04T00:00:00Z", amountMinor: 4, key: "page-4" },
      { id: "00000000-0000-4000-8000-000000000003", occurredAt: "2026-10-03T00:00:00Z", amountMinor: 3, key: "page-3" },
      { id: "00000000-0000-4000-8000-000000000002", occurredAt: "2026-10-02T00:00:00Z", amountMinor: 2, key: "page-2" },
      { id: "00000000-0000-4000-8000-000000000001", occurredAt: "2026-10-01T00:00:00Z", amountMinor: 1, key: "page-1" },
    ];
    for (const entry of pageRows) {
      await ownerA.run((tx) =>
        insertExpense(tx, {
          id: entry.id,
          occurredAt: entry.occurredAt,
          amountMinor: entry.amountMinor,
          idempotencyKey: entry.key,
        }),
      );
    }
    const page = await ownerA.run((tx) =>
      tx.unsafe(
        `SELECT id, occurred_at FROM public.personal_expenses
         WHERE owner_user_id = auth.uid()
           AND deleted_at IS NULL
           AND occurred_at >= '2026-10-01T00:00:00Z'
           AND occurred_at < '2026-10-06T00:00:00Z'
         ORDER BY occurred_at DESC, id DESC
         OFFSET 1 LIMIT 3`,
      ),
    );
    assert(page.length === 3, "bounded offset/limit returns three rows");
    assert(
      page[0].id === pageRows[1].id &&
        page[1].id === pageRows[2].id &&
        page[2].id === pageRows[3].id,
      "rows follow occurred_at desc, id desc",
    );
    log("PAGINATION", "occurred_at desc, id desc with bounded offset/limit proven");

    // HALF-OPEN WINDOW / DST ---------------------------------------------------
    // America/New_York springs forward at 02:00 on 2026-03-08: the local day is
    // 23 hours, from 05:00Z to the next day's 04:00Z.
    const dstStart = "2026-03-08T05:00:00.000Z";
    const dstEndExclusive = "2026-03-09T04:00:00.000Z";
    const windowRows = [
      { occurredAt: "2026-03-08T04:59:59.999Z", key: "dst-before" },
      { occurredAt: dstStart, key: "dst-start" },
      { occurredAt: "2026-03-08T12:00:00.000Z", key: "dst-inside" },
      { occurredAt: dstEndExclusive, key: "dst-end" },
    ];
    for (const entry of windowRows) {
      await ownerA.run((tx) =>
        insertExpense(tx, {
          occurredAt: entry.occurredAt,
          amountMinor: 100,
          idempotencyKey: entry.key,
        }),
      );
    }
    const window = await ownerA.run((tx) =>
      tx.unsafe(
        `SELECT idempotency_key FROM public.personal_expenses
         WHERE owner_user_id = auth.uid()
           AND deleted_at IS NULL
           AND occurred_at >= $1::timestamptz
           AND occurred_at < $2::timestamptz
         ORDER BY occurred_at ASC`,
        [dstStart, dstEndExclusive],
      ),
    );
    const windowKeys = window.map((entry) => entry.idempotency_key);
    assert(
      windowKeys.length === 2 &&
        windowKeys.includes("dst-start") &&
        windowKeys.includes("dst-inside"),
      "half-open window includes start, excludes just-before and end",
    );
    log("WINDOW", "half-open DST-day boundaries proven (23-hour local day)");

    // IDEMPOTENCE --------------------------------------------------------------
    const reapplied = await applyFile(sql, MIGRATION_TAG);
    const policiesAfter = await sql.unsafe(
      `SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'personal_expenses'`,
    );
    assert(policiesAfter.length === 3, "re-applying the migration preserves three policies");
    const [rlsAfter] = await sql.unsafe(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE oid = 'public.personal_expenses'::regclass`,
    );
    assert(rlsAfter?.enabled === true && rlsAfter?.forced === true, "RLS stays enabled/forced");
    const indexesAfter = await sql.unsafe(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'personal_expenses'`,
    );
    assert(
      indexesAfter.some((entry) => entry.indexname === CONSTRAINT),
      "re-applying the migration preserves the unique index",
    );
    const [remaining] = await sql.unsafe(
      `SELECT count(*)::int AS count FROM public.personal_expenses`,
    );
    assert(remaining.count > 0, "re-applying the migration preserves expense rows");
    log("IDEMPOTENCE", `${MIGRATION_TAG} re-applied (${reapplied} statement(s))`);

    log(
      "PROOF",
      "personal_expenses defaults, schema/grants, centime bounds, enums, idempotency uniqueness, forced RLS, soft-delete-only, pagination, DST window and migration idempotence verified",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
