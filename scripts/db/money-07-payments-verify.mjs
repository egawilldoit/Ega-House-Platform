#!/usr/bin/env node
/**
 * Ephemeral-database proof for MONEY-07 atomic obligation payments.
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, then proves at the real persistence boundary:
 *
 *   PAYMENT    - one occurrence is settled by exactly one canonical
 *                `personal_expenses` outflow: same amount, MAD, outflow, the
 *                payment date, the occurrence's category/purpose, need/want
 *                from the payment or the occurrence, and a fixed obligation
 *                excluded from daily spending.
 *   ATOMIC    - a failure inside the write leaves neither half committed, and
 *                a rejected input writes nothing at all.
 *   IDEMPOTENT - the same operation replays its original result; a different
 *                operation cannot pay an already-paid occurrence, and one
 *                operation cannot settle two occurrences.
 *   CORRECTION- the amount, the booking date and the daily flag move together
 *                with the occurrence, the full-payment equality holds, and a
 *                stale version is refused.
 *   UNDO      - the ledger outflow is soft-deleted and the occurrence reopens
 *                in one transaction.
 *   COHERENCE - paying X reduces recorded cash by X and the outstanding
 *                reserve by X, exactly once.
 *   ISOLATION - a cross-owner payment is refused, one payment cannot settle
 *                two occurrences, and a generic expense edit of a linked
 *                payment is still blocked.
 *   GRANTS    - a reader grant cannot pay, a writer grant can, and a token
 *                without the explicit personal_ops.write grant is refused.
 *
 * Usage:
 *   node scripts/db/money-07-payments-verify.mjs --url <postgres-url>
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

const PERIOD_A = "30000000-3000-4000-8000-300000000000";
const OCCURRENCE_PAY = "40000000-4000-4000-8000-400000000000";
const OCCURRENCE_SECOND = "40000000-4000-4000-8000-400000000001";
const OCCURRENCE_ROLLBACK = "40000000-4000-4000-8000-400000000002";
const OCCURRENCE_OWNER_B = "40000000-4000-4000-8000-400000000003";
const OCCURRENCE_SHARED_KEY = "40000000-4000-4000-8000-400000000004";
const OCCURRENCE_CORRECT = "40000000-4000-4000-8000-400000000005";

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

function insertPeriod(tx) {
  return tx.unsafe(
    `INSERT INTO public.money_periods
       (id, owner_user_id, start_date, end_date, currency, timezone, active_date,
        lifecycle, initialization, version)
     VALUES ($1::uuid, $2::uuid, '2026-11-01', '2026-11-30', 'MAD', 'Africa/Casablanca',
             '2026-11-01', 'tracking', 'uninitialized', 1)
     RETURNING id`,
    [PERIOD_A, OWNER_A],
  );
}

function insertOpening(tx) {
  return tx.unsafe(
    `INSERT INTO public.personal_expenses
       (owner_user_id, occurred_at, amount_minor, currency, kind, direction,
        booking_date, counts_in_daily, period_id, idempotency_key, create_fingerprint)
     VALUES ($1::uuid, NULL, 50000, 'MAD', 'opening', 'in', '2026-11-01', false,
             $2::uuid, 'opening-period', $3)
     RETURNING id`,
    [OWNER_A, PERIOD_A, fingerprint("opening-period")],
  );
}

function insertOccurrence(tx, input) {
  return tx.unsafe(
    `INSERT INTO public.money_obligations
       (id, owner_user_id, kind, description, amount_minor, currency,
        period_start, period_end, due_date, need_vs_want, purpose,
        counts_in_daily, category, state, state_effective_date, idempotency_key,
        create_fingerprint)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'MAD', $6::date, $7::date, $8::date,
             $9, $10, $11, $12, 'pending', $13::date, $14, $15)
     RETURNING id, version`,
    [
      input.id,
      input.owner ?? OWNER_A,
      input.kind ?? "bill",
      input.description ?? "Internet",
      input.amount ?? 10000,
      input.periodStart ?? "2026-11-01",
      input.periodEnd ?? "2026-11-30",
      input.dueDate ?? "2026-11-15",
      input.needVsWant ?? null,
      input.purpose ?? "fixed",
      input.countsInDaily ?? false,
      input.category ?? "bills",
      input.effective ?? "2026-11-01",
      input.key ?? `occurrence-${input.id}`,
      fingerprint(input.key ?? `occurrence-${input.id}`),
    ],
  );
}

function payOccurrence(tx, input) {
  return tx.unsafe(
    `SELECT public.money_pay_obligation(
       $1::uuid, $2::integer, $3::date, $4, $5, $6, $7, $8
     ) AS result`,
    [
      input.occurrenceId,
      input.expectedVersion ?? 1,
      input.bookingDate ?? "2026-11-15",
      input.idempotencyKey ?? `pay-${input.occurrenceId}`,
      input.needVsWant ?? null,
      input.countsInDaily ?? null,
      input.paymentMethod ?? null,
      input.operationId ?? `op-${input.occurrenceId}`,
    ],
  );
}

function correctPayment(tx, input) {
  return tx.unsafe(
    `SELECT public.money_correct_obligation_payment(
       $1::uuid, $2::integer, $3::integer, $4::date, $5, $6
     ) AS result`,
    [
      input.occurrenceId,
      input.expectedVersion,
      input.amountMinor,
      input.bookingDate,
      input.countsInDaily ?? null,
      input.operationId,
    ],
  );
}

function undoPayment(tx, input) {
  return tx.unsafe(
    `SELECT public.money_undo_obligation_payment(
       $1::uuid, $2::integer, $3
     ) AS result`,
    [input.occurrenceId, input.expectedVersion, input.operationId],
  );
}

async function cashOf(sql, owner) {
  const [row] = await sql.unsafe(
    `SELECT COALESCE(SUM(CASE WHEN "direction" = 'in' THEN "amount_minor" ELSE -"amount_minor" END), 0)::int AS cash
     FROM public.personal_expenses
     WHERE "owner_user_id" = $1::uuid AND "deleted_at" IS NULL`,
    [owner],
  );
  return Number(row.cash);
}

async function reserveOf(sql, owner, cutoff) {
  const [row] = await sql.unsafe(
    `SELECT COALESCE(SUM("amount_minor"), 0)::int AS reserve
     FROM public.money_obligations
     WHERE "owner_user_id" = $1::uuid AND "state" = 'pending' AND "due_date" <= $2::date`,
    [owner, cutoff],
  );
  return Number(row.reserve);
}

async function seedGrant(sql, input) {
  await sql`
    INSERT INTO public.mcp_authorization_grants
      (owner_user_id, oauth_client_id, resource_uri, client_name, status,
       permission_profile, permissions, permissions_version, approved_at, revoked_at)
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
      tags.includes("0099_money_07_obligation_payments"),
      "journal must include the MONEY-07 migration",
    );

    // The payment RPCs must be executable by an authenticated token only.
    const grants = await sql.unsafe(
      `SELECT p.proname,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('money_pay_obligation', 'money_correct_obligation_payment',
                           'money_undo_obligation_payment')`,
    );
    assert(grants.length === 3, "the three payment functions exist");
    for (const grant of grants) {
      assert(grant.authenticated_execute === true, `${grant.proname} is executable by authenticated`);
      assert(grant.anon_execute === false, `${grant.proname} is not executable by anon`);
    }

    // Seed --------------------------------------------------------------------
    await insertPeriod(sql);
    await insertOpening(sql);
    for (const occurrence of [
      { id: OCCURRENCE_PAY, description: "Internet", amount: 10000 },
      { id: OCCURRENCE_SECOND, description: "Rent", amount: 8000 },
      { id: OCCURRENCE_ROLLBACK, description: "BOOM", amount: 5000 },
      { id: OCCURRENCE_OWNER_B, description: "Foreign", amount: 7000, owner: OWNER_B },
      { id: OCCURRENCE_SHARED_KEY, description: "Shared key", amount: 8000 },
      { id: OCCURRENCE_CORRECT, description: "Phone", amount: 9000, needVsWant: "need" },
    ]) {
      await insertOccurrence(sql, occurrence);
    }
    log("SEED", "period, opening balance and six pending occurrences created");

    const owner = asUser(sql, OWNER_A);

    // PAYMENT -----------------------------------------------------------------
    const cashBefore = await cashOf(sql, OWNER_A);
    const reserveBefore = await reserveOf(sql, OWNER_A, "2026-11-30");

    const paid = await expectAccepted("pay one occurrence", () =>
      owner.run((tx) =>
        payOccurrence(tx, {
          occurrenceId: OCCURRENCE_PAY,
          expectedVersion: 1,
          bookingDate: "2026-11-15",
          idempotencyKey: "pay-key-1",
          needVsWant: "need",
          countsInDaily: null,
          paymentMethod: "cash",
          operationId: "op-1",
        }),
      ),
    );
    const payResult = paid[0].result;
    assert(payResult.outcome === "paid", "the payment reports a settled occurrence");
    assert(payResult.occurrence.state === "paid", "the occurrence is paid");
    assert(payResult.occurrence.version === 2, "the occurrence version advances by one");
    assert(payResult.occurrence.payment_expense_id, "the occurrence links one payment");
    assert(payResult.occurrence.payment_operation_id === "op-1", "the payment keeps its operation id");
    assert(payResult.occurrence.state_effective_date === "2026-11-15", "the effective date is the payment day");
    assert(payResult.payment.amount_minor === 10000, "the payment is the occurrence amount");
    assert(payResult.payment.currency === "MAD", "the payment is MAD");
    assert(payResult.payment.booking_date === "2026-11-15", "the payment books on the payment day");
    assert(payResult.payment.counts_in_daily === false, "a fixed obligation stays out of daily spending");
    assert(payResult.payment.need_vs_want === "need", "need/want comes from the payment input");
    assert(payResult.payment.purpose === "fixed", "the purpose comes from the occurrence");
    assert(payResult.payment.category === "bills", "the category comes from the occurrence");

    const [paymentRow] = await sql.unsafe(
      `SELECT "kind", "direction", "amount_minor", "booking_date", "counts_in_daily",
              "period_id", "deleted_at"
       FROM public.personal_expenses WHERE "id" = $1::uuid`,
      [payResult.payment.expense_id],
    );
    assert(paymentRow.kind === "expense", "the payment is a canonical expense row");
    assert(paymentRow.direction === "out", "the payment is a cash outflow");
    assert(paymentRow.deleted_at === null, "the payment is live");
    assert(paymentRow.period_id === PERIOD_A, "the payment belongs to the Money period of its booking day");

    const paidExpenses = await sql.unsafe(
      `SELECT count(*)::int AS total FROM public.personal_expenses
       WHERE "owner_user_id" = $1::uuid AND "idempotency_key" = 'pay-key-1'`,
      [OWNER_A],
    );
    assert(paidExpenses[0].total === 1, "exactly one ledger row settles the occurrence");

    // COHERENCE ---------------------------------------------------------------
    const cashAfter = await cashOf(sql, OWNER_A);
    const reserveAfter = await reserveOf(sql, OWNER_A, "2026-11-30");
    assert(cashBefore - cashAfter === 10000, "paying X reduces recorded cash by X");
    assert(reserveBefore - reserveAfter === 10000, "paying X reduces the outstanding reserve by X");
    log("COHERENCE", "cash and the outstanding reserve moved together, once");

    // IDEMPOTENT --------------------------------------------------------------
    const replay = await expectAccepted("retry the same operation", () =>
      owner.run((tx) =>
        payOccurrence(tx, {
          occurrenceId: OCCURRENCE_PAY,
          expectedVersion: 1,
          bookingDate: "2026-11-15",
          idempotencyKey: "pay-key-1",
          needVsWant: "need",
          countsInDaily: null,
          paymentMethod: "cash",
          operationId: "op-1",
        }),
      ),
    );
    assert(replay[0].result.outcome === "replayed", "the retry replays the original result");
    assert(
      replay[0].result.payment.expense_id === payResult.payment.expense_id,
      "the retry returns the original payment",
    );
    const afterReplay = await sql.unsafe(
      `SELECT count(*)::int AS total FROM public.personal_expenses
       WHERE "owner_user_id" = $1::uuid AND "idempotency_key" = 'pay-key-1'`,
      [OWNER_A],
    );
    assert(afterReplay[0].total === 1, "the retry creates no second ledger row");

    await expectDenied(
      "a different operation paying an already-paid occurrence",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_PAY,
            expectedVersion: 2,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-2",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-2",
          }),
        ),
      "23514",
    );
    const afterDouble = await sql.unsafe(
      `SELECT count(*)::int AS total FROM public.personal_expenses
       WHERE "owner_user_id" = $1::uuid AND "idempotency_key" IN ('pay-key-1', 'pay-key-2')`,
      [OWNER_A],
    );
    assert(afterDouble[0].total === 1, "the refused double payment wrote no second row");

    await expectDenied(
      "one operation settling a second occurrence",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 1,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-3",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-1",
          }),
        ),
      "23505",
    );

    // ATOMIC -----------------------------------------------------------------
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.proof_fail_on_boom()
      RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
      BEGIN
        IF NEW."note" = 'BOOM' THEN
          RAISE EXCEPTION 'proof: the ledger write failed' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END
      $fn$;
    `);
    await sql.unsafe(`
      CREATE TRIGGER proof_fail_on_boom
      BEFORE INSERT ON public.personal_expenses
      FOR EACH ROW EXECUTE FUNCTION public.proof_fail_on_boom();
    `);
    await expectDenied(
      "a payment whose ledger write fails",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_ROLLBACK,
            expectedVersion: 1,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-boom",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-boom",
          }),
        ),
      "23514",
    );
    const [rollbackRow] = await sql.unsafe(
      `SELECT "state", "payment_expense_id", "version" FROM public.money_obligations WHERE "id" = $1::uuid`,
      [OCCURRENCE_ROLLBACK],
    );
    assert(rollbackRow.state === "pending", "the failed payment left the occurrence pending");
    assert(rollbackRow.payment_expense_id === null, "the failed payment left no payment link");
    assert(rollbackRow.version === 1, "the failed payment did not advance the version");
    const [boomRow] = await sql.unsafe(
      `SELECT count(*)::int AS total FROM public.personal_expenses WHERE "idempotency_key" = 'pay-key-boom'`,
    );
    assert(boomRow.total === 0, "the failed payment left no ledger row");
    await sql.unsafe(`DROP TRIGGER proof_fail_on_boom ON public.personal_expenses;`);

    await expectDenied(
      "a payment without need/want",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 1,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-4",
            needVsWant: null,
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-4",
          }),
        ),
      "22023",
    );
    const [untouched] = await sql.unsafe(
      `SELECT "state", "version" FROM public.money_obligations WHERE "id" = $1::uuid`,
      [OCCURRENCE_SECOND],
    );
    assert(untouched.state === "pending", "the refused payment left the occurrence pending");
    assert(untouched.version === 1, "the refused payment did not advance the version");

    await expectDenied(
      "a payment booked before the obligation starts",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 1,
            bookingDate: "2026-10-01",
            idempotencyKey: "pay-key-5",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-5",
          }),
        ),
      "22023",
    );

    await expectDenied(
      "a payment with a stale version",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 9,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-6",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-6",
          }),
        ),
      "23514",
    );
    log("ATOMIC", "a failed or refused payment committed neither half");

    // CORRECTION -------------------------------------------------------------
    await owner.run((tx) =>
      payOccurrence(tx, {
        occurrenceId: OCCURRENCE_CORRECT,
        expectedVersion: 1,
        bookingDate: "2026-11-15",
        idempotencyKey: "pay-key-correct",
        needVsWant: null,
        countsInDaily: null,
        paymentMethod: "cash",
        operationId: "op-correct",
      }),
    );
    const corrected = await expectAccepted("correct the linked payment", () =>
      owner.run((tx) =>
        correctPayment(tx, {
          occurrenceId: OCCURRENCE_CORRECT,
          expectedVersion: 2,
          amountMinor: 9500,
          bookingDate: "2026-11-20",
          countsInDaily: true,
          operationId: "op-correct-2",
        }),
      ),
    );
    assert(corrected[0].result.outcome === "corrected", "the correction is applied");
    assert(corrected[0].result.occurrence.amount_minor === 9500, "the occurrence amount follows");
    assert(corrected[0].result.occurrence.counts_in_daily === true, "the daily flag follows");
    assert(corrected[0].result.occurrence.version === 3, "the correction advances the version");
    assert(corrected[0].result.payment.amount_minor === 9500, "the payment amount follows");
    assert(corrected[0].result.payment.booking_date === "2026-11-20", "the payment date follows");
    assert(corrected[0].result.payment.counts_in_daily === true, "the payment daily flag follows");

    const [correctedRows] = await sql.unsafe(
      `SELECT o."amount_minor" AS occurrence_amount, e."amount_minor" AS payment_amount,
              e."booking_date"::text AS booking_date,
              o."counts_in_daily" AS occurrence_daily,
              e."counts_in_daily" AS payment_daily
       FROM public.money_obligations o
       JOIN public.personal_expenses e ON e."id" = o."payment_expense_id"
       WHERE o."id" = $1::uuid`,
      [OCCURRENCE_CORRECT],
    );
    assert(
      correctedRows.occurrence_amount === correctedRows.payment_amount,
      "the corrected pair stays equal: one full payment",
    );
    assert(correctedRows.booking_date === "2026-11-20", "the stored payment moved to the corrected day");
    assert(correctedRows.occurrence_daily === correctedRows.payment_daily, "both daily flags agree");

    const correctionReplay = await expectAccepted("retry the same correction", () =>
      owner.run((tx) =>
        correctPayment(tx, {
          occurrenceId: OCCURRENCE_CORRECT,
          expectedVersion: 2,
          amountMinor: 9500,
          bookingDate: "2026-11-20",
          countsInDaily: true,
          operationId: "op-correct-2",
        }),
      ),
    );
    assert(correctionReplay[0].result.outcome === "replayed", "the correction retry replays");

    await expectDenied(
      "a correction with a stale version",
      () =>
        owner.run((tx) =>
          correctPayment(tx, {
            occurrenceId: OCCURRENCE_CORRECT,
            expectedVersion: 2,
            amountMinor: 9600,
            bookingDate: "2026-11-21",
            countsInDaily: true,
            operationId: "op-correct-3",
          }),
        ),
      "23514",
    );
    await expectDenied(
      "a correction of an unpaid occurrence",
      () =>
        owner.run((tx) =>
          correctPayment(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 1,
            amountMinor: 25000,
            bookingDate: "2026-11-15",
            countsInDaily: false,
            operationId: "op-correct-4",
          }),
        ),
      "23514",
    );
    log("CORRECTION", "amount, date and daily flag moved together; stale work refused");

    // UNDO --------------------------------------------------------------------
    const cashBeforeUndo = await cashOf(sql, OWNER_A);
    const reserveBeforeUndo = await reserveOf(sql, OWNER_A, "2026-11-30");
    const undone = await expectAccepted("undo the linked payment", () =>
      owner.run((tx) =>
        undoPayment(tx, {
          occurrenceId: OCCURRENCE_PAY,
          expectedVersion: 2,
          operationId: "op-undo",
        }),
      ),
    );
    assert(undone[0].result.outcome === "undone", "the undo is applied");
    assert(undone[0].result.occurrence.state === "pending", "the occurrence is open again");
    assert(undone[0].result.occurrence.payment_expense_id === null, "the occurrence is unlinked");
    assert(undone[0].result.occurrence.version === 3, "the undo advances the version");

    const cashAfterUndo = await cashOf(sql, OWNER_A);
    const reserveAfterUndo = await reserveOf(sql, OWNER_A, "2026-11-30");
    assert(cashAfterUndo - cashBeforeUndo === 10000, "undoing restores the cash exactly once");
    assert(reserveAfterUndo - reserveBeforeUndo === 10000, "undoing restores the outstanding reserve exactly once");
    const [undoneRow] = await sql.unsafe(
      `SELECT "deleted_at" FROM public.personal_expenses WHERE "id" = $1::uuid`,
      [payResult.payment.expense_id],
    );
    assert(undoneRow.deleted_at !== null, "the undone payment is soft-deleted");

    const undoReplay = await expectAccepted("retry the same undo", () =>
      owner.run((tx) =>
        undoPayment(tx, {
          occurrenceId: OCCURRENCE_PAY,
          expectedVersion: 2,
          operationId: "op-undo",
        }),
      ),
    );
    assert(undoReplay[0].result.outcome === "replayed", "the undo retry replays");
    log("UNDO", "the ledger outflow and the reserve were restored together");

    // ISOLATION ---------------------------------------------------------------
    const foreign = asUser(sql, OWNER_B);
    await expectDenied(
      "another owner paying this occurrence",
      () =>
        foreign.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_PAY,
            expectedVersion: 3,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-foreign",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-foreign",
          }),
        ),
      "P0002",
    );
    await expectDenied(
      "this owner paying another owner's occurrence",
      () =>
        owner.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_OWNER_B,
            expectedVersion: 1,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-foreign-2",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-foreign-2",
          }),
        ),
      "P0002",
    );
    const foreignPayment = await expectAccepted("the owner paying its own occurrence", () =>
      foreign.run((tx) =>
        payOccurrence(tx, {
          occurrenceId: OCCURRENCE_OWNER_B,
          expectedVersion: 1,
          bookingDate: "2026-11-15",
          idempotencyKey: "pay-key-owner-b",
          needVsWant: "need",
          countsInDaily: null,
          paymentMethod: "cash",
          operationId: "op-owner-b",
        }),
      ),
    );
    assert(
      foreignPayment[0].result.occurrence.owner_user_id === OWNER_B,
      "the payment belongs to the paying owner",
    );

    await owner.run((tx) =>
      payOccurrence(tx, {
        occurrenceId: OCCURRENCE_SHARED_KEY,
        expectedVersion: 1,
        bookingDate: "2026-11-15",
        idempotencyKey: "pay-key-shared",
        needVsWant: "need",
        countsInDaily: null,
        paymentMethod: "cash",
        operationId: "op-shared",
      }),
    );
    const [sharedPayment] = await sql.unsafe(
      `SELECT "payment_expense_id" FROM public.money_obligations WHERE "id" = $1::uuid`,
      [OCCURRENCE_SHARED_KEY],
    );
    await expectDenied(
      "one payment settling a second occurrence",
      () =>
        sql.unsafe(
          `UPDATE public.money_obligations
           SET "payment_expense_id" = $2::uuid, "state" = 'paid',
               "state_effective_date" = '2026-11-15', "version" = "version" + 1,
               "updated_at" = now()
           WHERE "id" = $1::uuid`,
          [OCCURRENCE_SECOND, sharedPayment.payment_expense_id],
        ),
      "23505",
    );
    await expectDenied(
      "a generic edit of a linked payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET "amount_minor" = 12345, "version" = "version" + 1, "updated_at" = now()
           WHERE "id" = $1::uuid`,
          [sharedPayment.payment_expense_id],
        ),
      "23514",
    );
    await expectDenied(
      "a generic classification edit of a linked payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET "purpose" = 'flexible', "counts_in_daily" = true,
               "category" = 'groceries', "version" = "version" + 1,
               "updated_at" = now()
           WHERE "id" = $1::uuid`,
          [sharedPayment.payment_expense_id],
        ),
      "23514",
    );
    await expectDenied(
      "a generic soft delete of a linked payment",
      () =>
        sql.unsafe(
          `UPDATE public.personal_expenses
           SET "deleted_at" = now(), "version" = "version" + 1, "updated_at" = now()
           WHERE "id" = $1::uuid`,
          [sharedPayment.payment_expense_id],
        ),
      "23514",
    );
    log("ISOLATION", "cross-owner, reuse and generic-edit paths refused");

    // GRANTS ------------------------------------------------------------------
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "profile-personal_operations",
      profile: "personal_operations",
      permissions: READ_PERMISSIONS,
    });
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "profile-personal_operations_writer",
      profile: "personal_operations_writer",
      permissions: WRITE_PERMISSIONS,
    });
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
    await expectDenied(
      "a reader grant paying an obligation",
      () =>
        reader.run((tx) =>
          payOccurrence(tx, {
            occurrenceId: OCCURRENCE_SECOND,
            expectedVersion: 1,
            bookingDate: "2026-11-15",
            idempotencyKey: "pay-key-reader",
            needVsWant: "need",
            countsInDaily: null,
            paymentMethod: "cash",
            operationId: "op-reader",
          }),
        ),
      "42501",
    );

    for (const [label, clientId] of [
      ["no grant", "no-grant-client"],
      ["revoked", "revoked-client"],
      ["pending", "pending-client"],
      ["wrong resource", "wrong-resource-client"],
    ]) {
      const denied = asUser(sql, OWNER_A, { clientId });
      await expectDenied(
        `${label} token paying an obligation`,
        () =>
          denied.run((tx) =>
            payOccurrence(tx, {
              occurrenceId: OCCURRENCE_SECOND,
              expectedVersion: 1,
              bookingDate: "2026-11-15",
              idempotencyKey: `pay-key-${label.replace(" ", "-")}`,
              needVsWant: "need",
              countsInDaily: null,
              paymentMethod: "cash",
              operationId: `op-${label.replace(" ", "-")}`,
            }),
          ),
        "42501",
      );
    }

    const writer = asUser(sql, OWNER_A, {
      clientId: "profile-personal_operations_writer",
    });
    const writerPayment = await expectAccepted("a writer grant paying an obligation", () =>
      writer.run((tx) =>
        payOccurrence(tx, {
          occurrenceId: OCCURRENCE_SECOND,
          expectedVersion: 1,
          bookingDate: "2026-11-15",
          idempotencyKey: "pay-key-writer",
          needVsWant: "need",
          countsInDaily: null,
          paymentMethod: "cash",
          operationId: "op-writer",
        }),
      ),
    );
    assert(writerPayment[0].result.outcome === "paid", "the writer grant settles the occurrence");
    log("GRANTS", "reader, no-grant, revoked, pending and wrong-resource tokens refused");

    log(
      "DONE",
      "MONEY-07 atomic payment, retry, double-pay refusal, correction, undo, cash/reserve coherence, owner isolation and grants verified",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
