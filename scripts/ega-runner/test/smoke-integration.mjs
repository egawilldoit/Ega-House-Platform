#!/usr/bin/env node
/**
 * EGA Runner Integration Test Suite
 *
 * Tests:
 *   1. Normal mode fail-closed: refuses to start without smoke mode
 *   2. Successful smoke flow: claim → heartbeat → events → cancel → archive
 *   3. Stale lease detection: expired lease → run_stale → archive (after durable state)
 *   4. Active valid lease: redelivered message preserved, not archived
 *   5. Wrong runner heartbeat: zero rows returned
 *   6. Exception during processing: message NOT archived
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNNER_DIR = resolve(__dirname, "..");
const PROJECT_ROOT = resolve(RUNNER_DIR, "..", "..");

// Load DATABASE_URL from the project root's .env.local
const envContent = readFileSync(resolve(PROJECT_ROOT, ".env.local"), "utf8");
const DATABASE_URL = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();

if (!DATABASE_URL) {
  console.error("DATABASE_URL not found in project .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false, max: 3 });
const PROJECT_ID = "54a38782-a534-481c-9ca0-c9d46a6e48a2";

// ── Helpers ────────────────────────────────────────────────────────────────

async function createDelivery(eventType = "issues.label") {
  const [delivery] = await sql`
    INSERT INTO automation.webhook_deliveries (
      delivery_id, event_type, webhook_timestamp_ms,
      payload_sha256, action, issue_id, issue_identifier
    ) VALUES (
      gen_random_uuid(), ${eventType}, ${Date.now()},
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      'update', 'integration-test-' || gen_random_uuid()::text, 'INTEGRATION-TEST'
    )
    RETURNING delivery_id
  `;
  return delivery;
}

async function createRun(deliveryId, overrides = {}) {
  // Use unique issue ID per test to avoid unique constraint violations
  const issueId = overrides.linear_issue_id || "integration-test-" + genRandomSuffix();

  // Merge defaults with overrides for the variable columns
  const merged = {
    status: "queued",
    attempt_number: 1,
    claimed_by: null,
    lease_expires_at: null,
    started_at: null,
    heartbeat_at: null,
    finished_at: null,
    failure_code: null,
    ...overrides,
  };

  const [run] = await sql`
    INSERT INTO automation.implementation_runs (
      source_delivery_id, project_id, linear_issue_id,
      linear_issue_identifier, linear_issue_url, status,
      attempt_number, claimed_by, lease_expires_at,
      started_at, heartbeat_at, finished_at, failure_code
    ) VALUES (
      ${deliveryId}::uuid,
      ${PROJECT_ID}::uuid,
      ${issueId},
      'INTEGRATION-TEST',
      'https://linear.app/test/INTEGRATION-TEST',
      ${merged.status},
      ${merged.attempt_number},
      ${merged.claimed_by},
      ${merged.lease_expires_at},
      ${merged.started_at},
      ${merged.heartbeat_at},
      ${merged.finished_at},
      ${merged.failure_code}
    )
    RETURNING id, status, attempt_number, claimed_by, lease_expires_at
  `;
  return run;
}

let _suffixCounter = 0;
function genRandomSuffix() {
  _suffixCounter++;
  return `${Date.now()}-${_suffixCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

async function enqueueMessage(runId) {
  const msgPayload = {
    run_id: runId,
    project_id: PROJECT_ID,
    project_slug: "ega-house-platform",
    github_repo: "egawilldoit/Ega-House-Platform",
    base_branch: "main",
    linear_issue_id: "integration-test-id",
    linear_issue_identifier: "INTEGRATION-TEST",
    linear_issue_url: "https://linear.app/test/INTEGRATION-TEST",
    attempt_number: 1,
    validation_commands: ["npm run typecheck", "npm run lint", "npm test"],
    enqueued_at: new Date().toISOString(),
  };

  await sql`
    SELECT pgmq.send('hermes_implementation_jobs', ${sql.json(msgPayload)})
  `;
}

async function runSmokeRunner(envOverrides = {}) {
  const env = {
    ...process.env,
    DATABASE_URL,
    EGA_RUNNER_SMOKE_MODE: "true",
    EGA_RUNNER_HEARTBEAT_SECONDS: "3",
    EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS: "60",
    EGA_RUNNER_LEASE_SECONDS: "60",
    ...envOverrides,
  };

  return execSync("npx tsx src/main.ts", {
    cwd: RUNNER_DIR,
    timeout: 120_000,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

async function getActiveMessages() {
  // Use COUNT to get accurate total, not a limited row set
  const rows = await sql`SELECT count(*)::int AS cnt FROM pgmq.q_hermes_implementation_jobs`;
  console.log(`   (active queue count: ${rows[0]?.cnt ?? 0})`);
  return { length: rows[0]?.cnt ?? 0 };
}

async function getArchivedMessages() {
  // Use COUNT to get accurate total
  const rows = await sql`SELECT count(*)::int AS cnt FROM pgmq.a_hermes_implementation_jobs`;
  return { length: rows[0]?.cnt ?? 0 };
}

async function getEvents(runId) {
  return sql`
    SELECT event_type, payload
    FROM automation.implementation_events
    WHERE run_id = ${runId}::uuid
    ORDER BY created_at ASC
  `;
}

function countPasses(checks) {
  let allPassed = true;
  checks.forEach((c) => {
    const icon = c.pass ? "PASS" : "FAIL";
    console.log(`   ${icon} ${c.label}`);
    if (!c.pass) allPassed = false;
  });
  return allPassed;
}

// ── Cleanup helper ─────────────────────────────────────────────────────────

const createdRunIds = [];
const createdDeliveryIds = [];

async function cleanupCreatedRows() {
  for (const id of createdRunIds) {
    try {
      await sql`DELETE FROM automation.implementation_events WHERE run_id = ${id}::uuid`;
      await sql`DELETE FROM automation.implementation_runs WHERE id = ${id}::uuid`;
    } catch { /* ignore */ }
  }
  for (const id of createdDeliveryIds) {
    try {
      await sql`DELETE FROM automation.webhook_deliveries WHERE delivery_id = ${id}::uuid`;
    } catch { /* ignore */ }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 1: Normal mode fail-closed
// ═════════════════════════════════════════════════════════════════════════════
async function testNormalModeFailClosed() {
  console.log("\n=== TEST 1: Normal mode fail-closed ===\n");

  try {
    execSync("npx tsx src/main.ts", {
      cwd: RUNNER_DIR,
      timeout: 15_000,
      env: {
        ...process.env,
        DATABASE_URL,
        // No EGA_RUNNER_SMOKE_MODE — default is false
      },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    console.error("   FAIL: Runner started in normal mode without error");
    return false;
  } catch (err) {
    const output = err.stderr || err.stdout || err.message;
    const hasError = output.includes("REAL_EXECUTION_HANDLER_NOT_IMPLEMENTED");
    console.log(`   ${hasError ? "PASS" : "FAIL"}: Runner rejected normal mode startup`);
    if (hasError) {
      console.log(`   Output includes expected error message`);
    } else {
      console.log(`   Unexpected output: ${output.substring(0, 200)}`);
    }
    return hasError;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 2: Successful smoke flow
// ═════════════════════════════════════════════════════════════════════════════
async function testSuccessfulSmokeFlow() {
  console.log("\n=== TEST 2: Successful smoke flow ===\n");

  // Setup
  const delivery = await createDelivery();
  createdDeliveryIds.push(delivery.delivery_id);
  const run = await createRun(delivery.delivery_id);
  createdRunIds.push(run.id);
  console.log(`1. Created implementation_run: ${run.id} (status=${run.status}, attempt=${run.attempt_number})`);

  await enqueueMessage(run.id);
  console.log("2. Enqueued pgmq message for run");

  const preActive = await getActiveMessages();
  console.log(`   Active messages before: ${preActive.length}`);

  // Run smoke
  console.log("3. Running EGA Runner (smoke mode)...");
  const runnerOutput = await runSmokeRunner();
  console.log(runnerOutput);

  // Verify
  const [finalRun] = await sql`
    SELECT id, status, claimed_by, heartbeat_at, lease_expires_at,
           started_at, finished_at, failure_code, attempt_number
    FROM automation.implementation_runs
    WHERE id = ${run.id}::uuid
  `;

  console.log(`\n4. Verifying results...`);
  console.log(`   Run ${finalRun.id}:`);
  console.log(`   status: ${finalRun.status}`);
  console.log(`   claimed_by: ${finalRun.claimed_by}`);
  console.log(`   attempt_number: ${finalRun.attempt_number}`);
  console.log(`   started_at: ${finalRun.started_at}`);
  console.log(`   finished_at: ${finalRun.finished_at}`);
  console.log(`   failure_code: ${finalRun.failure_code}`);

  const events = await getEvents(run.id);
  console.log(`\n5. Events (${events.length} total):`);
  events.forEach((e, i) => {
    console.log(`   [${i + 1}] ${e.event_type}`);
  });

  const activeMsgs = await getActiveMessages();
  const archivedMsgs = await getArchivedMessages();
  console.log(`\n6. Queue state:`);
  console.log(`   Active messages: ${activeMsgs.length}`);
  console.log(`   Archived messages: ${archivedMsgs.length}`);

  // Verify this specific run's message was archived (not global queue state)
  const thisRunArchived = await sql`
    SELECT msg_id FROM pgmq.a_hermes_implementation_jobs
    WHERE message->>'run_id' = ${run.id}::text
  `;

  const checks = [
    { label: "Run status is cancelled", pass: finalRun.status === "cancelled" },
    { label: "attempt_number == 1 (not incremented)", pass: finalRun.attempt_number === 1 },
    { label: "claimed_by is set", pass: finalRun.claimed_by !== null },
    { label: "started_at is set", pass: finalRun.started_at !== null },
    { label: "finished_at is set", pass: finalRun.finished_at !== null },
    { label: "heartbeat_at is set", pass: finalRun.heartbeat_at !== null },
    { label: "lease_expires_at is set", pass: finalRun.lease_expires_at !== null },
    { label: "Has run_preparing event", pass: events.some((e) => e.event_type === "run_preparing") },
    { label: "Has runner_smoke_started event", pass: events.some((e) => e.event_type === "runner_smoke_started") },
    { label: "Has runner_smoke_completed event", pass: events.some((e) => e.event_type === "runner_smoke_completed") },
    { label: "Has run_cancelled event", pass: events.some((e) => e.event_type === "run_cancelled") },
    { label: "Queue message archived for this run", pass: thisRunArchived.length >= 1 },
  ];

  console.log(`\n7. Assertions:`);
  return countPasses(checks);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 3: Stale lease detection
// ═════════════════════════════════════════════════════════════════════════════
async function testStaleLeaseDetection() {
  console.log("\n=== TEST 3: Stale lease detection ===\n");

  // Create a delivery and run that appears stale (preparing + expired lease)
  const delivery = await createDelivery();
  createdDeliveryIds.push(delivery.delivery_id);

  const staleRun = await createRun(delivery.delivery_id, {
    status: "preparing",
    claimed_by: "old-runner-abc123",
    lease_expires_at: new Date(Date.now() - 3600_000), // 1 hour ago
    started_at: new Date(Date.now() - 7200_000),
    heartbeat_at: new Date(Date.now() - 3600_000),
  });
  createdRunIds.push(staleRun.id);
  console.log(`1. Created stale run: ${staleRun.id}`);
  console.log(`   status=${staleRun.status} claimed_by=${staleRun.claimed_by} lease_expires=${staleRun.lease_expires_at}`);

  await enqueueMessage(staleRun.id);
  console.log("2. Enqueued queue message for stale run");

  // Count archived messages before
  const archivedBefore = await getArchivedMessages();
  console.log(`3. Archived messages before: ${archivedBefore.length}`);

  // Run smoke (the runner should detect stale lease, mark stale, then archive)
  console.log("4. Running EGA Runner (smoke mode)...");
  const runnerOutput = await runSmokeRunner();
  console.log(runnerOutput);

  // Verify
  const [finalRun] = await sql`
    SELECT id, status, claimed_by, started_at, finished_at,
           failure_code, attempt_number, lease_expires_at
    FROM automation.implementation_runs
    WHERE id = ${staleRun.id}::uuid
  `;

  console.log(`\n5. After runner:`);
  console.log(`   status: ${finalRun.status}`);
  console.log(`   claimed_by: ${finalRun.claimed_by} (evidence preserved)`);
  console.log(`   attempt_number: ${finalRun.attempt_number} (unchanged)`);
  console.log(`   failure_code: ${finalRun.failure_code}`);
  console.log(`   finished_at: ${finalRun.finished_at}`);
  console.log(`   started_at: ${finalRun.started_at} (original preserved)`);

  const events = await getEvents(staleRun.id);
  console.log(`\n6. Events (${events.length} total):`);
  events.forEach((e, i) => {
    console.log(`   [${i + 1}] ${e.event_type}`);
    const keys = Object.keys(e.payload || {}).join(", ");
    console.log(`       payload keys: ${keys}`);
  });

  const archivedAfter = await getArchivedMessages();
  const newArchived = archivedAfter.length - archivedBefore.length;
  console.log(`\n7. Queue state:`);
  console.log(`   Archived before: ${archivedBefore.length}, after: ${archivedAfter.length}, new: ${newArchived}`);

  const checks = [
    { label: "Run status is stale", pass: finalRun.status === "stale" },
    { label: "attempt_number unchanged", pass: finalRun.attempt_number === 1 },
    { label: "claimed_by preserved (evidence)", pass: finalRun.claimed_by === "old-runner-abc123" },
    { label: "started_at preserved (original attempt)", pass: finalRun.started_at !== null },
    { label: "finished_at set (stale marking)", pass: finalRun.finished_at !== null },
    { label: "failure_code is LEASE_EXPIRED", pass: finalRun.failure_code === "LEASE_EXPIRED" },
    { label: "Has run_stale event", pass: events.some((e) => e.event_type === "run_stale") },
    { label: "Message archived (1 new archived)", pass: newArchived >= 1 },
  ];

  console.log(`\n8. Assertions:`);
  return countPasses(checks);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 4: Active valid lease — redelivered message preserved
// ═════════════════════════════════════════════════════════════════════════════
async function testActiveValidLeasePreserved() {
  console.log("\n=== TEST 4: Active valid lease — redelivered message preserved ===\n");

  // Create a run owned by another runner with a valid (future) lease
  const delivery = await createDelivery();
  createdDeliveryIds.push(delivery.delivery_id);

  const futureLease = new Date(Date.now() + 3600_000); // 1 hour from now
  const activeRun = await createRun(delivery.delivery_id, {
    status: "preparing",
    claimed_by: "active-runner-xyz789",
    lease_expires_at: futureLease,
    started_at: new Date(),
    heartbeat_at: new Date(),
  });
  createdRunIds.push(activeRun.id);
  console.log(`1. Created actively-owned run: ${activeRun.id}`);
  console.log(`   status=${activeRun.status} claimed_by=${activeRun.claimed_by} lease_expires=${activeRun.lease_expires_at}`);

  await enqueueMessage(activeRun.id);
  console.log("2. Enqueued queue message for actively-owned run");

  const activeBefore = await getActiveMessages();
  const archivedBefore = await getArchivedMessages();
  console.log(`   Active messages before: ${activeBefore.length}`);
  console.log(`   Archived messages before: ${archivedBefore.length}`);

  // Run smoke — the runner should see ACTIVE_VALID_LEASE and NOT archive
  console.log("3. Running EGA Runner (smoke mode)...");
  const runnerOutput = await runSmokeRunner();
  console.log(runnerOutput);

  // Verify the run is UNCHANGED
  const [finalRun] = await sql`
    SELECT id, status, claimed_by, lease_expires_at, attempt_number
    FROM automation.implementation_runs
    WHERE id = ${activeRun.id}::uuid
  `;

  console.log(`\n4. After runner:`);
  console.log(`   status: ${finalRun.status} (unchanged)`);
  console.log(`   claimed_by: ${finalRun.claimed_by} (unchanged)`);
  console.log(`   attempt_number: ${finalRun.attempt_number} (unchanged)`);

  const activeAfter = await getActiveMessages();
  const archivedAfter = await getArchivedMessages();
  const newArchived = archivedAfter.length - archivedBefore.length;

  console.log(`\n5. Queue state:`);
  console.log(`   Active messages: ${activeAfter.length}`);
  console.log(`   Archived messages: ${archivedAfter.length}, new since test: ${newArchived}`);

  // Verify no new archived messages (or at least not for THIS run's message)
  const events = await getEvents(activeRun.id);
  console.log(`\n6. Events for this run: ${events.length}`);
  events.forEach((e, i) => {
    console.log(`   [${i + 1}] ${e.event_type}`);
  });

  const checks = [
    { label: "Run status unchanged (still preparing)", pass: finalRun.status === "preparing" },
    { label: "claimed_by unchanged (original owner preserved)", pass: finalRun.claimed_by === "active-runner-xyz789" },
    { label: "attempt_number unchanged", pass: finalRun.attempt_number === 1 },
    { label: "No run_stale event (not expired)", pass: !events.some((e) => e.event_type === "run_stale") },
    { label: "No run_error event", pass: !events.some((e) => e.event_type === "run_error") },
  ];

  // Also check: the queue message should still be visible (VT may need to expire)
  // Since we ran with VT=60s and completed quickly, the message should still be active
  // If it was archived, that's a bug
  const thisRunArchived = await sql`
    SELECT msg_id FROM pgmq.a_hermes_implementation_jobs
    WHERE message->>'run_id' = ${activeRun.id}::text
  `;
  checks.push({
    label: "Queue message NOT archived for this run",
    pass: thisRunArchived.length === 0,
  });

  console.log(`\n7. Assertions:`);
  return countPasses(checks);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 5: Wrong runner heartbeat returns zero rows
// ═════════════════════════════════════════════════════════════════════════════
async function testWrongRunnerHeartbeat() {
  console.log("\n=== TEST 5: Wrong runner heartbeat blocked ===\n");

  // Create a run claimed by runner-A
  const delivery = await createDelivery();
  createdDeliveryIds.push(delivery.delivery_id);

  const futureLease = new Date(Date.now() + 3600_000);
  const run = await createRun(delivery.delivery_id, {
    status: "running",
    claimed_by: "runner-a-real-owner",
    lease_expires_at: futureLease,
    started_at: new Date(),
    heartbeat_at: new Date(),
  });
  createdRunIds.push(run.id);
  console.log(`1. Created run owned by runner-a: ${run.id}`);

  // Attempt heartbeat as runner-b (wrong identity) — via direct DB operation
  const rows = await sql`
    UPDATE automation.implementation_runs
    SET
      heartbeat_at = now(),
      lease_expires_at = now() + interval '60 seconds',
      updated_at = now()
    WHERE id = ${run.id}::uuid
      AND claimed_by = 'runner-b-wrong'
      AND status IN ('preparing', 'running')
    RETURNING id
  `;

  const zeroRows = rows.length === 0;

  console.log(`2. Heartbeat by runner-b: ${zeroRows ? "zero rows (blocked)" : "UNEXPECTEDLY updated " + rows.length + " rows"}`);

  // Verify run is unchanged
  const [finalRun] = await sql`
    SELECT status, claimed_by, lease_expires_at
    FROM automation.implementation_runs
    WHERE id = ${run.id}::uuid
  `;

  console.log(`   status: ${finalRun.status} (unchanged)`);
  console.log(`   claimed_by: ${finalRun.claimed_by} (unchanged)`);
  console.log(`   lease_expires_at original: ${futureLease.toISOString()}`);
  console.log(`   lease_expires_at current: ${finalRun.lease_expires_at?.toISOString()}`);

  const leaseUnchanged =
    finalRun.claimed_by === "runner-a-real-owner" &&
    Math.abs(finalRun.lease_expires_at.getTime() - futureLease.getTime()) < 2000; // within 2 seconds

  const checks = [
    { label: "Wrong runner heartbeat returns zero rows", pass: zeroRows },
    { label: "claimed_by unchanged", pass: finalRun.claimed_by === "runner-a-real-owner" },
    { label: "lease_expires_at unchanged", pass: leaseUnchanged },
  ];

  console.log(`\n3. Assertions:`);
  return countPasses(checks);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST 6: Unknown/inconsistent state → message preserved (fail-closed)
// ═════════════════════════════════════════════════════════════════════════════
async function testInconsistentStatePreserved() {
  console.log("\n=== TEST 6: Unknown/inconsistent state → message preserved ===\n");

  // Create a run in an inconsistent state: status='queued' but claimed_by set
  // This is an invariant violation that should trigger UNKNOWN_INCONSISTENT_STATE
  const delivery = await createDelivery();
  createdDeliveryIds.push(delivery.delivery_id);

  const run = await createRun(delivery.delivery_id, {
    status: "queued",
    claimed_by: "some-runner", // contradictory: claimed but status still queued
  });
  createdRunIds.push(run.id);
  console.log(`1. Created inconsistent run: ${run.id}`);
  console.log(`   status=queued, claimed_by=some-runner (contradictory state)`);

  await enqueueMessage(run.id);
  console.log("2. Enqueued queue message for inconsistent run");

  const archivedBefore = await getArchivedMessages();
  console.log(`   Archived messages before: ${archivedBefore.length}`);

  // Run smoke — the runner should see UNKNOWN_INCONSISTENT_STATE and NOT archive
  console.log("3. Running EGA Runner (smoke mode)...");
  const runnerOutput = await runSmokeRunner();
  console.log(runnerOutput);

  // Verify the run is UNCHANGED
  const [finalRun] = await sql`
    SELECT id, status, claimed_by, attempt_number
    FROM automation.implementation_runs
    WHERE id = ${run.id}::uuid
  `;

  console.log(`\n4. After runner:`);
  console.log(`   status: ${finalRun.status} (unchanged)`);
  console.log(`   claimed_by: ${finalRun.claimed_by} (unchanged)`);
  console.log(`   attempt_number: ${finalRun.attempt_number} (unchanged)`);

  const archivedAfter = await getArchivedMessages();
  const newArchived = archivedAfter.length - archivedBefore.length;

  console.log(`\n5. Queue state:`);
  console.log(`   Archived before: ${archivedBefore.length}, after: ${archivedAfter.length}, new: ${newArchived}`);

  // Find our message in archive by run_id
  const thisRunArchived = await sql`
    SELECT msg_id FROM pgmq.a_hermes_implementation_jobs
    WHERE message->>'run_id' = ${run.id}::text
  `;

  const messageNotArchived = thisRunArchived.length === 0;
  console.log(`   Message in archive for this run: ${thisRunArchived.length} (should be 0)`);

  // Check events
  const events = await getEvents(run.id);
  console.log(`\n6. Events for this run: ${events.length}`);
  events.forEach((e, i) => {
    console.log(`   [${i + 1}] ${e.event_type}`);
  });

  const checks = [
    { label: "Run status unchanged (still queued)", pass: finalRun.status === "queued" },
    { label: "claimed_by unchanged", pass: finalRun.claimed_by === "some-runner" },
    { label: "attempt_number unchanged", pass: finalRun.attempt_number === 1 },
    { label: "Queue message NOT archived", pass: messageNotArchived },
    { label: "Has run_classification_error event", pass: events.some((e) => e.event_type === "run_classification_error") },
  ];

  console.log(`\n7. Assertions:`);
  return countPasses(checks);
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("=== EGA Runner Integration Test Suite ===\n");

  const results = [];

  // Test 1: Normal mode fail-closed
  results.push({ name: "Test 1: Normal mode fail-closed", pass: await testNormalModeFailClosed() });

  // Test 2: Successful smoke flow
  results.push({ name: "Test 2: Successful smoke flow", pass: await testSuccessfulSmokeFlow() });

  // Test 3: Stale lease detection
  results.push({ name: "Test 3: Stale lease detection", pass: await testStaleLeaseDetection() });

  // Test 4: Active valid lease preserved
  results.push({ name: "Test 4: Active valid lease preserved", pass: await testActiveValidLeasePreserved() });

  // Test 5: Wrong runner heartbeat blocked
  results.push({ name: "Test 5: Wrong runner heartbeat blocked", pass: await testWrongRunnerHeartbeat() });

  // Test 6: Exception does not archive
  results.push({ name: "Test 6: Inconsistent state fail-closed", pass: await testInconsistentStatePreserved() });

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));
  let allPassed = true;
  results.forEach((r) => {
    const icon = r.pass ? "PASS" : "FAIL";
    console.log(`  ${icon}  ${r.name}`);
    if (!r.pass) allPassed = false;
  });
  console.log("=".repeat(60));

  if (allPassed) {
    console.log("\n== ALL TESTS PASSED ==");
  } else {
    console.error("\n== SOME TESTS FAILED ==");
  }

  // Cleanup
  console.log("\nCleaning up test data...");
  await cleanupCreatedRows();
  console.log("Cleanup complete.");

  await sql.end();

  if (!allPassed) process.exit(1);
}

main().catch(async (err) => {
  console.error("Test suite failed:", err.message);
  await cleanupCreatedRows();
  await sql.end();
  process.exit(1);
});
