import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";
import type { PullRequestSnapshot } from "./github.js";
import type { HermesResult } from "./hermes-executor.js";
import type { RepairRunRecord } from "./repair-types.js";

function buildRepairPrompt(
  run: RepairRunRecord,
  snapshot: PullRequestSnapshot,
  attemptNumber: number,
  resultFile: string,
): string {
  const failedChecks = snapshot.checks.checks
    .filter((check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))
    .map((check) => [
      `- ${check.name}: ${check.conclusion ?? check.status}${check.detailsUrl ? ` (${check.detailsUrl})` : ""}`,
      check.diagnostic ? `  Failed log excerpt:\n${check.diagnostic.slice(-12_000)}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n");
  const reviewThreads = snapshot.unresolvedThreads
    .map((thread) => `- ${thread.path ?? "PR conversation"}: ${thread.body.slice(0, 2_000)}${thread.url ? ` (${thread.url})` : ""}`)
    .join("\n");

  return [
    "# EGA Runner bounded PR repair",
    "",
    `Run ID: ${run.id}`,
    `Issue: ${run.linear_issue_identifier}`,
    `PR: #${run.pr_number} ${run.pr_url}`,
    `Repair attempt: ${attemptNumber}/${run.max_repair_attempts}`,
    `Expected branch: ${run.branch_name}`,
    `Current PR head: ${snapshot.pr.headSha}`,
    "",
    "## Objective",
    "Repair only the concrete failed checks or new actionable review comments below.",
    "Do not redesign the feature, expand scope, merge, push, create a branch, or open another PR.",
    "",
    "## Failed checks",
    failedChecks || "- None reported",
    "",
    "## New unresolved review comments",
    reviewThreads || "- None reported",
    "",
    "## Authorized product paths",
    ...run.authorized_paths.map((file) => `- ${file}`),
    "",
    "## Required work",
    "1. Inspect the current worktree and existing PR implementation.",
    "2. Apply the smallest coherent repair within the authorized paths.",
    "3. Run useful validation.",
    "4. Create exactly one descendant commit on the existing branch.",
    "5. Leave push, PR synchronization, checks, and merge to the Runner.",
    "",
    "## Validation commands",
    ...run.validation_commands.map((command) => `- ${command}`),
    "",
    "## Result contract",
    `Write valid JSON to ${resultFile} using the existing Hermes result schema.`,
    `Set status=completed, run_id=${run.id}, branch=${run.branch_name}, pr=${run.pr_number}, and commit to the new HEAD SHA.`,
    "No Markdown fences and no secrets.",
  ].join("\n");
}

export function executeRepairHermes(
  run: RepairRunRecord,
  snapshot: PullRequestSnapshot,
  attemptNumber: number,
  config: Config,
): { result: HermesResult | null; stdout: string; stderr: string; exitCode: number } {
  const runnerDir = path.join(run.worktree_path, ".ega-runner");
  mkdirSync(runnerDir, { recursive: true });
  const resultFile = path.join(runnerDir, `hermes-repair-${attemptNumber}-result.json`);
  const execution = spawnSync("hermes", [
    "chat",
    "--quiet",
    "--query",
    buildRepairPrompt(run, snapshot, attemptNumber, resultFile),
    "--source",
    "ega-runner-repair",
    "--max-turns",
    String(config.repairMaxTurns),
    "--accept-hooks",
  ], {
    cwd: run.worktree_path,
    encoding: "utf8",
    timeout: config.hermesTimeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      HERMES_YOLO_MODE: "0",
      HERMES_RUN_ID: run.id,
      HERMES_ISSUE_ID: run.linear_issue_id,
      HERMES_AUTHORIZED_PATHS: JSON.stringify(run.authorized_paths),
      HERMES_RESULT_FILE: resultFile,
      HERMES_REPAIR_ATTEMPT: String(attemptNumber),
    },
  });

  let result: HermesResult | null = null;
  if (existsSync(resultFile)) {
    try {
      result = JSON.parse(readFileSync(resultFile, "utf8")) as HermesResult;
    } catch {
      result = null;
    }
  }
  return {
    result,
    stdout: (execution.stdout ?? "").slice(-50_000),
    stderr: `${execution.stderr ?? ""}${execution.error ? `\n${execution.error.message}` : ""}`.slice(-50_000),
    exitCode: execution.status ?? 1,
  };
}
