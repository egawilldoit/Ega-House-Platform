#!/usr/bin/env node
/**
 * Ephemeral-database proof for the project-template RPC
 * (drizzle/0068_project_templates.sql).
 *
 * Applies the full drizzle migration journal (plus the minimal Supabase shim
 * used by the other db proofs) to a disposable Postgres, then exercises
 * public.create_project_from_template(...) as a direct authenticated user:
 *
 *   CREATE   - 2 goals + 4 tasks are created in one call with owner, parent
 *              project and goal links, owner-local due dates, priorities,
 *              estimates and the canonical todo status.
 *   REPLAY   - the same operation id returns the same project and creates no
 *              duplicate goals/tasks (double submit / crashed retry).
 *   OWNER    - another owner using the same operation id gets a new project:
 *              the receipt is owner-scoped.
 *   SLUG     - a different operation reusing a slug is a typed slug_conflict
 *              and leaves no rows behind.
 *   ROLLBACK - a trigger-induced failure midway through the task insert aborts
 *              the whole function: no project, goal or task row survives, and
 *              the same call succeeds once the blocker is removed.
 *   INVALID  - bad priority, out-of-range goal index and oversized payloads
 *              raise 22023 with no rows.
 *   OAUTH    - an OAuth client_id token is refused (42501).
 *   RLS      - a foreign owner cannot read the created project/goals/tasks.
 *
 * Usage:
 *   node scripts/db/project-template-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const MIGRATION_TAG = "0068_project_templates";

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
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END
    $shim$;
  `);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);`);
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
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

async function applySupabaseGrants(sql) {
  // Supabase grants table privileges to the API roles through default
  // privileges; local proof clusters must reproduce that so the RLS policies
  // (not a missing GRANT) decide what one owner can see.
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`);
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;`);
}

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA public;`);
  log("RESET", "Database schemas dropped and recreated");
}

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const OPERATION_MAIN = "0f000000-0000-4000-8000-000000000001";
const OPERATION_OTHER_OWNER = "0f000000-0000-4000-8000-000000000002";
const OPERATION_SLUG = "0f000000-0000-4000-8000-000000000003";
const OPERATION_ROLLBACK = "0f000000-0000-4000-8000-000000000004";
const OPERATION_INVALID = "0f000000-0000-4000-8000-000000000005";

const GOALS = [
  { title: "Pipeline", description: "Get applications out.", status: "active" },
  { title: "Interview", description: null, status: "active" },
];

const TASKS = [
  {
    goal_index: 0,
    title: "List target roles",
    description: "Pick ten.",
    priority: "high",
    estimate_minutes: 45,
    due_date: "2027-03-14",
  },
  {
    goal_index: 0,
    title: "Send applications",
    description: null,
    priority: "urgent",
    estimate_minutes: 180,
    due_date: "2027-03-18",
  },
  {
    goal_index: 1,
    title: "Write stories",
    description: null,
    priority: "medium",
    estimate_minutes: null,
    due_date: "2027-03-22",
  },
  {
    goal_index: null,
    title: "Send follow-ups",
    description: null,
    priority: "low",
    estimate_minutes: 30,
    due_date: "2027-03-25",
  },
];

function directSession(sql, { userId = OWNER_A } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, ["{}"]);
        return fn(tx);
      });
    },
  };
}

function oauthSession(sql, { userId = OWNER_A, clientId = "template-proof-client" } = {}) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE authenticated`);
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ client_id: clientId }),
        ]);
        return fn(tx);
      });
    },
  };
}

function callCreate(tx, overrides = {}) {
  const input = {
    operationId: OPERATION_MAIN,
    templateId: "job-application-sprint",
    name: "Job sprint",
    slug: "job-sprint",
    description: "Two weeks of applications",
    goals: GOALS,
    tasks: TASKS,
    ...overrides,
  };
  return tx
    .unsafe(
      `SELECT public.create_project_from_template($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) AS result`,
      [
        input.operationId,
        input.templateId,
        input.name,
        input.slug,
        input.description,
        input.goals,
        input.tasks,
      ],
    )
    .then((rows) => rows[0]?.result);
}

async function capturePostgresCode(fn) {
  try {
    await fn();
  } catch (error) {
    return error?.code ?? "unknown";
  }
  return null;
}

async function countWhere(sql, table, column, value) {
  const rows = await sql.unsafe(
    `SELECT count(*)::int AS n FROM public.${table} WHERE ${column} = $1`,
    [value],
  );
  return rows[0]?.n ?? 0;
}

async function assertCreate(sql) {
  const result = await directSession(sql).run((tx) => callCreate(tx));
  assert(result?.status === "created", `expected created, got ${JSON.stringify(result)}`);
  assert(result.goal_count === 2, `goal_count must be 2, got ${JSON.stringify(result)}`);
  assert(result.task_count === 4, `task_count must be 4, got ${JSON.stringify(result)}`);
  assert(typeof result.project_id === "string" && result.slug === "job-sprint");

  const [project] = await sql.unsafe(
    `SELECT owner_user_id, name, slug, description, status, template_operation_id
     FROM public.projects WHERE id = $1`,
    [result.project_id],
  );
  assert(project?.owner_user_id === OWNER_A, "project owner must be the authenticated actor");
  assert(project?.template_operation_id === OPERATION_MAIN, "operation receipt must be stored");
  assert(project?.description === "Two weeks of applications", "description must be persisted");

  const goals = await sql.unsafe(
    `SELECT id, owner_user_id, project_id, title, status FROM public.goals
     WHERE project_id = $1 ORDER BY created_at`,
    [result.project_id],
  );
  assert(goals.length === 2, `expected 2 goals, got ${goals.length}`);
  assert(goals.every((goal) => goal.owner_user_id === OWNER_A), "goals must be owner-scoped");
  assert(goals.every((goal) => goal.project_id === result.project_id), "goals must be project-scoped");
  assert(goals.every((goal) => goal.status === "active"), "goals must carry the template status");

  const tasks = await sql.unsafe(
    `SELECT owner_user_id, project_id, goal_id, title, status, priority, estimate_minutes, due_date::text
     FROM public.tasks WHERE project_id = $1 ORDER BY created_at`,
    [result.project_id],
  );
  assert(tasks.length === 4, `expected 4 tasks, got ${tasks.length}`);
  assert(tasks.every((task) => task.owner_user_id === OWNER_A), "tasks must be owner-scoped");
  assert(tasks.every((task) => task.project_id === result.project_id), "tasks must be project-scoped");
  assert(tasks.every((task) => task.status === "todo"), "tasks must use the canonical todo status");

  const linked = tasks.filter((task) => task.goal_id !== null);
  const unlinked = tasks.filter((task) => task.goal_id === null);
  assert(linked.length === 3 && unlinked.length === 1, "goal indexes must map to inserted goals");
  assert(
    tasks.some((task) => task.title === "List target roles" && task.due_date === "2027-03-14" && task.priority === "high"),
    "due date, priority and estimate must round-trip",
  );
  assert(
    tasks.some((task) => task.title === "Send applications" && task.estimate_minutes === 180),
    "estimate must round-trip",
  );
  log("CREATE", "project + 2 goals + 4 tasks created atomically with parent ownership");
  return result;
}

async function assertReplay(sql, projectId) {
  const replay = await directSession(sql).run((tx) => callCreate(tx));
  assert(replay?.status === "replayed", `expected replayed, got ${JSON.stringify(replay)}`);
  assert(replay.project_id === projectId, "replay must return the first project id");
  assert(replay.goal_count === 2 && replay.task_count === 4, "replay counts must describe the existing project");
  assert((await countWhere(sql, "projects", "template_operation_id", OPERATION_MAIN)) === 1, "one project per operation");
  assert((await countWhere(sql, "goals", "project_id", projectId)) === 2, "replay must not add goals");
  assert((await countWhere(sql, "tasks", "project_id", projectId)) === 4, "replay must not add tasks");
  log("REPLAY", "same operation id returns one project and no duplicates");
}

async function assertOwnerScopedReceipt(sql) {
  const foreign = await directSession(sql, { userId: OWNER_B }).run((tx) =>
    callCreate(tx, {
      operationId: OPERATION_OTHER_OWNER,
      slug: "job-sprint",
      name: "Job sprint (B)",
    }),
  );
  assert(foreign?.status === "created", `expected created for owner B, got ${JSON.stringify(foreign)}`);
  const owners = await sql.unsafe(
    `SELECT owner_user_id FROM public.projects WHERE template_operation_id = $1`,
    [OPERATION_OTHER_OWNER],
  );
  assert(owners.length === 1 && owners[0].owner_user_id === OWNER_B, "receipt must be owner-scoped");
  log("OWNER", "the same operation id is a new project for a different owner");
}

async function assertSlugConflict(sql) {
  const conflict = await directSession(sql).run((tx) =>
    callCreate(tx, { operationId: OPERATION_SLUG, name: "Duplicate slug" }),
  );
  assert(conflict?.status === "slug_conflict", `expected slug_conflict, got ${JSON.stringify(conflict)}`);
  assert(
    (await countWhere(sql, "projects", "template_operation_id", OPERATION_SLUG)) === 0,
    "slug conflict must leave no project row",
  );
  log("SLUG", "slug collisions are typed outcomes and leave nothing behind");
}

async function assertInvalidPayloads(sql) {
  const cases = [
    { name: "bad priority", tasks: [{ ...TASKS[0], priority: "whenever" }] },
    { name: "goal index out of range", tasks: [{ ...TASKS[0], goal_index: 2 }] },
    { name: "blank title", tasks: [{ ...TASKS[0], title: "  " }] },
    {
      name: "oversized payload",
      tasks: Array.from({ length: 201 }, (_, index) => ({ ...TASKS[0], title: `Task ${index}` })),
    },
    { name: "goal count mismatch", goals: [{ title: "Only", status: "active" }], tasks: [{ ...TASKS[0], goal_index: 1 }] },
  ];

  for (const testCase of cases) {
    const code = await capturePostgresCode(() =>
      directSession(sql).run((tx) =>
        callCreate(tx, {
          operationId: OPERATION_INVALID,
          slug: `invalid-${cases.indexOf(testCase)}`,
          ...testCase,
        }),
      ),
    );
    assert(code === "22023", `${testCase.name} must raise 22023, got ${code}`);
    assert(
      (await countWhere(sql, "projects", "template_operation_id", OPERATION_INVALID)) === 0,
      `${testCase.name} must not create a project`,
    );
  }
  log("INVALID", "bad priorities, indexes, titles and sizes fail closed with no rows");
}

async function assertRollback(sql) {
  const blocker = `template_proof_blocker`;
  const [before] = await sql.unsafe(
    `SELECT
       (SELECT count(*)::int FROM public.projects) AS projects,
       (SELECT count(*)::int FROM public.goals) AS goals,
       (SELECT count(*)::int FROM public.tasks) AS tasks`,
  );
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.${blocker}() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.title = 'Send follow-ups' THEN
        RAISE EXCEPTION 'injected template failure' USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END;
    $fn$;
  `);
  await sql.unsafe(`
    CREATE TRIGGER ${blocker}_trigger BEFORE INSERT ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.${blocker}();
  `);

  const code = await capturePostgresCode(() =>
    directSession(sql).run((tx) =>
      callCreate(tx, { operationId: OPERATION_ROLLBACK, slug: "rollback-project" }),
    ),
  );
  assert(code === "23503", `induced failure must raise 23503, got ${code}`);
  assert(
    (await countWhere(sql, "projects", "template_operation_id", OPERATION_ROLLBACK)) === 0,
    "project must not survive the failed transaction",
  );
  assert((await countWhere(sql, "projects", "slug", "rollback-project")) === 0, "no project row may remain");

  const [after] = await sql.unsafe(
    `SELECT
       (SELECT count(*)::int FROM public.projects) AS projects,
       (SELECT count(*)::int FROM public.goals) AS goals,
       (SELECT count(*)::int FROM public.tasks) AS tasks`,
  );
  assert(after.projects === before.projects, "rollback must not add a project");
  assert(after.goals === before.goals, "rollback must not add goals");
  assert(after.tasks === before.tasks, "rollback must not add tasks");

  await sql.unsafe(`DROP TRIGGER ${blocker}_trigger ON public.tasks`);
  await sql.unsafe(`DROP FUNCTION public.${blocker}()`);

  const retried = await directSession(sql).run((tx) =>
    callCreate(tx, { operationId: OPERATION_ROLLBACK, slug: "rollback-project" }),
  );
  assert(retried?.status === "created", `expected created after blocker removal, got ${JSON.stringify(retried)}`);
  assert(retried.goal_count === 2 && retried.task_count === 4, "retry must create the full template");
  log("ROLLBACK", "a mid-way failure leaves no partial entities; retry creates the full set");
}

async function assertAuthGuards(sql) {
  const oauthCode = await capturePostgresCode(() =>
    oauthSession(sql).run((tx) => callCreate(tx, { operationId: OPERATION_INVALID, slug: "oauth-project" })),
  );
  assert(oauthCode === "42501", `OAuth context must raise 42501, got ${oauthCode}`);

  const anonymousCode = await capturePostgresCode(() =>
    sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE authenticated`);
      await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '', true)`);
      await tx.unsafe(`SELECT set_config('request.jwt.claims', '{}', true)`);
      return callCreate(tx, { operationId: OPERATION_INVALID, slug: "anonymous-project" });
    }),
  );
  assert(anonymousCode === "42501", `unauthenticated call must raise 42501, got ${anonymousCode}`);
  log("AUTH", "OAuth and unauthenticated contexts are refused");
}

async function assertRlsIsolation(sql) {
  const [project] = await sql.unsafe(
    `SELECT id FROM public.projects WHERE template_operation_id = $1`,
    [OPERATION_MAIN],
  );
  const foreign = await directSession(sql, { userId: OWNER_B }).run(async (tx) => {
    const projects = await tx.unsafe(`SELECT id FROM public.projects WHERE id = $1`, [project.id]);
    const goals = await tx.unsafe(`SELECT id FROM public.goals WHERE project_id = $1`, [project.id]);
    const tasks = await tx.unsafe(`SELECT id FROM public.tasks WHERE project_id = $1`, [project.id]);
    return { projects: projects.length, goals: goals.length, tasks: tasks.length };
  });
  assert(
    foreign.projects === 0 && foreign.goals === 0 && foreign.tasks === 0,
    `foreign owner must not read template rows, got ${JSON.stringify(foreign)}`,
  );
  log("RLS", "another owner cannot read the created project, goals or tasks");
}

async function main() {
  const { url } = parseArgs();
  const sql = postgres(url, { max: 4 });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    const tags = await readJournal();
    assert(tags.includes(MIGRATION_TAG), `journal must include ${MIGRATION_TAG}`);
    for (const tag of tags) {
      await applyFile(sql, tag);
    }
    await applySupabaseGrants(sql);
    log("MIGRATE", `${tags.length} journal migrations applied on real Postgres`);

    const created = await assertCreate(sql);
    await assertReplay(sql, created.project_id);
    await assertOwnerScopedReceipt(sql);
    await assertSlugConflict(sql);
    await assertInvalidPayloads(sql);
    await assertRollback(sql);
    await assertAuthGuards(sql);
    await assertRlsIsolation(sql);

    console.log("PROJECT-TEMPLATE-INVARIANT-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
