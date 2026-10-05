#!/usr/bin/env node
/**
 * Ephemeral-database concurrency proof for the MCP distributed rate limiter.
 *
 * WHY A SEPARATE VERIFIER. scripts/db/mcp-oauth-surface-verify.mjs already
 * proves the RPC's *shape*: that it takes only a window name, that the shipped
 * limits engage sequentially, and that the window is client bound. What it does
 * not prove is the property that actually protects a multi-tenant server:
 *
 *   - the shipped thresholds under GENUINE concurrency. Its 120/600/300/60
 *     sweep is a sequential loop inside ONE transaction on ONE connection, so
 *     it can never observe a lost update. A non-atomic counter passes that
 *     proof completely.
 *   - bucket isolation across owner, client and risk class.
 *   - that an unevaluatable bucket fails CLOSED.
 *
 * Those are different failure modes from the RPC inventory, and they need a
 * different harness (many independent connections, deliberately interleaved),
 * so they get their own proof rather than being bolted onto the surface
 * verifier. This file shares no infrastructure with it by design: the two
 * proofs are meant to stay independently readable and independently runnable.
 *
 * THE THRESHOLDS ARE READ, NOT COPIED. readShippedPolicy() parses the allowance
 * CASE expression, the window length, the window-name regex and the reserved
 * aggregate prefix out of the actual migration and registry sources. Every
 * threshold assertion below is made against those parsed values, so retuning a
 * threshold in drizzle/0071 changes what this proof demands rather than
 * silently making it wrong.
 *
 * WHAT IS PROVEN
 *
 *   THRESHOLD   Every shipped threshold bites at its configured value: the
 *               per-tool allowance admits exactly its limit and refuses the
 *               next call, and each risk-class aggregate does the same. Read
 *               from the migration's own CASE expression.
 *   CONCURRENCY N genuinely simultaneous calls, each on its own connection and
 *               in its own transaction, never admit more successes than the
 *               threshold, and never drive the durable counter above the
 *               number of calls actually made.
 *   ISOLATION   A different client_id, a different owner, and a different risk
 *               class are each a separate bucket. A revoked grant can neither
 *               consume nor benefit. A wrong aud is refused and consumes
 *               nothing. The aggregate bucket and the per-tool bucket for the
 *               same tool cannot corrupt each other.
 *   FAIL-CLOSED A bucket that cannot be evaluated refuses the call rather than
 *               admitting it.
 *   GRANT       The rate-limit RPC is not executable by anon, matching every
 *               sibling SECURITY DEFINER function in public/.
 *
 * CONCURRENCY IS REAL, NOT SLEPT ON. Every burst is Promise.all over N
 * independent connections, each in its own transaction, so the calls genuinely
 * contend for the same row. There are no sleeps and no timing assumptions: the
 * assertions are on the allowance each call RETURNED and on the durable
 * request_count, never on the absence of an error. A lost update shows up as
 * an extra allowed=true or as a counter below the call count, and both are
 * asserted.
 *
 * Usage:
 *   node scripts/db/mcp-rate-limit-concurrency-verify.mjs --url <postgres-url>
 *
 * The database identified by --url is destroyed by this script (DROP SCHEMA
 * public/auth/automation CASCADE). Only point it at a throwaway database.
 */
import { readFile } from "node:fs/promises";
import { argv, exit } from "node:process";

import postgres from "postgres";

const DRIZZLE_DIR = new URL("../../drizzle/", import.meta.url);
const REGISTRY_FILE = new URL(
  "../../apps/web/src/lib/mcp/capability-registry.ts",
  import.meta.url,
);
const RATE_LIMIT_REPOSITORY_FILE = new URL(
  "../../apps/web/src/lib/mcp/rate-limit-repository.ts",
  import.meta.url,
);

// Burst sizing. Two shapes, both sized against max_connections so the harness
// never exceeds it.
//
// STRADDLING: BURST_WIDTH calls fire at once once the bucket has been burned
// down to BURST_REFUSALS. Both outcomes are therefore produced BY contention -
// some concurrent calls win the remaining allowance and the rest are refused.
// This is the shape that catches a non-atomic counter, because every caller
// computes its decision from the counter it read.
//
// HEADROOM: a smaller burst against an empty bucket, which additionally covers
// the concurrent INSERT path that has to create the row for the first time.
const BURST_WIDTH = 24;
const BURST_REFUSALS = 10;
const HEADROOM_BURST_WIDTH = 16;
const CONCURRENT_CONNECTIONS = 40;

// HOW A MEASUREMENT IS KEPT INSIDE ONE WINDOW.
//
// The limiter counts per fixed 60s window, so a sample split across a boundary
// is meaningless rather than wrong: the counter legitimately resets. The obvious
// fix - predict how long the sample will take and wait for a window with enough
// room - is machine-dependent and flaked here, because the per-call cost differs
// by an order of magnitude between "one statement in a transaction" (~9ms) and
// "its own transaction" (~130ms of commit), and drifts with load.
//
// So the proof does not predict. It samples, then checks whether the window
// identity held either side of the sample, and re-takes the sample if it did
// not. This is NOT retry-until-green: the retry discards a sample that a
// rollover contaminated and takes a fresh one, bounded by MAX_MEASUREMENT_ATTEMPTS,
// and it triggers on the window boundary alone - never on a result. Every
// limiter assertion is evaluated only on a sample proven to sit inside a single
// window, so a retry cannot convert a defect into a pass. A non-atomic counter
// cannot roll a window, which is why break (a) is still caught rather than
// absorbed by this loop.
const MAX_MEASUREMENT_ATTEMPTS = 4;
// Enough room to begin comfortably. Not a prediction of sample duration -
// anything that still overruns is caught by the window-identity check.
const MIN_WINDOW_HEADROOM_SECONDS = 5;

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
  // Migration 0043 requires exactly one reconciliation owner row to exist.
  await sql.unsafe(`
    INSERT INTO auth.users (id, email)
    VALUES ('11111111-1111-4111-8111-111111111111'::uuid, 'ab.mortaki@gmail.com')
    ON CONFLICT (id) DO NOTHING;
  `);
  // GUC-backed auth stubs so the proof can act as an authenticated MCP session:
  // each proof transaction sets request.jwt.claim.sub / request.jwt.claims with
  // set_config(..., is_local => true) instead of ALTER FUNCTION stubs.
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
  // Migrations 0035+ alter automation.implementation_runs additively and
  // document that its base table predates the journal ("already exist in
  // production via manual/supabase setup"). The proof harness stands in the
  // Runner's documented base columns so those additive migrations and their
  // indexes still apply end-to-end.
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
const CLIENT_A = "concurrency-client-a";
const CLIENT_B = "concurrency-client-b";
const RESOURCE_URI = "https://ega.example.com/api/mcp";
const OTHER_RESOURCE_URI = "https://other.example.com/api/mcp";

