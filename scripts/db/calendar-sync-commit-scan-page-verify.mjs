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
 *   TARGET - a normalized job keeps its `calendar_event_id` on insert, adopts a
 *           re-planned target when the same task/destination coalesces, and
 *           survives a same-page replay without a second queue row.
 *   CLAIM - `calendar_sync_claim_jobs` returns the persisted target for a mapped
 *           update and a mapped delete, so the worker updates or removes the
 *           planned event instead of creating a duplicate.
 *   RECOVER - an expired processing claim with a newer pending edit is folded
 *           into that edit instead of violating the one-pending guard. The
 *           latest intent is claimed, a same-generation event identity is kept
 *           for an ambiguous write, run links survive, and the expired token
 *           cannot finalize newer work.
 *   RELEASE - a released or retryably failed claim folds into a newer pending
 *           edit the same way, without recording the older failure against
 *           newer work; an unsuperseded retry keeps its backoff and attempts.
 *   ORPHAN - a mapping is retired only after its queued delete is durable and
 *           Google confirms removal. A failed enqueue leaves the mapping active
 *           and persists no job or run item.
 *   SETTLE - `calendar_sync_complete_job` settles the job, confirmed mapping
 *           removal and run item in one claim-guarded transaction. A stale token
 *           or a failed item write rolls all three back, and a late old-generation
 *           delete cannot retire a mapping republished at a newer generation.
 *   REPUBLISH - the current-generation delete retires the newer mapping once.
 *   ORPHAN-SETTLE - the confirmed orphan delete retires mapping, job and item.
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
const TASK_C = "99999999-9999-4999-8999-999999999999";
const RUN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLAIM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLAIM_REPLAY = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CLAIM_REPLAN = "12121212-1212-4212-8212-121212121212";
const JOB_CLAIM = "13131313-1313-4313-8313-131313131313";
const CLAIM_EDIT = "14141414-1414-4414-8414-141414141414";
const JOB_CLAIM_RECOVER = "15151515-1515-4515-8515-151515151515";
const CLAIM_EDIT_RELEASE = "16161616-1616-4616-8616-161616161616";
const JOB_CLAIM_RELEASE = "17171717-1717-4717-8717-171717171717";
const JOB_CLAIM_RETRY = "18181818-1818-4818-8818-181818181818";
const DESTINATION_KEY = "proof-subject|primary";
const proofClock = Date.now() - 3 * 60 * 60_000;
function proofTime(fixtureTime) {
  return new Date(proofClock + Date.parse(fixtureTime) - Date.parse("2026-11-23T09:00:00Z")).toISOString();
}

const CURSOR_CREATED_AT = proofTime("2026-11-23T10:00:00+00:00");
const TASK_UPDATED_AT = proofTime("2026-11-23T09:59:00+00:00");
const NOW = proofTime("2026-11-23T10:01:00+00:00");
const NOW_REPLAY = proofTime("2026-11-23T10:02:00+00:00");
const NOW_REPLAN = proofTime("2026-11-23T10:03:00+00:00");
const JOB_CLAIM_AT = proofTime("2026-11-23T10:04:00+00:00");
const NOW_EDIT = proofTime("2026-11-23T10:05:00+00:00");
const NOW_RECOVER = proofTime("2026-11-23T10:10:00+00:00");
const NOW_EDIT_RELEASE = proofTime("2026-11-23T10:11:00+00:00");
const NOW_RELEASE = proofTime("2026-11-23T10:12:00+00:00");
const RETRY_AT = new Date(Date.now() + 60 * 60_000).toISOString();
const OWNER_REMOVAL = "21212121-2121-4121-8121-212121212121";
const RUN_REMOVAL = "22222222-2222-4222-8222-222222222222";
const TASK_REMOVAL = "23232323-2323-4323-8323-232323232323";
const TASK_ORPHAN = "24242424-2424-4424-8424-242424242424";
const DESTINATION_REMOVAL = "proof-removal|primary";
const ORPHAN_SCAN_CLAIM = "25252525-2525-4525-8525-252525252525";
const ORPHAN_SCAN_WRONG_CLAIM = "26262626-2626-4626-8626-262626262626";
const ORPHAN_JOB_CLAIM = "27272727-2727-4727-8727-272727272727";
const REMOVAL_JOB_CLAIM = "28282828-2828-4828-8828-282828282828";
const REMOVAL_WRONG_CLAIM = "29292929-2929-4929-8929-292929292929";
const REMOVAL_REPUBLISH_CLAIM = "31313131-3131-4131-8131-313131313131";
const TASK_REMOVAL_REPUBLISH_JOB = "32323232-3232-4232-8232-323232323232";
const TASK_REMOVAL_JOB = "33333333-3333-4333-8333-333333333333";
const NOW_REMOVAL = proofTime("2026-11-23T11:00:00+00:00");

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

function commitDrafts(overrides = {}) {
  return {
    runId: RUN,
    claimToken: CLAIM,
    nextCursor: { createdAt: CURSOR_CREATED_AT, taskId: TASK_C },
    scanComplete: false,
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
      {
        taskId: TASK_C,
        outcome: "pending",
        exclusionReason: "archived",
        eventId: "event-c",
        payloadHash: null,
        errorMessage: null,
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
      {
        taskId: TASK_C,
        operation: "delete",
        eventId: "event-c",
        generation: 1,
        eventExists: true,
        payloadHash: null,
        exclusionReason: "archived",
        taskUpdatedAt: TASK_UPDATED_AT,
      },
    ],
    nowIso: NOW,
    ...overrides,
  };
}

function normalizeCommit(drafts) {
  return {
    ...drafts,
    items: drafts.items.map(toCalendarScanItemPayload),
    jobs: drafts.jobs.map(toCalendarScanJobPayload),
  };
}

