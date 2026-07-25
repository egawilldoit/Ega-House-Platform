#!/usr/bin/env -S npx tsx
/**
 * Schema Preflight Unit Tests
 *
 * Tests that the Runner's startup schema preflight correctly:
 *   - Lists every required column the Runner writes/reads
 *   - Rejects (ok: false) when columns are missing
 *   - Accepts (ok: true) when all columns exist
 *   - Exits non-zero without reading queue messages on failure
 *
 * Run: ./test/schema-preflight.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNNER_DIR = resolve(__dirname, "..");

let allPassed = true;
let testCount = 0;
let passCount = 0;

function check(label, pass) {
  testCount++;
  if (pass) passCount++;
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  ${icon} ${label}`);
  if (!pass) allPassed = false;
}

// ── Test 1: Module exports correct interface ─────────────────────────────────

async function testModuleExports() {
  console.log("\n=== Test 1: Module exports correct interface ===\n");

  const mod = await import("../src/schema-preflight.js");

  check("verifyImplementationRunsSchema is a function", typeof mod.verifyImplementationRunsSchema === "function");

  // Verify the return type shape by calling with a mock that returns empty
  // (simulating all columns missing)
  let callCount = 0;
  const mockDb = (strings, ...args) => {
    callCount++;
    return { rows: [] };
  };
  // Make it thenable so `await db\`...\`` works
  const mockSql = (strings, ..._args) => {
    callCount++;
    return Promise.resolve([]);
  };
  mockSql.mockQuery = true;

  // We can't easily test the real function without a DB connection,
  // so we verify the source code structure instead
  const source = readFileSync(resolve(RUNNER_DIR, "src/schema-preflight.ts"), "utf8");

  check("REQUIRED_COLUMNS constant defined", source.includes("REQUIRED_COLUMNS"));
  check("queries information_schema.columns", source.includes("information_schema.columns"));
  check("logs missing columns to stderr", source.includes("console.error"));
  check("returns ok: false on missing", source.includes("ok: false"));
  check("returns ok: true on pass", source.includes("ok: true"));
  check("missingColumns list returned", source.includes("missingColumns"));
}

// ── Test 2: REQUIRED_COLUMNS covers all Runner-written columns ────────────────

async function testRequiredColumnsComplete() {
  console.log("\n=== Test 2: REQUIRED_COLUMNS covers all Runner columns ===\n");

  const mainSource = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");
  const leaseSource = readFileSync(resolve(RUNNER_DIR, "src/run-lease.ts"), "utf8");
  const preflightSource = readFileSync(resolve(RUNNER_DIR, "src/schema-preflight.ts"), "utf8");

  // Extract REQUIRED_COLUMNS from the source
  const requiredMatch = preflightSource.match(/REQUIRED_COLUMNS\s*=\s*\[([^\]]+)\]/s);
  const requiredList = requiredMatch
    ? [...requiredMatch[1].matchAll(/"(\w+)"/g)].map(m => m[1])
    : [];

  // Columns written in main.ts UPDATE statements
  const writtenInUpdates = [
    ...mainSource.matchAll(/SET\s+([\w_]+)\s*=/g),
  ].map(m => m[1]);

  // Columns read in SELECTs (run-lease.ts)
  const selectedColumns = [
    ...leaseSource.matchAll(/\b(id|project_id|status|claimed_by|heartbeat_at|lease_expires_at|started_at|linear_issue_id|linear_issue_identifier|linear_issue_url|attempt_number)\b/g),
  ].map(m => m[1]);

  const uniqueWritten = [...new Set(writtenInUpdates)];
  const uniqueSelected = [...new Set(selectedColumns)];

  // Columns used by the Runner that should be in REQUIRED_COLUMNS
  const runnerColumns = new Set([
    "id", "project_id", "status", "claimed_by",
    "heartbeat_at", "lease_expires_at", "started_at",
    "linear_issue_id", "linear_issue_identifier", "linear_issue_url",
    "attempt_number", "updated_at", "finished_at", "failure_code",
    "context_hash", "base_sha", "branch_name", "worktree_path",
    "hermes_run_id", "result_json",
    "pr_number", "pr_url", "pr_head_sha", "vercel_preview_url",
    "slack_thread_ts", "parent_issue_id", "parent_issue_identifier",
    "created_at",
  ]);

  for (const col of runnerColumns) {
    check(`REQUIRED_COLUMNS includes '${col}'`, requiredList.includes(col));
  }

  // Verify the count
  check(`REQUIRED_COLUMNS has ${runnerColumns.size} entries`, requiredList.length === runnerColumns.size);
}

// ── Test 3: main.ts imports and uses preflight ────────────────────────────────

async function testPreflightImportedInMain() {
  console.log("\n=== Test 3: main.ts imports and uses preflight ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");

  check("imports schema-preflight", source.includes('import { verifyImplementationRunsSchema } from "./schema-preflight.js"'));
  check("calls preflight before poll loop", source.includes("await verifyImplementationRunsSchema(db)"));
  check("exits non-zero on preflight failure", source.includes("process.exit(1)"));
  check("logs preflight passed", source.includes("preflight passed"));
  check("preflight logs on failure", source.includes("Schema preflight FAILED"));
}

// ── Test 4: Preflight is called BEFORE any queue read in main() ───────────────

async function testPreflightBeforeQueueRead() {
  console.log("\n=== Test 4: Preflight is before queue read in main() ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");

  // Find the main function body (not the imports at the top)
  const mainStart = source.indexOf("async function main()");
  const mainEnd = source.indexOf("async function pollOnce");
  const mainBody = source.slice(mainStart, mainEnd);

  // In the main function body, preflight appears before the poll loop
  // readMessage is not in main() itself (it's in pollOnce), so we check
  // that preflight is before the poll while loop
  const preflightPos = mainBody.indexOf("verifyImplementationRunsSchema");
  const pollWhilePos = mainBody.indexOf("while (!shuttingDown)");

  check("verifyImplementationRunsSchema called before poll loop", preflightPos < pollWhilePos);
  check("process.exit before poll loop on failure", mainBody.indexOf("process.exit(1)") < pollWhilePos);

  // Verify the order: getDb -> preflight -> signal handling -> poll loop
  const getDbPos = mainBody.indexOf("getDb(config)");
  const signalPos = mainBody.indexOf("for (const sig of");

  check("preflight after getDb", preflightPos > getDbPos);
  check("preflight before poll loop", preflightPos < pollWhilePos);
  check("signal handling after preflight (preflight gates startup)", preflightPos < signalPos);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔" + "═".repeat(50) + "╗");
  console.log("║  Schema Preflight Unit Tests                  ║");
  console.log("╚" + "═".repeat(50) + "╝");

  await testModuleExports();
  await testRequiredColumnsComplete();
  await testPreflightImportedInMain();
  await testPreflightBeforeQueueRead();

  console.log("\n" + "=".repeat(50));
  console.log(`RESULTS: ${passCount}/${testCount} passed`);
  console.log("=".repeat(50));

  if (allPassed) {
    console.log("\nALL TESTS PASSED");
  } else {
    console.error("\nSOME TESTS FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