const GRANT_A = "55555555-5555-4555-8555-5555555555a1";
const GRANT_B = "55555555-5555-4555-8555-5555555555a2";
const GRANT_CLIENT_B = "55555555-5555-4555-8555-5555555555a4";
const GRANT_REVOKED = "55555555-5555-4555-8555-5555555555a3";

const READ_ONLY_PERMISSIONS = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "today.read",
  "timer.read",
];

// A registered read capability and a registered sensitive_write capability.
// Both names are asserted against the registry below, so a rename in the
// registry fails this proof rather than silently testing a nonexistent bucket.
const READ_TOOL = "ega_list_projects";
const SENSITIVE_WRITE_TOOL = "ega_clear_completed_today";

/**
 * Parses the shipped policy out of the canonical sources instead of restating
 * it. The allowance lives in a plpgsql CASE inside a migration, the risk classes
 * live in the registry, and the reserved aggregate prefix lives in the
 * repository, so all three are read from the files that own them.
 */
async function readShippedPolicy() {
  const rateLimitMigration = await readFile(
    new URL("0071_mcp_rate_limit_and_fence_classification.sql", DRIZZLE_DIR),
    "utf8",
  );

  // v_limit := CASE WHEN p_window_name = 'ega_aggregate_read' THEN 600 ... ELSE 120 END
  const limitCase = rateLimitMigration.match(
    /v_limit\s*:=\s*CASE([\s\S]*?)END;/,
  );
  assert(limitCase, "drizzle/0071 no longer contains the rate-limit allowance CASE");

  const aggregateLimits = new Map();
  for (const match of limitCase[1].matchAll(
    /WHEN\s+p_window_name\s*=\s*'([a-z0-9_]+)'\s*THEN\s*(\d+)/g,
  )) {
    aggregateLimits.set(match[1], Number(match[2]));
  }
  const defaultLimit = limitCase[1].match(/ELSE\s+(\d+)/);
  assert(defaultLimit, "drizzle/0071 no longer has a default per-tool allowance");
  const perToolLimit = Number(defaultLimit[1]);

  const windowSeconds = rateLimitMigration.match(
    /v_window_seconds\s+constant\s+integer\s*:=\s*(\d+)/,
  );
  assert(windowSeconds, "drizzle/0071 no longer declares a fixed window length");

  const windowNamePattern = rateLimitMigration.match(
    /p_window_name\s+!~\s*'([^']+)'/,
  );
  assert(windowNamePattern, "drizzle/0071 no longer validates the window name");

  const registry = await readFile(REGISTRY_FILE, "utf8");
  const rateClassUnion = registry.match(/export type McpRateClass =([\s\S]*?);/);
  assert(rateClassUnion, "capability-registry.ts no longer declares McpRateClass");
  const rateClasses = [...rateClassUnion[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert(rateClasses.length > 0, "McpRateClass has no members");

  const repository = await readFile(RATE_LIMIT_REPOSITORY_FILE, "utf8");
  const aggregatePrefix = repository.match(
    /MCP_AGGREGATE_BUCKET_PREFIX\s*=\s*"([^"]+)"/,
  );
  assert(aggregatePrefix, "rate-limit-repository.ts no longer declares the aggregate prefix");

  // Every risk class the registry can produce must have a configured bucket.
  // A new risk class with no server-side threshold would otherwise fall through
  // to the per-tool allowance and ship an unbounded aggregate by omission.
  const missingBuckets = rateClasses.filter(
    (rateClass) => !aggregateLimits.has(`${aggregatePrefix[1]}${rateClass}`),
  );
  assert(
    missingBuckets.length === 0,
    `every McpRateClass needs a server-side aggregate threshold; missing: ${missingBuckets
      .map((rateClass) => `${aggregatePrefix[1]}${rateClass}`)
      .join(", ")}`,
  );

  // The tool names under test must really exist, in the class under test.
  assert(
    registry.includes(`read("${READ_TOOL}"`),
    `${READ_TOOL} is not a registered read capability`,
  );
  assert(
    registry.includes(`write("${SENSITIVE_WRITE_TOOL}"`),
    `${SENSITIVE_WRITE_TOOL} is not a registered write capability`,
  );
  assert(
    new RegExp(
      `write\\("${SENSITIVE_WRITE_TOOL}"[\\s\\S]{0,400}?rateClass:\\s*"sensitive_write"`,
    ).test(registry),
    `${SENSITIVE_WRITE_TOOL} is no longer a sensitive_write capability`,
  );

  log(
    "POLICY-SOURCE",
    `Read from drizzle/0071 + capability-registry.ts: per-tool=${perToolLimit}/${windowSeconds[1]}s, aggregates=${JSON.stringify(
      Object.fromEntries(aggregateLimits),
    )}, classes=${rateClasses.join("/")}, prefix=${aggregatePrefix[1]}`,
  );

  return {
    perToolLimit,
    windowSeconds: Number(windowSeconds[1]),
    windowNamePattern: new RegExp(windowNamePattern[1]),
    aggregateLimits,
    rateClasses,
    aggregatePrefix: aggregatePrefix[1],
  };
}