function claimScanQuery(sql, claimToken, nowIso, runId = RUN) {
  return sql`SELECT * FROM public.calendar_sync_claim_run_scan(
    ${runId}::uuid,
    ${claimToken}::uuid,
    ${nowIso}::timestamptz,
    ${300}::integer
  )`;
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
    ${commit.nowIso}::timestamptz,
    ${commit.expectedCursor?.createdAt ?? null}::timestamptz,
    ${commit.expectedCursor?.taskId ?? null}::uuid
  ) AS committed`;
}

function claimJobsQuery(sql, claimToken, nowIso) {
  return sql`
    SELECT id, task_id, calendar_event_id, operation, status, attempts,
           claim_token, generation, event_exists, payload_hash, run_id,
           destination_key, scheduled_at
    FROM public.calendar_sync_claim_jobs(
      ${OWNER}::uuid,
      ${DESTINATION_KEY}::text,
      ${RUN}::uuid,
      ${claimToken}::uuid,
      ${10}::integer,
      ${nowIso}::timestamptz,
      ${300}::integer
    )
  `;
}

function releaseJobsQuery(sql, jobIds, claimToken, nowIso, settlement = {}) {
  return sql`
    SELECT id, task_id, status, attempts, scheduled_at, last_error, outcome,
           exclusion_reason, permanent_failure, generation, calendar_event_id,
           payload_hash
    FROM public.calendar_sync_release_claimed_jobs(
      ${jobIds}::uuid[],
      ${claimToken}::uuid,
      ${nowIso}::timestamptz,
      ${Boolean(settlement.recordFailure)}::boolean,
      ${settlement.lastError ?? null}::text,
      ${settlement.outcome ?? null}::varchar,
      ${settlement.exclusionReason ?? null}::text,
      ${settlement.scheduledAt ?? null}::timestamptz
    )
  `;
}

function completeJobQuery(sql, input) {
  return sql`
    SELECT public.calendar_sync_complete_job(
      ${input.jobId}::uuid,
      ${input.claimToken}::uuid,
      ${input.outcome}::varchar,
      ${input.eventId ?? null}::text,
      ${input.generation}::integer,
      ${input.payloadHash ?? null}::text,
      ${input.exclusionReason ?? null}::text,
      ${input.lastError ?? null}::text,
      ${Boolean(input.permanentFailure)}::boolean,
      ${Boolean(input.removeMapping)}::boolean,
      ${input.removedEventId ?? null}::text,
      ${input.removedGeneration ?? null}::integer,
      ${input.nowIso}::timestamptz
    ) AS completed
  `;
}

function orphanMappingsQuery(sql, ownerUserId, destinationKey) {
  return sql`
    SELECT task_id, event_id, generation, status
    FROM public.calendar_sync_list_orphan_mappings(
      ${ownerUserId}::uuid,
      ${destinationKey}::text,
      ${10}::integer
    )
  `;
}

function removalCommit(overrides = {}) {
  return normalizeCommit({
    runId: RUN_REMOVAL,
    claimToken: ORPHAN_SCAN_CLAIM,
    nextCursor: null,
    scanComplete: true,
    items: [
      {
        taskId: TASK_ORPHAN,
        outcome: "pending",
        exclusionReason: null,
        eventId: null,
        payloadHash: null,
        errorMessage: null,
      },
    ],
    jobs: [
      {
        taskId: TASK_ORPHAN,
        operation: "delete",
        eventId: "orphan-event",
        generation: 1,
        eventExists: true,
        payloadHash: null,
        exclusionReason: null,
        taskUpdatedAt: NOW_REMOVAL,
      },
    ],
    nowIso: NOW_REMOVAL,
    ...overrides,
  });
}

function editDrafts(input) {
  return normalizeCommit({
    runId: RUN,
    claimToken: input.claimToken,
    nextCursor: { createdAt: CURSOR_CREATED_AT, taskId: TASK_C },
    scanComplete: false,
    items: [
      {
        taskId: TASK_A,
        outcome: "pending",
        exclusionReason: null,
        eventId: input.eventId,
        payloadHash: input.payloadHash,
        errorMessage: null,
      },
    ],
    jobs: [
      {
        taskId: TASK_A,
        operation: "upsert",
        eventId: input.eventId,
        generation: 3,
        eventExists: true,
        payloadHash: input.payloadHash,
        exclusionReason: null,
        taskUpdatedAt: input.taskUpdatedAt,
      },
    ],
    expectedCursor: { createdAt: CURSOR_CREATED_AT, taskId: TASK_C },
    nowIso: input.nowIso,
  });
}

async function jobsForTask(sql, taskId) {
  return sql.unsafe(
    `SELECT id, task_id, calendar_event_id, operation, status, attempts,
            claim_token, lease_expires_at, generation, event_exists,
            payload_hash, run_id, scheduled_at, last_error, outcome,
            exclusion_reason, permanent_failure
     FROM public.calendar_sync_jobs
     WHERE run_id = $1 AND task_id = $2
     ORDER BY created_at`,
    [RUN, taskId],
  );
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
       VALUES ($1, $4, $5, 'Task A', $6::timestamptz),
              ($2, $4, $5, 'Task B', $6::timestamptz),
              ($3, $4, $5, 'Task C', $6::timestamptz)`,
      [TASK_A, TASK_B, TASK_C, PROJECT, OWNER, TASK_UPDATED_AT],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_sync_runs (
         id, owner_user_id, destination_key, google_account_subject,
         google_account_email, calendar_id, status, scan_claim_token,
         scan_lease_expires_at
       )
       VALUES ($1, $2, $3, 'proof-subject', 'proof@example.test', 'primary',
               'active', $4, clock_timestamp() + interval '5 minutes')`,
      [RUN, OWNER, DESTINATION_KEY, CLAIM],
    );
    log("SEED", "active run, scan claim, project and three tasks ready");

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
    const commit = normalizeCommit(drafts);
    assert(
      commit.jobs[0].calendar_event_id === "event-a",
      "normalized job payload must carry calendar_event_id for the SQL target",
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
    assert(items.length === 3, "all scanned tasks must persist a run item");
    const itemA = items.find((row) => row.task_id === TASK_A);
    const itemB = items.find((row) => row.task_id === TASK_B);
    const itemC = items.find((row) => row.task_id === TASK_C);
    assert(itemA?.outcome === "pending", "task A item outcome must persist");
    assert(itemA?.event_id === "event-a", "task A item event id must persist");
    assert(itemA?.payload_hash === "hash-a", "task A item payload hash must persist");
    assert(itemA?.job_id, "task A item must link to its queued job");
    assert(itemB?.outcome === "unchanged", "task B item outcome must persist");
    assert(itemB?.event_id === "event-b", "task B item event id must persist");
    assert(itemB?.job_id === null, "a task without work must not link a job");
    assert(itemC?.outcome === "pending", "task C removal item outcome must persist");
    assert(itemC?.event_id === "event-c", "task C item event id must persist");
    assert(itemC?.job_id, "task C removal item must link to its queued job");

    const jobs = await sql.unsafe(
      `SELECT id, task_id, calendar_event_id, operation, status, queue_version,
              generation, event_exists, payload_hash, task_updated_at, run_id,
              destination_key, scheduled_at, now() AS database_now
       FROM public.calendar_sync_jobs
       WHERE run_id = $1`,
      [RUN],
    );
    assert(jobs.length === 2, "one coalesced job per scanned task must be queued");
    const jobA = jobs.find((row) => row.task_id === TASK_A);
    const jobC = jobs.find((row) => row.task_id === TASK_C);
    assert(jobA, "task A update job must persist");
    assert(jobC, "task C delete job must persist");
    assert(jobA.operation === "upsert", "task A job operation must persist");
    assert(jobA.status === "pending", "task A job must be queued as pending");
    assert(jobA.queue_version === 2, "task A job must be a v2 queue job");
    assert(jobA.generation === 2, "task A job generation must persist");
    assert(jobA.event_exists === true, "task A job event_exists must persist");
    assert(jobA.payload_hash === "hash-a", "task A job payload hash must persist");
    assert(
      new Date(jobA.task_updated_at).toISOString() ===
        new Date(TASK_UPDATED_AT).toISOString(),
      "task A job task_updated_at must persist",
    );
    assert(jobA.destination_key === DESTINATION_KEY, "task A job must inherit the destination");
    assert(
      jobA.calendar_event_id === "event-a",
      "Fix 2: a mapped update job must persist its planned calendar_event_id",
    );
    assert(jobC.operation === "delete", "task C job operation must persist");
    assert(jobC.generation === 1, "task C job generation must persist");
    assert(new Date(jobC.scheduled_at) <= new Date(jobC.database_now),
      "an inserted job must be scheduled against the database clock");
    assert(
      jobC.calendar_event_id === "event-c",
      "Fix 2: a mapped delete job must persist its planned calendar_event_id",
    );

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
    assert(run.scan_cursor_task_id === TASK_C, "scan cursor task id must advance");
    assert(run.scan_complete === false, "an unfinished scan must stay incomplete");
    assert(run.scan_claim_token === null, "committed scan claim must clear");
    assert(run.scan_lease_expires_at === null, "committed scan lease must clear");
    log("TARGET", "inserted update and delete jobs kept their planned event ids");

    // A crash replays the same page. Re-claim the run and commit the identical
    // page: the pending jobs must coalesce by id and keep the same target.
    const [replayClaim] = await claimScanQuery(sql, CLAIM_REPLAY, NOW_REPLAY);
    assert(replayClaim?.scan_cursor_task_id === TASK_C &&
      new Date(replayClaim.scan_cursor_created_at).toISOString() === CURSOR_CREATED_AT,
      "claim must return the cursor advanced by the first continuation");
    const [staleCursor] = await commitQuery(sql, normalizeCommit(commitDrafts({
      claimToken: CLAIM_REPLAY, nextCursor: null,
    })));
    assert(!staleCursor.committed, "a second continuation with the older cursor must not rewind the run");
    const currentCursor = { createdAt: CURSOR_CREATED_AT, taskId: TASK_C };
    await sql`UPDATE public.calendar_sync_runs
      SET scan_lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${RUN}::uuid`;
    const [expiredScan] = await commitQuery(sql, normalizeCommit(commitDrafts({
      claimToken: CLAIM_REPLAY, expectedCursor: currentCursor,
    })));
    assert(!expiredScan.committed, "actual lease expiry must reject the stale caller clock");
    assert((await claimScanQuery(sql, CLAIM_REPLAY, NOW_REPLAY)).length === 1,
      "actual lease expiry must allow the scan to be reclaimed");
    const replayCommit = normalizeCommit(
      commitDrafts({ claimToken: CLAIM_REPLAY, nowIso: NOW_REPLAY, expectedCursor: currentCursor }),
    );
    const [replayed] = await commitQuery(sql, replayCommit);
    assert(replayed.committed === true, "an identical replay must commit");

    const replayJobs = await sql.unsafe(
      `SELECT id, task_id, calendar_event_id, operation, generation
       FROM public.calendar_sync_jobs
       WHERE run_id = $1
       ORDER BY task_id`,
      [RUN],
    );
    assert(replayJobs.length === 2, "a page replay must not queue duplicate jobs");
    const replayedA = replayJobs.find((row) => row.task_id === TASK_A);
    const replayedC = replayJobs.find((row) => row.task_id === TASK_C);
    assert(replayedA?.id === jobA.id, "task A replay must coalesce into the same job");
    assert(replayedC?.id === jobC.id, "task C replay must coalesce into the same job");
    assert(
      replayedA.calendar_event_id === "event-a",
      "task A replay must preserve the planned target",
    );
    assert(
      replayedC.calendar_event_id === "event-c",
      "task C replay must preserve the planned target",
    );
    assert(replayedA.operation === "upsert", "task A replay must keep the operation");
    assert(replayedC.operation === "delete", "task C replay must keep the operation");
    log("REPLAY", "same-page replay coalesced to the same jobs and planned targets");

    // A later plan for the same task/destination must adopt its new target in
    // the same pending row, and finishing the scan must still clear the claim.
    const [replanClaim] = await claimScanQuery(sql, CLAIM_REPLAN, NOW_REPLAN);
    assert(replanClaim?.id === RUN, "the scan must be claimable after a replay");
    const replanCommit = normalizeCommit(
      commitDrafts({
        claimToken: CLAIM_REPLAN,
        expectedCursor: currentCursor,
        nowIso: NOW_REPLAN,
        scanComplete: true,
        items: [
          {
            taskId: TASK_A,
            outcome: "pending",
            exclusionReason: null,
            eventId: "event-a2",
            payloadHash: "hash-a2",
            errorMessage: null,
          },
          {
            taskId: TASK_B,
            outcome: "unchanged",
            exclusionReason: null,
            eventId: "event-b",
            payloadHash: "hash-b",
          },
          {
            taskId: TASK_C,
            outcome: "pending",
            exclusionReason: "archived",
            eventId: "event-c",
            payloadHash: null,
            errorMessage: null,
          },
        ],
        jobs: [
          {
            taskId: TASK_A,
            operation: "upsert",
            eventId: "event-a2",
            generation: 3,
            eventExists: false,
            payloadHash: "hash-a2",
            exclusionReason: null,
            taskUpdatedAt: TASK_UPDATED_AT,
          },
          {
            taskId: TASK_C,
            operation: "delete",
            eventId: "event-c",
            generation: 1,
            eventExists: true,
            payloadHash: null,
            exclusionReason: "archived",
            taskUpdatedAt: TASK_UPDATED_AT,
          },
        ],
      }),
    );
    await sql`
      UPDATE public.calendar_sync_jobs SET run_id = NULL, attempts = 7
      WHERE id = ${jobA.id}::uuid
    `;
    const [replanned] = await commitQuery(sql, replanCommit);
    assert(replanned.committed === true, "a re-planned page must commit");

    const plannedJobs = await sql.unsafe(
      `SELECT id, task_id, calendar_event_id, operation, generation, event_exists,
              payload_hash, attempts
       FROM public.calendar_sync_jobs
       WHERE run_id = $1
       ORDER BY task_id`,
      [RUN],
    );
    assert(plannedJobs.length === 2, "re-planning must coalesce, not duplicate");
    const plannedA = plannedJobs.find((row) => row.task_id === TASK_A);
    const plannedC = plannedJobs.find((row) => row.task_id === TASK_C);
    assert(plannedA?.id === jobA.id, "task A re-plan must adopt the detached pending job");
    assert(plannedA.attempts === 0, "adopting the pending job must reset attempts");
    assert(plannedC?.id === jobC.id, "task C re-plan must keep the pending job id");
    assert(
      plannedA.calendar_event_id === "event-a2",
      "coalescing must adopt the re-planned calendar_event_id",
    );
    assert(plannedA.operation === "upsert", "coalescing must adopt the re-planned operation");
    assert(plannedA.generation === 3, "coalescing must adopt the re-planned generation");
    assert(plannedA.event_exists === false, "coalescing must adopt event_exists");
    assert(plannedA.payload_hash === "hash-a2", "coalescing must adopt the payload hash");
    assert(
      plannedC.calendar_event_id === "event-c",
      "coalescing must preserve the unchanged delete target",
    );
    assert(plannedC.operation === "delete", "coalescing must keep the delete operation");

    const [finishedRun] = await sql.unsafe(
      `SELECT scan_cursor_task_id, scan_complete, scan_claim_token,
              scan_lease_expires_at
       FROM public.calendar_sync_runs WHERE id = $1`,
      [RUN],
    );
    assert(finishedRun.scan_cursor_task_id === TASK_C, "scan cursor must stay current");
    assert(finishedRun.scan_complete === true, "scan completion flag must persist");
    assert(finishedRun.scan_claim_token === null, "the final commit must clear the claim");
    assert(finishedRun.scan_lease_expires_at === null, "the final commit must clear the lease");
    assert((await claimScanQuery(sql, CLAIM_EDIT, NOW_EDIT)).length === 0,
      "a completed scan must never be claimable");
    log("COALESCE", "re-planning adopted the new target on the same pending rows");

    // The worker receives the normalized target only through the real claim
    // path. Both a mapped update and a mapped delete must carry their event id.
    const claimedJobs = await sql`
      SELECT id, task_id, calendar_event_id, operation, status, attempts,
             claim_token, generation, event_exists, destination_key
      FROM public.calendar_sync_claim_jobs(
        ${OWNER}::uuid,
        ${DESTINATION_KEY}::text,
        ${RUN}::uuid,
        ${JOB_CLAIM}::uuid,
        ${10}::integer,
        ${JOB_CLAIM_AT}::timestamptz,
        ${300}::integer
      )
    `;
    assert(claimedJobs.length === 2, "both queued jobs must be claimable");
    const claimedA = claimedJobs.find((row) => row.task_id === TASK_A);
    const claimedC = claimedJobs.find((row) => row.task_id === TASK_C);
    assert(claimedA?.status === "processing", "task A claim must be processing");
    assert(claimedA?.claim_token === JOB_CLAIM, "task A claim must carry the claim token");
    assert(claimedA?.attempts === 1, "task A claim must advance attempts once");
    assert(claimedA?.operation === "upsert", "task A claim must expose the update operation");
    assert(
      claimedA?.calendar_event_id === "event-a2",
      "Fix 2: a claimed mapped update must expose its planned target",
    );
    assert(claimedA?.event_exists === false, "task A claim must expose event_exists");
    assert(claimedC?.status === "processing", "task C claim must be processing");
    assert(claimedC?.claim_token === JOB_CLAIM, "task C claim must carry the claim token");
    assert(claimedC?.attempts === 1, "task C claim must advance attempts once");
    assert(claimedC?.operation === "delete", "task C claim must expose the delete operation");
    assert(
      claimedC?.calendar_event_id === "event-c",
      "Fix 2: a claimed mapped delete must expose its planned target",
    );
    assert(claimedC?.destination_key === DESTINATION_KEY, "task C claim must stay destination-bound");
    log("CLAIM", "claimed mapped update and delete jobs exposed their planned targets");

    // Finish the delete claim so the recovery scenario has exactly one
    // processing job for task A.
    const [completedC] = await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'succeeded', outcome = 'removed', claim_token = NULL,
          lease_expires_at = NULL, locked_at = NULL,
          updated_at = ${NOW_EDIT}::timestamptz
      WHERE id = ${jobC.id}::uuid
        AND status = 'processing'
        AND claim_token = ${JOB_CLAIM}::uuid
      RETURNING id
    `;
    assert(completedC, "task C claim must complete before the recovery scenario");
    await sql`
      UPDATE public.calendar_sync_run_items
      SET outcome = 'removed', event_id = NULL, payload_hash = NULL,
          updated_at = ${NOW_EDIT}::timestamptz
      WHERE run_id = ${RUN}::uuid AND task_id = ${TASK_C}::uuid
    `;

    // A newer edit is planned while task A's earlier claim is still processing.
    // The scan commit cannot coalesce into a processing row, so it inserts a
    // second pending row for the same task and destination.
    // Reopen the fixture to exercise a second page while a claim is in flight.
    await sql`UPDATE public.calendar_sync_runs SET scan_complete = false WHERE id = ${RUN}::uuid`;
    const [editClaim] = await claimScanQuery(sql, CLAIM_EDIT, NOW_EDIT);
    assert(editClaim?.id === RUN, "the run must be scannable while a job is processing");
    const [editCommitted] = await commitQuery(
      sql,
      editDrafts({
        claimToken: CLAIM_EDIT,
        nowIso: NOW_EDIT,
        eventId: "event-a2",
        payloadHash: "hash-a3",
        taskUpdatedAt: "2026-11-23T10:04:30+00:00",
      }),
    );
    assert(editCommitted.committed === true, "a newer edit must commit");

    const editedJobs = await jobsForTask(sql, TASK_A);
    assert(editedJobs.length === 2, "a newer edit must queue beside the processing claim");
    const stillProcessingA = editedJobs.find((row) => row.status === "processing");
    const pendingA = editedJobs.find((row) => row.status === "pending");
    assert(stillProcessingA?.id === jobA.id, "the earlier claim must stay processing");
    assert(pendingA, "the newer edit must insert a pending row");
    assert(pendingA.id !== jobA.id, "the newer pending edit must be a separate row");
    assert(pendingA.generation === 3, "the newer pending edit must carry its generation");
    assert(pendingA.operation === "upsert", "the newer pending edit must carry its operation");
    assert(pendingA.payload_hash === "hash-a3", "the newer pending edit must carry its payload hash");

    await sql`
      UPDATE public.calendar_sync_jobs
      SET scheduled_at = now() + interval '1 day', calendar_event_id = 'older-event'
      WHERE id = ${pendingA.id}::uuid
    `;
    await sql`
      UPDATE public.calendar_sync_jobs
      SET generation = 4, calendar_event_id = 'ambiguous-newer-event',
          lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${jobA.id}::uuid
    `;
    const [overlap] = await sql`SELECT public.calendar_sync_run_counts(${RUN}::uuid) AS counts`;
    assert(overlap.counts.pending === 1 && overlap.counts.ready === 1,
      "one processing plus one pending job must count once");

    // The expired database lease is reclaimable even with a caller clock hours behind.
    const recoveredJobs = await claimJobsQuery(sql, JOB_CLAIM_RECOVER, NOW_RECOVER);
    assert(recoveredJobs.length === 1, "only the newer pending edit must be claimable");
    const recoveredA = recoveredJobs[0];
    assert(recoveredA.id === pendingA.id, "the coalesced pending edit must survive recovery");
    assert(recoveredA.task_id === TASK_A, "the recovered claim must be task A");
    assert(recoveredA.status === "processing", "the recovered claim must be processing");
    assert(
      recoveredA.claim_token === JOB_CLAIM_RECOVER,
      "the recovered claim must carry its new token",
    );
    assert(
      recoveredA.attempts === 1,
      "the newer intent must keep its own retry budget, not the expired attempt",
    );
    assert(recoveredA.generation === 4, "the recovered claim must keep the latest generation");
    assert(recoveredA.operation === "upsert", "the recovered claim must keep the latest operation");
    assert(
      recoveredA.payload_hash === "hash-a3",
      "the recovered claim must keep the latest payload hash",
    );
    assert(
      recoveredA.calendar_event_id === "ambiguous-newer-event",
      "an older pending edit must inherit the higher-generation ambiguous-write target",
    );
    assert(recoveredA.run_id === RUN, "the recovered claim must keep run accounting");

    const recoveredRows = await jobsForTask(sql, TASK_A);
    assert(recoveredRows.length === 1, "recovery must leave exactly one task A job");
    assert(recoveredRows[0].id === pendingA.id, "recovery must keep the newer pending row");
    assert(recoveredRows[0].status === "processing", "recovery must claim the surviving row");
    assert(
      !recoveredRows.some((row) => row.id === jobA.id),
      "recovery must remove the expired processing row",
    );
    const [pendingRowCount] = await sql`
      SELECT count(*)::integer AS count FROM public.calendar_sync_jobs
      WHERE run_id = ${RUN}::uuid AND task_id = ${TASK_A}::uuid
        AND status = 'pending'
    `;
    assert(pendingRowCount.count === 0, "recovery must leave no duplicate pending row");
    const [linkedItem] = await sql`
      SELECT job_id FROM public.calendar_sync_run_items
      WHERE run_id = ${RUN}::uuid AND task_id = ${TASK_A}::uuid
    `;
    assert(
      linkedItem.job_id === pendingA.id,
      "run accounting must link the surviving job after recovery",
    );

    const [recoveredCounts] = await sql`
      SELECT public.calendar_sync_run_counts(${RUN}::uuid) AS counts
    `;
    assert(recoveredCounts.counts.total === 3, "run totals must not change on recovery");
    assert(recoveredCounts.counts.removed === 1, "the completed delete must stay counted");
    assert(recoveredCounts.counts.unchanged === 1, "unchanged work must stay counted");
    assert(recoveredCounts.counts.processing === 1, "the recovered claim must be the only processing job");
    assert(
      recoveredCounts.counts.pending === 1,
      "the run counts must report one unfinished recovered job, not a duplicate",
    );
    assert(recoveredCounts.counts.ready === 1, "recovered work must be ready exactly once");
    assert(recoveredCounts.counts.retrying === 0, "a recovered claim must not look retrying");

    const [staleCompleted] = await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'succeeded', outcome = 'created', claim_token = NULL,
          lease_expires_at = NULL
      WHERE id = ${jobA.id}::uuid
        AND status = 'processing'
        AND claim_token = ${JOB_CLAIM}::uuid
      RETURNING id
    `;
    assert(!staleCompleted, "the expired claim token must not finalize removed work");
    const [staleFinalizedSurvivor] = await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'succeeded', outcome = 'created'
      WHERE id = ${pendingA.id}::uuid
        AND status = 'processing'
        AND claim_token = ${JOB_CLAIM}::uuid
      RETURNING id
    `;
    assert(!staleFinalizedSurvivor, "the expired claim token must not finalize the newer claim");
    const [survivingClaim] = await sql`
      SELECT status, claim_token FROM public.calendar_sync_jobs
      WHERE id = ${pendingA.id}::uuid
    `;
    assert(survivingClaim.status === "processing", "the newer claim must stay processing");
    assert(
      survivingClaim.claim_token === JOB_CLAIM_RECOVER,
      "the newer claim must keep its own token",
    );
    const [expiredRow] = await sql`
      SELECT count(*)::integer AS count FROM public.calendar_sync_jobs
      WHERE id = ${jobA.id}::uuid
    `;
    assert(expiredRow.count === 0, "the expired processing row must be gone");
    log(
      "RECOVER",
      "expired processing folded into the newer pending edit; latest intent claimed and stale token rejected",
    );

    // The release and retryable-failure paths share the collision. A newer edit
    // first supersedes the release: the newest intent stays pending, the older
    // claim is removed, and its failure is not recorded against newer work.
    const [releaseEditClaim] = await claimScanQuery(sql, CLAIM_EDIT_RELEASE, NOW_EDIT_RELEASE);
    assert(releaseEditClaim?.id === RUN, "the run must be scannable during the release scenario");
    const [releaseEditCommitted] = await commitQuery(
      sql,
      editDrafts({
        claimToken: CLAIM_EDIT_RELEASE,
        nowIso: NOW_EDIT_RELEASE,
        eventId: "event-a2",
        payloadHash: "hash-a4",
        taskUpdatedAt: "2026-11-23T10:10:30+00:00",
      }),
    );
    assert(releaseEditCommitted.committed === true, "the release-scenario edit must commit");

    const beforeRelease = await jobsForTask(sql, TASK_A);
    assert(beforeRelease.length === 2, "the release scenario must have a processing and pending row");
    const releasePendingA = beforeRelease.find((row) => row.status === "pending");
    assert(releasePendingA, "the release scenario must keep the newer pending edit");

    const supersededRelease = await releaseJobsQuery(
      sql,
      [pendingA.id],
      JOB_CLAIM_RECOVER,
      NOW_EDIT_RELEASE,
      {
        recordFailure: true,
        lastError: "Transient Google Calendar error.",
        outcome: "failed",
        scheduledAt: NOW_RELEASE,
      },
    );
    assert(
      supersededRelease.length === 0,
      "a release superseded by a newer edit must not report the old claim",
    );

    const afterRelease = await jobsForTask(sql, TASK_A);
    assert(afterRelease.length === 1, "a superseded release must leave one job");
    assert(afterRelease[0].id === releasePendingA.id, "a superseded release must keep the newer row");
    assert(afterRelease[0].status === "pending", "a superseded release must stay pending");
    assert(afterRelease[0].generation === 4 &&
      afterRelease[0].calendar_event_id === "ambiguous-newer-event" && !afterRelease[0].event_exists,
      "release must preserve the higher-generation target for ownership verification");
    assert(afterRelease[0].last_error === null, "the newer intent must not inherit an older failure");
    assert(afterRelease[0].outcome === null, "the newer intent must not inherit an older outcome");
    assert(afterRelease[0].payload_hash === "hash-a4", "the newer intent must keep its payload hash");
    assert(
      new Date(afterRelease[0].scheduled_at).getTime() <= new Date(NOW_EDIT_RELEASE).getTime(),
      "a superseded release must leave the newer intent ready",
    );
    const [staleReleaseFinalize] = await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'succeeded'
      WHERE id = ${pendingA.id}::uuid
        AND status = 'processing'
        AND claim_token = ${JOB_CLAIM_RECOVER}::uuid
      RETURNING id
    `;
    assert(!staleReleaseFinalize, "a superseded release token must not finalize newer work");

    const claimedReleaseJobs = await claimJobsQuery(sql, JOB_CLAIM_RELEASE, NOW_RELEASE);
    assert(claimedReleaseJobs.length === 1, "the surviving newer edit must be claimable");
    const claimedReleaseA = claimedReleaseJobs[0];
    assert(claimedReleaseA.id === releasePendingA.id, "the claim must keep the surviving edit");
    assert(claimedReleaseA.status === "processing", "the release claim must be processing");
    assert(claimedReleaseA.attempts === 1, "the release claim must advance attempts once");

    // With no newer edit, a retryable failure settles the claimed row in place
    // with its backoff and error, and the retry budget is retained.
    const failedJobs = await releaseJobsQuery(
      sql,
      [claimedReleaseA.id],
      JOB_CLAIM_RELEASE,
      NOW_RELEASE,
      {
        recordFailure: true,
        lastError: "Transient Google Calendar error.",
        outcome: "failed",
        scheduledAt: RETRY_AT,
      },
    );
    assert(failedJobs.length === 1, "an unsuperseded failure must settle its claimed row");
    const settledFailure = failedJobs[0];
    assert(settledFailure.id === claimedReleaseA.id, "the same row must return to pending");
    assert(settledFailure.status === "pending", "a retryable failure must return to pending");
    assert(settledFailure.attempts === 1, "a retryable failure must keep its attempt count");
    assert(
      settledFailure.last_error === "Transient Google Calendar error.",
      "a retryable failure must record its error",
    );
    assert(settledFailure.outcome === "failed", "a retryable failure must record its outcome");
    assert(
      new Date(settledFailure.scheduled_at).toISOString() === new Date(RETRY_AT).toISOString(),
      "a retryable failure must honor its backoff",
    );

    const tooEarlyJobs = await claimJobsQuery(
      sql,
      "19191919-1919-4919-8919-191919191919",
      RETRY_AT,
    );
    assert(tooEarlyJobs.length === 0, "a retry backoff must not be claimable early");
    await sql`UPDATE public.calendar_sync_jobs SET scheduled_at = clock_timestamp() - interval '1 second'
      WHERE id = ${claimedReleaseA.id}::uuid`;
    const retriedJobs = await claimJobsQuery(sql, JOB_CLAIM_RETRY, RETRY_AT);
    assert(retriedJobs.length === 1, "the retry must be claimable at its backoff time");
    assert(retriedJobs[0].id === claimedReleaseA.id, "the retry must keep the same job row");
    assert(retriedJobs[0].attempts === 2, "the retry must advance attempts from the settled count");
    assert(retriedJobs[0].claim_token === JOB_CLAIM_RETRY, "the retry must carry a new token");
    assert(retriedJobs[0].payload_hash === "hash-a4", "the retry must keep the latest payload hash");
    log(
      "RELEASE",
      "release and retryable failure fold into newer edits and preserve backoff without duplicates",
    );

    // ---------------------------------------------------------------------
    // Fix 5: a mapping is retired only after Google confirms removal, and the
    // mapping/job/run-item settlement is one claim-guarded transaction.
    // ---------------------------------------------------------------------
    await sql.unsafe(
      `INSERT INTO auth.users (id, email)
       VALUES ($1, 'proof-removal@example.test')
       ON CONFLICT (id) DO NOTHING`,
      [OWNER_REMOVAL],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_sync_runs (
         id, owner_user_id, destination_key, google_account_subject,
         google_account_email, calendar_id, status
       )
       VALUES ($1, $2, $3, 'proof-removal', 'proof-removal@example.test',
               'primary', 'active')`,
      [RUN_REMOVAL, OWNER_REMOVAL, DESTINATION_REMOVAL],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_event_mappings (
         owner_user_id, task_id, destination_key, google_account_subject,
         google_account_email, calendar_id, event_id, generation, status,
         metadata_verified, updated_at
       )
       VALUES
         ($1, $2, $3, 'proof-removal', 'proof-removal@example.test', 'primary',
          'event-generation-2', 2, 'active', true, $4::timestamptz),
         ($1, $5, $3, 'proof-removal', 'proof-removal@example.test', 'primary',
          'orphan-event', 1, 'active', true, $4::timestamptz)`,
      [OWNER_REMOVAL, TASK_REMOVAL, DESTINATION_REMOVAL, NOW_REMOVAL, TASK_ORPHAN],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_sync_run_items (
         run_id, owner_user_id, task_id, outcome, updated_at
       )
       VALUES ($1, $2, $3, 'pending', $4::timestamptz)`,
      [RUN_REMOVAL, OWNER_REMOVAL, TASK_REMOVAL, NOW_REMOVAL],
    );
    await sql.unsafe(
      `INSERT INTO public.calendar_sync_jobs (
         id, owner_user_id, task_id, calendar_event_id, operation, status,
         attempts, updated_at, queue_version, run_id, destination_key,
         google_account_subject, google_account_email, calendar_id, generation,
         event_exists, claim_token, lease_expires_at, scheduled_at,
         payload_hash, permanent_failure
       )
       VALUES ($1, $2, $3, 'event-generation-1', 'delete', 'processing', 1,
               $4::timestamptz, 2, $5, $6, 'proof-removal',
               'proof-removal@example.test', 'primary', 1, true, $7,
               clock_timestamp() + interval '5 minutes', $4::timestamptz, NULL, false)`,
      [
        TASK_REMOVAL_JOB,
        OWNER_REMOVAL,
        TASK_REMOVAL,
        NOW_REMOVAL,
        RUN_REMOVAL,
        DESTINATION_REMOVAL,
        REMOVAL_JOB_CLAIM,
      ],
    );

    const [removalScanClaim] = await claimScanQuery(sql, ORPHAN_SCAN_CLAIM, NOW_REMOVAL, RUN_REMOVAL);
    assert(removalScanClaim?.id === RUN_REMOVAL, "the removal run must be scannable");

    // A mapping with an active processing job is already represented in the
    // queue. Listing it again would enqueue duplicate orphan work.
    const orphansBefore = await orphanMappingsQuery(
      sql,
      OWNER_REMOVAL,
      DESTINATION_REMOVAL,
    );
    assert(orphansBefore.length === 1, "only the jobless orphan mapping must be listed");
    assert(orphansBefore[0].task_id === TASK_ORPHAN, "the listed mapping must be the orphan");

    // Crash before the delete job is durable: the claim token no longer matches,
    // so the commit fails and neither the mapping nor a partial job is changed.
    const [failedRemovalCommit] = await commitQuery(
      sql,
      removalCommit({ claimToken: ORPHAN_SCAN_WRONG_CLAIM }),
    );
    assert(
      failedRemovalCommit.committed === false,
      "a stale scan claim must not commit the orphan delete",
    );
    const [orphanAfterFailure] = await sql`
      SELECT status, event_id FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_ORPHAN}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(
      orphanAfterFailure.status === "active",
      "a failed orphan enqueue must keep the mapping active",
    );
    assert(
      orphanAfterFailure.event_id === "orphan-event",
      "a failed orphan enqueue must keep the mapped Google event",
    );
    const [orphanJobsAfterFailure] = await sql`
      SELECT count(*)::integer AS count FROM public.calendar_sync_jobs
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_ORPHAN}::uuid
    `;
    assert(orphanJobsAfterFailure.count === 0, "a failed enqueue must persist no job");
    const [orphanItemsAfterFailure] = await sql`
      SELECT count(*)::integer AS count FROM public.calendar_sync_run_items
      WHERE run_id = ${RUN_REMOVAL}::uuid AND task_id = ${TASK_ORPHAN}::uuid
    `;
    assert(orphanItemsAfterFailure.count === 0, "a failed enqueue must persist no item");

    // The same page with the active claim commits the delete job while the
    // mapping stays active until that job's completion confirms removal.
    const [removalCommitted] = await commitQuery(sql, removalCommit());
    assert(removalCommitted.committed === true, "the active claim must commit the orphan page");
    const [orphanAfterEnqueue] = await sql`
      SELECT status FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_ORPHAN}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(
      orphanAfterEnqueue.status === "active",
      "queuing a delete must not retire the mapping before Google confirms it",
    );
    const [queuedOrphanJob] = await sql`
      SELECT id, calendar_event_id, operation, status FROM public.calendar_sync_jobs
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_ORPHAN}::uuid
    `;
    assert(queuedOrphanJob.status === "pending", "the orphan delete must be durable");
    assert(queuedOrphanJob.operation === "delete", "the orphan job must delete");
    assert(
      queuedOrphanJob.calendar_event_id === "orphan-event",
      "the orphan job must target the mapped event",
    );
    const orphansAfterEnqueue = await orphanMappingsQuery(
      sql,
      OWNER_REMOVAL,
      DESTINATION_REMOVAL,
    );
    assert(
      orphansAfterEnqueue.length === 0,
      "queued orphan work must not be listed again",
    );
    log("ORPHAN", "failed enqueue preserved the mapping; committed enqueue queued one delete");

    const claimedOrphanJobs = await sql`
      SELECT id, task_id, calendar_event_id, status, claim_token
      FROM public.calendar_sync_claim_jobs(
        ${OWNER_REMOVAL}::uuid,
        ${DESTINATION_REMOVAL}::text,
        ${RUN_REMOVAL}::uuid,
        ${ORPHAN_JOB_CLAIM}::uuid,
        ${10}::integer,
        clock_timestamp(),
        ${300}::integer
      )
    `;
    assert(claimedOrphanJobs.length === 1, "only the orphan delete must be claimable");
    const claimedOrphan = claimedOrphanJobs[0];
    assert(claimedOrphan.task_id === TASK_ORPHAN, "the claimed job must be the orphan");
    assert(claimedOrphan.status === "processing", "the orphan job must be processing");
    assert(
      claimedOrphan.claim_token === ORPHAN_JOB_CLAIM,
      "the orphan claim must carry its token",
    );

    // A stale token cannot settle anything: job, mapping and item stay as they
    // were, so the retry after a provider success can safely settle again.
    const [staleSettlement] = await completeJobQuery(sql, {
      jobId: TASK_REMOVAL_JOB,
      claimToken: REMOVAL_WRONG_CLAIM,
      outcome: "removed",
      eventId: null,
      generation: 1,
      payloadHash: null,
      exclusionReason: null,
      removeMapping: true,
      removedEventId: "event-generation-1",
      removedGeneration: 1,
      nowIso: NOW_REMOVAL,
    });
    assert(staleSettlement.completed === false, "a stale claim must not settle the job");
    const [mappingAfterStale] = await sql`
      SELECT event_id, generation, status FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(mappingAfterStale.status === "active", "a stale claim must not retire the mapping");
    assert(mappingAfterStale.generation === 2, "a stale claim must not change the mapping generation");
    const [jobAfterStale] = await sql`
      SELECT status, claim_token FROM public.calendar_sync_jobs
      WHERE id = ${TASK_REMOVAL_JOB}::uuid
    `;
    assert(jobAfterStale.status === "processing", "a stale claim must leave the job processing");
    assert(
      jobAfterStale.claim_token === REMOVAL_JOB_CLAIM,
      "a stale claim must leave the active token intact",
    );
    const [itemAfterStale] = await sql`
      SELECT outcome FROM public.calendar_sync_run_items
      WHERE run_id = ${RUN_REMOVAL}::uuid AND task_id = ${TASK_REMOVAL}::uuid
    `;
    assert(itemAfterStale.outcome === "pending", "a stale claim must leave the item pending");

    // Prove the settlement is one transaction: if the run-item update fails,
    // the mapping removal and job success must roll back together.
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.calendar_sync_proof_fail_settlement()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $proof$
      BEGIN
        RAISE EXCEPTION 'proof settlement failure';
      END
      $proof$;
    `);
    await sql.unsafe(`
      CREATE TRIGGER calendar_sync_proof_fail_settlement
      BEFORE UPDATE ON public.calendar_sync_run_items
      FOR EACH ROW
      EXECUTE FUNCTION public.calendar_sync_proof_fail_settlement();
    `);
    const settlementFailure = await captureCode(() =>
      completeJobQuery(sql, {
        jobId: TASK_REMOVAL_JOB,
        claimToken: REMOVAL_JOB_CLAIM,
        outcome: "removed",
        eventId: null,
        generation: 1,
        payloadHash: null,
        exclusionReason: null,
        removeMapping: true,
        removedEventId: "event-generation-1",
        removedGeneration: 1,
        nowIso: NOW_REMOVAL,
      }),
    );
    assert(settlementFailure !== null, "the run-item failure must abort settlement");
    await sql.unsafe(
      `DROP TRIGGER calendar_sync_proof_fail_settlement ON public.calendar_sync_run_items;`,
    );
    await sql.unsafe(`DROP FUNCTION public.calendar_sync_proof_fail_settlement();`);
    const [mappingAfterRollback] = await sql`
      SELECT status, generation FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(mappingAfterRollback.status === "active", "a failed settlement must roll back mapping removal");
    assert(mappingAfterRollback.generation === 2, "a failed settlement must keep the newer mapping");
    const [jobAfterRollback] = await sql`
      SELECT status, claim_token FROM public.calendar_sync_jobs
      WHERE id = ${TASK_REMOVAL_JOB}::uuid
    `;
    assert(jobAfterRollback.status === "processing", "a failed settlement must leave the job processing");
    assert(
      jobAfterRollback.claim_token === REMOVAL_JOB_CLAIM,
      "a failed settlement must leave the claim retryable",
    );

    // Late completion of the generation-1 delete must never retire the
    // generation-2 mapping published by a remove-then-republish.
    const [lateRemoval] = await completeJobQuery(sql, {
      jobId: TASK_REMOVAL_JOB,
      claimToken: REMOVAL_JOB_CLAIM,
      outcome: "removed",
      eventId: null,
      generation: 1,
      payloadHash: null,
      exclusionReason: null,
      removeMapping: true,
      removedEventId: "event-generation-1",
      removedGeneration: 1,
      nowIso: NOW_REMOVAL,
    });
    assert(lateRemoval.completed === true, "the active claim must settle the old delete");
    const [mappingAfterLateRemoval] = await sql`
      SELECT event_id, generation, status FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(
      mappingAfterLateRemoval.status === "active",
      "a late generation-1 delete must not retire the generation-2 mapping",
    );
    assert(
      mappingAfterLateRemoval.event_id === "event-generation-2",
      "the republished event must remain mapped",
    );
    assert(mappingAfterLateRemoval.generation === 2, "the republished generation must remain");
    log("SETTLE", "stale claims and failed settlements left mapping, job and item untouched");

    await sql.unsafe(
      `INSERT INTO public.calendar_sync_jobs (
         id, owner_user_id, task_id, calendar_event_id, operation, status,
         attempts, updated_at, queue_version, run_id, destination_key,
         google_account_subject, google_account_email, calendar_id, generation,
         event_exists, claim_token, lease_expires_at, scheduled_at,
         payload_hash, permanent_failure
       )
       VALUES ($1, $2, $3, 'event-generation-2', 'delete', 'processing', 1,
               $4::timestamptz, 2, $5, $6, 'proof-removal',
               'proof-removal@example.test', 'primary', 2, true, $7,
               clock_timestamp() + interval '5 minutes', $4::timestamptz, NULL, false)`,
      [
        TASK_REMOVAL_REPUBLISH_JOB,
        OWNER_REMOVAL,
        TASK_REMOVAL,
        NOW_REMOVAL,
        RUN_REMOVAL,
        DESTINATION_REMOVAL,
        REMOVAL_REPUBLISH_CLAIM,
      ],
    );
    const [currentRemoval] = await completeJobQuery(sql, {
      jobId: TASK_REMOVAL_REPUBLISH_JOB,
      claimToken: REMOVAL_REPUBLISH_CLAIM,
      outcome: "removed",
      eventId: null,
      generation: 2,
      payloadHash: null,
      exclusionReason: null,
      removeMapping: true,
      removedEventId: "event-generation-2",
      removedGeneration: 2,
      nowIso: NOW_REMOVAL,
    });
    assert(currentRemoval.completed === true, "the current-generation delete must settle");
    const [mappingAfterCurrentRemoval] = await sql`
      SELECT status FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(
      mappingAfterCurrentRemoval.status === "removed",
      "the matching generation must be retired",
    );
    log(
      "REPUBLISH",
      "an old delete could not retire the newer mapping; the current delete retired it",
    );

    // Simulate an insert accepted by Google whose initial settlement failed.
    await sql`
      DELETE FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}
    `;
    await sql`
      UPDATE public.calendar_sync_jobs
      SET operation = 'upsert', status = 'processing',
          claim_token = ${REMOVAL_REPUBLISH_CLAIM}::uuid,
          lease_expires_at = clock_timestamp() + interval '5 minutes'
      WHERE id = ${TASK_REMOVAL_REPUBLISH_JOB}::uuid
    `;
    const [stalePrepare] = await sql`
      SELECT public.calendar_sync_prepare_removal(
        ${TASK_REMOVAL_REPUBLISH_JOB}::uuid, ${REMOVAL_JOB_CLAIM}::uuid,
        'event-generation-2', ${NOW_REMOVAL}::timestamptz
      ) AS prepared
    `;
    assert(!stalePrepare.prepared, "a stale claim must not prepare a removal");
    const [currentPrepare] = await sql`
      SELECT public.calendar_sync_prepare_removal(
        ${TASK_REMOVAL_REPUBLISH_JOB}::uuid, ${REMOVAL_REPUBLISH_CLAIM}::uuid,
        'event-generation-2', ${NOW_REMOVAL}::timestamptz
      ) AS prepared
    `;
    assert(currentPrepare.prepared, "a live claim must persist the verified target before delete");
    const [preparedMapping] = await sql`
      SELECT status, generation FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}
    `;
    assert(preparedMapping.status === "active" && preparedMapping.generation === 2,
      "the prepared target must remain discoverable before confirmed deletion");
    // Exercise settlement independently when the mapping still holds an older event.
    await sql`
      UPDATE public.calendar_event_mappings
      SET generation = 1, event_id = 'event-generation-1'
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}
    `;
    const [unmappedRemoval] = await completeJobQuery(sql, {
      jobId: TASK_REMOVAL_REPUBLISH_JOB,
      claimToken: REMOVAL_REPUBLISH_CLAIM,
      outcome: "removed",
      eventId: null,
      generation: 2,
      removeMapping: true,
      removedEventId: "event-generation-2",
      removedGeneration: 2,
      nowIso: NOW_REMOVAL,
    });
    assert(unmappedRemoval.completed, "confirmed removal of an unmapped event must settle");
    const [removedGeneration] = await sql`
      SELECT status, event_id, generation FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_REMOVAL}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}
    `;
    assert(
      removedGeneration?.status === "removed" &&
        removedGeneration.event_id === "event-generation-2" &&
        removedGeneration.generation === 2,
      "confirmed removal must advance an older mapping to the removed generation",
    );
    log("UNMAPPED-REMOVE", "confirmed removal retained the generation for republish");

    const [orphanRemoval] = await completeJobQuery(sql, {
      jobId: claimedOrphan.id,
      claimToken: ORPHAN_JOB_CLAIM,
      outcome: "removed",
      eventId: null,
      generation: 1,
      payloadHash: null,
      exclusionReason: null,
      removeMapping: true,
      removedEventId: "orphan-event",
      removedGeneration: 1,
      nowIso: NOW_REMOVAL,
    });
    assert(orphanRemoval.completed === true, "the confirmed orphan delete must settle");
    const [orphanFinal] = await sql`
      SELECT status FROM public.calendar_event_mappings
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid
        AND task_id = ${TASK_ORPHAN}::uuid
        AND destination_key = ${DESTINATION_REMOVAL}::text
    `;
    assert(orphanFinal.status === "removed", "a confirmed orphan delete must retire the mapping");
    const [orphanFinalJob] = await sql`
      SELECT status, claim_token FROM public.calendar_sync_jobs
      WHERE id = ${claimedOrphan.id}::uuid
    `;
    assert(orphanFinalJob.status === "succeeded", "the orphan job must be finalized");
    assert(orphanFinalJob.claim_token === null, "the settled orphan claim must clear");
    const [orphanFinalItem] = await sql`
      SELECT outcome, event_id FROM public.calendar_sync_run_items
      WHERE run_id = ${RUN_REMOVAL}::uuid AND task_id = ${TASK_ORPHAN}::uuid
    `;
    assert(orphanFinalItem.outcome === "removed", "the orphan run item must settle as removed");
    assert(orphanFinalItem.event_id === null, "the removed item must not keep an event id");
    log(
      "ORPHAN-SETTLE",
      "Google-confirmed delete retired the mapping, job and run item atomically",
    );

    await sql.begin(async (tx) => {
      await tx`GRANT USAGE ON SCHEMA auth TO authenticated`;
      await tx`GRANT SELECT, INSERT, UPDATE, DELETE ON
        public.calendar_sync_runs, public.calendar_sync_run_items,
        public.calendar_event_mappings TO authenticated`;
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${OWNER_REMOVAL}, true)`;
      const [direct] = await tx`SELECT
        (SELECT count(*)::int FROM public.calendar_sync_runs) AS runs,
        (SELECT count(*)::int FROM public.calendar_sync_run_items) AS items,
        (SELECT count(*)::int FROM public.calendar_event_mappings) AS mappings`;
      assert(direct.runs > 0 && direct.items > 0 && direct.mappings > 0,
        "direct owner session must read all three tables");
      await tx`SELECT set_config('request.jwt.claims', '{"client_id":"mcp-proof"}', true)`;
      const [restricted] = await tx`SELECT
        (SELECT count(*)::int FROM public.calendar_sync_runs) AS runs,
        (SELECT count(*)::int FROM public.calendar_sync_run_items) AS items,
        (SELECT count(*)::int FROM public.calendar_event_mappings) AS mappings`;
      assert(restricted.runs === 0 && restricted.items === 0 && restricted.mappings === 0,
        "MCP OAuth must see zero rows in all three tables");

      const inserts = [
        (db) => db`INSERT INTO public.calendar_sync_runs (owner_user_id, destination_key, calendar_id)
                    VALUES (${OWNER_REMOVAL}::uuid, 'rls-proof', 'primary')`,
        (db) => db`INSERT INTO public.calendar_sync_run_items (owner_user_id, run_id, task_id, outcome)
                    VALUES (${OWNER_REMOVAL}::uuid, ${RUN_REMOVAL}::uuid, ${TASK_C}::uuid, 'pending')`,
        (db) => db`INSERT INTO public.calendar_event_mappings
                      (owner_user_id, task_id, destination_key, calendar_id, event_id)
                    VALUES (${OWNER_REMOVAL}::uuid, ${TASK_C}::uuid, 'rls-proof', 'primary', 'ev')`,
      ];
      for (const insert of inserts) {
        const code = await captureCode(() => tx.savepoint(insert));
        assert(code === "42501", `MCP OAuth insert must be rejected by RLS, got ${code}`);
      }
      for (const table of ["calendar_sync_runs", "calendar_sync_run_items", "calendar_event_mappings"]) {
        const updated = await tx`UPDATE public.${tx(table)} SET updated_at = now() RETURNING id`;
        const deleted = await tx`DELETE FROM public.${tx(table)} RETURNING id`;
        assert(updated.length === 0 && deleted.length === 0,
          `MCP OAuth must not update or delete rows in ${table}`);
      }
    });
    log("RLS", "direct owner access works and MCP OAuth reads and inserts are denied");

    await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'processing', attempts = 8, claim_token = ${ORPHAN_JOB_CLAIM}::uuid,
          lease_expires_at = now() - interval '1 second'
      WHERE id = ${claimedOrphan.id}::uuid
    `;
    const [expired] = await sql`SELECT
      public.calendar_sync_claim_is_current(${claimedOrphan.id}::uuid, ${ORPHAN_JOB_CLAIM}::uuid) AS current,
      public.calendar_sync_advance_generation(
        ${claimedOrphan.id}::uuid, ${ORPHAN_JOB_CLAIM}::uuid, 2, 'bad', NULL, now()
      ) AS advanced,
      public.calendar_sync_fail_claim(
        ${claimedOrphan.id}::uuid, ${ORPHAN_JOB_CLAIM}::uuid, 'failed', NULL, 'bad', true, now()
      ) AS failed`;
    assert(!expired.current && !expired.advanced && !expired.failed, "expired claim must not mutate");
    const releasedExpired = await releaseJobsQuery(sql, [claimedOrphan.id], ORPHAN_JOB_CLAIM, NOW_REMOVAL);
    assert(releasedExpired.length === 0, "expired claims must be reclaimed, not released");

    await sql`
      UPDATE public.calendar_sync_jobs SET lease_expires_at = now() + interval '1 minute'
      WHERE id = ${claimedOrphan.id}::uuid
    `;
    const [exhausted] = await sql`SELECT public.calendar_sync_fail_claim(
      ${claimedOrphan.id}::uuid, ${ORPHAN_JOB_CLAIM}::uuid, 'failed', NULL, 'exhausted', false, now()
    ) AS failed`;
    assert(exhausted.failed, "live exhausted claim must settle as failed");
    const [failedItem] = await sql`SELECT outcome, error_message FROM public.calendar_sync_run_items
      WHERE run_id = ${RUN_REMOVAL}::uuid AND task_id = ${TASK_ORPHAN}::uuid`;
    assert(failedItem.outcome === "failed" && failedItem.error_message === "exhausted",
      "exhaustion must atomically settle the job and item");
    const resumeRetry = (db) => db`SELECT status, scan_complete, retry_mode, completed_at
      FROM public.calendar_sync_resume_run_for_retry(
        ${RUN_REMOVAL}::uuid, ${DESTINATION_REMOVAL}, true, now()
      )`;
    let competingCompletion;
    // Start completion while retry holds the row lock. Completion must read the
    // newly queued work after it acquires the lock and before changing the run.
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM public.calendar_sync_runs WHERE id = ${RUN_REMOVAL}::uuid FOR UPDATE`;
        competingCompletion = sql`/* proof-competing-completion */ SELECT id
          FROM public.calendar_sync_complete_run_if_drained(${RUN_REMOVAL}::uuid, now())`.execute();
        let waiting = false;
        for (let i = 0; i < 50 && !waiting; i += 1) {
          await tx`SELECT pg_stat_clear_snapshot()`;
          const [activity] = await tx`SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE query LIKE '/* proof-competing-completion */%' AND wait_event_type = 'Lock'
          ) AS waiting`;
          waiting = activity.waiting;
          if (!waiting) await tx`SELECT pg_sleep(0.02)`;
        }
        assert(waiting, "completion must wait for the run lock");
        const [retry] = await resumeRetry(tx);
        assert(retry?.status === "active" && retry.scan_complete && retry.retry_mode,
          "retry must atomically requeue work under the run lock");
      });
    } finally {
      if (competingCompletion) {
        assert((await competingCompletion).length === 0, "waiting completion must see requeued work");
      }
    }
    await sql`UPDATE public.calendar_sync_runs SET status = 'completed', completed_at = now()
      WHERE id = ${RUN_REMOVAL}::uuid`;
    const [retry] = await resumeRetry(sql);
    assert(retry?.status === "active" && retry.scan_complete && retry.retry_mode && retry.completed_at === null,
      "retry must resume a completed run without reopening the scan");
    const [retried] = await sql`
      SELECT job.attempts, job.status, job.last_error, item.outcome, item.error_message
      FROM public.calendar_sync_jobs AS job JOIN public.calendar_sync_run_items AS item ON item.job_id = job.id
      WHERE job.id = ${claimedOrphan.id}::uuid
    `;
    assert(retried.attempts === 0 && retried.status === "pending" && retried.last_error === null &&
      retried.outcome === "pending" && retried.error_message === null, "retry must reset the job and item");

    const undrained = await sql`SELECT id FROM public.calendar_sync_complete_run_if_drained(${RUN_REMOVAL}::uuid, now())`;
    assert(undrained.length === 0, "pending work must block run completion");

    const actionable = () => sql`SELECT id FROM public.calendar_sync_list_actionable_runs(100)
      WHERE id = ${RUN_REMOVAL}::uuid`;
    assert((await actionable()).length === 1, "a run with ready work must be actionable");
    await sql`UPDATE public.calendar_sync_jobs
      SET attempts = 1, scheduled_at = now() + interval '1 hour'
      WHERE id = ${claimedOrphan.id}::uuid`;
    assert((await actionable()).length === 0, "future backoff must not consume a recovery slot");
    await sql`UPDATE public.calendar_sync_jobs
      SET status = 'processing', claim_token = ${ORPHAN_JOB_CLAIM}::uuid,
          lease_expires_at = now() - interval '1 second'
      WHERE id = ${claimedOrphan.id}::uuid`;
    assert((await actionable()).length === 1, "an expired run lease must be actionable");
    await sql`UPDATE public.calendar_sync_jobs SET status = 'succeeded'
      WHERE run_id = ${RUN_REMOVAL}::uuid`;
    assert((await actionable()).length === 1, "a drained run must stay actionable until completion");
    const drained = await sql`SELECT id FROM public.calendar_sync_complete_run_if_drained(${RUN_REMOVAL}::uuid, now())`;
    assert(drained.length === 1, "fully scanned and drained run must complete");

    // Five older unfinished runs backed off via next_retry_at or paused must not
    // starve a sixth healthy unfinished run at limit 5.
    const backedOffRuns = [];
    for (let i = 1; i <= 6; i += 1) {
      const [insertedRun] = await sql`
        INSERT INTO public.calendar_sync_runs (
          owner_user_id, destination_key, calendar_id, status, scan_complete,
          next_retry_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${`starve-dest-${i}|primary`}, 'primary',
          ${i <= 2 ? "paused" : "active"}, false,
          ${i >= 3 && i <= 5 ? sql`now() + interval '5 minutes'` : null},
          now() - make_interval(mins => ${10 - i})
        ) RETURNING id`;
      backedOffRuns.push(insertedRun.id);
    }
    const actionableSixth = await sql`
      SELECT id FROM public.calendar_sync_list_actionable_runs(5)`;
    assert(
      actionableSixth.some((row) => row.id === backedOffRuns[5]) &&
        !actionableSixth.some((row) => backedOffRuns.slice(0, 5).includes(row.id)),
      "backed-off and paused failing runs must not starve a sixth healthy run",
    );
    await sql`UPDATE public.calendar_sync_runs
      SET next_retry_at = now() - interval '1 second'
      WHERE id = ${backedOffRuns[2]}::uuid`;
    const dueRetryRuns = await sql`
      SELECT id FROM public.calendar_sync_list_actionable_runs(5)`;
    assert(
      dueRetryRuns.some((row) => row.id === backedOffRuns[2]),
      "a backed-off unfinished run must become actionable once next_retry_at passes",
    );

    // Fencing check for calendar_sync_fail_unclaimed_listing:
    // 1) Refuses when a live scan claim is held
    await sql`UPDATE public.calendar_sync_runs
      SET scan_claim_token = gen_random_uuid(),
          scan_lease_expires_at = now() + interval '5 minutes'
      WHERE id = ${backedOffRuns[5]}::uuid`;
    const [blockedByClaim] = await sql`
      SELECT public.calendar_sync_fail_unclaimed_listing(
        ${backedOffRuns[5]}::uuid, NULL, NULL, true, NULL, 'late failure', now()
      ) AS recorded`;
    assert(!blockedByClaim.recorded, "listing failure must not interrupt a live scan claim");
    // 2) Refuses when cursor already advanced
    await sql`UPDATE public.calendar_sync_runs
      SET scan_claim_token = NULL, scan_lease_expires_at = NULL,
          scan_cursor_created_at = now(), scan_cursor_task_id = ${TASK_A}::uuid
      WHERE id = ${backedOffRuns[5]}::uuid`;
    const [blockedByCursor] = await sql`
      SELECT public.calendar_sync_fail_unclaimed_listing(
        ${backedOffRuns[5]}::uuid, NULL, NULL, true, NULL, 'late failure', now()
      ) AS recorded`;
    assert(!blockedByCursor.recorded, "listing failure must not apply against a stale cursor");
    // 3) Refuses on a completed run
    const [blockedByCompleted] = await sql`
      SELECT public.calendar_sync_fail_unclaimed_listing(
        ${RUN_REMOVAL}::uuid, NULL, NULL, true, NULL, 'late failure', now()
      ) AS recorded`;
    assert(!blockedByCompleted.recorded, "listing failure must never overwrite a completed run");
    // 4) Succeeds when active, unclaimed, incomplete, and cursor matches
    const [allowedPause] = await sql`
      SELECT public.calendar_sync_fail_unclaimed_listing(
        ${backedOffRuns[2]}::uuid, NULL, NULL, true, NULL, 'Calendar deleted', now()
      ) AS recorded`;
    const [pausedRow] = await sql`
      SELECT status, last_error, next_retry_at FROM public.calendar_sync_runs
      WHERE id = ${backedOffRuns[2]}::uuid`;
    assert(
      allowedPause.recorded && pausedRow.status === "paused" &&
        pausedRow.last_error === "Calendar deleted" && pausedRow.next_retry_at === null,
      "unclaimed matching listing failure must pause cleanly",
    );
    await sql`DELETE FROM public.calendar_sync_runs WHERE id = ANY(${backedOffRuns}::uuid[])`;
    log("CLAIM-RETRY", "expired mutation guards, retry settlement, fenced listing failures and drained run completion verified");

    const [newTask] = await sql`SELECT gen_random_uuid() AS id`;
    const enqueueGeneration = (generation, eventId, operation) => sql`
      SELECT public.calendar_sync_enqueue_job(
        ${OWNER}::uuid, ${newTask.id}::uuid, ${eventId}, ${operation},
        ${DESTINATION_KEY}, 'proof-subject', NULL, 'primary', ${generation},
        ${generation === 1}, now()
      )`;
    await sql`
      INSERT INTO public.calendar_event_mappings (
        owner_user_id, task_id, destination_key, google_account_subject,
        calendar_id, event_id, generation, status, metadata_verified
      ) VALUES (${OWNER}::uuid, ${newTask.id}::uuid, ${DESTINATION_KEY}, 'proof-subject',
        'primary', 'generation-one', 1, 'active', true)`;
    const claimDetached = async (token) => {
      const rows = await sql`
        SELECT id FROM public.calendar_sync_claim_jobs(
          ${OWNER}::uuid, ${DESTINATION_KEY}, NULL, ${token}::uuid, 10,
          '2000-01-01'::timestamptz, 60
        ) WHERE task_id = ${newTask.id}::uuid`;
      assert(rows.length === 1, "database time must allow a due detached claim");
      return rows[0].id;
    };
    await enqueueGeneration(2, "generation-two", "upsert");
    const newJobId = await claimDetached(JOB_CLAIM);
    await sql`ALTER TABLE public.calendar_sync_jobs ADD CONSTRAINT proof_fail_settlement
      CHECK (calendar_event_id IS DISTINCT FROM 'generation-two' OR status <> 'succeeded') NOT VALID`;
    try {
      await completeJobQuery(sql, {
        jobId: newJobId, claimToken: JOB_CLAIM, outcome: "created",
        eventId: "generation-two", generation: 2, payloadHash: "accepted", nowIso: NOW,
      });
      assert(false, "settlement should have failed after Google accepted generation two");
    } catch (error) {
      assert(error.constraint_name === "proof_fail_settlement", "expected injected settlement failure");
    }
    await sql`ALTER TABLE public.calendar_sync_jobs DROP CONSTRAINT proof_fail_settlement`;
    await sql`UPDATE public.calendar_sync_jobs SET lease_expires_at = now() - interval '1 second'
      WHERE id = ${newJobId}::uuid`;
    assert(await claimDetached(JOB_CLAIM_RECOVER) === newJobId, "expired work must be reclaimed");
    await releaseJobsQuery(sql, [newJobId], JOB_CLAIM_RECOVER, NOW);
    await enqueueGeneration(1, "generation-one", "delete");
    const [coalesced] = await sql`
      SELECT job.generation, job.calendar_event_id, job.event_exists, job.operation,
        job.status, job.attempts, mapping.generation AS mapped_generation
      FROM public.calendar_sync_jobs AS job
      JOIN public.calendar_event_mappings AS mapping USING (owner_user_id, task_id, destination_key)
      WHERE job.id = ${newJobId}::uuid`;
    assert(coalesced?.generation === 2 && coalesced.calendar_event_id === "generation-two" &&
      !coalesced.event_exists && coalesced.operation === "delete" && coalesced.status === "pending" &&
      coalesced.attempts === 0 && coalesced.mapped_generation === 1,
    "a stale enqueue must preserve the unverified higher-generation target");
    log("AD-HOC-ENQUEUE", "recovered generation survives a conflicting lower-generation delete");

    await sql`
      INSERT INTO public.calendar_integration_settings (
        owner_user_id, provider, google_account_subject, calendar_id, access_token_encrypted,
        connected_at, updated_at
      ) VALUES
        (${OWNER}::uuid, 'google', 'proof-subject', 'primary', 'token',
          now() - interval '2 hours', now() - interval '1 hour'),
        (${OWNER_REMOVAL}::uuid, 'google', 'switched-subject', 'primary', 'token',
          now() - interval '2 hours', now() - interval '1 hour')`;
    await sql`
      INSERT INTO public.calendar_sync_jobs (
        owner_user_id, task_id, operation, status, queue_version, destination_key,
        google_account_subject, calendar_id, scheduled_at
      )
      SELECT ${OWNER_REMOVAL}::uuid, gen_random_uuid(), 'upsert', 'pending', 2,
        ${DESTINATION_REMOVAL}, 'proof-removal', 'primary', now() - interval '2 days'
      FROM generate_series(1, 120)`;
    const ready = (owner = null) => sql`
      SELECT * FROM public.calendar_sync_list_ready_destinations(${owner}::uuid, 1)`;
    const [healthyDestination] = await ready();
    assert(healthyDestination?.owner_user_id === OWNER && healthyDestination.destination_key === DESTINATION_KEY,
      "a switched owner's backlog must not hide a healthy destination at limit 1");
    assert((await ready(OWNER_REMOVAL)).length === 0, "the switched destination must be ineligible");
    await sql`UPDATE public.calendar_integration_settings
      SET google_account_subject = 'proof-removal', disconnected_at = now()
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid`;
    assert((await ready())[0]?.owner_user_id === OWNER, "a disconnected owner's backlog must not hide ready work");
    const [unavailable] = await sql`SELECT count(*)::int AS count FROM public.calendar_sync_jobs
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid AND run_id IS NULL AND status = 'pending'`;
    assert(unavailable.count === 120, "discovery must leave unavailable work untouched");

    // Two ready jobs for the same (owner, destination_key) with different stored
    // identity fields (subject NULL vs set) must occupy only one recovery slot.
    await sql`UPDATE public.calendar_integration_settings
      SET google_account_email = 'owner@example.com'
      WHERE owner_user_id = ${OWNER}::uuid`;
    await sql`UPDATE public.calendar_integration_settings
      SET google_account_subject = 'proof-removal', google_account_email = 'removal@example.com',
          disconnected_at = NULL
      WHERE owner_user_id = ${OWNER_REMOVAL}::uuid`;
    await sql`
      INSERT INTO public.calendar_sync_jobs (
        owner_user_id, task_id, operation, status, queue_version, destination_key,
        google_account_subject, google_account_email, calendar_id, scheduled_at
      ) VALUES
        (${OWNER}::uuid, gen_random_uuid(), 'upsert', 'pending', 2,
          ${DESTINATION_KEY}, NULL, 'owner@example.com', 'primary', now() - interval '3 days'),
        (${OWNER}::uuid, gen_random_uuid(), 'upsert', 'pending', 2,
          ${DESTINATION_KEY}, 'proof-subject', 'owner@example.com', 'primary', now() - interval '3 days')`;
    const dedupedTwo = await sql`
      SELECT * FROM public.calendar_sync_list_ready_destinations(NULL::uuid, 2)`;
    assert(
      dedupedTwo.length === 2 &&
        dedupedTwo.some((row) => row.owner_user_id === OWNER && row.destination_key === DESTINATION_KEY) &&
        dedupedTwo.some((row) => row.owner_user_id === OWNER_REMOVAL && row.destination_key === DESTINATION_REMOVAL),
      "identity variants for one destination must deduplicate to a single recovery slot",
    );
    await sql`UPDATE public.calendar_integration_settings
      SET google_account_email = NULL
      WHERE owner_user_id = ${OWNER}::uuid`;
    log("DESTINATIONS", "database filtering and per-destination deduplication verified");

    await sql`UPDATE public.projects SET status = 'archived', archived_at = now() WHERE id = ${PROJECT}::uuid`;
    await sql`
      INSERT INTO public.calendar_event_mappings (
        owner_user_id, task_id, destination_key, google_account_subject, google_account_email,
        calendar_id, event_id, generation, status, metadata_verified
      ) VALUES (${OWNER}::uuid, ${TASK_B}::uuid, ${DESTINATION_KEY}, 'proof-subject',
        NULL, 'primary', 'purged-event', 3, 'active', true)`;
    // Simulate a calendar switch followed by editing TASK_A (advancing tasks.updated_at)
    // and leaving TASK_C older than settings: neither unmapped legacy task may be bound
    // to whichever calendar happens to be connected now.
    await sql`UPDATE public.tasks
      SET calendar_event_id = 'legacy-' || id::text,
        updated_at = CASE WHEN id = ${TASK_C}::uuid THEN now() - interval '3 hours' ELSE now() END
      WHERE id IN (${TASK_A}::uuid, ${TASK_B}::uuid, ${TASK_C}::uuid)`;
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${OWNER}, true)`;
      const purgeProject = () => tx`
        SELECT public.purge_archived_project(${PROJECT}::uuid, 'Calendar commit proof', 3, 0) AS result`;
      const [purge] = await purgeProject();
      assert(purge.result.status === "purged" && purge.result.calendar_delete_jobs_enqueued === 3,
        "purge must queue one mapped delete and two unbound legacy deletes");
      const [repeat] = await purgeProject();
      assert(repeat.result.status === "not_found", "repeated purge must not enqueue again");
    });
    const [purgeJob] = await sql`
      SELECT id, run_id, queue_version, operation, destination_key, calendar_event_id, generation, event_exists
      FROM public.calendar_sync_jobs WHERE task_id = ${TASK_B}::uuid`;
    assert(purgeJob?.queue_version === 2 && purgeJob.run_id === null && purgeJob.operation === "delete" &&
      purgeJob.destination_key === DESTINATION_KEY && purgeJob.calendar_event_id === "purged-event" &&
      purgeJob.generation === 3 && purgeJob.event_exists, "purge must retain the verified event identity");
    const legacyPurgeJobs = await sql`
      SELECT task_id, destination_key, google_account_subject, google_account_email, calendar_id, event_exists
      FROM public.calendar_sync_jobs
      WHERE queue_version = 1 AND operation = 'delete'
        AND task_id IN (${TASK_A}::uuid, ${TASK_B}::uuid, ${TASK_C}::uuid)`;
    const editedAfterSwitch = legacyPurgeJobs.find((job) => job.task_id === TASK_A);
    const olderLegacy = legacyPurgeJobs.find((job) => job.task_id === TASK_C);
    assert(
      legacyPurgeJobs.length === 2 &&
        editedAfterSwitch?.destination_key === "" &&
        editedAfterSwitch.google_account_subject === null &&
        editedAfterSwitch.google_account_email === null &&
        editedAfterSwitch.calendar_id === null &&
        editedAfterSwitch.event_exists === false,
      "legacy task edited after a calendar switch must remain unbound instead of targeting the new calendar",
    );
    assert(
      olderLegacy?.destination_key === "" &&
        olderLegacy.google_account_subject === null &&
        olderLegacy.calendar_id === null &&
        olderLegacy.event_exists === false,
      "unmapped legacy cleanup must remain unbound",
    );
    await sql`
      UPDATE public.calendar_sync_jobs
      SET status = 'processing', attempts = 8, claim_token = ${ORPHAN_JOB_CLAIM}::uuid,
          lease_expires_at = now() - interval '1 second'
      WHERE id = ${purgeJob.id}::uuid`;
    const [reclaimedPurge] = await sql`
      SELECT id, attempts FROM public.calendar_sync_claim_jobs(
        ${OWNER}::uuid, ${DESTINATION_KEY}, NULL, ${JOB_CLAIM_RECOVER}::uuid, 5, now(), 60
      ) WHERE id = ${purgeJob.id}::uuid`;
    assert(reclaimedPurge?.attempts === 8, "a final-attempt runless lease must be recoverable");
    log("PURGE", "mapped and legacy cleanup, repeated purge, and expired runless recovery verified");

    console.log("CALENDAR-SYNC-COMMIT-SCAN-PAGE-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
