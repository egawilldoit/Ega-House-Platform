#!/usr/bin/env node
/**
 * Ephemeral-database proof for task comments, mentions and reactions (EGA-783).
 *
 * Applies the full drizzle journal (plus the minimal Supabase shim) to a
 * disposable Postgres and proves, at the real RLS/RPC boundary:
 *
 *   - owner isolation for reads and writes, including parent task ownership;
 *   - direct table inserts/updates/deletes are denied to authenticated clients;
 *   - one comment retry produces exactly one comment, activity row, mention and
 *     notification;
 *   - agent authors require a live token with tasks.comment, and cannot post as
 *     another agent or another owner;
 *   - token rotation keeps the stable `agent:<name>` attribution;
 *   - unknown/unconfigured mention names are rejected rather than invented;
 *   - reaction toggles are per actor and leave other actors untouched;
 *   - edit/delete are limited to the author.
 *
 * Usage:
 *   node scripts/db/task-comments-invariant-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed (DROP SCHEMA public/auth).
 * Only point it at a throwaway container.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);

const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_A = "44444444-4444-4444-8444-444444444441";
const PROJECT_B = "44444444-4444-4444-8444-444444444442";
const TASK_A = "55555555-5555-4555-8555-555555555551";
const TASK_B = "55555555-5555-4555-8555-555555555552";
const TOKEN_A_CODEX = "66666666-6666-4666-8666-666666666661";
const TOKEN_A_NO_SCOPE = "66666666-6666-4666-8666-666666666662";
const TOKEN_A_CODEX_ROTATED = "66666666-6666-4666-8666-666666666663";
const TOKEN_B_CODEX = "66666666-6666-4666-8666-666666666664";
const TOKEN_A_RUNNER = "66666666-6666-4666-8666-666666666665";

let failures = 0;

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

function check(condition, label, detail = "") {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}${detail ? ` (${detail})` : ""}`);
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
  for (const statement of splitStatements(text)) {
    await sql.unsafe(statement);
  }
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
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
      ALTER ROLE service_role BYPASSRLS;
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
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $fn$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fn$;
  `);
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $fn$ SELECT '{}'::jsonb $fn$;
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

async function resetDatabase(sql) {
  await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS auth CASCADE;`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS automation CASCADE;`);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS public;`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;`);
}

async function asUser(sql, ownerUserId, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE authenticated`);
    await tx.unsafe(
      `SELECT set_config('request.jwt.claim.sub', '${ownerUserId}', true)`,
    );
    return fn(tx);
  });
}

async function asService(sql, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE service_role`);
    await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    return fn(tx);
  });
}

async function expectFailure(label, fn, expectedText) {
  try {
    await fn();
    check(false, label, "unexpected success");
  } catch (error) {
    const message = String(error?.message ?? error).toLowerCase();
    check(
      message.includes(expectedText.toLowerCase()),
      label,
      message,
    );
  }
}

function mentions(...values) {
  return values;
}

async function count(sql, table, where = "", params = []) {
  const rows = await sql.unsafe(
    `SELECT count(*)::int AS count FROM ${table}${where ? ` WHERE ${where}` : ""}`,
    params,
  );
  return rows[0].count;
}

async function main() {
  const args = parseArgs();
  const sql = postgres(args.url, { max: 4, onnotice: () => {} });

  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);

    for (const tag of await readJournal()) {
      await applyFile(sql, tag);
    }
    // Supabase grants authenticated table privileges by default; the journal
    // only defines the objects. The RLS policies still decide row visibility.
    await sql.unsafe(`GRANT SELECT ON TABLE public.tasks TO authenticated;`);
    log("MIGRATE", "Full drizzle journal applied");

    await sql`
      INSERT INTO auth.users (id, email) VALUES
        (${OWNER_A}::uuid, 'a@example.test'),
        (${OWNER_B}::uuid, 'b@example.test')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO projects (id, owner_user_id, name, slug)
      VALUES
        (${PROJECT_A}::uuid, ${OWNER_A}::uuid, 'Owner A', 'owner-a'),
        (${PROJECT_B}::uuid, ${OWNER_B}::uuid, 'Owner B', 'owner-b')
    `;

    await sql`
      INSERT INTO tasks (id, owner_user_id, project_id, title, status, priority)
      VALUES
        (${TASK_A}::uuid, ${OWNER_A}::uuid, ${PROJECT_A}::uuid, 'Owner A task', 'todo', 'medium'),
        (${TASK_B}::uuid, ${OWNER_B}::uuid, ${PROJECT_B}::uuid, 'Owner B task', 'todo', 'medium')
    `;

    await sql`
      INSERT INTO agent_integration_tokens
        (id, owner_user_id, name, token_prefix, token_hash, scopes)
      VALUES
        (${TOKEN_A_CODEX}::uuid, ${OWNER_A}::uuid, 'Codex', 'aaaaaaaaaaaaaaaa', repeat('a', 64), '{"tasks":{"comment":true}}'::jsonb),
        (${TOKEN_A_NO_SCOPE}::uuid, ${OWNER_A}::uuid, 'NoScope', 'bbbbbbbbbbbbbbbb', repeat('b', 64), '{"tasks":{"read":true}}'::jsonb),
        (${TOKEN_B_CODEX}::uuid, ${OWNER_B}::uuid, 'Codex', 'cccccccccccccccc', repeat('c', 64), '{"tasks":{"comment":true}}'::jsonb),
        (${TOKEN_A_RUNNER}::uuid, ${OWNER_A}::uuid, 'Runner', 'eeeeeeeeeeeeeeee', repeat('e', 64), '{"tasks":{"comment":true}}'::jsonb)
    `;

    // ---------------------------------------------------------------------
    log("RLS", "table shape and policies");

    const [flags] = await sql`
      SELECT
        c.relrowsecurity AS comments_rls,
        c.relforcerowsecurity AS comments_force,
        m.relrowsecurity AS mentions_rls,
        r.relrowsecurity AS reactions_rls
      FROM pg_class c, pg_class m, pg_class r
      WHERE c.oid = 'public.task_comments'::regclass
        AND m.oid = 'public.task_comment_mentions'::regclass
        AND r.oid = 'public.task_comment_reactions'::regclass
    `;
    check(flags?.comments_rls === true && flags?.comments_force === true, "task_comments has forced RLS");
    check(flags?.mentions_rls === true, "task_comment_mentions has RLS");
    check(flags?.reactions_rls === true, "task_comment_reactions has RLS");

    // ---------------------------------------------------------------------
    log("COMMENT", "owner post, retry, activity, mention and notification");

    const first = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.create_task_comment(
          ${TASK_A}::uuid,
          ${'Ship the note @codex'},
          ${'req-owner-1'},
          ${'owner'},
          ${OWNER_A}::uuid,
          NULL,
          ${mentions({ kind: "agent", ref: "agent:codex", label: "Codex" })}::jsonb
        )
      `;
      return row;
    });

    check(first?.id && first.author_ref === "owner", "owner comment is authored as stable owner ref");
    check(first?.author_user_id === OWNER_A, "owner comment records the verified author user id");

    const retried = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.create_task_comment(
          ${TASK_A}::uuid,
          ${'Ship the note @codex'},
          ${'req-owner-1'},
          ${'owner'},
          ${OWNER_A}::uuid,
          NULL,
          ${mentions({ kind: "agent", ref: "agent:codex", label: "Codex" })}::jsonb
        )
      `;
      return row;
    });

    check(retried?.id === first?.id, "retry returns the original comment");

    check(
      (await count(sql, "task_comments", "owner_user_id = $1::uuid", [OWNER_A])) === 1,
      "retry produced exactly one comment row",
    );
    check(
      (await count(sql, "task_activity_events", "task_id = $1::uuid AND event_kind = 'commented'", [TASK_A])) === 1,
      "retry produced exactly one EGA-784 activity entry",
    );
    check(
      (await count(sql, "task_comment_mentions", "comment_id = $1::uuid", [first.id])) === 1,
      "retry produced exactly one mention row",
    );
    const [notification] = await sql`
      SELECT * FROM notifications
      WHERE owner_user_id = ${OWNER_A}::uuid
        AND idempotency_key = ${`task-comment:${first.id}:agent:codex`}
    `;
    check(Boolean(notification), "mention created one owner-scoped notification");
    check(notification?.type === "task_comment_mention", "mention notification uses the in-app comment type");
    check(
      (await count(sql, "notifications", "owner_user_id = $1::uuid AND idempotency_key LIKE $2", [OWNER_A, `task-comment:${first.id}:%`])) === 1,
      "retry did not duplicate the notification",
    );

    const [activity] = await sql`
      SELECT * FROM task_activity_events
      WHERE task_id = ${TASK_A}::uuid AND event_kind = 'commented'
    `;
    check(activity?.actor_kind === "owner" && activity?.actor_label === "Owner", "activity attributes the owner honestly");
    check(activity?.delta?.comment_id === first.id, "activity delta references the comment");

    // Self-mention makes no inbox noise.
    const selfMention = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.create_task_comment(
          ${TASK_A}::uuid,
          ${'Note for @owner'},
          ${'req-owner-self'},
          ${'owner'},
          ${OWNER_A}::uuid,
          NULL,
          ${mentions({ kind: "owner", ref: "owner", label: "Owner" })}::jsonb
        )
      `;
      return row;
    });
    check(
      (await count(sql, "notifications", "owner_user_id = $1::uuid AND idempotency_key = $2", [OWNER_A, `task-comment:${selfMention.id}:owner`])) === 0,
      "self-mention creates no notification",
    );
    check(
      (await count(sql, "task_comment_mentions", "comment_id = $1::uuid AND mention_ref = 'owner'", [selfMention.id])) === 1,
      "self-mention is still recorded as a mention reference",
    );

    // ---------------------------------------------------------------------
    log("SECURITY", "owner isolation, forged authors and direct writes");

    const foreignRead = await asUser(sql, OWNER_B, async (tx) =>
      count(tx, "task_comments", "owner_user_id = $1::uuid", [OWNER_A]),
    );
    check(foreignRead === 0, "cross-owner comment read returns no rows through RLS");

    const foreignTaskRead = await asUser(sql, OWNER_B, async (tx) =>
      count(tx, "task_comments", "task_id = $1::uuid", [TASK_A]),
    );
    check(foreignTaskRead === 0, "cross-owner task filter returns no rows through RLS");

    await expectFailure(
      "owner B cannot post into owner A's task",
      () =>
        asUser(sql, OWNER_B, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'forged'}, ${'req-forged-b'}, ${'owner'}, ${OWNER_A}::uuid, NULL, '[]'::jsonb
          )`,
        ),
      "owner mismatch",
    );

    await expectFailure(
      "authenticated session cannot author as an agent",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'forged agent'}, ${'req-forged-agent'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_CODEX}::uuid, '[]'::jsonb
          )`,
        ),
      "invalid author",
    );

    await expectFailure(
      "direct comment INSERT is denied to authenticated clients",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`INSERT INTO task_comments
              (owner_user_id, task_id, author_kind, author_ref, author_label, body, client_request_id)
             VALUES (${OWNER_A}::uuid, ${TASK_A}::uuid, 'owner', 'owner', 'Owner', 'direct', 'req-direct')`,
        ),
      "permission denied",
    );

    await expectFailure(
      "direct comment UPDATE is denied to authenticated clients",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`UPDATE task_comments SET body = 'tampered' WHERE id = ${first.id}::uuid`,
        ),
      "permission denied",
    );

    await expectFailure(
      "direct comment DELETE is denied to authenticated clients",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`DELETE FROM task_comments WHERE id = ${first.id}::uuid`,
        ),
      "permission denied",
    );

    await expectFailure(
      "direct reaction INSERT is denied to authenticated clients",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`INSERT INTO task_comment_reactions
              (owner_user_id, comment_id, actor_kind, actor_ref, actor_label, emoji)
             VALUES (${OWNER_A}::uuid, ${first.id}::uuid, 'owner', 'owner', 'Owner', '👍')`,
        ),
      "permission denied",
    );

    // ---------------------------------------------------------------------
    log("AGENT", "scope, rotation and cross-owner denial");

    const agentComment = await asService(sql, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.create_task_comment(
          ${TASK_A}::uuid,
          ${'Agent hand-off'},
          ${'req-agent-codex-1'},
          ${'agent'},
          ${OWNER_A}::uuid,
          ${TOKEN_A_CODEX}::uuid,
          '[]'::jsonb
        )
      `;
      return row;
    });
    check(agentComment?.author_kind === "agent", "agent comment records agent author kind");
    check(agentComment?.author_ref === "agent:codex", "agent comment uses the stable name ref");
    check(agentComment?.author_label === "Codex", "agent comment keeps the display label");
    check(agentComment?.author_token_id === TOKEN_A_CODEX, "agent comment records the credential used");

    const [agentActivity] = await sql`
      SELECT * FROM task_activity_events
      WHERE task_id = ${TASK_A}::uuid AND delta->>'comment_id' = ${agentComment.id}
    `;
    check(agentActivity?.actor_kind === "agent", "agent comment activity is attributed to the agent");

    await expectFailure(
      "token without tasks.comment cannot post",
      () =>
        asService(sql, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'no scope'}, ${'req-no-scope'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_NO_SCOPE}::uuid, '[]'::jsonb
          )`,
        ),
      "not authorized",
    );

    await expectFailure(
      "owner B agent token cannot post into owner A's task",
      () =>
        asService(sql, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'cross owner'}, ${'req-agent-b'}, ${'agent'}, ${OWNER_B}::uuid, ${TOKEN_B_CODEX}::uuid, '[]'::jsonb
          )`,
        ),
      "task not found",
    );

    // Rotation: revoke the original token, issue a new one with the same name.
    await sql`UPDATE agent_integration_tokens SET revoked_at = now() WHERE id = ${TOKEN_A_CODEX}::uuid`;
    await sql`
      INSERT INTO agent_integration_tokens
        (id, owner_user_id, name, token_prefix, token_hash, scopes)
      VALUES
        (${TOKEN_A_CODEX_ROTATED}::uuid, ${OWNER_A}::uuid, 'Codex', 'dddddddddddddddd', repeat('d', 64), '{"tasks":{"comment":true}}'::jsonb)
    `;

    await expectFailure(
      "revoked token cannot post",
      () =>
        asService(sql, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'revoked'}, ${'req-revoked'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_CODEX}::uuid, '[]'::jsonb
          )`,
        ),
      "not authorized",
    );

    const rotated = await asService(sql, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.create_task_comment(
          ${TASK_A}::uuid,
          ${'Rotated token note'},
          ${'req-agent-codex-2'},
          ${'agent'},
          ${OWNER_A}::uuid,
          ${TOKEN_A_CODEX_ROTATED}::uuid,
          '[]'::jsonb
        )
      `;
      return row;
    });
    check(
      rotated?.author_ref === "agent:codex" && rotated?.author_label === "Codex",
      "rotation keeps the stable author attribution",
    );
    const [historical] = await sql`SELECT * FROM task_comments WHERE id = ${agentComment.id}`;
    check(historical?.author_label === "Codex", "historical author attribution survives revocation");

    const [candidates] = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`SELECT public.list_task_comment_mentions() AS value`;
      return [row.value];
    });
    const candidateRefs = Array.isArray(candidates) ? candidates.map((entry) => entry.ref) : [];
    check(candidateRefs.includes("owner"), "mention candidates include the owner");
    check(candidateRefs.filter((ref) => ref === "agent:codex").length === 1, "mention candidates include one live Codex actor");
    check(!candidateRefs.includes("agent:noscope"), "mention candidates exclude tokens without tasks.comment");
    check(!candidateRefs.includes("agent:ghost"), "mention candidates never invent a branded actor");

    await expectFailure(
      "unconfigured branded mention is rejected",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`SELECT * FROM public.create_task_comment(
            ${TASK_A}::uuid, ${'Hi @ghost'}, ${'req-ghost'}, ${'owner'}, ${OWNER_A}::uuid, NULL,
            ${mentions({ kind: "agent", ref: "agent:ghost", label: "Ghost" })}::jsonb
          )`,
        ),
      "not authorized",
    );

    // ---------------------------------------------------------------------
    log("EDIT", "author-only update and delete");

    const edited = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.update_task_comment(
          ${first.id}::uuid,
          ${'Edited owner note'},
          ${'owner'},
          ${OWNER_A}::uuid,
          NULL,
          '[]'::jsonb
        )
      `;
      return row;
    });
    check(edited?.body === "Edited owner note" && edited?.edited_at !== null, "owner can edit their own comment");

    await expectFailure(
      "owner B cannot edit owner A's comment",
      () =>
        asUser(sql, OWNER_B, (tx) =>
          tx`SELECT * FROM public.update_task_comment(
            ${first.id}::uuid, ${'forged edit'}, ${'owner'}, ${OWNER_B}::uuid, NULL, '[]'::jsonb
          )`,
        ),
      "not owned",
    );

    await expectFailure(
      "agent cannot edit the owner's comment",
      () =>
        asService(sql, (tx) =>
          tx`SELECT * FROM public.update_task_comment(
            ${first.id}::uuid, ${'forged edit'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_CODEX_ROTATED}::uuid, '[]'::jsonb
          )`,
        ),
      "not owned",
    );

    await expectFailure(
      "agent cannot edit another agent's comment",
      () =>
        asService(sql, (tx) =>
          tx`SELECT * FROM public.update_task_comment(
            ${agentComment.id}::uuid, ${'forged agent edit'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_RUNNER}::uuid, '[]'::jsonb
          )`,
        ),
      "not owned",
    );

    const agentEdited = await asService(sql, async (tx) => {
      const [row] = await tx`
        SELECT * FROM public.update_task_comment(
          ${agentComment.id}::uuid,
          ${'Agent edited its note'},
          ${'agent'},
          ${OWNER_A}::uuid,
          ${TOKEN_A_CODEX_ROTATED}::uuid,
          '[]'::jsonb
        )
      `;
      return row;
    });
    check(agentEdited?.body === "Agent edited its note", "agent can edit its own comment");

    // ---------------------------------------------------------------------
    log("REACTION", "atomic per-actor toggles");

    const ownerToggleOn = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT public.toggle_task_comment_reaction(
          ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_A}::uuid, NULL
        ) AS value
      `;
      return row.value;
    });
    check(
      Array.isArray(ownerToggleOn) &&
        ownerToggleOn.find((entry) => entry.emoji === "👍")?.count === 1 &&
        ownerToggleOn.find((entry) => entry.emoji === "👍")?.reacted === true,
      "owner reaction toggles on and reports viewer state",
    );

    const ownerToggleOff = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT public.toggle_task_comment_reaction(
          ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_A}::uuid, NULL
        ) AS value
      `;
      return row.value;
    });
    check(
      !Array.isArray(ownerToggleOff) ||
        !ownerToggleOff.some((entry) => entry.emoji === "👍"),
      "owner reaction toggles off",
    );

    await asService(sql, (tx) =>
      tx`SELECT public.toggle_task_comment_reaction(
        ${first.id}::uuid, ${'👍'}, ${'agent'}, ${OWNER_A}::uuid, ${TOKEN_A_CODEX_ROTATED}::uuid
      )`,
    );
    const ownerWithAgent = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT public.toggle_task_comment_reaction(
          ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_A}::uuid, NULL
        ) AS value
      `;
      return row.value;
    });
    check(
      ownerWithAgent.find((entry) => entry.emoji === "👍")?.count === 2,
      "own toggle preserves the other actor's reaction",
    );
    check(
      ownerWithAgent.find((entry) => entry.emoji === "👍")?.reacted === true,
      "viewer state only reflects the current actor",
    );

    const [agentReaction] = await sql`
      SELECT * FROM task_comment_reactions
      WHERE comment_id = ${first.id}::uuid AND actor_ref = 'agent:codex' AND emoji = '👍'
    `;
    check(Boolean(agentReaction), "agent reaction row is intact after owner toggle");

    // Two concurrent toggles for the same actor are serialised by the advisory
    // lock: both resolve, the pair lands back on "off", and the other actor's
    // row is never touched.
    const [concurrentA, concurrentB] = await Promise.all([
      asUser(sql, OWNER_A, async (tx) => {
        const [row] = await tx`
          SELECT public.toggle_task_comment_reaction(
            ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_A}::uuid, NULL
          ) AS value
        `;
        return row.value;
      }),
      asUser(sql, OWNER_A, async (tx) => {
        const [row] = await tx`
          SELECT public.toggle_task_comment_reaction(
            ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_A}::uuid, NULL
          ) AS value
        `;
        return row.value;
      }),
    ]);
    check(
      Array.isArray(concurrentA) && Array.isArray(concurrentB),
      "concurrent same-actor toggles both resolve without a unique violation",
    );
    check(
      (await count(
        sql,
        "task_comment_reactions",
        "comment_id = $1::uuid AND actor_ref = 'owner' AND emoji = '👍'",
        [first.id],
      )) === 1,
      "concurrent same-actor toggles land on the deterministic final state",
    );
    check(
      (await count(
        sql,
        "task_comment_reactions",
        "comment_id = $1::uuid AND actor_ref = 'agent:codex'",
        [first.id],
      )) === 1,
      "concurrent owner toggles preserve the agent's reaction",
    );

    await expectFailure(
      "unsupported emoji is rejected",
      () =>
        asUser(sql, OWNER_A, (tx) =>
          tx`SELECT public.toggle_task_comment_reaction(
            ${first.id}::uuid, ${'💣'}, ${'owner'}, ${OWNER_A}::uuid, NULL
          )`,
        ),
      "invalid reaction",
    );

    await expectFailure(
      "owner B cannot react to owner A's comment",
      () =>
        asUser(sql, OWNER_B, (tx) =>
          tx`SELECT public.toggle_task_comment_reaction(
            ${first.id}::uuid, ${'👍'}, ${'owner'}, ${OWNER_B}::uuid, NULL
          )`,
        ),
      "not owned",
    );

    // ---------------------------------------------------------------------
    log("DELETE", "author-only delete");

    await expectFailure(
      "owner B cannot delete owner A's comment",
      () =>
        asUser(sql, OWNER_B, (tx) =>
          tx`SELECT public.delete_task_comment(
            ${first.id}::uuid, ${'owner'}, ${OWNER_B}::uuid, NULL
          )`,
        ),
      "not owned",
    );

    const deleted = await asUser(sql, OWNER_A, async (tx) => {
      const [row] = await tx`
        SELECT public.delete_task_comment(
          ${first.id}::uuid, ${'owner'}, ${OWNER_A}::uuid, NULL
        ) AS value
      `;
      return row.value;
    });
    check(deleted === true, "owner can delete their own comment");
    check(
      (await count(sql, "task_comments", "id = $1::uuid", [first.id])) === 0,
      "deleted comment row is gone",
    );

    // ---------------------------------------------------------------------
    log("RESULT", failures === 0 ? "TASK-COMMENT-INVARIANT-VERIFY PASS" : `${failures} check(s) failed`);
    return failures === 0 ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then((code) => exit(code))
  .catch((error) => {
    console.error("[FATAL]", error);
    exit(1);
  });
