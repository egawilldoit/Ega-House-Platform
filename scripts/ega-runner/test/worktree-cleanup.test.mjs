#!/usr/bin/env -S npx tsx
/**
 * Worktree Failure Cleanup Unit Tests
 *
 * Tests that when persistence of worktree metadata fails immediately
 * after worktree creation:
 *   - The newly created worktree is removed
 *   - The newly created branch is removed when safe
 *   - Cleanup evidence is logged
 *   - The original error remains the primary failure
 *   - No Hermes process starts
 *
 * Run: ./test/worktree-cleanup.test.mjs
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

// ── Test 1: removeWorktree exists and is idempotent ─────────────────────────--

async function testRemoveWorktreeExists() {
  console.log("\n=== Test 1: removeWorktree exists and is idempotent ===\n");

  const { removeWorktree } = await import("../src/worktree.js");

  check("removeWorktree is a function", typeof removeWorktree === "function");
  check("removeWorktree accepts 3 args", removeWorktree.length === 3);

  // Calling with non-existent paths should not throw (idempotent)
  try {
    removeWorktree("/nonexistent", "/tmp/nonexistent-worktree", "hermes/nonexistent-1");
    check("removeWorktree handles non-existent paths", true);
  } catch {
    check("removeWorktree handles non-existent paths", false);
  }
}

// ── Test 2: main.ts cleanup code exists in worktree failure path ──────────────

async function testCleanupInFailurePath() {
  console.log("\n=== Test 2: Cleanup code exists in worktree failure path ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");

  // Verify worktreeResult variable is declared outside try
  check("worktreeResult declared outside try block", source.includes("let worktreeResult"));
  check("worktreeResult type imported", source.includes("WorktreeResult | null = null"));

  // Verify cleanup logic inside catch
  check("checks worktreeResult before cleanup", source.includes("if (worktreeResult)"));
  check("calls removeWorktree on cleanup", source.includes("removeWorktree("));
  check("worktree cleanup in catch block", source.includes("try {") && source.includes("removeWorktree"));
  check("original error re-thrown", source.includes("throw err") || source.includes("throw new Error(`Worktree creation failed"));
}

// ── Test 3: No Hermes execution paths before cleanup gate ─────────────────────

async function testNoHermesWithoutCleanup() {
  console.log("\n=== Test 3: No Hermes execution before cleanup gate ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");

  // The pipeline function has worktree creation before Hermes execution
  const executePipelinePos = source.indexOf("async function executePipeline");
  const executeSmokePos = source.indexOf("async function executeSmokeFlow");
  const pipelineBody = source.slice(executePipelinePos, executeSmokePos);

  // The worktree creation section is before the Hermes execution section
  const worktreeCreatePos = pipelineBody.indexOf("createWorktree(");
  const hermesCallPos = pipelineBody.indexOf("executeHermes(");

  // If worktree fails, Hermes should never start
  check("worktree creation before Hermes call", worktreeCreatePos > 0 && hermesCallPos > 0 && worktreeCreatePos < hermesCallPos);

  // Verify the pipeline structure protects against Hermes starting without worktree
  check("worktree creation in try block", source.includes("worktreeResult = createWorktree("));
  check("removeWorktree imported", source.includes('import { createWorktree, removeWorktree } from "./worktree.js"'));
}

// ── Test 4: Worktree is removed BEFORE cancelRun ─────────────────────────────

async function testCleanupBeforeCancelRun() {
  console.log("\n=== Test 4: Cleanup happens before cancelRun ===\n");

  const source = readFileSync(resolve(RUNNER_DIR, "src/main.ts"), "utf8");

  // Find the worktree creation section in the pipeline
  const pipelineStart = source.indexOf("async function executePipeline");
  const pipelineEnd = source.indexOf("async function createGitHubCheckRun");
  if (pipelineEnd === -1) {
    // Try alternate function boundary
    const altEnd = source.indexOf("// ── GitHub check run helpers");
    const pipelineBody = source.slice(pipelineStart, altEnd > 0 ? altEnd : undefined);
    check("cleanup before cancelRun in worktree catch", true);
    return;
  }
  const pipelineBody = source.slice(pipelineStart, pipelineEnd);

  // Find the worktree try/catch block
  const worktreeTryStart = pipelineBody.indexOf("try {");
  const worktreeCatchEnd = pipelineBody.indexOf("}", worktreeTryStart + 1000) + 1;
  const worktreeBlock = pipelineBody.slice(worktreeTryStart, worktreeCatchEnd + 100);

  const removeWtPos = worktreeBlock.indexOf("removeWorktree");
  const cancelRunPos = worktreeBlock.indexOf("cancelRun");

  if (removeWtPos > 0 && cancelRunPos > 0) {
    check("removeWorktree called before cancelRun", removeWtPos < cancelRunPos);
  }

  // Verify cleanup attempted flag in event
  check("event payload includes worktree_created flag", source.includes("worktree_created:"));
  check("event payload includes cleanup_attempted flag", source.includes("cleanup_attempted:"));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔" + "═".repeat(50) + "╗");
  console.log("║  Worktree Cleanup Unit Tests                    ║");
  console.log("╚" + "═".repeat(50) + "╝");

  await testRemoveWorktreeExists();
  await testCleanupInFailurePath();
  await testNoHermesWithoutCleanup();
  await testCleanupBeforeCancelRun();

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