function aggregateBucketName(policy, rateClass) {
  return `${policy.aggregatePrefix}${rateClass}`;
}

async function seedGrants(sql) {
  const grants = [
    { id: GRANT_A, owner: OWNER_A, client: CLIENT_A, status: "active", revoked: null },
    { id: GRANT_B, owner: OWNER_B, client: CLIENT_A, status: "active", revoked: null },
    { id: GRANT_CLIENT_B, owner: OWNER_A, client: CLIENT_B, status: "active", revoked: null },
    {
      id: GRANT_REVOKED,
      owner: OWNER_A,
      client: "concurrency-revoked-client",
      status: "revoked",
      revoked: "2026-08-30T00:00:00.000Z",
    },
  ];
  for (const grant of grants) {
    await sql.unsafe(
      `INSERT INTO public.mcp_authorization_grants
         (id, owner_user_id, oauth_client_id, resource_uri, client_name, status,
          permission_profile, permissions, permissions_version, revoked_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'Concurrency fixture', $5,
               'read_only', $6::jsonb, 1, $7::timestamptz)`,
      [
        grant.id,
        grant.owner,
        grant.client,
        RESOURCE_URI,
        grant.status,
        sql.json(READ_ONLY_PERMISSIONS),
        grant.revoked,
      ],
    );
  }
  log(
    "SEED",
    `Active grants inserted for owner-A/${CLIENT_A}, owner-B/${CLIENT_A}, owner-A/${CLIENT_B}, plus one revoked grant`,
  );
}

/**
 * Runs `fn` in one transaction carrying a transaction-local MCP auth context,
 * matching how the RPC reads auth.uid()/auth.jwt() in Supabase. `pool` is a
 * parameter so a burst can hand every concurrent call its own connection.
 */
function mcpSession(pool, { userId = OWNER_A, clientId = CLIENT_A, resource = RESOURCE_URI } = {}) {
  return (fn) =>
    pool.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE authenticated`);
      if (userId) {
        await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      }
      if (userId && clientId && resource) {
        await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ client_id: clientId, aud: resource }),
        ]);
      }
      return fn(tx);
    });
}

// Returns TABLE(allowed, retry_after_seconds), so select * gives named columns.
function consume(tx, windowName) {
  return tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit($1)`, [windowName]);
}

async function capturePostgresError(fn) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error?.code ?? null;
  }
}

async function bucketRow(sql, { userId = OWNER_A, clientId = CLIENT_A, windowName }) {
  const [row] = await sql.unsafe(
    `SELECT request_count, window_started_at
     FROM public.mcp_rate_limit_windows
     WHERE owner_user_id = $1::uuid AND oauth_client_id = $2 AND tool_name = $3`,
    [userId, clientId, windowName],
  );
  return row;
}

async function resetBucket(sql, { userId = OWNER_A, clientId = CLIENT_A, windowName }) {
  await sql.unsafe(
    `DELETE FROM public.mcp_rate_limit_windows
     WHERE owner_user_id = $1::uuid AND oauth_client_id = $2 AND tool_name = $3`,
    [userId, clientId, windowName],
  );
}

/**
 * Seconds left in the CURRENT fixed window. Used only to decide whether to wait
 * before sampling; whether a sample actually stayed inside one window is decided
 * by comparing currentWindowStart() either side of it.
 */
async function secondsLeftInWindow(sql, windowSeconds) {
  const [row] = await sql.unsafe(
    `SELECT ($1::integer - (extract(epoch FROM clock_timestamp())::numeric % $1::integer))::float8 AS left`,
    [windowSeconds],
  );
  return Number(row.left);
}

/**
 * The fixed window the RPC itself derives, computed with the same expression so
 * the proof compares against the shipped alignment rather than an assumed one.
 */
async function currentWindowStart(sql, windowSeconds) {
  const [row] = await sql.unsafe(
    `SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp()) / $1::integer) * $1::integer) AS start`,
    [windowSeconds],
  );
  return row.start;
}

/**
 * Waits, if necessary, for the current fixed window to have `neededSeconds` of
 * room left so a measurement can begin with space to work in.
 *
 * This is SCHEDULING, NOT EVIDENCE, and correctness does not depend on it. It
 * cannot promise a measurement will finish before the boundary - only the
 * window-identity check taken either side of each sample can, and a sample that
 * still overruns is re-taken (see MAX_MEASUREMENT_ATTEMPTS). Nothing about the
 * limiter's behaviour is inferred from this wait; it exists so most samples
 * start with room, so a run beginning just after a boundary does not pay for a
 * doomed first attempt on every scenario.
 */
async function alignToFreshWindow(sql, windowSeconds, neededSeconds, label) {
  const left = await secondsLeftInWindow(sql, windowSeconds);
  if (left > neededSeconds) return left;
  log(
    "WINDOW-ALIGN",
    `${label}: only ${left.toFixed(1)}s left in the current ${windowSeconds}s window; waiting ${(left + 0.2).toFixed(1)}s for a fresh one so the measurement starts with room.`,
  );
  await sql.unsafe(`SELECT pg_sleep($1)`, [Number((left + 0.2).toFixed(2))]);
  const after = await secondsLeftInWindow(sql, windowSeconds);
  assert(
    after > neededSeconds,
    `${label}: after waiting for a fresh window only ${after.toFixed(1)}s remained (needed >${neededSeconds}s)`,
  );
  return after;
}

