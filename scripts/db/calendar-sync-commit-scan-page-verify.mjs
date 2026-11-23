#!/usr/bin/env node
/**
 * Real Postgres proof for the Calendar sync v2 scan-page commit boundary
 * (drizzle/0109_calendar_sync_v2.sql, issue #428).
 *
 * Applies the full drizzle migration journal (plus the standard minimal
 * Supabase shim) to a disposable Postgres, then drives
 * `public.calendar_sync_commit_scan_page` with a nonempty scan page built by
 * the production adapter payload mappers.
 *
 *   RED   - the application draft objects passed unchanged (camelCase keys)
 *           cannot persist a nonempty page: the SQL function reads snake_case
 *           keys, so `task_id` arrives as NULL and the commit fails.
 *   GREEN - `toCalendarScanItemPayload`/`toCalendarScanJobPayload` normalize
 *           every field at the adapter boundary, so the same page persists run
 *           items with real task ids, links them to the coalesced job, and
 *           advances the scan cursor.
 *
 * Usage:
 *   node --import tsx scripts/db/calendar-sync-commit-scan-page-verify.mjs \
 *     --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

import {
  toCalendarScanItemPayload,
  toCalendarScanJobPayload,
} from "../../packages/data-access/src/calendar/repository.ts";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TASK_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLAIM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DESTINATION_KEY = "proof-subject|primary";
const CURSOR_CREATED_AT = "2026-11-23T10:00:00+00:00";
const TASK_UPDATED_AT = "2026-11-23T09:59:00+00:00";
const NOW = "2026-11-23T10:01:00+00:00";
const LEASE_UNTIL = "2026-11-23T10:06:00+00:00";

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
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"));
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
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`);
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

async function captureCode(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? error?.message ?? "unknown";
  }
}

function commitDrafts() {
  return {
    runId: RUN,
    claimToken: CLAIM,
    nextCursor: { createdAt: CURSOR_CREATED_AT, taskId: TASK_B },
    scanComplete: true,
    items: [
      {
        taskId: TASK_A,
        outcome: "pending",
        exclusionReason: null,
        eventId: "event-a",
        payloadHash: "hash-a",
        errorMessage: null,
      },
      {
        taskId: TASK_B,
        outcome: "unchanged",
        exclusionReason: null,
        eventId: "event-b",
        payloadHash: "hash-b",
      },
    ],
    jobs: [
      {
        taskId: TASK_A,
        operation: "upsert",
        eventId: "event-a",
        generation: 2,
        eventExists: true,
        payloadHash: "hash-a",
        exclusionReason: null,
        taskUpdatedAt: TASK_UPDATED_AT,
      },
    ],
    nowIso: NOW,
  };
}

function commitQuery(sql, commit) {
  return sql`SELECT public.calendar_sync_commit_scan_page(
    ${commit.runId}::uuid,
    ${commit.claimToken}::uuid,
    ${commit.nextCursor?.createdAt ?? null}::timestamptz,
    ${commit.nextCursor?.taskId ?? null}::uuid,
    ${commit.scanComplete}::boolean,
    ${sql.json(commit.items)}::jsonb,
    ${sql.json(commit.jobs)}::jsonb,
    ${commit.nowIso}::timestamptz
  ) AS committed`;
}

async function main() {
  const { url } = parseArgs();
  const sql = postgres(url, { max: 2, onnotice: () => {} });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    const tags = await readJournal();
    assert(
      tags.includes("0109_calendar_sync_v2"),
      "journal must include the calendar sync v2 migration",
    );

    let applied = 0;
    for (const tag of tags) {
      await applyFile(sql, tag);
      applied += 1;
    }
    log("MIGRATE", `${applied} journal migrations applied`);

    await sql.unsafe(
      `INSERT INTO public.projects (id, owner_user_id, name, slug)
       VALUES ($1, $2, 'Calendar commit proof', 'calendar-commit-proof')`,
      [PROJECT, OWNER],
    );
    await sql.unsafe(
      `INSERT INTO public.tasks (id, project_id, owner_user_id, title, updated_at)
       VALUES ($1, $3, $4, 'Task A', $5::timestamptz),
              ($2, $3, $4, 'Task B', $5::timestamptz)`,
      [TASK_A, TASK_B, PROJECT, OWNER, TASK_UPDATED_AT],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_sync_runs (
         id, owner_user_id, destination_key, google_account_subject,
         google_account_email, calendar_id, status, scan_claim_token,
         scan_lease_expires_at
       )
       VALUES ($1, $2, $3, 'proof-subject', 'proof@example.test', 'primary',
               'active', $4, $5::timestamptz)`,
      [RUN, OWNER, DESTINATION_KEY, CLAIM, LEASE_UNTIL],
    );
    log("SEED", "active run, scan claim, project and two tasks ready");

    // RED: the pre-fix adapter forwarded the camelCase drafts unchanged. The
    // SQL function reads snake_case keys, so the first item has no task_id.
    const drafts = commitDrafts();
    const redCode = await captureCode(() => commitQuery(sql, drafts));
    assert(redCode !== null, "un-normalized camelCase page must fail against the SQL contract");
    const [afterRed] = await sql.unsafe(
      `SELECT count(*)::integer AS items FROM public.calendar_sync_run_items WHERE run_id = $1`,
      [RUN],
    );
    assert(afterRed.items === 0, "a failed commit must not persist partial run items");
    log("RED", `camelCase drafts fail as expected (${redCode}); no partial items persisted`);

    // GREEN: the adapter normalizes every field before the RPC call.
    const commit = {
      ...drafts,
      items: drafts.items.map(toCalendarScanItemPayload),
      jobs: drafts.jobs.map(toCalendarScanJobPayload),
    };
    assert(
      commit.jobs[0].calendar_event_id === "event-a",
      "normalized job payload must carry calendar_event_id for the fix-2 consumer",
    );
    const [committed] = await commitQuery(sql, commit);
    assert(committed.committed === true, "normalized nonempty page must commit");
    log("GREEN", "normalized nonempty page committed");

    const items = await sql.unsafe(
      `SELECT task_id, outcome, event_id, payload_hash, error_message, job_id
       FROM public.calendar_sync_run_items
       WHERE run_id = $1
       ORDER BY task_id`,
      [RUN],
    );
    assert(items.length === 2, "both scanned tasks must persist a run item");
    const itemA = items.find((row) => row.task_id === TASK_A);
    const itemB = items.find((row) => row.task_id === TASK_B);
    assert(itemA?.outcome === "pending", "task A item outcome must persist");
    assert(itemA?.event_id === "event-a", "task A item event id must persist");
    assert(itemA?.payload_hash === "hash-a", "task A item payload hash must persist");
    assert(itemA?.job_id, "task A item must link to its queued job");
    assert(itemB?.outcome === "unchanged", "task B item outcome must persist");
    assert(itemB?.event_id === "event-b", "task B item event id must persist");
    assert(itemB?.job_id === null, "a task without work must not link a job");

    const jobs = await sql.unsafe(
      `SELECT task_id, operation, status, queue_version, generation, event_exists,
              payload_hash, task_updated_at, run_id, destination_key
       FROM public.calendar_sync_jobs
       WHERE run_id = $1`,
      [RUN],
    );
    assert(jobs.length === 1, "one coalesced job must be queued for the scanned page");
    const job = jobs[0];
    assert(job.task_id === TASK_A, "job task id must come from the normalized payload");
    assert(job.operation === "upsert", "job operation must persist");
    assert(job.status === "pending", "job must be queued as pending");
    assert(job.queue_version === 2, "job must be a v2 queue job");
    assert(job.generation === 2, "job generation must persist");
    assert(job.event_exists === true, "job event_exists must persist");
    assert(job.payload_hash === "hash-a", "job payload hash must persist");
    assert(
      new Date(job.task_updated_at).toISOString() === new Date(TASK_UPDATED_AT).toISOString(),
      "job task_updated_at must persist",
    );
    assert(job.destination_key === DESTINATION_KEY, "job must inherit the run destination");

    const [run] = await sql.unsafe(
      `SELECT scan_cursor_created_at, scan_cursor_task_id, scan_complete,
              scan_claim_token, scan_lease_expires_at
       FROM public.calendar_sync_runs WHERE id = $1`,
      [RUN],
    );
    assert(
      new Date(run.scan_cursor_created_at).toISOString() ===
        new Date(CURSOR_CREATED_AT).toISOString(),
      "scan cursor timestamp must advance",
    );
    assert(run.scan_cursor_task_id === TASK_B, "scan cursor task id must advance");
    assert(run.scan_complete === true, "scan completion flag must persist");
    assert(run.scan_claim_token === null, "committed scan claim must clear");
    assert(run.scan_lease_expires_at === null, "committed scan lease must clear");

    console.log("CALENDAR-SYNC-COMMIT-SCAN-PAGE-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
