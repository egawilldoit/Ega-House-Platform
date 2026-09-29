#!/usr/bin/env node
/**
 * Ephemeral-database proof for the task_status_events ledger and the
 * canonical completed_at invariant (EGA-662).
 *
 * Applies the full drizzle migration journal (plus the standard Supabase
 * shim) to a disposable Postgres, then proves:
 *
 *   BACKFILL   - pre-existing Tasks with a trustworthy completed_at get exactly
 *                one 'done' backfill event; Tasks without one get none; no
 *                timestamp is invented from updated_at.
 *   INSERT     - inserting a Task whose status is already done succeeds (the
 *                ledger is written after the row exists) and records exactly
 *                one event; non-done statuses never carry completed_at; a
 *                done-spelling rename is not a new completion.
 *   TRANSITION - todo -> done stamps completed_at and records one event.
 *   REPEAT     - writing done again creates no event and does not move
 *                completed_at.
 *   REOPEN     - done -> todo clears completed_at and records the event.
 *   RE-COMPLETE- a second completion after reopen records a second event at
 *                the new instant (historical day keeps its evidence).
 *   UNRELATED  - editing a done Task preserves completed_at, records no event.
 *   APPEND-ONLY- client roles cannot INSERT/UPDATE/DELETE events (RLS).
 *   RLS        - owners can read only their own events.
 *   HARD-DELETE- deleting a Task preserves its events with task_id NULL.
 *   IDEMPOTENCE- re-applying the migration succeeds (up-only).
 *
 * Usage:
 *   node scripts/db/task-status-events-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const SKIP_MIGRATION = "0063_task_status_events";

function parseArgs() {
  const args = { skipMigration: SKIP_MIGRATION };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--url") args.url = rest[++i];
    if (rest[i] === "--skip-migration") args.skipMigration = rest[++i];
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

function fail(section, message) {
  console.error(`[${section}] FAILED: ${message}`);
  exit(1);
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
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL
    );
  `);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  // GUC-backed identity so the proof can simulate distinct authenticated
  // users under RLS (SET app.current_user = '<uuid>').
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('app.current_user', true), '')::uuid $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$ SELECT '{}'::jsonb $fn$;
  `);
  await sql.unsafe(`GRANT USAGE ON SCHEMA auth TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION auth.jwt() TO authenticated;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;`);
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

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444441";
const TASK_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TASK_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TASK_C = "cccccccc-0000-4000-8000-00000000000c";
const TASK_D = "dddddddd-0000-4000-8000-00000000000d";
const TASK_E = "eeeeeeee-0000-4000-8000-00000000000e";
const TASK_F = "ffffffff-0000-4000-8000-00000000000f";
const TASK_G = "99999999-0000-4000-8000-000000000009";

async function seedProject(sql) {
  await sql`
    INSERT INTO projects (id, name, slug, created_at, updated_at)
    VALUES (${PROJECT_ID}::uuid, 'Proof project', 'proof-project', now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
}

// Pre-migration state: Task A completed in the past but currently reopened
// (completed_at survives from the legacy path), Task B done with a timestamp,
// Task C done without any timestamp (untrustworthy).
async function seedPreMigrationTasks(sql) {
  await seedProject(sql);
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, completed_at, created_at, updated_at)
    VALUES
      (${TASK_A}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Reopened with surviving completed_at', 'todo', '2026-01-15T10:00:00Z', now(), now()),
      (${TASK_B}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Done with timestamp', 'done', '2026-02-20T10:00:00Z', now(), now()),
      (${TASK_C}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Done without timestamp', 'done', NULL, now(), now())
    ON CONFLICT (id) DO NOTHING
  `;
  log("RED", "Pre-migration tasks seeded (A: reopened+completed_at, B: done+completed_at, C: done without completed_at)");
}

async function expect(condition, section, message) {
  if (!condition) fail(section, message);
}

async function runBackfillProof(sql) {
  const eventsA = await sql`
    SELECT to_status, occurred_at FROM task_status_events
    WHERE task_id = ${TASK_A}::uuid ORDER BY occurred_at
  `;
  await expect(eventsA.length === 1, "BACKFILL", `Task A should have exactly one backfill event, got ${eventsA.length}`);
  const occurredIso = new Date(eventsA[0]?.occurred_at).toISOString();
  await expect(
    occurredIso === "2026-01-15T10:00:00.000Z",
    "BACKFILL",
    `Task A event should reuse the trustworthy completed_at, got ${occurredIso}`,
  );
  const taskA = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_A}::uuid`;
  await expect(taskA[0]?.completed_at === null, "BACKFILL", "Task A current-state completed_at should be normalized to NULL (not done)");

  const eventsB = await sql`
    SELECT to_status, occurred_at FROM task_status_events
    WHERE task_id = ${TASK_B}::uuid ORDER BY occurred_at
  `;
  await expect(eventsB.length === 1, "BACKFILL", `Task B should have exactly one backfill event, got ${eventsB.length}`);
  const taskB = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_B}::uuid`;
  const taskBIso = new Date(taskB[0]?.completed_at).toISOString();
  await expect(
    taskBIso === "2026-02-20T10:00:00.000Z",
    "BACKFILL",
    `Task B completed_at should be preserved, got ${taskBIso}`,
  );

  const eventsC = await sql`SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_C}::uuid`;
  await expect(eventsC[0]?.count === 0, "BACKFILL", `Task C (done without completed_at) must get no event, got ${eventsC[0]?.count}`);

  // An unrelated edit of a done Task whose completion evidence was already
  // lost must not fabricate completed_at (and must record no event). This is
  // the pre-migration MCP/mobile state: status=done, completed_at NULL. The
  // edit even supplies a completed_at, which the trigger must ignore while the
  // status is unchanged.
  await sql`UPDATE tasks SET title = 'Renamed without timestamp', completed_at = now(), updated_at = now() WHERE id = ${TASK_C}::uuid`;
  const taskCAfterEdit = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_C}::uuid`;
  await expect(
    taskCAfterEdit[0]?.completed_at === null,
    "BACKFILL",
    "unrelated edit must not invent completed_at for a done Task with no trustworthy timestamp",
  );
  const eventsCAfterEdit = await sql`SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_C}::uuid`;
  await expect(eventsCAfterEdit[0]?.count === 0, "BACKFILL", `unrelated edit must not create an event for Task C, got ${eventsCAfterEdit[0]?.count}`);
  log("BACKFILL", "Trustworthy completed_at reused; untrustworthy rows get no event; current state normalized; unrelated edits never fabricate completion evidence.");
}

async function runTransitionProof(sql) {
  await seedProject(sql);
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_D}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Transition proof', 'todo', now(), now())
  `;

  // todo -> done: completed_at stamped, exactly one done event.
  await sql`UPDATE tasks SET status = 'done', updated_at = now() WHERE id = ${TASK_D}::uuid`;
  const afterDone = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_D}::uuid`;
  await expect(afterDone[0]?.completed_at !== null, "TRANSITION", "todo -> done must stamp completed_at");
  const doneAt = new Date(afterDone[0]?.completed_at).toISOString();
  let events = await sql`
    SELECT to_status, occurred_at FROM task_status_events WHERE task_id = ${TASK_D}::uuid ORDER BY occurred_at
  `;
  await expect(events.length === 1 && events[0]?.to_status === "done", "TRANSITION", `todo -> done must record one done event, got ${JSON.stringify(events)}`);
  const eventIso = new Date(events[0]?.occurred_at).toISOString();
  await expect(
    eventIso === doneAt,
    "TRANSITION",
    `event occurred_at (${eventIso}) must equal the stamped completed_at (${doneAt})`,
  );
  log("TRANSITION", `todo -> done stamped completed_at=${doneAt} and recorded one event.`);

  // Repeated write of done: no new event, completed_at unmoved.
  await sql`UPDATE tasks SET status = 'done', updated_at = now() WHERE id = ${TASK_D}::uuid`;
  const afterRepeat = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_D}::uuid`;
  const repeatIso = new Date(afterRepeat[0]?.completed_at).toISOString();
  await expect(repeatIso === doneAt, "REPEAT", `repeated done must not move completed_at, got ${repeatIso}`);
  events = await sql`SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_D}::uuid`;
  await expect(events[0]?.count === 1, "REPEAT", `repeated done must not create a duplicate event, got ${events[0]?.count}`);
  log("REPEAT", "Repeated done write: no duplicate event, completed_at unmoved.");

  // Unrelated edit while done: completed_at preserved, no event.
  await sql`UPDATE tasks SET title = 'Renamed while done', updated_at = now() WHERE id = ${TASK_D}::uuid`;
  const afterEdit = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_D}::uuid`;
  const editIso = new Date(afterEdit[0]?.completed_at).toISOString();
  await expect(editIso === doneAt, "UNRELATED", `unrelated edit must not move completed_at, got ${editIso}`);
  events = await sql`SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_D}::uuid`;
  await expect(events[0]?.count === 1, "UNRELATED", `unrelated edit must not create an event, got ${events[0]?.count}`);
  log("UNRELATED", "Unrelated edit while done: completed_at preserved, no event.");

  // Reopen: completed_at cleared, event recorded at the mutation instant (not
  // the old completion instant that a status-only UPDATE would carry over).
  await sql`SELECT pg_sleep(0.05)`;
  await sql`UPDATE tasks SET status = 'todo', updated_at = now() WHERE id = ${TASK_D}::uuid`;
  const afterReopen = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_D}::uuid`;
  await expect(afterReopen[0]?.completed_at === null, "REOPEN", "done -> todo must clear completed_at");
  events = await sql`SELECT to_status, occurred_at FROM task_status_events WHERE task_id = ${TASK_D}::uuid ORDER BY occurred_at`;
  await expect(events.length === 2 && events[1]?.to_status === "todo", "REOPEN", `reopen must record a todo event, got ${JSON.stringify(events)}`);
  const reopenIso = new Date(events[1]?.occurred_at).toISOString();
  await expect(reopenIso !== doneAt, "REOPEN", `reopen event must be stamped at the mutation instant, not the completion instant (${reopenIso} vs ${doneAt})`);
  log("REOPEN", "done -> todo cleared completed_at and recorded the transition at the mutation instant.");

  // Re-complete: second done event at the new instant; first day keeps evidence.
  await sql`UPDATE tasks SET status = 'done', updated_at = now() WHERE id = ${TASK_D}::uuid`;
  events = await sql`SELECT to_status, occurred_at FROM task_status_events WHERE task_id = ${TASK_D}::uuid AND to_status = 'done' ORDER BY occurred_at`;
  await expect(events.length === 2, "RE-COMPLETE", `re-completion must record a second done event, got ${events.length}`);
  const firstIso = new Date(events[0]?.occurred_at).toISOString();
  await expect(
    firstIso === doneAt,
    "RE-COMPLETE",
    `the original completion event must remain at its original instant (${firstIso} vs ${doneAt})`,
  );
  log("RE-COMPLETE", "Re-completion after reopen records a second event; historical day keeps its evidence.");
}

async function runInsertProof(sql) {
  // INSERT directly into a done status must succeed. A BEFORE trigger cannot
  // reference the not-yet-inserted tasks row (the ledger's FK parent), so the
  // event is written after the row exists.
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_E}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Inserted done', 'done', now(), now())
  `;
  const inserted = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_E}::uuid`;
  await expect(inserted[0]?.completed_at !== null, "INSERT", "inserting a done Task must stamp completed_at");
  const insertedAt = new Date(inserted[0]?.completed_at).toISOString();
  const insertEvents = await sql`SELECT to_status, occurred_at FROM task_status_events WHERE task_id = ${TASK_E}::uuid`;
  await expect(
    insertEvents.length === 1 && insertEvents[0]?.to_status === "done",
    "INSERT",
    `inserted done Task must record exactly one done event, got ${JSON.stringify(insertEvents)}`,
  );
  await expect(
    new Date(insertEvents[0]?.occurred_at).toISOString() === insertedAt,
    "INSERT",
    "insert event must be stamped at the completion instant",
  );

  // Any non-done status owns no completion time, even if the writer supplies one.
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_F}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Inserted todo', 'todo', now(), now())
  `;
  await sql`UPDATE tasks SET status = 'in_progress', completed_at = now(), updated_at = now() WHERE id = ${TASK_F}::uuid`;
  const inProgress = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_F}::uuid`;
  await expect(inProgress[0]?.completed_at === null, "INSERT", "a non-done status must never carry completed_at");

  // A done-spelling rename is not a new completion.
  await sql`
    INSERT INTO tasks (id, project_id, owner_user_id, title, status, created_at, updated_at)
    VALUES (${TASK_G}::uuid, ${PROJECT_ID}::uuid, ${OWNER_A}::uuid, 'Spelling rename', 'todo', now(), now())
  `;
  await sql`UPDATE tasks SET status = 'done', updated_at = now() WHERE id = ${TASK_G}::uuid`;
  const doneOnce = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_G}::uuid`;
  const doneInstant = new Date(doneOnce[0]?.completed_at).toISOString();
  await sql`UPDATE tasks SET status = 'completed', updated_at = now() WHERE id = ${TASK_G}::uuid`;
  const renameEvents = await sql`
    SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_G}::uuid AND to_status = 'done'
  `;
  await expect(renameEvents[0]?.count === 1, "INSERT", `a done-spelling rename must not create a second completion event, got ${renameEvents[0]?.count}`);
  const afterRename = await sql`SELECT completed_at FROM tasks WHERE id = ${TASK_G}::uuid`;
  await expect(
    new Date(afterRename[0]?.completed_at).toISOString() === doneInstant,
    "INSERT",
    "a done-spelling rename must preserve completed_at",
  );
  log("INSERT", "INSERT done records one event; non-done carries no completed_at; done-spelling rename is not a new completion.");
}

async function runRlsProof(sql) {
  const flags = await sql`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE oid = 'public.task_status_events'::regclass
  `;
  await expect(flags[0]?.relrowsecurity === true, "RLS", "task_status_events must have RLS enabled");
  const policies = await sql`
    SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'task_status_events'
    ORDER BY policyname
  `;
  const selectPolicies = policies.filter((p) => p.cmd === "SELECT");
  const writePolicies = policies.filter((p) => p.cmd !== "SELECT");
  await expect(selectPolicies.length === 1, "RLS", `expected exactly one SELECT policy, got ${JSON.stringify(policies)}`);
  await expect(writePolicies.length === 0, "RLS", `expected no INSERT/UPDATE/DELETE policies (append-only), got ${JSON.stringify(writePolicies)}`);
  log("RLS", `RLS enabled; ${selectPolicies.length} SELECT policy, 0 write policies (append-only).`);

  // Owner A can read own events; owner B cannot. Each attempt runs in its
  // own transaction so the transaction-local identity (set_config + SET LOCAL
  // ROLE) is scoped exactly to that attempt.
  const asAuthenticated = async (statement) => {
    const tx = sql.begin(async (tx) => {
      await tx.unsafe(`SELECT set_config('app.current_user', '${OWNER_A}', true)`);
      await tx.unsafe(`SET LOCAL ROLE authenticated`);
      return tx.unsafe(statement);
    });
    return tx;
  };

  const ownEvents = await asAuthenticated(
    `SELECT count(*)::int AS count FROM task_status_events WHERE owner_user_id = '${OWNER_A}'::uuid`,
  );
  await expect(ownEvents[0]?.count > 0, "RLS", "owner A must be able to read own events");
  const foreignEvents = await asAuthenticated(
    `SELECT count(*)::int AS count FROM task_status_events WHERE owner_user_id = '${OWNER_B}'::uuid`,
  );
  await expect(foreignEvents[0]?.count === 0, "RLS", `owner B must not read owner A events, got ${foreignEvents[0]?.count}`);

  // Append-only: client writes are denied.
  const denied = async (statement) => {
    try {
      await asAuthenticated(statement);
      return false;
    } catch {
      return true;
    }
  };
  await expect(
    await denied(`INSERT INTO task_status_events (owner_user_id, task_id, to_status, occurred_at) VALUES ('${OWNER_A}'::uuid, ${TASK_D}::uuid, 'done', now())`),
    "APPEND-ONLY",
    "client INSERT on task_status_events must be denied",
  );
  await expect(
    await denied(`UPDATE task_status_events SET to_status = 'todo' WHERE owner_user_id = '${OWNER_A}'::uuid`),
    "APPEND-ONLY",
    "client UPDATE on task_status_events must be denied",
  );
  await expect(
    await denied(`DELETE FROM task_status_events WHERE owner_user_id = '${OWNER_A}'::uuid`),
    "APPEND-ONLY",
    "client DELETE on task_status_events must be denied",
  );
  log("APPEND-ONLY", "Client INSERT/UPDATE/DELETE on events all denied under RLS.");
}

async function runHardDeleteProof(sql) {
  const before = await sql`SELECT count(*)::int AS count FROM task_status_events WHERE task_id = ${TASK_D}::uuid`;
  await expect(before[0]?.count === 3, "HARD-DELETE", `expected 3 events for Task D before delete, got ${before[0]?.count}`);
  await sql`DELETE FROM tasks WHERE id = ${TASK_D}::uuid`;
  const after = await sql`
    SELECT count(*)::int AS count, count(task_id)::int AS with_task_id
    FROM task_status_events WHERE owner_user_id = ${OWNER_A}::uuid AND to_status = 'done' AND task_id IS NULL
  `;
  await expect(after[0]?.count === 2, "HARD-DELETE", `events must survive hard delete with task_id NULL, got ${JSON.stringify(after)}`);
  log("HARD-DELETE", "Task delete preserves events with task_id set to NULL.");
}

async function main() {
  const { url, skipMigration } = parseArgs();
  const tags = await readJournal();
  if (!tags.includes(skipMigration)) {
    console.error(`Unknown --skip-migration tag '${skipMigration}'. Known tags: ${tags.join(", ")}`);
    exit(2);
  }

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    let applied = 0;
    for (const tag of tags) {
      if (tag === skipMigration) continue;
      const statements = await applyFile(sql, tag);
      applied += 1;
      log("MIGRATE", `${tag}: ${statements} statement(s) applied`);
    }
    log("MIGRATE", `${applied} baseline migrations applied (excluding ${skipMigration})`);

    await seedPreMigrationTasks(sql);

    const statements = await applyFile(sql, skipMigration);
    log("MIGRATE", `${skipMigration}: ${statements} statement(s) applied`);

    // Table-level read grant for the RLS proof (row filtering still comes from
    // the policies; real Supabase grants this via default privileges).
    await sql.unsafe(`GRANT SELECT ON public.task_status_events TO authenticated;`);

    await runBackfillProof(sql);
    await runTransitionProof(sql);
    await runInsertProof(sql);
    await runRlsProof(sql);
    await runHardDeleteProof(sql);

    const reapplied = await applyFile(sql, skipMigration);
    log("IDEMPOTENCE", `Re-applied ${skipMigration} (${reapplied} statement(s)); up-only convention holds.`);

    console.log("TASK-STATUS-EVENTS-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