/**
 * THE CORE ATOMICITY CLAIM. N calls fired simultaneously, each on its own
 * connection in its own transaction, against one owner/client/bucket.
 *
 * Asserted on what the calls RETURNED, not on the absence of an error:
 *   - successes never exceed the threshold
 *   - refusals are exactly successes' complement (no silent success)
 *   - the durable counter equals the number of calls, so no increment was lost
 *     and none was invented
 */
async function proveConcurrentBurst({
  sql,
  pool,
  windowName,
  limit,
  width,
  windowSeconds,
  label,
  // Calls to consume BEFORE the burst, so the burst straddles the threshold
  // instead of sitting entirely under it. Without this every concurrent call is
  // admitted and the refusal half of the limiter is never exercised under
  // contention, which is the half that matters.
  preConsume = 0,
  sessionOptions = {},
}) {
  const session = mcpSession(pool, sessionOptions);

  // TAKE A SAMPLE, THEN CHECK IT LIES INSIDE ONE WINDOW, THEN JUDGE IT.
  //
  // A window rollover invalidates a sample rather than refuting it: the counter
  // legitimately resets, so the durable count stops describing these calls and
  // the refusal indices carry no verdict. Predicting the rollover away with a
  // wall-clock estimate does not work - the estimate drifts with machine load,
  // and the cost of one RPC differs by an order of magnitude depending on
  // whether it shares a transaction (~9ms) or commits on its own (~130ms). So
  // the proof does not predict: it samples, compares the window identity either
  // side of the sample, and re-takes the sample if they differ.
  //
  // This is NOT retry-until-green. A retry replaces a sample that carried no
  // verdict at all; it is bounded by MAX_MEASUREMENT_ATTEMPTS; and it triggers only
  // on the window boundary, which is observed rather than inferred from any
  // result. A non-atomic counter cannot make a window roll, so no real defect
  // can hide behind a retry - which is why break (a) is still caught rather than
  // absorbed. Every assertion below runs only on a sample proven to sit inside a
  // single window.
  for (let attempt = 1; attempt <= MAX_MEASUREMENT_ATTEMPTS; attempt += 1) {
    // Ask for a little room so a rollover is unlikely. This is an optimisation
    // only: correctness comes from the window-identity check below, not here.
    await alignToFreshWindow(sql, windowSeconds, MIN_WINDOW_HEADROOM_SECONDS, label);
    const windowAtStart = await currentWindowStart(sql, windowSeconds);

    await resetBucket(sql, { windowName, ...sessionOptions });

    // Burn the head of the allowance sequentially so the concurrent burst starts
    // just below the threshold and its refusals are produced BY contention,
    // which is the only way the refusal half of the limiter gets exercised.
    //
    // The warm-up runs as sequential statements inside ONE transaction. Each call
    // in its own transaction costs ~130ms of commit overhead, so the 590-call
    // warm-up the 600/min aggregate needs would take 76s and could not fit
    // inside a 60s window at all; sharing a transaction costs ~9ms each and
    // advances the counter identically. Only the BURST needs independent
    // transactions, because only the burst has to contend.
    if (preConsume > 0) {
      const warmup = await session(async (tx) => {
        const rows = [];
        for (let i = 0; i < preConsume; i += 1) {
          rows.push((await consume(tx, windowName))[0]);
        }
        return rows;
      });
      const firstWarmupRefusal = warmup.findIndex((row) => row?.allowed === false);
      assert(
        firstWarmupRefusal === -1,
        `${label}: warm-up call ${firstWarmupRefusal + 1} of ${preConsume} was refused, so the bucket cannot be filled to the intended head and the burst would not straddle the threshold`,
      );
    }

    const outcomes = await Promise.all(
      Array.from({ length: width }, () => session((tx) => consume(tx, windowName))),
    );

    const windowAtEnd = await currentWindowStart(sql, windowSeconds);
    if (windowAtStart.getTime() !== windowAtEnd.getTime()) {
      log(
        "WINDOW-ALIGN",
        `${label}: sample ${attempt} straddled a window boundary (${windowAtStart.toISOString()} -> ${windowAtEnd.toISOString()}), so it carries no verdict; re-taking it inside a fresh window.`,
      );
      continue;
    }

    await judgeBurstSample({ sql, outcomes, windowName, limit, width, preConsume, label, sessionOptions });
    return;
  }
  assert(
    false,
    `${label}: no sample fit inside one ${windowSeconds}s window after ${MAX_MEASUREMENT_ATTEMPTS} attempts; the burst is too wide or the window too short to measure it`,
  );
}

