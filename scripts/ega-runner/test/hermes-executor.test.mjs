#!/usr/bin/env -S npx tsx
/**
 * Hermes Executor Unit Tests
 *
 * Focused tests for the Hermes CLI invocation patch:
 *   - Correct chat args (no legacy `implement` subcommand)
 *   - No --worktree or --yolo flags
 *   - HERMES_YOLO_MODE always forced to "0"
 *   - Legacy HERMES_YOLO stripped
 *   - HERMES_MAX_ITERATIONS set
 *   - extraEnv cannot override YOLO_MODE
 *   - mkdirSync used instead of shell execSync
 *
 * Run: ./test/hermes-executor.test.mjs  (or `npx tsx test/hermes-executor.test.mjs`)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RUNNER_DIR = resolve(__dirname, "..");

// Track results
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

// ── Test 1: buildHermesArgs produces correct chat invocation ────────────────

async function testBuildHermesArgs() {
  console.log("\n=== Test 1: buildHermesArgs produces correct argv ===\n");

  const { buildHermesArgs } = await import("../src/hermes-executor.js");

  const config = {
    worktreePath: "/tmp/test-worktree",
    timeoutMs: 60000,
    maxTurns: 25,
    runId: "run-001",
    issueId: "iss-001",
    issueIdentifier: "TEST-001",
    baseSha: "abc123def456",
    validationCommands: ["npm test"],
    extraEnv: {},
    authorizedPaths: [],
    resultFilePath: "/tmp/test-worktree/.ega-runner/hermes-result.json",
    hermesRunId: "ega:run-001:attempt:1",
    isRecovery: false,
  };

  const { args, childEnv } = buildHermesArgs(config);

  check("first arg is 'chat'", args[0] === "chat");
  check("--quiet is present", args.includes("--quiet"));
  check("--query is present", args.includes("--query"));
  check("--source is present", args.includes("--source"));
  check("source value is 'ega-runner'", args[args.indexOf("--source") + 1] === "ega-runner");
  check("--max-turns is present", args.includes("--max-turns"));
  check("max-turns value matches config", args[args.indexOf("--max-turns") + 1] === "25");
  check("--accept-hooks is present", args.includes("--accept-hooks"));
  check("--worktree is NOT present", !args.includes("--worktree"));
  check("--yolo is NOT present", !args.includes("--yolo"));
  check("legacy 'implement' subcommand NOT present", !args.includes("implement"));
  check("prompt is included (string after --query)", typeof args[args.indexOf("--query") + 1] === "string" && args[args.indexOf("--query") + 1].length > 0);

  check("HERMES_MAX_ITERATIONS is set", childEnv.HERMES_MAX_ITERATIONS === "25");
  check("HERMES_YOLO_MODE is '0'", childEnv.HERMES_YOLO_MODE === "0");
  check("HERMES_YOLO is deleted", !("HERMES_YOLO" in childEnv));
  check("HERMES_RUN_ID is set", childEnv.HERMES_RUN_ID === "run-001");
  check("HERMES_ISSUE_ID is set", childEnv.HERMES_ISSUE_ID === "iss-001");
  check("HERMES_BASE_SHA is set", childEnv.HERMES_BASE_SHA === "abc123def456");
}

// ── Test 2: extraEnv cannot re-enable YOLO mode ─────────────────────────────

async function testExtraEnvCannotOverrideYolo() {
  console.log("\n=== Test 2: extraEnv cannot override HERMES_YOLO_MODE ===\n");

  const { buildHermesArgs } = await import("../src/hermes-executor.js");

  // extraEnv tries to enable YOLO
  const config = {
    worktreePath: "/tmp/test-worktree",
    timeoutMs: 60000,
    maxTurns: 10,
    runId: "run-002",
    issueId: "iss-002",
    issueIdentifier: "TEST-002",
    baseSha: "000000000000",
    validationCommands: [],
    extraEnv: {
      HERMES_YOLO_MODE: "1",
      HERMES_YOLO: "1",
    },
    authorizedPaths: [],
    resultFilePath: "/tmp/test-worktree/.ega-runner/hermes-result.json",
    hermesRunId: "ega:run-002:attempt:1",
    isRecovery: false,
  };

  const { childEnv } = buildHermesArgs(config);

  check("HERMES_YOLO_MODE forced to '0' despite extraEnv", childEnv.HERMES_YOLO_MODE === "0");
  check("HERMES_YOLO stripped despite extraEnv", !("HERMES_YOLO" in childEnv));
}

// ── Test 3: mkdirSync replaces shell execSync ───────────────────────────────

async function testNoShellMkdir() {
  console.log("\n=== Test 3: No shell-based directory creation ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/hermes-executor.ts"), "utf8");

  check("execSync not used in file", !source.includes("execSync"));
  check("mkdirSync used for directory creation", source.includes("mkdirSync(hermesPath, { recursive: true })"));
  check("shell spawn is false (no shell interpolation)", source.includes("shell: false"));
}

// ── Test 4: Default max-turns applied when config missing ───────────────────

async function testDefaultMaxTurns() {
  console.log("\n=== Test 4: Default max-turns applied when config omits maxTurns ===\n");

  const { buildHermesArgs } = await import("../src/hermes-executor.js");

  const config = {
    worktreePath: "/tmp/test",
    timeoutMs: 30000,
    runId: "run-003",
    issueId: "iss-003",
    issueIdentifier: "TEST-003",
    baseSha: "deadbeef",
    validationCommands: [],
    extraEnv: {},
    authorizedPaths: [],
    resultFilePath: "/tmp/test/.ega-runner/hermes-result.json",
    hermesRunId: "ega:run-003:attempt:1",
    isRecovery: false,
  };
  // Note: maxTurns is undefined

  const { args, childEnv } = buildHermesArgs(config);

  check("max-turns arg uses default (50)", args[args.indexOf("--max-turns") + 1] === "50");
  check("HERMES_MAX_ITERATIONS uses default (50)", childEnv.HERMES_MAX_ITERATIONS === "50");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔" + "═".repeat(50) + "╗");
  console.log("║  Hermes Executor Unit Tests                    ║");
  console.log("╚" + "═".repeat(50) + "╝");

  await testBuildHermesArgs();
  await testExtraEnvCannotOverrideYolo();
  await testNoShellMkdir();
  await testDefaultMaxTurns();

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
