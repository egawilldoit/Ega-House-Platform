#!/usr/bin/env node
/**
 * Ephemeral-database proof for the MONEY-04 movement ledger (the extended
 * `personal_expenses` journal).
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim
 * that seeds `ab.mortaki@gmail.com` for the 0043 reconciliation) to a
 * disposable Postgres, then proves:
 *
 *   BACKFILL   - a legacy-style expense insert without movement columns becomes
 *                kind='expense', direction='out', counts_in_daily=true with a
 *                booking date derived from occurred_at.
 *   KINDS      - income/opening/savings/adjustment rows keep null category and
 *                need/want; a fictional category on income fails the shape check.
 *   COUNTS     - the daily flag is persisted, can be overridden explicitly and
 *                survives updates; an excluded expense still lowers cash.
 *   CASH       - opening 500 + income 200 - coffee 11 = recorded cash 689 and
 *                expense spending 11 at the same cutoff; a later booking date is
 *                excluded from an earlier cutoff.
 *   SAVINGS    - a savings transfer out reduces spendable cash once and appears
 *                once as funded savings.
 *   IMMUTABLE  - kind/direction cannot be changed after creation.
 *   RLS        - owners cannot read each other's movements and an OAuth token
 *                without a finance grant is denied.
 *
 * Usage:
 *   node scripts/db/money-04-movements-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

function fingerprint(label) {
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
  log("OK", message);
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
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`);
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
  // Required by migration 0043 (exactly one reconciliation owner).
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
}

function asUser(sql, userId, { clientId = null } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
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

async function expectCode(label, fn, expectedCode) {
  try {
    await fn();
  } catch (error) {
    assert(
      error.code === expectedCode,
      `${label}: expected ${expectedCode}, got ${error.code} ${error.message}`,
    );
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

async function insertMovement(tx, input) {
  const [row] = await tx.unsafe(
    `INSERT INTO public.personal_expenses
       (kind, direction, occurred_at, booking_date, amount_minor, category,
        need_vs_want, purpose, counts_in_daily, idempotency_key, create_fingerprint,
        note)
     VALUES ($1, $2, $3::timestamptz, $4::date, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, kind, direction, booking_date, amount_minor, counts_in_daily,
               category, need_vs_want`,
    [
      input.kind,
      input.direction,
      input.occurredAt ?? null,
      input.bookingDate,
      input.amountMinor,
      input.category ?? null,
      input.needVsWant ?? null,
      input.purpose ?? null,
      input.countsInDaily ?? false,
      input.idempotencyKey,
      input.createFingerprint ?? fingerprint(input.idempotencyKey),
      input.note ?? null,
    ],
  );
  return row;
}

async function ledgerTotals(tx, cutoff) {
  const [row] = await tx.unsafe(
    `SELECT
       coalesce(sum(amount_minor) FILTER (WHERE kind = 'opening'), 0)::int AS opening,
       coalesce(sum(amount_minor) FILTER (WHERE kind <> 'opening' AND direction = 'in'), 0)::int AS inflows,
       coalesce(sum(amount_minor) FILTER (WHERE direction = 'out'), 0)::int AS outflows,
       coalesce(sum(amount_minor) FILTER (WHERE kind = 'expense'), 0)::int AS expenses,
       coalesce(sum(amount_minor) FILTER (WHERE kind = 'expense' AND counts_in_daily), 0)::int AS daily,
       coalesce(sum(amount_minor) FILTER (WHERE kind = 'savings_transfer' AND direction = 'out'), 0)::int AS funded_savings
     FROM public.personal_expenses
     WHERE owner_user_id = auth.uid() AND deleted_at IS NULL AND booking_date <= $1::date`,
    [cutoff],
  );
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  );
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  assert(tags.includes("0096_money_04_movements"), "journal includes MONEY-04");

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    for (const tag of tags) await applyFile(sql, tag);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
    log("MIGRATE", `${tags.length} journal migrations applied`);

    const columns = await sql.unsafe(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'personal_expenses'
         AND column_name IN ('kind','direction','purpose','counts_in_daily','booking_date','period_id','category','need_vs_want')
       ORDER BY column_name`,
    );
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    assert(byName.kind?.column_default?.includes("expense"), "kind defaults to expense");
    assert(byName.direction?.column_default?.includes("out"), "direction defaults to out");
    assert(byName.counts_in_daily?.is_nullable === "NO", "counts_in_daily is not null");
    assert(
      !byName.counts_in_daily?.column_default,
      "counts_in_daily derives its kind-aware default from the insert trigger",
    );
    assert(byName.booking_date?.is_nullable === "NO", "booking_date is required after backfill");
    assert(byName.category?.is_nullable === "YES", "category is nullable for non-expense kinds");
    assert(byName.need_vs_want?.is_nullable === "YES", "need_vs_want is nullable for non-expense kinds");

    // Backfill / legacy compatibility: no movement columns supplied.
    await asUser(sql, OWNER_A).run(async (tx) => {
      const [legacy] = await tx.unsafe(
        `INSERT INTO public.personal_expenses
           (occurred_at, amount_minor, category, need_vs_want, idempotency_key, create_fingerprint)
         VALUES ('2026-11-01T23:30:00Z', 50000, 'other', 'need', 'legacy-opening', $1)
         RETURNING kind, direction, counts_in_daily, booking_date`,
        [fingerprint("legacy-opening")],
      );
      assert(legacy.kind === "expense", "legacy row backfills kind=expense");
      assert(legacy.direction === "out", "legacy row backfills direction=out");
      assert(legacy.counts_in_daily === true, "legacy row gets the expense daily default");
      assert(
        String(legacy.booking_date) === "2026-11-01",
        "legacy booking date is derived from occurred_at when no owner timezone is configured",
      );
      const [omittedIncome] = await tx.unsafe(
        `INSERT INTO public.personal_expenses
           (kind, direction, booking_date, amount_minor, idempotency_key, create_fingerprint)
         VALUES ('income', 'in', '2026-11-02', 100, 'omitted-income-flag', $1)
         RETURNING counts_in_daily`,
        [fingerprint("omitted-income-flag")],
      );
      assert(
        omittedIncome.counts_in_daily === false,
        "an income insert that omits the daily flag defaults false by kind",
      );
      // Remove the synthetic legacy rows so the cash example starts clean.
      await tx.unsafe(`DELETE FROM public.personal_expenses WHERE owner_user_id = auth.uid()`);
    });

    const ids = {};

    await asUser(sql, OWNER_A).run(async (tx) => {
      const opening = await insertMovement(tx, {
        kind: "opening",
        direction: "in",
        amountMinor: 50000,
        bookingDate: "2026-11-01",
        idempotencyKey: "opening-1",
      });
      const income = await insertMovement(tx, {
        kind: "income",
        direction: "in",
        amountMinor: 20000,
        bookingDate: "2026-11-09",
        idempotencyKey: "income-1",
      });
      const coffee = await insertMovement(tx, {
        kind: "expense",
        direction: "out",
        amountMinor: 1100,
        category: "coffee",
        needVsWant: "want",
        countsInDaily: true,
        bookingDate: "2026-11-11",
        idempotencyKey: "coffee-1",
      });

      assert(opening.kind === "opening" && opening.category === null, "opening has no expense category");
      assert(income.kind === "income" && income.need_vs_want === null, "income has no need/want");
      assert(coffee.counts_in_daily === true, "ordinary expense is daily-included");

      // Acceptance example without the optional excluded expense/savings.
      const base = await ledgerTotals(tx, "2026-11-11");
      assert(base.opening === 50000, "opening cash is 500.00");
      assert(base.inflows === 20000, "received income is 200.00");
      assert(base.outflows === 1100, "coffee is the only outflow");
      assert(
        base.opening + base.inflows - base.outflows === 68900,
        "recorded cash = opening 500 + income 200 - coffee 11 = 689",
      );
      assert(base.expenses === 1100, "expense spending is 11.00");
      assert(base.daily === 1100, "daily included spending is 11.00");

      const excluded = await insertMovement(tx, {
        kind: "expense",
        direction: "out",
        amountMinor: 1100,
        category: "other",
        needVsWant: "need",
        countsInDaily: false,
        bookingDate: "2026-11-11",
        idempotencyKey: "excluded-1",
      });
      const savings = await insertMovement(tx, {
        kind: "savings_transfer",
        direction: "out",
        amountMinor: 15000,
        bookingDate: "2026-11-10",
        idempotencyKey: "savings-1",
      });
      const later = await insertMovement(tx, {
        kind: "income",
        direction: "in",
        amountMinor: 99900,
        bookingDate: "2026-11-20",
        idempotencyKey: "income-later",
      });

      assert(excluded.counts_in_daily === false, "explicit daily override persists");
      assert(savings.kind === "savings_transfer", "savings transfer is its own kind");
      assert(later.booking_date === "2026-11-20", "later income keeps its booking date");

      const atEleven = await ledgerTotals(tx, "2026-11-11");
      assert(
        atEleven.outflows === 1100 + 1100 + 15000,
        "outflows include expenses and the savings transfer once",
      );
      assert(
        atEleven.opening + atEleven.inflows - atEleven.outflows === 68900 - 1100 - 15000,
        "an excluded expense and a real savings transfer each lower cash once",
      );
      assert(atEleven.expenses === 2200, "expense total includes the excluded expense");
      assert(atEleven.daily === 1100, "daily included spending excludes the excluded expense");
      assert(atEleven.funded_savings === 15000, "savings transfer funds savings once");

      const atNine = await ledgerTotals(tx, "2026-11-09");
      assert(atNine.expenses === 0, "an earlier cutoff cannot include later expenses");
      assert(atNine.inflows === 20000, "income on the cutoff day is included");

      const atTwenty = await ledgerTotals(tx, "2026-11-20");
      assert(atTwenty.inflows === 20000 + 99900, "a later cutoff includes the later income");

      // Explicit override through UPDATE remains durable.
      const [updated] = await tx.unsafe(
        `UPDATE public.personal_expenses
         SET counts_in_daily = true, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING counts_in_daily, version`,
        [excluded.id],
      );
      assert(updated.counts_in_daily === true && updated.version === 2, "daily override survives update");

      ids.coffee = coffee.id;
      ids.income = income.id;
    });

    // Immutability and shape checks use separate transactions so a rejected
    // statement never aborts a later proof.
    await expectCode(
      "immutable kind change",
      () =>
        asUser(sql, OWNER_A).run((tx) =>
          tx.unsafe(
            `UPDATE public.personal_expenses SET kind = 'income', version = version + 1 WHERE id = $1`,
            [ids.coffee],
          ),
        ),
      "23514",
    );
    await expectCode(
      "immutable direction change",
      () =>
        asUser(sql, OWNER_A).run((tx) =>
          tx.unsafe(
            `UPDATE public.personal_expenses SET direction = 'in', version = version + 1 WHERE id = $1`,
            [ids.income],
          ),
        ),
      "23514",
    );
    await expectCode(
      "income with a category",
      () =>
        asUser(sql, OWNER_A).run((tx) =>
          tx.unsafe(
            `INSERT INTO public.personal_expenses
               (kind, direction, booking_date, amount_minor, category, idempotency_key, create_fingerprint)
             VALUES ('income', 'in', '2026-11-11', 100, 'coffee', 'bad-income', $1)`,
            [fingerprint("bad-income")],
          ),
        ),
      "23514",
    );
    log("CASH", "opening 500 + income 200 - coffee 11 = 689 model proven at the cutoff");

    // Owner isolation: OWNER_B cannot read OWNER_A's movements.
    await asUser(sql, OWNER_B).run(async (tx) => {
      const [row] = await tx.unsafe(
        `SELECT count(*)::int AS visible FROM public.personal_expenses`,
      );
      assert(row.visible === 0, "another owner sees no movements");
    });

    // OAuth/MCP without a finance grant is denied: reads return no rows and a
    // write fails the INSERT policy.
    await asUser(sql, OWNER_A, { clientId: "ungranted-client" }).run(async (tx) => {
      const [row] = await tx.unsafe(
        `SELECT count(*)::int AS visible FROM public.personal_expenses`,
      );
      assert(row.visible === 0, "an ungranted OAuth read returns no movements");
      await expectCode(
        "an ungranted OAuth write",
        () =>
          tx.unsafe(
            `INSERT INTO public.personal_expenses
               (kind, direction, booking_date, amount_minor, idempotency_key, create_fingerprint)
             VALUES ('income', 'in', '2026-11-11', 100, 'oauth-write', $1)`,
            [fingerprint("oauth-write")],
          ),
        "42501",
      );
    });

    log("DONE", "MONEY-04 movement ledger proofs passed");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  exit(1);
});