// Kept separate from the sampling loop so it is structurally impossible to run
// these assertions against a sample that straddled a window.
async function judgeBurstSample({ sql, outcomes, windowName, limit, width, preConsume, label, sessionOptions }) {
  const allowed = outcomes.filter((row) => row[0]?.allowed === true).length;
  const refused = outcomes.filter((row) => row[0]?.allowed === false).length;
  const malformed = outcomes.filter(
    (row) => typeof row[0]?.allowed !== "boolean" || !Number.isInteger(row[0]?.retry_after_seconds),
  );

  assert(
    malformed.length === 0,
    `${label}: ${malformed.length} call(s) returned a malformed allowance; the assertion must be made on the returned allowance`,
  );
  assert(
    allowed <= limit,
    `${label}: ${allowed} concurrent calls were admitted but the threshold is ${limit}; the counter is not atomic`,
  );
  assert(
    allowed + refused === width,
    `${label}: ${allowed} allowed + ${refused} refused != ${width} calls issued`,
  );

  // With a warm-up of `preConsume`, the budget left for the burst is
  // limit - preConsume. Anything above that must be refused. When
  // preConsume is 0 the whole allowance is available and the burst simply has
  // to fit under it; both shapes are legitimate, so the invariant is only that
  // the burst cannot be admitted beyond the remaining budget.
  const remaining = limit - preConsume;
  assert(
    remaining >= 0,
    `${label}: warm-up consumed ${preConsume} of a ${limit} allowance; the scenario is misconfigured`,
  );
  const expectedAllowed = Math.min(width, remaining);
  assert(
    allowed === expectedAllowed,
    `${label}: with ${preConsume} call(s) already consumed, the ${width}-call burst must admit exactly ${expectedAllowed} and refuse ${width - expectedAllowed} at threshold ${limit}; it admitted ${allowed} and refused ${refused}`,
  );

  const row = await bucketRow(sql, { windowName, ...sessionOptions });
  assert(row, `${label}: no durable bucket row was written`);
  assert(
    Number(row.request_count) === preConsume + width,
    `${label}: durable request_count is ${row.request_count} for ${preConsume} warm-up + ${width} burst calls; a lost update (or an invented one) means the counter is not atomic`,
  );

  // A refusal must carry actionable retry timing; that is the value a client
  // uses to back off, so a refusal that reported 0 would be a real defect.
  const retryValues = outcomes
    .filter((r) => r[0]?.allowed === false)
    .map((r) => Number(r[0]?.retry_after_seconds));
  for (const retry of retryValues) {
    assert(
      retry > 0 && retry <= 60,
      `${label}: refused call reported retry_after_seconds=${retry}, expected a positive value within the window`,
    );
  }

  log(
    "CONCURRENCY",
    `${label}: ${width} simultaneous calls on independent connections (after ${preConsume} warm-up calls) admitted exactly ${allowed} and refused ${refused} at threshold ${limit}; durable request_count=${row.request_count}.`,
  );
  return { allowed, refused };
}

/**
 * The threshold bites at its configured value. Sequential, inside one window,
 * on one connection: the refusal INDEX is the configured allowance. This is the
 * discriminator the mutation proof uses, because a caller-supplied limit or an
 * off-by-one moves that index.
 */
async function proveThresholdIndex({
  sql,
  pool,
  windowName,
  limit,
  windowSeconds,
  label,
  sessionOptions = {},
}) {
  const session = mcpSession(pool, sessionOptions);

  // Sample, then confirm the sample lies inside one window, then read the index.
  // A rollover invalidates the sweep rather than refuting it, so the sweep is
  // re-taken - see MAX_MEASUREMENT_ATTEMPTS for why this is not retry-until-green.
  for (let attempt = 1; attempt <= MAX_MEASUREMENT_ATTEMPTS; attempt += 1) {
    await alignToFreshWindow(sql, windowSeconds, MIN_WINDOW_HEADROOM_SECONDS, label);
    await resetBucket(sql, { windowName, ...sessionOptions });
    const windowAtStart = await currentWindowStart(sql, windowSeconds);

    const outcomes = await session(async (tx) => {
      const rows = [];
      // Sweep a few calls PAST the threshold. At the shipped boundary the first
      // refusal is call limit+1, so the overshoot is never reached; it is there
      // so a boundary that is one call too generous reports the exact wrong index
      // instead of only "no refusal was observed".
      for (let i = 0; i <= limit + 4; i += 1) {
        rows.push((await consume(tx, windowName))[0]);
      }
      return rows;
    });

    const windowAtEnd = await currentWindowStart(sql, windowSeconds);
    if (windowAtStart.getTime() !== windowAtEnd.getTime()) {
      log(
        "WINDOW-ALIGN",
        `${label}: sweep ${attempt} straddled a window boundary (${windowAtStart.toISOString()} -> ${windowAtEnd.toISOString()}), so the refusal index carries no verdict; re-sweeping inside a fresh window.`,
      );
      continue;
    }

    judgeRefusalIndex(outcomes, limit, label);
    return;
  }
  assert(
    false,
    `${label}: no sweep fit inside one ${windowSeconds}s window after ${MAX_MEASUREMENT_ATTEMPTS} attempts`,
  );
}

// Separate from the sampling loop so the index can only ever be read from a
// sample proven to sit inside a single window.
function judgeRefusalIndex(outcomes, limit, label) {
  const refusedIndex = outcomes.findIndex((row) => row?.allowed === false);
  assert(
    refusedIndex === limit,
    `${label}: the configured threshold is ${limit}, so the first refusal must be call ${limit + 1} (0-based index ${limit}); it was ${
      refusedIndex === -1
        ? `never observed within ${outcomes.length} calls, so the limit is not being enforced at all`
        : `call ${refusedIndex + 1} (0-based index ${refusedIndex}), which is ${
            refusedIndex === limit + 1 ? "one call too generous" : "at the wrong index"
          }`
    }`,
  );

  for (let i = 0; i < limit; i += 1) {
    assert(
      outcomes[i]?.allowed === true,
      `${label}: call ${i + 1} of the allowed range was refused`,
    );
    assert(
      Number(outcomes[i]?.retry_after_seconds) === 0,
      `${label}: allowed call ${i + 1} must report retry_after_seconds=0`,
    );
  }
  assert(
    Number(outcomes[limit]?.retry_after_seconds) > 0,
    `${label}: the refusing call must report a positive retry_after_seconds`,
  );

  log(
    "THRESHOLD",
    `${label}: admitted calls 1..${limit} and refused call ${limit + 1} exactly at the configured threshold.`,
  );
}

/**
 * FAIL CLOSED. Whenever the RPC cannot evaluate the bucket it was asked about,
 * it must raise rather than return an allowance. A returned `allowed` is the
 * only thing the repository treats as "this call may proceed", so a bucket the
 * limiter could not evaluate but still admitted would be an unbounded-throughput
 * outage wearing a limiter's clothes.
 *
 * Three distinct unusable-input conditions are proven to raise:
 *   - no verified identity      -> 42501 (also covered in the isolation phase)
 *   - a malformed window name   -> 22023
 *   - no active grant           -> 42501 (also covered in the isolation phase)
 *
 * The unconfigured-aggregate case is bounded rather than refused, and that is
 * asserted explicitly instead of being left implicit. A name in the reserved
 * `ega_aggregate_` namespace that the policy does not define falls through the
 * CASE expression to the per-tool allowance. That is bounded (never unlimited),
 * and it is unreachable from the application because the repository derives the
 * bucket name from the registry rather than from input - but "bounded" is a
 * weaker property than "refused", so the proof states which one holds rather
 * than implying the stronger one.
 */
