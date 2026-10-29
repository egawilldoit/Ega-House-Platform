#!/usr/bin/env node
/**
 * Ephemeral-database proof for EGA-802 task attachments.
 *
 * Applies the full drizzle journal (plus the usual Supabase shim: auth roles,
 * auth.uid()/auth.jwt(), storage.buckets/objects/foldername) to a disposable
 * Postgres, then proves at the database boundary that:
 *
 *   METADATA-RLS      own rows are readable, another owner's rows are filtered.
 *   DIRECT-WRITE      authenticated clients cannot INSERT/UPDATE/DELETE
 *                     metadata directly; the SECURITY DEFINER functions are the
 *                     only writer.
 *   FORGED-PARENT     a ticket for another owner's task id returns not_found,
 *                     so a forged task id cannot mint a path or a row.
 *   SERVER-PATH       the object path is built by the database as
 *                     <owner>/<task>/<attachment>.<ext>.
 *   LIMITS            size, MIME allowlist, task file ceiling and idempotency
 *                     conflicts are rejected server-side.
 *   FINALIZE          finalize is owner-only and idempotent ("already").
 *   DELETE            delete is owner-only and idempotent.
 *   ACTIVITY          finalized attach/remove emit task_activity_events.
 *   STORAGE-RLS       two owners cannot read, write or delete each other's
 *                     objects; the bucket is private with size/MIME limits.
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation/storage CASCADE). Only point it at a throwaway
 * container.
 *
 * Usage: node scripts/db/task-attachments-rls-verify.mjs --url <postgres-url>
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";
const PROJECT_A = "77777777-7777-4777-8777-777777777771";
const PROJECT_B = "77777777-7777-4777-8777-777777777772";
const TASK_A = "99999999-9999-4999-8999-999999999991";
const TASK_B = "99999999-9999-4999-8999-999999999992";

let assertions = 0;

function parseArgs() {
  const args = {};
  const rest = argv.slice(2);
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--url") args.url = rest[++index];
  }
  if (!args.url) {
    console.error("Missing --url");
    exit(2);
  }
  return args;
}

function log(stage, message) {
  console.log(`[${stage}] ${message}`);
}

function assert(condition, message) {
  assertions += 1;
  if (!condition) {
    console.error(`[PROOF] FAILED: ${message}`);
    exit(1);
  }
}

async function readJournal() {
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", DRIZZLE_DIR), "utf8"));
  return journal.entries.map((entry) => entry.tag);
}

function splitStatements(source) {
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyFile(sql, tag) {
  const source = await readFile(new URL(`${tag}.sql`, DRIZZLE_DIR), "utf8");
  for (const statement of splitStatements(source)) await sql.unsafe(statement);
}

async function reset(sql) {
  await sql.unsafe(
    `DROP SCHEMA IF EXISTS public CASCADE;
     DROP SCHEMA IF EXISTS auth CASCADE;
     DROP SCHEMA IF EXISTS automation CASCADE;
     DROP SCHEMA IF EXISTS storage CASCADE;
     CREATE SCHEMA public;`,
  );
}

async function applyShim(sql) {
  await sql.unsafe(`DO $x$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $x$;`);

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, supabase_auth_admin;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text NOT NULL);`);
  await sql.unsafe(
    `INSERT INTO auth.users (id, email) VALUES
       ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com'),
       ('${OWNER_A}'::uuid, 'owner-a@example.test'),
       ('${OWNER_B}'::uuid, 'owner-b@example.test')
     ON CONFLICT (id) DO NOTHING;`,
  );
  await sql.unsafe(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;`);
  await sql.unsafe(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $fn$;`);

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS automation;
    CREATE TABLE IF NOT EXISTS automation.implementation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64),
      linear_issue_id varchar(64), linear_issue_identifier varchar(64),
      linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1,
      status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64),
      heartbeat_at timestamptz, lease_expires_at timestamptz,
      started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      finished_at timestamptz, failure_code varchar(64), pr_number bigint,
      created_at timestamptz DEFAULT now());`);

  // Minimal Supabase Storage surface used by the migration and its policies.
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS storage;
    GRANT USAGE ON SCHEMA storage TO authenticated, anon;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[],
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL,
      owner uuid,
      owner_id text,
      metadata jsonb,
      created_at timestamptz DEFAULT now()
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON storage.objects TO authenticated;
    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $fn$
      SELECT CASE
        WHEN position('/' in name) = 0 THEN ARRAY[]::text[]
        ELSE (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
      END
    $fn$;`);
}

function directSession(sql, userId) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
        await tx.unsafe(`SELECT set_config('request.jwt.claims', '{}', true)`);
        return fn(tx);
      });
    },
  };
}

function anonSession(sql) {
  return {
    run(fn) {
      return sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE anon");
        return fn(tx);
      });
    },
  };
}

async function expectDenied(label, fn, codes = ["42501"]) {
  try {
    await fn();
  } catch (error) {
    if (codes.includes(error.code)) {
      assert(true, `${label} denied (${error.code})`);
      log("DENIED", label);
      return;
    }
    assert(false, `${label} denied with unexpected ${error.code}: ${error.message}`);
    return;
  }
  assert(false, `${label} should have been denied`);
}

async function main() {
  const { url } = parseArgs();
  const sql = postgres(url, { max: 4, onnotice: () => {} });

  try {
    await reset(sql);
    await applyShim(sql);
    const tags = await readJournal();
    for (const tag of tags) await applyFile(sql, tag);
    log("MIGRATE", `${tags.length} migrations applied`);

    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.projects, public.tasks TO authenticated;
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_subtasks TO authenticated;
       GRANT SELECT ON TABLE public.task_activity_events TO authenticated;
       GRANT SELECT ON TABLE public.task_attachments TO authenticated;`,
    );

    const sessionA = directSession(sql, OWNER_A);
    const sessionB = directSession(sql, OWNER_B);
    const anon = anonSession(sql);

    // Seed one project + task per owner through RLS as each owner.
    await sessionA.run((tx) =>
      tx.unsafe(
        `INSERT INTO public.projects (id, name, slug, owner_user_id)
         VALUES ('${PROJECT_A}'::uuid, 'Owner A project', 'owner-a-project', '${OWNER_A}'::uuid)`,
      ),
    );
    await sessionA.run((tx) =>
      tx.unsafe(
        `INSERT INTO public.tasks (id, project_id, title, owner_user_id)
         VALUES ('${TASK_A}'::uuid, '${PROJECT_A}'::uuid, 'Owner A task', '${OWNER_A}'::uuid)`,
      ),
    );
    await sessionB.run((tx) =>
      tx.unsafe(
        `INSERT INTO public.projects (id, name, slug, owner_user_id)
         VALUES ('${PROJECT_B}'::uuid, 'Owner B project', 'owner-b-project', '${OWNER_B}'::uuid)`,
      ),
    );
    await sessionB.run((tx) =>
      tx.unsafe(
        `INSERT INTO public.tasks (id, project_id, title, owner_user_id)
         VALUES ('${TASK_B}'::uuid, '${PROJECT_B}'::uuid, 'Owner B task', '${OWNER_B}'::uuid)`,
      ),
    );

    async function ticket(session, taskId, key, size = 10, mime = "image/png", ext = "png") {
      const rows = await session.run((tx) =>
        tx.unsafe(
          `SELECT public.create_task_attachment_upload(
             '${taskId}'::uuid, 'plan.${ext}', '${mime}', ${size}, '${ext}', '${key}'
           ) AS result`,
        ),
      );
      return rows[0].result;
    }

    // 1. Server-owned tickets and immutable paths.
    const ownTicket = await ticket(sessionA, TASK_A, "owner-a-key-0001");
    assert(ownTicket.ok === true, "owner can create an upload ticket for an owned task");
    assert(
      ownTicket.storage_path === `${OWNER_A}/${TASK_A}/${ownTicket.id}.png`,
      "storage path is built from owner, task and attachment id",
    );
    assert(ownTicket.status === "pending", "a new ticket starts pending");
    log("TICKET", `created ${ownTicket.storage_path}`);

    const forged = await ticket(sessionA, TASK_B, "forged-task-key-01");
    assert(forged.ok === false && forged.code === "not_found", "forged other-owner task id is rejected");
    log("FORGED", "cross-owner task ticket rejected");

    const badSize = await ticket(sessionA, TASK_A, "bad-size-key-0001", 10 * 1024 * 1024 + 1);
    assert(badSize.ok === false && badSize.code === "invalid_size", "oversized ticket rejected");
    const badType = await ticket(sessionA, TASK_A, "bad-type-key-0001", 10, "image/svg+xml", "svg");
    assert(badType.ok === false && badType.code === "invalid_type", "active/unsupported MIME rejected");
    log("LIMITS", "size and MIME allowlist enforced by the ticket function");

    // Idempotency: the same owner + key resolves to the same row.
    const replay = await ticket(sessionA, TASK_A, "owner-a-key-0001");
    assert(replay.id === ownTicket.id, "replayed key returns the original attachment id");
    assert(replay.reused === true, "replayed key is reported as reused");
    assert(
      (await ticket(sessionA, TASK_A, "owner-a-key-0001", 20)).id === ownTicket.id,
      "replay ignores a different client size claim",
    );
    log("IDEMPOTENCY", "retried ticket does not duplicate the row");

    // Task ceiling is enforced server-side (20 files per task).
    const bulkTickets = [];
    for (let index = 0; index < 19; index += 1) {
      const extra = await ticket(sessionA, TASK_A, `owner-a-bulk-key-${String(index).padStart(4, "0")}`);
      assert(extra.ok === true, `bulk ticket ${index} accepted`);
      bulkTickets.push(extra);
    }
    const overLimit = await ticket(sessionA, TASK_A, "owner-a-over-limit-01");
    assert(overLimit.ok === false && overLimit.code === "task_limit", "21st file is rejected");
    log("LIMITS", "per-task file ceiling enforced");

    // 2. Metadata reads are owner + parent scoped.
    const ownRows = await sessionA.run((tx) =>
      tx.unsafe(`SELECT id FROM public.task_attachments WHERE id = '${ownTicket.id}'::uuid`),
    );
    assert(ownRows.length === 1, "owner reads own metadata");
    const foreignRows = await sessionB.run((tx) =>
      tx.unsafe(`SELECT id FROM public.task_attachments WHERE id = '${ownTicket.id}'::uuid`),
    );
    assert(foreignRows.length === 0, "other owner cannot read metadata (RLS)");
    log("METADATA-RLS", "cross-owner read filtered");

    // 3. Direct metadata writes are not granted; only the definer functions write.
    const forgedInsert = `INSERT INTO public.task_attachments
      (owner_user_id, task_id, file_name, storage_path, mime_type, size_bytes, status,
       idempotency_key, upload_expires_at, finalized_at)
      VALUES ('${OWNER_A}'::uuid, '${TASK_A}'::uuid, 'forged.png',
       '${OWNER_A}/${TASK_A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', 'image/png', 10,
       'finalized', 'forged-key-000001', now() + interval '2 hours', now())`;
    await expectDenied("direct metadata insert", () => sessionA.run((tx) => tx.unsafe(forgedInsert)));
    await expectDenied("direct metadata update", () =>
      sessionA.run((tx) =>
        tx.unsafe(`UPDATE public.task_attachments SET status = 'finalized' WHERE id = '${ownTicket.id}'::uuid`),
      ),
    );
    await expectDenied("direct metadata delete", () =>
      sessionA.run((tx) =>
        tx.unsafe(`DELETE FROM public.task_attachments WHERE id = '${ownTicket.id}'::uuid`),
      ),
    );
    await expectDenied("anon metadata select", () =>
      anon.run((tx) => tx.unsafe(`SELECT id FROM public.task_attachments LIMIT 1`)),
    );

    // 4. Finalize is owner-only and idempotent.
    const foreignFinalize = await sessionB.run((tx) =>
      tx.unsafe(
        `SELECT public.finalize_task_attachment('${ownTicket.id}'::uuid, 10) AS result`,
      ),
    );
    assert(
      foreignFinalize[0].result.ok === false && foreignFinalize[0].result.code === "not_found",
      "other owner cannot finalize",
    );
    const finalized = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.finalize_task_attachment('${ownTicket.id}'::uuid, 10) AS result`),
    );
    assert(finalized[0].result.ok === true && finalized[0].result.already === false, "owner finalizes");
    const finalizedAgain = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.finalize_task_attachment('${ownTicket.id}'::uuid, 10) AS result`),
    );
    assert(
      finalizedAgain[0].result.ok === true && finalizedAgain[0].result.already === true,
      "repeated finalize is idempotent",
    );
    const wrongSize = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.finalize_task_attachment('${finalized[0].result.id}'::uuid, 11) AS result`),
    );
    // Already finalized, so the idempotent branch wins; proving the pending size
    // mismatch path needs a fresh row.
    assert(wrongSize[0].result.ok === true, "finalize replay stays idempotent regardless of a later size claim");

    // Reuse an existing pending ticket for the size-mismatch proof: the task is
    // already at its 20-file ceiling, so a fresh ticket would be rejected.
    const mismatchTicket = bulkTickets[0];
    assert(Boolean(mismatchTicket?.id), "a bulk pending ticket exists for the size proof");
    const mismatch = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.finalize_task_attachment('${mismatchTicket.id}'::uuid, 999) AS result`),
    );
    assert(
      mismatch[0].result.ok === false && mismatch[0].result.code === "size_mismatch",
      "measured size mismatch is rejected",
    );
    const failed = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.fail_task_attachment('${mismatchTicket.id}'::uuid, 'size mismatch') AS result`),
    );
    assert(failed[0].result === true, "owner can mark a pending upload failed");
    log("FINALIZE", "owner-only, idempotent, size-checked");

    // 5. Attach/remove activity flows through the EGA-784 ledger.
    const added = await sessionA.run((tx) =>
      tx.unsafe(
        `SELECT event_kind FROM public.task_activity_events
         WHERE task_id = '${TASK_A}'::uuid AND event_kind = 'attachment_added'`,
      ),
    );
    assert(added.length === 1, "finalize emits exactly one attachment_added activity row");

    const foreignDelete = await sessionB.run((tx) =>
      tx.unsafe(`SELECT public.delete_task_attachment('${ownTicket.id}'::uuid) AS result`),
    );
    assert(foreignDelete[0].result.deleted === false, "other owner delete affects no row");
    assert(
      (await sessionA.run((tx) =>
        tx.unsafe(`SELECT id FROM public.task_attachments WHERE id = '${ownTicket.id}'::uuid`),
      )).length === 1,
      "cross-owner delete left the row intact",
    );

    const deleted = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.delete_task_attachment('${ownTicket.id}'::uuid) AS result`),
    );
    assert(deleted[0].result.ok === true && deleted[0].result.deleted === true, "owner delete removes the row");
    const deletedAgain = await sessionA.run((tx) =>
      tx.unsafe(`SELECT public.delete_task_attachment('${ownTicket.id}'::uuid) AS result`),
    );
    assert(deletedAgain[0].result.deleted === false, "repeated delete is idempotent");
    const removed = await sessionA.run((tx) =>
      tx.unsafe(
        `SELECT event_kind FROM public.task_activity_events
         WHERE task_id = '${TASK_A}'::uuid AND event_kind = 'attachment_removed'`,
      ),
    );
    assert(removed.length === 1, "delete emits one attachment_removed activity row");
    log("ACTIVITY", "attach/remove events recorded once");

    // 6. Storage policies: two owners, path prefix is not just cosmetic.
    const bucket = await sql.unsafe(
      `SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'task-attachments'`,
    );
    assert(bucket.length === 1, "task-attachments bucket exists");
    assert(bucket[0].public === false, "bucket is private");
    assert(Number(bucket[0].file_size_limit) === 10 * 1024 * 1024, "bucket size limit configured");
    assert(bucket[0].allowed_mime_types.includes("application/pdf"), "bucket MIME allowlist configured");

    const ownObject = `${OWNER_A}/${TASK_A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.png`;
    const foreignObject = `${OWNER_B}/${TASK_B}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1.png`;
    await sessionA.run((tx) =>
      tx.unsafe(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('task-attachments', '${ownObject}', '${OWNER_A}'::uuid)`,
      ),
    );
    await sessionB.run((tx) =>
      tx.unsafe(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('task-attachments', '${foreignObject}', '${OWNER_B}'::uuid)`,
      ),
    );
    assert(
      (await sessionA.run((tx) => tx.unsafe(`SELECT name FROM storage.objects WHERE name = '${ownObject}'`)))
        .length === 1,
      "owner can read own object",
    );
    assert(
      (await sessionA.run((tx) => tx.unsafe(`SELECT name FROM storage.objects WHERE name = '${foreignObject}'`)))
        .length === 0,
      "owner cannot read another owner's object",
    );
    await expectDenied("foreign-folder object insert", () =>
      sessionA.run((tx) =>
        tx.unsafe(
          `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('task-attachments', '${foreignObject}.forged', '${OWNER_A}'::uuid)`,
        ),
      ),
    );
    const foreignUpdate = await sessionA.run((tx) =>
      tx.unsafe(`UPDATE storage.objects SET name = '${ownObject}.hijack' WHERE name = '${foreignObject}' RETURNING id`),
    );
    assert(foreignUpdate.length === 0, "owner cannot update another owner's object");
    const foreignObjectDelete = await sessionA.run((tx) =>
      tx.unsafe(`DELETE FROM storage.objects WHERE name = '${foreignObject}' RETURNING id`),
    );
    assert(foreignObjectDelete.length === 0, "owner cannot delete another owner's object");
    await expectDenied("anon object insert", () =>
      anon.run((tx) =>
        tx.unsafe(
          `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('task-attachments', 'anon/object.png', null)`,
        ),
      ),
    );
    log("STORAGE-RLS", "two-owner object access denied by path policy");

    console.log(`TASK-ATTACHMENTS-VERIFY PASS (${assertions} assertions)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error.message);
  exit(1);
});
