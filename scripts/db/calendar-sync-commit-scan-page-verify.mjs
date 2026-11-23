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
const CURSOR_CREATED_AT = "2026-11-23T10:00:00+00:00";
const TASK_UPDATED_AT = "2026-11-23T09:59:00+00:00";
const NOW = "2026-11-23T10:01:00+00:00";
const NOW_REPLAY = "2026-11-23T10:02:00+00:00";
const NOW_REPLAN = "2026-11-23T10:03:00+00:00";
const JOB_CLAIM_AT = "2026-11-23T10:04:00+00:00";
const LEASE_UNTIL = "2026-11-23T10:06:00+00:00";
const NOW_EDIT = "2026-11-23T10:05:00+00:00";
const NOW_RECOVER = "2026-11-23T10:10:00+00:00";
const NOW_EDIT_RELEASE = "2026-11-23T10:11:00+00:00";
const NOW_RELEASE = "2026-11-23T10:12:00+00:00";
const RETRY_AT = "2026-11-23T10:13:00+00:00";

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

function claimScanQuery(sql, claimToken, nowIso) {
  return sql`SELECT public.calendar_sync_claim_run_scan(
    ${RUN}::uuid,
    ${claimToken}::uuid,
    ${nowIso}::timestamptz,
    ${300}::integer
  ) AS claimed`;
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

function editDrafts(input) {
  return normalizeCommit({
    runId: RUN,
    claimToken: input.claimToken,
    nextCursor: { createdAt: CURSOR_CREATED_AT, taskId: TASK_C },
    scanComplete: true,
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
               'active', $4, $5::timestamptz)`,
      [RUN, OWNER, DESTINATION_KEY, CLAIM, LEASE_UNTIL],
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
              destination_key
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
    assert(replayClaim.claimed === true, "a replayed scan page must be claimable");
    const replayCommit = normalizeCommit(
      commitDrafts({ claimToken: CLAIM_REPLAY, nowIso: NOW_REPLAY }),
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
    assert(replanClaim.claimed === true, "the scan must be claimable after a replay");
    const replanCommit = normalizeCommit(
      commitDrafts({
        claimToken: CLAIM_REPLAN,
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
    const [replanned] = await commitQuery(sql, replanCommit);
    assert(replanned.committed === true, "a re-planned page must commit");

    const plannedJobs = await sql.unsafe(
      `SELECT id, task_id, calendar_event_id, operation, generation, event_exists,
              payload_hash
       FROM public.calendar_sync_jobs
       WHERE run_id = $1
       ORDER BY task_id`,
      [RUN],
    );
    assert(plannedJobs.length === 2, "re-planning must coalesce, not duplicate");
    const plannedA = plannedJobs.find((row) => row.task_id === TASK_A);
    const plannedC = plannedJobs.find((row) => row.task_id === TASK_C);
    assert(plannedA?.id === jobA.id, "task A re-plan must keep the pending job id");
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
    const [editClaim] = await claimScanQuery(sql, CLAIM_EDIT, NOW_EDIT);
    assert(editClaim.claimed === true, "the run must be scannable while a job is processing");
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

    // Same-generation event identity: a pending row without a planned target
    // must inherit the expired claim's target so an ambiguous write retries the
    // same Google event instead of creating another one.
    await sql`
      UPDATE public.calendar_sync_jobs
      SET calendar_event_id = NULL
      WHERE id = ${pendingA.id}::uuid
    `;

    // The earlier claim lease (10:09) is expired at 10:10. The claim must fold the
    // expired processing row into the newer pending row atomically.
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
    assert(recoveredA.generation === 3, "the recovered claim must keep the latest generation");
    assert(recoveredA.operation === "upsert", "the recovered claim must keep the latest operation");
    assert(
      recoveredA.payload_hash === "hash-a3",
      "the recovered claim must keep the latest payload hash",
    );
    assert(
      recoveredA.calendar_event_id === "event-a2",
      "a same-generation pending edit must inherit the ambiguous-write target",
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
    assert(releaseEditClaim.claimed === true, "the run must be scannable during the release scenario");
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
      NOW_RELEASE,
    );
    assert(tooEarlyJobs.length === 0, "a retry backoff must not be claimable early");
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

    console.log("CALENDAR-SYNC-COMMIT-SCAN-PAGE-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