async function proveFailsClosed({ sql, pool, policy }) {
  const session = mcpSession(pool);

  // A window name the RPC cannot interpret. It must raise, not admit.
  const invalid = await capturePostgresError(() => session((tx) => consume(tx, "Not A Window")));
  assert(
    invalid === "22023",
    `a malformed window name must be refused with 22023 rather than admitted, got ${invalid}`,
  );
  const empty = await capturePostgresError(() => session((tx) => consume(tx, "")));
  assert(
    empty === "22023",
    `an empty window name must be refused with 22023 rather than admitted, got ${empty}`,
  );

  // No verified identity at all.
  const anonymous = mcpSession(pool, { userId: null });
  const anonError = await capturePostgresError(() => anonymous((tx) => consume(tx, READ_TOOL)));
  assert(
    anonError === "42501",
    `a call with no verified identity must be refused with 42501 rather than admitted, got ${anonError}`,
  );

  // No active grant for this (owner, client, resource).
  const noGrant = mcpSession(pool, { userId: OWNER_A, clientId: "concurrency-no-grant-client" });
  const noGrantError = await capturePostgresError(() => noGrant((tx) => consume(tx, READ_TOOL)));
  assert(
    noGrantError === "42501",
    `a client with no grant must be refused with 42501 rather than admitted, got ${noGrantError}`,
  );

  // None of those refusals may have left a bucket behind. A refusal that still
  // consumes is not a refusal. Measured per identity, because a refusal for the
  // anonymous context has no owner to key on.
  const [ungrantedRow] = await sql.unsafe(
    `SELECT count(*)::int AS count FROM public.mcp_rate_limit_windows
     WHERE oauth_client_id = 'concurrency-no-grant-client'`,
  );
  assert(
    Number(ungrantedRow.count) === 0,
    `a refused call created ${ungrantedRow.count} bucket row(s) for a client with no grant`,
  );
  await resetBucket(sql, { windowName: READ_TOOL, clientId: CLIENT_A });
  await anonymous((tx) => consume(tx, READ_TOOL)).catch(() => null);
  const anonRow = await bucketRow(sql, { windowName: READ_TOOL, clientId: CLIENT_A });
  assert(
    !anonRow || Number(anonRow.request_count) === 0,
    `an anonymous call consumed ${anonRow?.request_count} unit(s) of owner A's real bucket`,
  );

  // The reserved aggregate namespace: a name the policy does not configure is
  // bounded by the per-tool allowance, never unlimited. Measured by sweeping it
  // to its own refusal index, with the same single-window discipline as every
  // other sweep here.
  const unconfigured = `${policy.aggregatePrefix}not_a_configured_class`;
  let unconfiguredRefusedIndex = null;
  for (let attempt = 1; attempt <= MAX_MEASUREMENT_ATTEMPTS; attempt += 1) {
    await alignToFreshWindow(sql, policy.windowSeconds, MIN_WINDOW_HEADROOM_SECONDS, `unconfigured bucket ${unconfigured}`);
    await resetBucket(sql, { windowName: unconfigured });
    const windowAtStart = await currentWindowStart(sql, policy.windowSeconds);

    const sweep = await session(async (tx) => {
      const rows = [];
      for (let i = 0; i <= policy.perToolLimit; i += 1) {
        rows.push((await consume(tx, unconfigured))[0]);
      }
      return rows;
    });

    const windowAtEnd = await currentWindowStart(sql, policy.windowSeconds);
    if (windowAtStart.getTime() !== windowAtEnd.getTime()) {
      log(
        "WINDOW-ALIGN",
        `${unconfigured}: sweep ${attempt} straddled a window boundary, so the refusal index carries no verdict; re-sweeping.`,
      );
      continue;
    }
    unconfiguredRefusedIndex = sweep.findIndex((row) => row?.allowed === false);
    break;
  }
  assert(
    unconfiguredRefusedIndex !== null,
    `${unconfigured}: no sweep fit inside one ${policy.windowSeconds}s window after ${MAX_MEASUREMENT_ATTEMPTS} attempts`,
  );
  assert(
    unconfiguredRefusedIndex === policy.perToolLimit,
    `${unconfigured} must be bounded by the per-tool allowance ${policy.perToolLimit} (first refusal at 0-based ${unconfiguredRefusedIndex}), not left unlimited`,
  );

  log(
    "FAIL-CLOSED",
    `Malformed, anonymous and ungranted calls all raised (22023/42501) and created no bucket; the unconfigured aggregate name ${unconfigured} is bounded by the per-tool allowance ${policy.perToolLimit} rather than being unlimited.`,
  );
}

