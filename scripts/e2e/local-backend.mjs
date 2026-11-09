import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import { readLocalEnvironment, stateDirectory, validateLocalEnvironment } from "./local-env.cjs";

const cwd = fileURLToPath(stateDirectory);
const executable = process.env.E2E_SUPABASE_BIN ?? "supabase";
const cli = process.env.E2E_SUPABASE_SUDO === "1" ? ["sudo", "-n", executable] : [executable];
const excludes = "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
function command(args) {
  const result = spawnSync(cli[0], [...cli.slice(1), ...args, "--workdir", cwd], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60_000 });
  // CLI status/start output contains credentials. Never print captured output.
  if (result.status !== 0) throw new Error(`Local Supabase ${args[0]} failed; exit ${result.status ?? "spawn error"}.`);
  return result.stdout;
}

async function stop() {
  const config = await readFile(new URL("supabase/config.toml", stateDirectory), "utf8");
  const runId = /^project_id = "(ega-e2e-[a-f0-9]{12})"$/m.exec(config)?.[1];
  if (!runId) throw new Error("Backend ownership mismatch; refusing cleanup.");
  // Also recover a failed start that never wrote credentials. Stop only this generated project.
  try {
    await readFile(new URL("environment.json", stateDirectory));
    if (readLocalEnvironment().E2E_RUN_ID !== runId) throw new Error("Backend ownership mismatch; refusing cleanup.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  command(["stop", "--no-backup"]);
  await rm(stateDirectory, { recursive: true });
  console.log("Disposable backend removed.");
}

async function migrate(env) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  // 0043 reconciles legacy ownership by this exact address. It is never used for login.
  const { error } = await admin.auth.admin.createUser({ email: "ab.mortaki@gmail.com", password: randomBytes(32).toString("hex"), email_confirm: true });
  if (error) throw new Error("Unable to provision migration reconciliation account.");
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // 0035 is additive to the pre-Drizzle automation table. Do not replace auth schemas/functions.
    await sql.unsafe(`CREATE SCHEMA automation;
      CREATE TABLE automation.implementation_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id varchar(64), linear_issue_id varchar(64),
        linear_issue_identifier varchar(64), linear_issue_url text, attempt_number integer NOT NULL DEFAULT 1,
        status varchar(48) NOT NULL DEFAULT 'queued', claimed_by varchar(64), heartbeat_at timestamptz,
        lease_expires_at timestamptz, started_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        finished_at timestamptz, failure_code varchar(64), pr_number bigint, created_at timestamptz DEFAULT now()
      );`);
    const journal = JSON.parse(await readFile(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    for (const entry of journal.entries) {
      const text = await readFile(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      try {
        for (const statement of text.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) await sql.unsafe(statement);
      } catch { throw new Error(`Disposable migration failed at ${entry.tag}.`); }
    }
    await sql.unsafe("CREATE SCHEMA e2e_private; REVOKE ALL ON SCHEMA e2e_private FROM PUBLIC; CREATE TABLE e2e_private.run (id text PRIMARY KEY);");
    await sql`INSERT INTO e2e_private.run VALUES (${env.E2E_RUN_ID})`;
    await sql`NOTIFY pgrst, 'reload schema'`;
    console.log(`Applied ${journal.entries.length} canonical migrations with real Supabase Auth.`);
  } finally { await sql.end({ timeout: 5 }); }
}

async function start() {
  await mkdir(stateDirectory, { mode: 0o700 }); // Existing state requires an explicit stop; never take it over.
  const runId = `ega-e2e-${randomBytes(6).toString("hex")}`;
  await mkdir(new URL("supabase/", stateDirectory));
  await mkdir(new URL("supabase/.temp/", stateDirectory));
  const template = await readFile(new URL("supabase.toml", import.meta.url), "utf8");
  await writeFile(new URL("supabase/config.toml", stateDirectory), template.replace("REPLACED_BY_RUN_ID", runId));
  try {
    command(["start", "--exclude", excludes]);
    const status = JSON.parse(command(["status", "--output", "json"]));
    const env = validateLocalEnvironment({
      E2E_DISPOSABLE: "local-supabase-v1", E2E_RUN_ID: runId, E2E_AUTH_BASE_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL, DATABASE_URL: status.DB_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", MCP_ENABLED: "false", MCP_WRITES_ENABLED: "false",
    });
    await writeFile(new URL("environment.json", stateDirectory), JSON.stringify(env), { mode: 0o600 });
    await migrate(env);
  } catch (error) {
    try { command(["stop", "--no-backup"]); await rm(stateDirectory, { recursive: true }); } catch { console.error("Cleanup failed; preserve local state and run the stop command."); }
    throw error;
  }
}

const action = process.argv[2];
if (action === "start") await start();
else if (action === "stop") await stop();
else throw new Error("Usage: node scripts/e2e/local-backend.mjs start|stop");
