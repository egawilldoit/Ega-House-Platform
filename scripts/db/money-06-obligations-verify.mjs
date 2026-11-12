#!/usr/bin/env node
/**
 * Ephemeral-database proof for MONEY-06 obligation occurrences.
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim,
 * including the 0043 reconciliation owner `ab.mortaki@gmail.com`) to a
 * disposable Postgres, then proves at the real persistence boundary:
 *
 *   SCHEMA     - templates and occurrences exist, are owner-scoped, and the
 *                canonical personal_expenses ledger is extended, not replaced.
 *   RECURRENCE - one occurrence per owner+template+period; a cross-owner
 *                template reference is rejected; editing a template never
 *                rewrites an existing occurrence snapshot.
 *   LIFECYCLE  - pending -> cancelled/waived and reopen are accepted with
 *                retained effective dates and +1 versions; a status-only paid
 *                change, a paid -> cancelled change and an edit of a paid
 *                occurrence's amount are rejected.
 *   PAYMENT    - paid requires exactly one linked payment (same owner, MAD,
 *                undeleted, full amount) or flagged historical import evidence;
 *                partial, over, foreign and duplicate payments are rejected;
 *                generic expense edits/soft delete of a linked payment fail.
 *   RLS        - a reader grant reads but cannot insert/update; a writer grant
 *                can; no grant, revoked/pending/wrong-resource and cross-owner
 *                tokens read nothing. There is no DELETE path.
 *
 * Usage:
 *   node scripts/db/money-06-obligations-verify.mjs --url <postgres-url>
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

const TEMPLATE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OCCURRENCE_TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OCCURRENCE_CANCEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OCCURRENCE_LINK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OCCURRENCE_LINK_TWO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OCCURRENCE_HISTORY = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OCCURRENCE_BAD_HISTORY = "12121212-1212-4212-8212-121212121212";
const OCCURRENCE_INSERTED_BY_WRITER = "13131313-1313-4313-8313-131313131313";

const EXPENSE_EXACT = "14141414-1414-4414-8414-141414141414";
const EXPENSE_SMALL = "15151515-1515-4515-8515-151515151515";
const EXPENSE_OVER = "16161616-1616-4616-8616-161616161616";
const EXPENSE_OTHER_OWNER = "18181818-1818-4818-8818-181818181818";

const READ_PERMISSIONS = ["today.read", "timer.read", "personal_ops.read"];
const WRITE_PERMISSIONS = [...READ_PERMISSIONS, "personal_ops.write"];

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

function fingerprint(label) {
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
  // Migration 0043 reconciliation requires this owner to exist.
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

async function expectDenied(label, fn, expectedCode) {
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

async function expectAccepted(label, fn) {
  try {
    const result = await fn();
    log("ACCEPTED", label);
    return result;
  } catch (error) {
    console.error(`[PROOF] FAILED: ${label} was rejected: ${error.message}`);
    exit(1);
  }
}

function insertTemplate(tx, input) {
  return tx.unsafe(
    `INSERT INTO public.money_obligation_templates
       (id, owner_user_id, kind, description, amount_minor, currency, cadence,
        due_day_of_month, due_weekday, start_date, need_vs_want, purpose,
        counts_in_daily, category, idempotency_key, create_fingerprint)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'MAD', $6, $7, $8, $9::date,
             $10, $11, $12, $13, $14, $15)
     RETURNING id, version`,
    [
      input.id,
      input.owner,
      input.kind ?? "bill",
      input.description ?? "Internet",
      input.amount ?? 10000,
      input.cadence ?? "monthly",
      input.dueDayOfMonth ?? 15,
      input.dueWeekday ?? null,
      input.startDate ?? "2026-01-01",
      input.needVsWant ?? null,
      input.purpose ?? null,
      input.countsInDaily ?? null,
      input.category ?? null,
      input.key ?? `template-${input.id}`,
      fingerprint(input.key ?? `template-${input.id}`),
    ],
  );
}

function insertOccurrence(tx, input) {
  return tx.unsafe(
    `INSERT INTO public.money_obligations
       (id, owner_user_id, template_id, kind, description, amount_minor,
        currency, period_start, period_end, due_date, need_vs_want, purpose,
        counts_in_daily, category, state, state_effective_date, payment_expense_id,
        payment_evidence, idempotency_key, create_fingerprint)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'MAD', $7::date,
             $8::date, $9::date, $10, $11, $12, $13, $14, $15::date,
             $16::uuid, $17::jsonb, $18, $19)
     RETURNING id, version, amount_minor, purpose, category`,
    [
      input.id,
      input.owner,
      input.templateId ?? null,
      input.kind ?? "bill",
      input.description ?? "Rent",
      input.amount ?? 10000,
      input.periodStart ?? "2026-11-01",
      input.periodEnd ?? "2026-11-30",
      input.dueDate ?? "2026-11-15",
      input.needVsWant ?? null,
      input.purpose ?? "fixed",
      input.countsInDaily ?? false,
      input.category ?? "bills",
      input.state ?? "pending",
      input.effective ?? "2026-11-01",
      input.paymentExpenseId ?? null,
      input.evidence ? tx.json(input.evidence) : null,
      input.key ?? `occurrence-${input.id}`,
      fingerprint(input.key ?? `occurrence-${input.id}`),
    ],
  );
}

function insertExpense(tx, input) {
  return tx.unsafe(
    `INSERT INTO public.personal_expenses
       (id, owner_user_id, occurred_at, amount_minor, currency, category,
        note, merchant, need_vs_want, payment_method, idempotency_key,
        create_fingerprint)
     VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4, 'MAD', $5, null, null,
             $6, null, $7, $8)
     RETURNING id, amount_minor, version`,
    [
      input.id,
      input.owner,
      input.occurredAt ?? "2026-11-15T09:00:00Z",
      input.amount,
      input.category ?? "bills",
      input.needVsWant ?? "need",
      input.key ?? `expense-${input.id}`,
      fingerprint(input.key ?? `expense-${input.id}`),
    ],
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
    assert(
      tags.includes("0098_money_06_obligations"),
      "journal must include the MONEY-06 migration",
    );

    // SCHEMA -----------------------------------------------------------------
    const tables = await sql.unsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('money_obligation_templates', 'money_obligations',
                            'personal_expenses')
       ORDER BY table_name`,
    );
    assert(tables.length === 3, "template, occurrence and ledger tables exist");
    const ledgerColumns = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'personal_expenses'
       ORDER BY column_name`,
    );
    assert(
      ledgerColumns.some((column) => column.column_name === "amount_minor"),
      "the canonical ledger keeps its existing columns",
    );

    await insertTemplate(sql, {
      id: TEMPLATE_A,
      owner: OWNER_A,
      amount: 10000,
      key: "template-a",
    });
    await insertOccurrence(sql, {
      id: OCCURRENCE_TEMPLATE,
      owner: OWNER_A,
      templateId: TEMPLATE_A,
      key: "occ-template",
    });
    log("SCHEMA", "template and occurrence created in pending state");

    // RECURRENCE -------------------------------------------------------------
    await expectDenied(
      "duplicate occurrence for the same template period",
      () =>
        insertOccurrence(sql, {
          id: "19191919-1919-4919-8919-191919191919",
          owner: OWNER_A,
          templateId: TEMPLATE_A,
          key: "occ-template-duplicate",
        }),
      "23505",
    );
    await expectDenied(
      "occurrence referencing another owner's template",
      () =>
        insertOccurrence(sql, {
          id: "20202020-2020-4020-8020-202020202020",
          owner: OWNER_B,
          templateId: TEMPLATE_A,
          key: "occ-cross-template",
        }),
      "42501",
    );

    await expectAccepted("template edit", () =>
      sql.unsafe(
        `UPDATE public.money_obligation_templates
         SET amount_minor = 20000, description = 'Internet (raised)',
             version = version + 1, updated_at = now()
         WHERE id = $1::uuid`,
        [TEMPLATE_A],
      ),
    );
    const [snapshot] = await sql.unsafe(
      `SELECT amount_minor, description, purpose, category
       FROM public.money_obligations WHERE id = $1::uuid`,
      [OCCURRENCE_TEMPLATE],
    );
    assert(
      Number(snapshot.amount_minor) === 10000,
      "editing the template must not rewrite the occurrence amount",
    );
    assert(
      snapshot.description === "Rent",
      "editing the template must not rewrite the occurrence description",
    );
    log("RECURRENCE", "template edit left the existing occurrence snapshot intact");

    // LIFECYCLE --------------------------------------------------------------
    await insertOccurrence(sql, {
      id: OCCURRENCE_CANCEL,
      owner: OWNER_A,
      key: "occ-cancel",
    });
    let [cancelVersion] = await sql.unsafe(
      `UPDATE public.money_obligations
       SET state = 'cancelled', state_effective_date = '2026-11-20',
           state_reason = 'Duplicate bill', version = version + 1, updated_at = now()
       WHERE id = $1::uuid
       RETURNING version`,
      [OCCURRENCE_CANCEL],
    );
    assert(Number(cancelVersion.version) === 2, "cancel bumps version to 2");
    await expectAccepted("reopen cancelled occurrence", () =>
      sql.unsafe(
        `UPDATE public.money_obligations
         SET state = 'pending', state_effective_date = '2026-11-21',
             version = version + 1, updated_at = now()
         WHERE id = $1::uuid`,
        [OCCURRENCE_CANCEL],
      ),
    );
    const [history] = await sql.unsafe(
      `SELECT state_history FROM public.money_obligations WHERE id = $1::uuid`,
      [OCCURRENCE_CANCEL],
    );
    assert(Array.isArray(history.state_history), "state history is an array");
    assert(history.state_history.length === 2, "waive/cancel and reopen are retained");
    assert(history.state_history[0].state === "cancelled", "first transition retained");
    assert(history.state_history[1].state === "pending", "reopen transition retained");
    await expectDenied(
      "status-only paid without a payment link",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET state = 'paid', state_effective_date = '2026-11-22',
               version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [OCCURRENCE_CANCEL],
        ),
      "23514",
    );
    await expectDenied(
      "effective date moving backwards",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET state = 'waived', state_effective_date = '2026-11-01',
               version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [OCCURRENCE_CANCEL],
        ),
      "23514",
    );
    await expectDenied(
      "version not increasing by exactly one",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET description = 'Rent (relabelled)', version = version + 2,
               updated_at = now()
           WHERE id = $1::uuid`,
          [OCCURRENCE_TEMPLATE],
        ),
      "23514",
    );
    await expectDenied(
      "paid -> cancelled without resolving the payment",
      async () => {
        await sql.unsafe(
          `INSERT INTO public.personal_expenses
             (id, owner_user_id, occurred_at, amount_minor, category,
              need_vs_want, idempotency_key, create_fingerprint)
           VALUES ($1::uuid, $2::uuid, '2026-11-15T09:00:00Z', 10000, 'bills',
                   'need', 'late-expense', $3)`,
          [
            "21212121-2121-4121-8121-212121212121",
            OWNER_A,
            fingerprint("late-expense"),
          ],
        );
        await insertOccurrence(sql, {
          id: "22222222-2222-4222-8222-222222222222",
          owner: OWNER_A,
          key: "occ-paid-cancel",
        });
        await sql.unsafe(
          `UPDATE public.money_obligations
           SET payment_expense_id = '21212121-2121-4121-8121-212121212121'::uuid,
               state = 'paid', state_effective_date = '2026-11-15',
               version = version + 1, updated_at = now()
           WHERE id = '22222222-2222-4222-8222-222222222222'::uuid`,
        );
        await sql.unsafe(
          `UPDATE public.money_obligations
           SET state = 'cancelled', state_effective_date = '2026-11-16',
               version = version + 1, updated_at = now()
           WHERE id = '22222222-2222-4222-8222-222222222222'::uuid`,
        );
      },
      "23514",
    );
    log("LIFECYCLE", "explicit transitions enforced; paid cannot be waived/cancelled");

    // PAYMENT ----------------------------------------------------------------
    await insertExpense(sql, { id: EXPENSE_EXACT, owner: OWNER_A, amount: 10000, key: "pay-exact" });
    await insertExpense(sql, { id: EXPENSE_SMALL, owner: OWNER_A, amount: 5000, key: "pay-small" });
    await insertExpense(sql, { id: EXPENSE_OVER, owner: OWNER_A, amount: 10001, key: "pay-over" });
    await insertExpense(sql, { id: EXPENSE_OTHER_OWNER, owner: OWNER_B, amount: 10000, key: "pay-other" });
    await insertOccurrence(sql, {
      id: OCCURRENCE_LINK,
      owner: OWNER_A,
      key: "occ-link",
    });

    for (const [label, expenseId, code] of [
      ["partial payment", EXPENSE_SMALL, "23514"],
      ["overpayment", EXPENSE_OVER, "23514"],
      ["cross-owner payment", EXPENSE_OTHER_OWNER, "42501"],
    ]) {
      await expectDenied(
        label,
        () =>
          sql.unsafe(
            `UPDATE public.money_obligations
             SET payment_expense_id = $2::uuid, state = 'paid',
                 state_effective_date = '2026-11-15', version = version + 1,
                 updated_at = now()
             WHERE id = $1::uuid`,
            [OCCURRENCE_LINK, expenseId],
          ),
        code,
      );
    }

    await expectAccepted("exact full payment link", () =>
      sql.unsafe(
        `UPDATE public.money_obligations
         SET payment_expense_id = $2::uuid, state = 'paid',
             state_effective_date = '2026-11-15', version = version + 1,
             updated_at = now()
         WHERE id = $1::uuid`,
        [OCCURRENCE_LINK, EXPENSE_EXACT],
      ),
    );

    await insertOccurrence(sql, {
      id: OCCURRENCE_LINK_TWO,
      owner: OWNER_A,
      key: "occ-link-two",
    });
    await expectDenied(
      "one payment reused for a second occurrence",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET payment_expense_id = $2::uuid, state = 'paid',
               state_effective_date = '2026-11-15', version = version + 1,
               updated_at = now()
           WHERE id = $1::uuid`,
          [OCCURRENCE_LINK_TWO, EXPENSE_EXACT],
        ),
      "23505",
    );
    await expectDenied(
      "re-pricing a paid occurrence",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET amount_minor = 1, version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [OCCURRENCE_LINK],
        ),
      "23514",
    );
    await expectDenied(
      "editing a linked ledger payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET amount_minor = 100, version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [EXPENSE_EXACT],
        ),
      "23514",
    );
    await expectDenied(
      "soft-deleting a linked ledger payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET deleted_at = now(), version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [EXPENSE_EXACT],
        ),
      "23514",
    );
    await expectDenied(
      "re-dating a linked ledger payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET booking_date = '2026-11-30', version = version + 1, updated_at = now()
           WHERE id = $1::uuid`,
          [EXPENSE_EXACT],
        ),
      "23514",
    );

    await expectAccepted("paid occurrence with reconciled historical evidence", () =>
      insertOccurrence(sql, {
        id: OCCURRENCE_HISTORY,
        owner: OWNER_A,
        state: "paid",
        effective: "2026-10-15",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        dueDate: "2026-10-15",
        evidence: {
          kind: "reconciled_historical_import",
          reference: "workbook-2026-10",
          note: "Source row 42",
          importedAt: "2026-11-01T00:00:00.000Z",
        },
        key: "occ-history",
      }),
    );
    await expectDenied(
      "paid occurrence without payment or evidence",
      () =>
        insertOccurrence(sql, {
          id: OCCURRENCE_BAD_HISTORY,
          owner: OWNER_A,
          state: "paid",
          effective: "2026-10-15",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          dueDate: "2026-10-15",
          key: "occ-bad-history",
        }),
      "23514",
    );
    await expectDenied(
      "historical evidence without a reference",
      () =>
        insertOccurrence(sql, {
          id: "23232323-2323-4323-8323-232323232323",
          owner: OWNER_A,
          state: "paid",
          effective: "2026-10-15",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          dueDate: "2026-10-15",
          evidence: { kind: "reconciled_historical_import", reference: " " },
          key: "occ-bad-reference",
        }),
      "23514",
    );
    log("PAYMENT", "full owner-safe linked payment or disclosed historical evidence only");

    // RLS --------------------------------------------------------------------
    for (const [profile, permissions] of [
      ["personal_operations", READ_PERMISSIONS],
      ["personal_operations_writer", WRITE_PERMISSIONS],
    ]) {
      await seedGrant(sql, {
        owner: OWNER_A,
        clientId: `profile-${profile}`,
        profile,
        permissions,
      });
    }
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

    const reader = asUser(sql, OWNER_A, { clientId: "profile-personal_operations" });
    const readerRows = await reader.run((tx) =>
      tx.unsafe(`SELECT id FROM public.money_obligations`),
    );
    assert(readerRows.length >= 2, "reader grant reads the owner's occurrences");
    await expectDenied(
      "reader insert",
      () =>
        reader.run((tx) =>
          insertOccurrence(tx, {
            id: "24242424-2424-4424-8424-242424242424",
            owner: OWNER_A,
            key: "reader-insert",
          }),
        ),
      "42501",
    );
    const readerUpdate = await reader.run((tx) =>
      tx.unsafe(
        `UPDATE public.money_obligations
         SET description = 'reader edit', version = version + 1, updated_at = now()
         WHERE id = $1::uuid RETURNING id`,
        [OCCURRENCE_TEMPLATE],
      ),
    );
    assert(readerUpdate.length === 0, "reader grant must not update occurrences");
    const readerTemplates = await reader.run((tx) =>
      tx.unsafe(`SELECT id FROM public.money_obligation_templates`),
    );
    assert(readerTemplates.length === 1, "reader grant reads templates");
    await expectDenied(
      "reader template insert",
      () =>
        reader.run((tx) =>
          insertTemplate(tx, {
            id: "25252525-2525-4525-8525-252525252525",
            owner: OWNER_A,
            key: "reader-template",
          }),
        ),
      "42501",
    );

    const writer = asUser(sql, OWNER_A, {
      clientId: "profile-personal_operations_writer",
    });
    const writerInsert = await writer.run((tx) =>
      insertOccurrence(tx, {
        id: OCCURRENCE_INSERTED_BY_WRITER,
        owner: OWNER_A,
        description: "Writer bill",
        key: "writer-insert",
      }),
    );
    assert(writerInsert.length === 1, "writer grant inserts a pending occurrence");
    const writerUpdate = await writer.run((tx) =>
      tx.unsafe(
        `UPDATE public.money_obligations
         SET description = 'Writer edit', version = version + 1, updated_at = now()
         WHERE id = $1::uuid RETURNING id`,
        [OCCURRENCE_TEMPLATE],
      ),
    );
    assert(writerUpdate.length === 1, "writer grant updates an occurrence");

    for (const [label, clientId, ownerId] of [
      ["no grant", "no-grant-client", OWNER_A],
      ["revoked", "revoked-client", OWNER_A],
      ["pending", "pending-client", OWNER_A],
      ["wrong resource", "wrong-resource-client", OWNER_A],
      ["cross owner", "profile-personal_operations_writer", OWNER_B],
    ]) {
      const denied = asUser(sql, ownerId, { clientId });
      const rows = await denied.run((tx) =>
        tx.unsafe(`SELECT id FROM public.money_obligations`),
      );
      assert(rows.length === 0, `${label} token must read zero occurrences`);
    }

    const direct = asUser(sql, OWNER_A);
    const directRows = await direct.run((tx) =>
      tx.unsafe(`SELECT id FROM public.money_obligations`),
    );
    assert(directRows.length >= 2, "direct-user token keeps owner-scoped access");

    const deletePolicy = await sql.unsafe(
      `SELECT polname FROM pg_policy
       WHERE polrelid = 'public.money_obligations'::regclass
         AND polcmd IN ('d', '*')`,
    );
    assert(deletePolicy.length === 0, "no DELETE policy exists for occurrences");
    log(
      "RLS",
      "reader/writer/no-grant/revoked/pending/wrong-resource/cross-owner/direct behaviour verified; no DELETE path",
    );

    log(
      "DONE",
      "MONEY-06 recurrence identity, template snapshots, lifecycle, full-payment link, historical evidence and owner RLS verified",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