async function proveIsolation(sql, pool, policy) {
  const sessionA = mcpSession(pool, { userId: OWNER_A, clientId: CLIENT_A });
  const sessionB = mcpSession(pool, { userId: OWNER_B, clientId: CLIENT_A });
  const otherClient = mcpSession(pool, { userId: OWNER_A, clientId: CLIENT_B });
  const revoked = mcpSession(pool, { userId: OWNER_A, clientId: "concurrency-revoked-client" });
  const wrongResource = mcpSession(pool, { userId: OWNER_A, clientId: CLIENT_A, resource: OTHER_RESOURCE_URI });
  const anonymous = mcpSession(pool, { userId: null });

  const readAggregate = aggregateBucketName(policy, "read");

  // 1. Different client_id is a different bucket. Exhaust owner A's aggregate
  //    for CLIENT_A, then prove CLIENT_B's window is untouched.
  await resetBucket(sql, { windowName: readAggregate, clientId: CLIENT_A });
  await resetBucket(sql, { windowName: readAggregate, clientId: CLIENT_B });
  for (let i = 0; i < 5; i += 1) {
    await sessionA((tx) => consume(tx, readAggregate));
  }
  const afterOtherClient = await otherClient((tx) => consume(tx, readAggregate));
  assert(
    afterOtherClient[0]?.allowed === true,
    "a different client_id must be a different rate-limit bucket",
  );
  const clientBRow = await bucketRow(sql, { windowName: readAggregate, clientId: CLIENT_B });
  assert(
    Number(clientBRow?.request_count) === 1,
    `client B's bucket recorded ${clientBRow?.request_count} calls; buckets must not share state across client_id`,
  );
  log("ISOLATION", "A different client_id consumed its own bucket; owner A's five calls did not touch it.");

  // 2. Different owner is a different bucket. OWNER_B shares CLIENT_A, so only
  //    the owner differs from the five owner-A calls above.
  const afterOtherOwner = await sessionB((tx) => consume(tx, readAggregate));
  assert(
    afterOtherOwner[0]?.allowed === true,
    "a different owner must be a different rate-limit bucket",
  );
  const ownerBRow = await bucketRow(sql, {
    userId: OWNER_B,
    windowName: readAggregate,
  });
  assert(
    Number(ownerBRow?.request_count) === 1,
    `owner B's bucket recorded ${ownerBRow?.request_count} calls; buckets must not share state across owner`,
  );
  log("ISOLATION", "A different owner consumed its own bucket under the same client_id and resource.");

  // 3. A revoked grant can neither consume nor benefit.
  const revokedError = await capturePostgresError(() => revoked((tx) => consume(tx, READ_TOOL)));
  assert(
    revokedError === "42501",
    `a revoked grant must be refused with 42501, got ${revokedError}`,
  );
  const revokedRow = await bucketRow(sql, {
    windowName: READ_TOOL,
    clientId: "concurrency-revoked-client",
  });
  assert(
    !revokedRow,
    "a revoked grant must not create a rate-limit row; a refusal that still consumes is not a refusal",
  );
  log("ISOLATION", "A revoked grant was refused with 42501 and created no bucket row.");

  // 4. A wrong aud is refused entirely and consumes nothing. Measured against a
  //    bucket emptied first, so the assertion is about what the wrong-aud call
  //    itself did rather than about residue from an earlier scenario.
  await resetBucket(sql, { windowName: READ_TOOL, clientId: CLIENT_A });
  const wrongAudError = await capturePostgresError(() => wrongResource((tx) => consume(tx, READ_TOOL)));
  assert(
    wrongAudError === "42501",
    `a wrong aud must be refused with 42501, got ${wrongAudError}`,
  );
  const wrongAudRow = await bucketRow(sql, { windowName: READ_TOOL, clientId: CLIENT_A });
  assert(
    !wrongAudRow || Number(wrongAudRow.request_count) === 0,
    `a wrong aud consumed ${wrongAudRow?.request_count} unit(s) of owner A's real bucket`,
  );
  log("ISOLATION", "A wrong aud was refused with 42501 and consumed nothing in the real bucket.");

  // 5. No auth context at all is refused.
  const anonymousError = await capturePostgresError(() => anonymous((tx) => consume(tx, READ_TOOL)));
  assert(
    anonymousError === "42501",
    `an anonymous call must be refused with 42501, got ${anonymousError}`,
  );

  // 6. The aggregate bucket and the per-tool bucket for the same tool cannot
  //    corrupt each other. Both are rows in one table distinguished only by
  //    tool_name, so prove they are counted independently.
  const sensitiveAggregate = aggregateBucketName(policy, "sensitive_write");
  await resetBucket(sql, { windowName: SENSITIVE_WRITE_TOOL });
  await resetBucket(sql, { windowName: sensitiveAggregate });
  for (let i = 0; i < 3; i += 1) {
    await sessionA((tx) => consume(tx, SENSITIVE_WRITE_TOOL));
  }
  const [aggregateFirst] = await sessionA((tx) => consume(tx, sensitiveAggregate));
  assert(
    aggregateFirst?.allowed === true,
    "the aggregate bucket must start empty even after the per-tool bucket was consumed",
  );
  const toolRow = await bucketRow(sql, { windowName: SENSITIVE_WRITE_TOOL });
  const aggregateRow = await bucketRow(sql, { windowName: sensitiveAggregate });
  assert(
    Number(toolRow?.request_count) === 3 && Number(aggregateRow?.request_count) === 1,
    `per-tool=${toolRow?.request_count} aggregate=${aggregateRow?.request_count}; the two buckets must be counted independently`,
  );
  assert(
    toolRow?.window_started_at?.getTime() === aggregateRow?.window_started_at?.getTime(),
    "both buckets must be in the same fixed window; differing windows would hide a keying defect",
  );
  log(
    "ISOLATION",
    `The per-tool and aggregate buckets for ${SENSITIVE_WRITE_TOOL} counted independently (3 and 1) inside one shared window.`,
  );
}

/**
 * The rate limiter must not be reachable by anon. Every other SECURITY DEFINER
 * function in public/ revokes it, and 0071's signature change left the surviving
 * function with the default PUBLIC EXECUTE. See drizzle/0076.
 */
