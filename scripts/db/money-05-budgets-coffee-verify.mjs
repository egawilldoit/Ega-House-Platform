#!/usr/bin/env node
/**
 * Ephemeral-database proof for MONEY-05 budgets, category taxonomy and counted
 * coffee visits.
 *
 * Applies the full drizzle migration journal (plus the standard Supabase shim)
 * to a disposable Postgres, seeds the reconciliation owner email required by
 * migration 0043, then proves:
 *
 *   CATEGORY - existing categories still insert; appended reporting categories
 *              insert; an unsupported category is rejected. Old rows are not
 *              rewritten by the additive constraint.
 *   CAPS     - the advisory cap validator accepts an appended category.
 *   BUDGET   - an owner can create one versioned plan per period; duplicate
 *              periods, invalid allocation values and immutable-field edits are
 *              rejected; version increments are enforced.
 *   RLS      - a reader grant cannot insert; a writer can; cross-owner rows are
 *              invisible; direct-user access stays owner-scoped.
 *   COFFEE   - a counted visit references a canonical expense, one expense can
 *              belong to at most one visit, visit keys are unique, and counted
 *              spend equals the canonical expense amount. Deleting a visit
 *              removes metadata but never the expense.
 *
 * Usage:
 *   node scripts/db/money-05-budgets-coffee-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script. Only point it
 * at a throwaway database.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const RESOURCE = "https://ega.example.com/api/mcp";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const EXPENSE_COFFEE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPENSE_COFFEE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXPENSE_GROCERIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EXPENSE_OTHER_OWNER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const VISIT_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  // 0043 reconciliation requires this owner email to exist.
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

async function expectConstraint(label, fn, expectedCode = "23514") {
  try {
    await fn();
  } catch (error) {
    assert(
      error.code === expectedCode,
      `${label}: expected ${expectedCode}, got ${error.code} ${error.message}`,
    );
    log("REJECTED", `${label} (${expectedCode})`);
    return;
  }
  console.error(`[PROOF] FAILED: ${label} should have been rejected`);
  exit(1);
}

function insertExpense(tx, { id, owner, amount, key, category = "coffee" }) {
  return tx.unsafe(
    `INSERT INTO public.personal_expenses
       (id, owner_user_id, occurred_at, amount_minor, category, need_vs_want,
        idempotency_key, create_fingerprint)
     VALUES ($1::uuid, $2::uuid, '2026-11-11T09:00:00Z', $3, $4, 'want',
             $5, $6)
     RETURNING id, amount_minor, category, version`,
    [id, owner, amount, category, key, receiptFingerprint(key)],
  );
}

async function seedGrant(sql, input) {
  await sql`
    INSERT INTO public.mcp_authorization_grants
      (owner_user_id, oauth_client_id, resource_uri, client_name, status,
       permission_profile, permissions, permissions_version, approved_at)
    VALUES
      (${input.owner}::uuid, ${input.clientId}, ${RESOURCE}, 'Proof client',
       'active', ${input.profile}, ${sql.json(input.permissions)}, 1,
       ${new Date().toISOString()}::timestamptz)
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
      tags.includes("0097_money_05_budgets_coffee"),
      "journal must include the MONEY-05 migration",
    );

    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "reader-client",
      profile: "personal_operations",
      permissions: READ_PERMISSIONS,
    });
    await seedGrant(sql, {
      owner: OWNER_A,
      clientId: "writer-client",
      profile: "personal_operations_writer",
      permissions: WRITE_PERMISSIONS,
    });

    // CATEGORY ---------------------------------------------------------------
    await asUser(sql, OWNER_A).run(async (tx) => {
      await insertExpense(tx, {
        id: EXPENSE_COFFEE,
        owner: OWNER_A,
        amount: 2500,
        key: "coffee-1",
        category: "coffee",
      });
      await insertExpense(tx, {
        id: EXPENSE_COFFEE_2,
        owner: OWNER_A,
        amount: 1800,
        key: "coffee-2",
        category: "coffee",
      });
      await insertExpense(tx, {
        id: EXPENSE_GROCERIES,
        owner: OWNER_A,
        amount: 4200,
        key: "coffee-as-groceries",
        category: "groceries",
      });
      for (const category of [
        "daily_usage",
        "personal_care",
        "work_tools",
        "fun",
        "emergency",
      ]) {
        await insertExpense(tx, {
          id: crypto.randomUUID(),
          owner: OWNER_A,
          amount: 100,
          key: `category-${category}`,
          category,
        });
      }
    });
    await expectConstraint("unsupported expense category", () =>
      sql.unsafe(
        `INSERT INTO public.personal_expenses
           (owner_user_id, occurred_at, amount_minor, category, need_vs_want,
            idempotency_key, create_fingerprint)
         VALUES ($1::uuid, now(), 100, 'pet_supplies', 'want', 'bad-category', $2)`,
        [OWNER_A, receiptFingerprint("bad-category")],
      ),
    );
    const capsCheck = await sql.unsafe(
      `SELECT public.valid_category_caps('{"daily_usage": 100, "personal_care": 0}'::jsonb) AS ok,
              public.valid_category_caps('{"pet_supplies": 100}'::jsonb) AS bad`,
    );
    assert(capsCheck[0].ok === true, "caps validator must accept appended categories");
    assert(capsCheck[0].bad === false, "caps validator must reject unknown categories");
    log("CATEGORY", "existing and appended categories valid; unsupported rejected");

    // BUDGET ----------------------------------------------------------------
    const budget = await asUser(sql, OWNER_A).run((tx) =>
      tx.unsafe(
        `INSERT INTO public.money_budget_plans
           (owner_user_id, period_start_date, period_end_date, allocations,
            savings_target_minor, emergency_target_minor,
            coffee_weekly_spend_limit_minor, coffee_weekly_visit_limit)
         VALUES ($1::uuid, '2026-11-09', '2026-11-30',
                 '{"coffee": 7000, "groceries": 12000}'::jsonb, 20000, 5000,
                 7000, 5)
         RETURNING id, version, allocations`,
        [OWNER_A],
      ),
    );
    assert(budget[0].version === 1, "new plan starts at version 1");
    assert(budget[0].allocations.coffee === 7000, "allocation stored as centimes");

    await expectConstraint(
      "duplicate owner period",
      () =>
        sql.unsafe(
          `INSERT INTO public.money_budget_plans
             (owner_user_id, period_start_date, period_end_date)
           VALUES ($1::uuid, '2026-11-09', '2026-11-30')`,
          [OWNER_A],
        ),
      "23505",
    );
    await expectConstraint("invalid allocation category", () =>
      sql.unsafe(
        `INSERT INTO public.money_budget_plans
           (owner_user_id, period_start_date, period_end_date, allocations)
         VALUES ($1::uuid, '2026-12-01', '2026-12-31', '{"pet_supplies": 100}'::jsonb)`,
        [OWNER_A],
      ),
    );
    await expectConstraint("negative allocation", () =>
      sql.unsafe(
        `UPDATE public.money_budget_plans
           SET allocations = '{"coffee": -1}'::jsonb, version = version + 1
         WHERE id = $1::uuid`,
        [budget[0].id],
      ),
    );
    await expectConstraint("immutable plan period", () =>
      sql.unsafe(
        `UPDATE public.money_budget_plans
           SET period_end_date = '2026-12-01', version = version + 1
         WHERE id = $1::uuid`,
        [budget[0].id],
      ),
    );
    await expectConstraint("plan version jump", () =>
      sql.unsafe(
        `UPDATE public.money_budget_plans
           SET allocations = '{"coffee": 8000}'::jsonb, version = version + 2
         WHERE id = $1::uuid`,
        [budget[0].id],
      ),
    );
    const updated = await sql.unsafe(
      `UPDATE public.money_budget_plans
         SET allocations = '{"coffee": 8000, "groceries": 12000}'::jsonb,
             version = version + 1, updated_at = now()
       WHERE owner_user_id = $1::uuid AND id = $2::uuid AND version = 1
       RETURNING version, allocations`,
      [OWNER_A, budget[0].id],
    );
    assert(updated[0].version === 2, "valid update increments version once");
    assert(updated[0].allocations.coffee === 8000, "updated allocation persisted");
    log("BUDGET", "one versioned plan per owner/period; invalid values rejected");

    // RLS -------------------------------------------------------------------
    await expectDenied("reader cannot insert a budget plan", () =>
      asUser(sql, OWNER_A, { clientId: "reader-client" }).run((tx) =>
        tx.unsafe(
          `INSERT INTO public.money_budget_plans
             (period_start_date, period_end_date)
           VALUES ('2027-01-01', '2027-01-31')`,
        ),
      ),
    );
    const writerInsert = await asUser(sql, OWNER_A, {
      clientId: "writer-client",
    }).run((tx) =>
      tx.unsafe(
        `INSERT INTO public.money_budget_plans
           (period_start_date, period_end_date, allocations)
         VALUES ('2027-01-01', '2027-01-31', '{"coffee": 100}'::jsonb)
         RETURNING id`,
      ),
    );
    assert(writerInsert.length === 1, "writer grant can create a plan");
    const crossOwner = await asUser(sql, OWNER_B, {
      clientId: "reader-client",
    }).run((tx) =>
      tx.unsafe(`SELECT id FROM public.money_budget_plans`),
    );
    assert(crossOwner.length === 0, "cross-owner plans are invisible");
    log("RLS", "reader denied writes; writer allowed; cross-owner hidden");

    // COFFEE ----------------------------------------------------------------
    await asUser(sql, OWNER_A, { clientId: "writer-client" }).run(async (tx) => {
      await tx.unsafe(
        `INSERT INTO public.money_coffee_visits
           (id, visit_key, visit_fingerprint, local_date, timezone, note)
         VALUES ($1::uuid, 'visit-1', $2, '2026-11-11', 'Africa/Casablanca',
                 'two lines, one visit')`,
        [VISIT_1, receiptFingerprint("visit-1")],
      );
      await tx.unsafe(
        `INSERT INTO public.money_coffee_visit_lines (visit_id, expense_id)
         VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)`,
        [VISIT_1, EXPENSE_COFFEE, EXPENSE_COFFEE_2],
      );
    });
    const counted = await sql.unsafe(
      `SELECT count(*)::int AS lines,
              sum(e.amount_minor)::int AS spend
       FROM public.money_coffee_visit_lines l
       JOIN public.personal_expenses e ON e.id = l.expense_id
       WHERE l.visit_id = $1::uuid AND e.deleted_at IS NULL`,
      [VISIT_1],
    );
    assert(counted[0].lines === 2, "one visit can hold two purchase lines");
    assert(counted[0].spend === 4300, "counted spend comes from canonical expenses");

    await insertExpense(sql, {
      id: EXPENSE_OTHER_OWNER,
      owner: OWNER_B,
      amount: 900,
      key: "other-owner-coffee",
      category: "coffee",
    });
    const crossOwnerVisit = await sql.unsafe(
      `INSERT INTO public.money_coffee_visits
         (owner_user_id, visit_key, visit_fingerprint, local_date, timezone)
       VALUES ($1::uuid, 'owner-a-visit', $2, '2026-11-11', 'Africa/Casablanca')
       RETURNING id`,
      [OWNER_A, receiptFingerprint("owner-a-visit")],
    );
    await expectConstraint("cross-owner visit line", () =>
      asUser(sql, OWNER_A, { clientId: "writer-client" }).run((tx) =>
        tx.unsafe(
          `INSERT INTO public.money_coffee_visit_lines (visit_id, expense_id)
           VALUES ($1::uuid, $2::uuid)`,
          [crossOwnerVisit[0].id, EXPENSE_OTHER_OWNER],
        ),
      ),
    );
    await asUser(sql, OWNER_A, { clientId: "writer-client" }).run((tx) =>
      tx.unsafe(`DELETE FROM public.money_coffee_visits WHERE id = $1::uuid`, [
        crossOwnerVisit[0].id,
      ]),
    );

    await expectConstraint(
      "one expense cannot belong to two visits",
      () =>
        sql.unsafe(
          `INSERT INTO public.money_coffee_visits
             (owner_user_id, visit_key, visit_fingerprint, local_date, timezone)
           VALUES ($1::uuid, 'visit-2', $2, '2026-11-11', 'Africa/Casablanca')
           RETURNING id`,
          [OWNER_A, receiptFingerprint("visit-2")],
        ).then(async (created) => {
          await sql.unsafe(
            `INSERT INTO public.money_coffee_visit_lines (owner_user_id, visit_id, expense_id)
             VALUES ($2::uuid, $1::uuid, $3::uuid)`,
            [created[0].id, OWNER_A, EXPENSE_COFFEE],
          );
        }),
      "23505",
    );
    await expectConstraint(
      "duplicate visit key",
      () =>
        sql.unsafe(
          `INSERT INTO public.money_coffee_visits
             (owner_user_id, visit_key, visit_fingerprint, local_date, timezone)
           VALUES ($1::uuid, 'visit-1', $2, '2026-11-11', 'Africa/Casablanca')`,
          [OWNER_A, receiptFingerprint("visit-1-dup")],
        ),
      "23505",
    );
    await expectDenied("reader cannot record a counted visit", () =>
      asUser(sql, OWNER_A, { clientId: "reader-client" }).run((tx) =>
        tx.unsafe(
          `INSERT INTO public.money_coffee_visits
             (visit_key, visit_fingerprint, local_date, timezone)
           VALUES ('reader-visit', $1, '2026-11-11', 'Africa/Casablanca')`,
          [receiptFingerprint("reader-visit")],
        ),
      ),
    );
    await asUser(sql, OWNER_A, { clientId: "writer-client" }).run((tx) =>
      tx.unsafe(`DELETE FROM public.money_coffee_visits WHERE id = $1::uuid`, [
        VISIT_1,
      ]),
    );
    const afterDelete = await sql.unsafe(
      `SELECT
         (SELECT count(*)::int FROM public.money_coffee_visits WHERE id = $2::uuid) AS visits,
         (SELECT count(*)::int FROM public.money_coffee_visit_lines WHERE visit_id = $2::uuid) AS lines,
         (SELECT count(*)::int FROM public.personal_expenses WHERE id = $1::uuid) AS expense`,
      [EXPENSE_COFFEE, VISIT_1],
    );
    assert(afterDelete[0].visits === 0, "visit delete removes the metadata row");
    assert(afterDelete[0].lines === 0, "visit lines cascade with the visit");
    assert(afterDelete[0].expense === 1, "canonical expense survives visit deletion");
    log("COFFEE", "unique/replayable visit, multi-line count, delete keeps spending");

    log("DONE", "MONEY-05 database proof passed");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[PROOF] FAILED:", error);
  exit(1);
});
