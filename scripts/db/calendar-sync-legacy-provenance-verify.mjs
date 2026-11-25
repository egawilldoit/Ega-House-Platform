#!/usr/bin/env node
/**
 * Disposable Postgres upgrade proof for legacy Calendar sync job provenance
 * (drizzle/0109_calendar_sync_v2.sql).
 *
 * Applies the journal only through 0108, seeds real pre-0109 rows, switches one
 * owner's Google account and another owner's calendar on the same connection
 * BEFORE applying 0109, then applies 0109 and checks what the backfill stamped.
 *
 *   OLD  - 0109 stamps every unstamped legacy job from the owner's *current*
 *          settings using connected_at. A connection switched before the
 *          upgrade redirects older jobs (and their saved event ids) to account
 *          B, and a calendar switch on the same connection redirects older
 *          jobs to calendar B even though connected_at never changed.
 *   SAFE - a job queued before either switch has unknown provenance: 0109
 *          leaves it unstamped, so the scheduled-sync worker's destination
 *          check rejects it before any Google request. Jobs queued after a
 *          switch are stamped with the verified current destination and remain
 *          drainable. Jobs already carrying a destination are preserved.
 *
 * Usage:
 *   node --import tsx scripts/db/calendar-sync-legacy-provenance-verify.mjs \
 *     --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

import {
  isVerifiedCalendarDestination,
  normalizeCalendarDestination,
  sameVerifiedCalendarDestination,
} from "../../packages/application/src/calendar-sync/rules.ts";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const UPGRADE_MIGRATION = "0109_calendar_sync_v2";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "55555555-5555-4555-8555-555555555555";
const CALENDAR_OWNER = "33333333-3333-4333-8333-333333333333";
const JOB_BEFORE_SWITCH = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_AFTER_SWITCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_ALREADY_STAMPED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_NO_SETTINGS = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB_CALENDAR_BEFORE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const JOB_CALENDAR_AFTER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const TASK = "22222222-2222-4222-8222-222222222222";

const CONNECT_A = "2026-05-01T00:00:00+00:00";
const JOB_A_CREATED = "2026-05-02T00:00:00+00:00";
const SWITCH_TO_B = "2026-05-10T00:00:00+00:00";
const JOB_B_CREATED = "2026-05-11T00:00:00+00:00";
const CALENDAR_CONNECT = "2026-04-01T00:00:00+00:00";
const CALENDAR_JOB_BEFORE = "2026-04-02T00:00:00+00:00";
const CALENDAR_SWITCH = "2026-04-10T00:00:00+00:00";
const CALENDAR_JOB_AFTER = "2026-04-11T00:00:00+00:00";

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
  await sql.unsafe(
    `GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`,
  );
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  await sql.unsafe(
    `INSERT INTO auth.users (id, email) VALUES ($1, 'ab.mortaki@gmail.com')
     ON CONFLICT (id) DO NOTHING;`,
    [OWNER],
  );
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
  log("SHIM", "Supabase compatibility objects ready");
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
  log("RESET", "Database schemas dropped and recreated");
}

async function seedLegacyState(sql) {
  // Pre-0109 shape: calendar_sync_jobs has no destination/account columns and
  // calendar_integration_settings has no google_account_subject column.
  const jobColumns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendar_sync_jobs'
  `;
  assert(
    !jobColumns.some((row) => row.column_name === "destination_key"),
    "the pre-upgrade calendar_sync_jobs table must not have destination_key",
  );
  const settingsColumns = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendar_integration_settings'
  `;
  assert(
    !settingsColumns.some(
      (row) => row.column_name === "google_account_subject",
    ),
    "the pre-upgrade settings table must not have google_account_subject",
  );

  await sql.unsafe(
    `INSERT INTO public.calendar_integration_settings (
       owner_user_id, provider, google_account_email, calendar_id,
       access_token_encrypted, refresh_token_encrypted, connected_at,
       created_at, updated_at
     ) VALUES ($1, 'google', 'account-a@example.test', 'primary-a',
       'token', 'refresh', $2::timestamptz, $2::timestamptz, $2::timestamptz),
       ($3, 'google', 'account-c@example.test', 'calendar-c',
       'token', 'refresh', $2::timestamptz, $2::timestamptz, $2::timestamptz),
       ($4, 'google', 'account-d@example.test', 'calendar-a',
       'token', 'refresh', $5::timestamptz, $5::timestamptz, $5::timestamptz)`,
    [OWNER, CONNECT_A, OTHER_OWNER, CALENDAR_OWNER, CALENDAR_CONNECT],
  );

  await sql.unsafe(
    `INSERT INTO public.calendar_sync_jobs
       (id, owner_user_id, task_id, calendar_event_id, operation, status,
        attempts, created_at, updated_at)
     VALUES ($1, $4, $5, 'event-queued-under-a', 'upsert', 'pending', 0,
       $2::timestamptz, $2::timestamptz),
       ($6, $4, $5, 'event-queued-under-b', 'delete', 'pending', 0,
       $3::timestamptz, $3::timestamptz),
       ($7, $8, $5, 'event-c', 'upsert', 'pending', 0,
       $2::timestamptz, $2::timestamptz),
       ($9, $4, $5, 'event-no-settings', 'upsert', 'pending', 0,
       $2::timestamptz, $2::timestamptz),
       ($10, $11, $5, 'event-calendar-a', 'upsert', 'pending', 0,
       $12::timestamptz, $12::timestamptz),
       ($13, $11, $5, 'event-calendar-b', 'delete', 'pending', 0,
       $14::timestamptz, $14::timestamptz)`,
    [
      JOB_BEFORE_SWITCH,
      JOB_A_CREATED,
      JOB_B_CREATED,
      OWNER,
      TASK,
      JOB_AFTER_SWITCH,
      JOB_ALREADY_STAMPED,
      OTHER_OWNER,
      JOB_NO_SETTINGS,
      JOB_CALENDAR_BEFORE,
      CALENDAR_OWNER,
      CALENDAR_JOB_BEFORE,
      JOB_CALENDAR_AFTER,
      CALENDAR_JOB_AFTER,
    ],
  );
  log(
    "SEED",
    "legacy jobs queued under A (account switch), C (unchanged), D (calendar switch), and an owner without settings",
  );

  // The owner reconnects to account B before the upgrade. Current settings now
  // describe B, not the destination under which the older job was queued.
  await sql.unsafe(
    `UPDATE public.calendar_integration_settings
     SET google_account_email = 'account-b@example.test',
         calendar_id = 'primary-b',
         connected_at = $1::timestamptz,
         updated_at = $1::timestamptz
     WHERE owner_user_id = $2 AND provider = 'google'`,
    [SWITCH_TO_B, OWNER],
  );
  log("SWITCH", "connection switched from account A to account B before 0109");

  // This owner never reconnected: connected_at stays at CALENDAR_CONNECT while
  // only the calendar changes. connected_at alone cannot establish which
  // calendar a job was queued for, so older jobs must stay unstamped.
  await sql.unsafe(
    `UPDATE public.calendar_integration_settings
     SET calendar_id = 'calendar-b',
         updated_at = $1::timestamptz
     WHERE owner_user_id = $2 AND provider = 'google'`,
    [CALENDAR_SWITCH, CALENDAR_OWNER],
  );
  log(
    "CALENDAR-SWITCH",
    "calendar switched from calendar-a to calendar-b without reconnecting before 0109",
  );
}

async function assertJob(sql, id) {
  const [job] = await sql`
    SELECT destination_key, google_account_subject, google_account_email,
           calendar_id, queue_version, status
    FROM public.calendar_sync_jobs WHERE id = ${id}::uuid
  `;
  assert(job, `job ${id} must survive the upgrade`);
  return job;
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  const upgradeIndex = tags.indexOf(UPGRADE_MIGRATION);
  assert(
    upgradeIndex >= 0,
    "journal must include the calendar sync v2 migration",
  );

  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    for (const tag of tags.slice(0, upgradeIndex)) {
      await applyFile(sql, tag);
    }
    log("MIGRATE", `${upgradeIndex} journal migrations applied through 0108`);

    await seedLegacyState(sql);
    await applyFile(sql, UPGRADE_MIGRATION);
    log("MIGRATE", `${UPGRADE_MIGRATION} applied over seeded legacy rows`);

    for (const tag of tags.slice(upgradeIndex + 1)) {
      await applyFile(sql, tag);
    }
    log("MIGRATE", `${tags.length} journal migrations applied`);

    const beforeSwitch = await assertJob(sql, JOB_BEFORE_SWITCH);
    assert(
      beforeSwitch.destination_key === "" &&
        beforeSwitch.google_account_subject === null &&
        beforeSwitch.google_account_email === null &&
        beforeSwitch.calendar_id === null,
      `a job queued before the account switch must stay unstamped, got ${JSON.stringify(beforeSwitch)}`,
    );
    assert(beforeSwitch.queue_version === 1, "the legacy job stays on queue v1");
    const beforeSwitchDestination = normalizeCalendarDestination({
      accountSubject: beforeSwitch.google_account_subject,
      accountEmail: beforeSwitch.google_account_email,
      calendarId: beforeSwitch.calendar_id,
    });
    assert(
      !isVerifiedCalendarDestination(beforeSwitchDestination),
      "an unstamped job must fail the worker's verified-destination gate",
    );
    log(
      "UNKNOWN",
      "the pre-switch job is unstamped and unverifiable; the worker rejects it before any Google request",
    );

    const afterSwitch = await assertJob(sql, JOB_AFTER_SWITCH);
    const afterSwitchDestination = normalizeCalendarDestination({
      accountSubject: afterSwitch.google_account_subject,
      accountEmail: afterSwitch.google_account_email,
      calendarId: afterSwitch.calendar_id,
    });
    assert(
      afterSwitch.destination_key === "account-b@example.test|primary-b" &&
        isVerifiedCalendarDestination(afterSwitchDestination) &&
        sameVerifiedCalendarDestination(afterSwitchDestination, {
          accountSubject: null,
          accountEmail: "account-b@example.test",
          calendarId: "primary-b",
        }),
      `a job queued under the connected account must keep its verified destination, got ${JSON.stringify(afterSwitch)}`,
    );
    log("VERIFIED", "the post-switch job carries the verified account B destination");

    const unchanged = await assertJob(sql, JOB_ALREADY_STAMPED);
    assert(
      unchanged.destination_key === "account-c@example.test|calendar-c" &&
        unchanged.google_account_email === "account-c@example.test" &&
        unchanged.calendar_id === "calendar-c",
      `an unchanged owner's job must be stamped with its verified destination, got ${JSON.stringify(unchanged)}`,
    );
    log("PRESERVED", "an owner whose account never switched keeps its verified destination");

    const beforeCalendarSwitch = await assertJob(sql, JOB_CALENDAR_BEFORE);
    assert(
      beforeCalendarSwitch.destination_key === "" &&
        beforeCalendarSwitch.google_account_subject === null &&
        beforeCalendarSwitch.google_account_email === null &&
        beforeCalendarSwitch.calendar_id === null,
      `a job queued before a calendar-only switch must stay unstamped, got ${JSON.stringify(beforeCalendarSwitch)}`,
    );
    const beforeCalendarDestination = normalizeCalendarDestination({
      accountSubject: beforeCalendarSwitch.google_account_subject,
      accountEmail: beforeCalendarSwitch.google_account_email,
      calendarId: beforeCalendarSwitch.calendar_id,
    });
    assert(
      !isVerifiedCalendarDestination(beforeCalendarDestination),
      "a calendar-switch-unstamped job must fail the worker's verified-destination gate",
    );
    log(
      "CALENDAR-UNKNOWN",
      "a calendar switch without reconnect leaves older jobs unbound even though connected_at did not change",
    );

    const afterCalendarSwitch = await assertJob(sql, JOB_CALENDAR_AFTER);
    assert(
      afterCalendarSwitch.destination_key ===
        "account-d@example.test|calendar-b" &&
        isVerifiedCalendarDestination(
          normalizeCalendarDestination({
            accountSubject: afterCalendarSwitch.google_account_subject,
            accountEmail: afterCalendarSwitch.google_account_email,
            calendarId: afterCalendarSwitch.calendar_id,
          }),
        ),
      `a job queued after the calendar switch must carry the verified destination, got ${JSON.stringify(afterCalendarSwitch)}`,
    );
    log("CALENDAR-VERIFIED", "a post-calendar-switch job keeps the verified account and calendar");

    const noSettings = await assertJob(sql, JOB_NO_SETTINGS);
    assert(
      noSettings.destination_key === "",
      "a legacy job with no connection settings must stay unstamped",
    );
    log("NO-SETTINGS", "a job with no settings stays unstamped and is rejected without a Google request");

    console.log("CALENDAR-SYNC-LEGACY-PROVENANCE-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