async function proveExecuteGrant(sql) {
  const rows = await sql`
    SELECT p.oid::regprocedure::text AS signature,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_may_execute,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_may_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
    ORDER BY 1
  `;
  const rateLimiter = rows.find((row) => row.signature.startsWith("consume_mcp_rate_limit"));
  assert(rateLimiter, "consume_mcp_rate_limit is no longer a SECURITY DEFINER function");
  assert(
    rateLimiter.anon_may_execute === false,
    "anon must not be able to EXECUTE the MCP rate limiter; every other SECURITY DEFINER function in public/ revokes it",
  );
  assert(
    rateLimiter.authenticated_may_execute === true,
    "authenticated must retain EXECUTE on the MCP rate limiter or every MCP tool call breaks",
  );
  const leaked = rows.filter((row) => row.anon_may_execute === true);
  assert(
    leaked.length === 0,
    `anon can EXECUTE SECURITY DEFINER function(s) ${leaked.map((r) => r.signature).join(", ")}`,
  );
  log(
    "GRANT",
    `consume_mcp_rate_limit(text) is executable by authenticated and not by anon, and no SECURITY DEFINER function in public/ leaks EXECUTE to anon (${rows.length} checked).`,
  );
}

/**
 * A revoked grant must not be able to reach the rate limiter even if it could
 * set the identity GUCs itself. This is the defence-in-depth claim that the
 * GRANT above restores: with EXECUTE revoked, an unauthenticated role cannot
 * invoke the function at all, so the function's own identity check is no longer
 * the only control.
 */
async function proveAnonCannotForge(sql) {
  const error = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE anon`);
    await tx.unsafe(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [OWNER_A]);
    await tx.unsafe(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ client_id: CLIENT_A, aud: RESOURCE_URI }),
    ]);
    await tx.unsafe(`SELECT * FROM public.consume_mcp_rate_limit($1)`, [READ_TOOL]);
    return null;
  }).catch((cause) => cause?.code ?? "NO_ERROR");
  assert(
    error === "42501",
    `anon must not be able to invoke the rate limiter even after forging the identity GUCs; got ${error}`,
  );
  const row = await bucketRow(sql, { windowName: READ_TOOL });
  assert(
    !row,
    `a forged anon call must consume nothing; it recorded ${row?.request_count} unit(s) in owner A's bucket`,
  );
  log(
    "GRANT",
    "anon could not invoke the rate limiter even after setting request.jwt.claim.sub and request.jwt.claims to a real owner's identity.",
  );
}

async function main() {
  const { url } = parseArgs();
  const tags = await readJournal();
  assert(
    tags.includes("0071_mcp_rate_limit_and_fence_classification"),
    "journal does not contain 0071_mcp_rate_limit_and_fence_classification",
  );

  const policy = await readShippedPolicy();

  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await resetDatabase(sql);
    await applySupabaseShim(sql);
    for (const tag of tags) {
      await applyFile(sql, tag);
    }
    log("MIGRATE", `${tags.length} journal migrations applied`);
    await seedGrants(sql);

    // --- threshold enforcement, one window, one bucket -----------------------
    for (const [windowName, limit] of [
      [READ_TOOL, policy.perToolLimit],
      ...[...policy.aggregateLimits.entries()].map(([name, limit]) => [name, limit]),
    ]) {
      await proveThresholdIndex({
        sql,
        pool: sql,
        windowName,
        limit,
        windowSeconds: policy.windowSeconds,
        label: `${windowName} (${limit}/${policy.windowSeconds}s)`,
      });
    }

    // --- genuine concurrency -------------------------------------------------
    // A dedicated pool sized for the widest burst, so every concurrent call
    // really gets its own connection rather than queueing behind one.
    const pool = postgres(url, { max: CONCURRENT_CONNECTIONS, onnotice: () => {} });
    try {
      // Two shapes of burst per bucket, because they fail differently:
      //   STRADDLE - the head of the allowance is burned first, so the burst
      //              spans the boundary and refusals are produced BY contention.
      //              A non-atomic counter admits past the threshold here.
      //   HEADROOM - the burst runs against an empty bucket, so it also covers
      //              the concurrent INSERT path that creates the row.
      for (const [windowName, limit] of [
        [READ_TOOL, policy.perToolLimit],
        ...policy.aggregateLimits.entries(),
      ]) {
        // Leave a head of BURST_REFUSALS below the threshold, so of the
        // BURST_WIDTH concurrent calls exactly BURST_REFUSALS can be admitted
        // and the remaining BURST_WIDTH - BURST_REFUSALS must be refused. That
        // requires the shipped threshold to exceed BURST_REFUSALS, which is
        // asserted rather than assumed.
        assert(
          limit > BURST_REFUSALS,
          `${windowName}: threshold ${limit} is too small to leave a head of ${BURST_REFUSALS} for a straddling burst`,
        );
        await proveConcurrentBurst({
          sql,
          pool,
          windowName,
          limit,
          width: BURST_WIDTH,
          windowSeconds: policy.windowSeconds,
          preConsume: limit - BURST_REFUSALS,
          label: `straddling burst on ${windowName}`,
        });
      }

      for (const [windowName, limit] of [
        [READ_TOOL, policy.perToolLimit],
        ...policy.aggregateLimits.entries(),
      ]) {
        assert(
          HEADROOM_BURST_WIDTH <= limit,
          `headroom burst width ${HEADROOM_BURST_WIDTH} must not exceed the ${limit} threshold of ${windowName}`,
        );
        await proveConcurrentBurst({
          sql,
          pool,
          windowName,
          limit,
          width: HEADROOM_BURST_WIDTH,
          windowSeconds: policy.windowSeconds,
          label: `headroom burst on ${windowName}`,
        });
      }

      await proveIsolation(sql, pool, policy);
      await proveFailsClosed({ sql, pool, policy });
    } finally {
      await pool.end({ timeout: 5 });
    }

    await proveExecuteGrant(sql);
    await proveAnonCannotForge(sql);

    console.log("MCP-RATE-LIMIT-CONCURRENCY-VERIFY PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("[FATAL]", error?.message ?? error);
  exit(1);
});
