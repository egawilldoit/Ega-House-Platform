import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import type { Config } from "./config.js";
import { insertEvent } from "./event-log.js";
import { writeEvidenceFile } from "./evidence.js";
import { createCommitStatus, getRemoteCommitSha, pushBranch, type PullRequestSnapshot } from "./github.js";
import type { HermesResult } from "./hermes-executor.js";
import { validateHermesResultSchema, verifyImplementationCommit } from "./result.js";
import { collectChangedProductPaths, enforceScope } from "./scope.js";
import { postSlackNotification } from "./notify.js";
import { runValidationCommands } from "./validation.js";

export interface RepairRunRecord {
  id: string;
  linear_issue_id: string;
  linear_issue_identifier: string;
  linear_issue_url: string | null;
  base_sha: string;
  branch_name: string;
  worktree_path: string;
  pr_number: number;
  pr_url: string;
  pr_head_sha: string;
  evidence_dir: string | null;
  authorized_paths: string[];
  validation_commands: string[];
  repair_attempt_count: number;
  max_repair_attempts: number;
  slack_thread_ts: string | null;
}

export interface RepairOutcome {
  status: "pr_open" | "needs_human";
  headSha: string | null;
  reason: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

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
      check.diagnostic ? `  Failed log excerpt:
${check.diagnostic.slice(-12_000)}` : "",
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
    "Repair only the concrete failed checks or actionable unresolved review comments below.",
    "Do not redesign the feature, expand scope, merge the PR, or modify unrelated files.",
    "",
    "## Failed checks",
    failedChecks || "- None reported",
    "",
    "## Unresolved review comments",
    reviewThreads || "- None reported",
    "",
    "## Authorized product paths",
    ...run.authorized_paths.map((file) => `- ${file}`),
    "",
    "## Required work",
    "1. Inspect the existing worktree and current branch.",
    "2. Apply the smallest coherent fix within the authorized paths.",
    "3. Run the validation commands listed below.",
    "4. Create one new commit on the existing branch.",
    "5. Do not push, merge, create another branch, or open another PR; the Runner owns those actions.",
    "",
    "## Validation commands",
    ...run.validation_commands.map((command) => `- ${command}`),
    "",
    "## Result contract",
    `Write valid JSON to ${resultFile} using the existing Hermes result schema.`,
    `Set run_id to ${run.id}, branch to ${run.branch_name}, pr to ${run.pr_number}, and commit to the new HEAD SHA.`,
    "No Markdown fences and no secrets.",
  ].join("\n");
}

function executeRepairHermes(
  run: RepairRunRecord,
  snapshot: PullRequestSnapshot,
  attemptNumber: number,
  config: Config,
): { result: HermesResult | null; stdout: string; stderr: string; exitCode: number } {
  const runnerDir = path.join(run.worktree_path, ".ega-runner");
  mkdirSync(runnerDir, { recursive: true });
  const resultFile = path.join(runnerDir, `hermes-repair-${attemptNumber}-result.json`);
  const prompt = buildRepairPrompt(run, snapshot, attemptNumber, resultFile);
  const execution = spawnSync("hermes", [
    "chat",
    "--quiet",
    "--query",
    prompt,
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

function productStatus(worktreePath: string): string[] {
  const lines = git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.filter((line) => {
    const file = line.slice(3).replace(/^"|"$/g, "");
    return file !== ".ega-runner" && !file.startsWith(".ega-runner/");
  });
}

function isAncestor(worktreePath: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

function preserveAndResetRepair(
  run: RepairRunRecord,
  beforeHead: string,
  attemptNumber: number,
  evidenceDir: string,
): void {
  mkdirSync(evidenceDir, { recursive: true });
  let patch = "";
  try {
    patch = git(run.worktree_path, ["diff", "--binary", beforeHead]);
  } catch {
    patch = "";
  }
  writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-failed.patch`, patch);
  writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-failed-status.txt`, productStatus(run.worktree_path).join("\n"));
  git(run.worktree_path, ["reset", "--hard", beforeHead]);
  git(run.worktree_path, ["clean", "-fd", "-e", ".ega-runner/"]);
  if (git(run.worktree_path, ["rev-parse", "HEAD"]) !== beforeHead || productStatus(run.worktree_path).length > 0) {
    throw new Error("Failed repair attempt could not be reset to the observed PR head");
  }
}

async function persistRepairFailure(
  db: postgres.Sql<{}>,
  config: Config,
  run: RepairRunRecord,
  attemptNumber: number,
  reason: string,
  forceHuman: boolean,
  beforeHead?: string,
  evidenceDir?: string,
): Promise<RepairOutcome> {
  let finalReason = reason;
  let exhausted = forceHuman || attemptNumber >= run.max_repair_attempts;
  if (!exhausted && beforeHead && evidenceDir && existsSync(run.worktree_path)) {
    try {
      preserveAndResetRepair(run, beforeHead, attemptNumber, evidenceDir);
    } catch (error) {
      exhausted = true;
      finalReason += `; reset failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const status = exhausted ? "needs_human" : "pr_open";
  const rows = await db`
    UPDATE automation.implementation_runs
    SET status = ${status},
        failure_code = ${exhausted ? "REPAIR_EXHAUSTED" : "REPAIR_ATTEMPT_FAILED"},
        last_check_state = 'failure',
        next_check_at = ${exhausted ? null : new Date(Date.now() + config.prMonitorIntervalSeconds * 1_000)},
        updated_at = now()
    WHERE id = ${run.id}::uuid
      AND status = 'repairing'
    RETURNING id
  `;
  if (rows.length !== 1) throw new Error(`Repair failure state was not persisted for ${run.id}`);
  await insertEvent(db, run.id, "repair_failed", {
    attempt_number: attemptNumber,
    exhausted,
    reason: finalReason,
    source: "ega_runner",
  });
  await postSlackNotification({
    channel: config.slackChannel,
    runId: run.id,
    issueIdentifier: run.linear_issue_identifier,
    issueUrl: run.linear_issue_url ?? "",
    prUrl: run.pr_url,
    vercelPreviewUrl: null,
    status: exhausted ? "failed" : "started",
    summary: exhausted
      ? `Repair stopped after attempt ${attemptNumber}: ${finalReason}`
      : `Repair attempt ${attemptNumber} failed and the worktree was reset for retry: ${finalReason}`,
    threadTs: run.slack_thread_ts ?? undefined,
  });
  return { status, headSha: null, reason: finalReason };
}

export async function runRepairAttempt(
  db: postgres.Sql<{}>,
  config: Config,
  run: RepairRunRecord,
  snapshot: PullRequestSnapshot,
): Promise<RepairOutcome> {
  const claimed = await db`
    UPDATE automation.implementation_runs
    SET status = 'repairing',
        repair_attempt_count = repair_attempt_count + 1,
        updated_at = now()
    WHERE id = ${run.id}::uuid
      AND status IN ('pr_open', 'awaiting_review')
      AND repair_attempt_count < max_repair_attempts
    RETURNING repair_attempt_count
  `;
  if (claimed.length !== 1) {
    return { status: "needs_human", headSha: null, reason: "Repair claim was not acquired" };
  }
  const attemptNumber = Number(claimed[0].repair_attempt_count);

  await insertEvent(db, run.id, "repair_started", {
    attempt_number: attemptNumber,
    pr_number: run.pr_number,
    pr_head_sha: snapshot.pr.headSha,
    failed_checks: snapshot.checks.checks.filter((check) => check.conclusion && check.conclusion !== "success").map((check) => check.name),
    unresolved_threads: snapshot.unresolvedThreads.length,
    source: "ega_runner",
  });

  let repairHead: string | undefined;
  let repairEvidenceDir: string | undefined;
  try {
    if (!existsSync(run.worktree_path)) {
      return persistRepairFailure(db, config, run, attemptNumber, "Authoritative worktree is missing", true);
    }
    const branch = git(run.worktree_path, ["branch", "--show-current"]);
    const beforeHead = git(run.worktree_path, ["rev-parse", "HEAD"]);
    repairHead = beforeHead;
    if (branch !== run.branch_name || beforeHead !== snapshot.pr.headSha) {
      return persistRepairFailure(
        db,
        config,
        run,
        attemptNumber,
        `Worktree identity mismatch: branch=${branch}, head=${beforeHead}, expected=${run.branch_name}@${snapshot.pr.headSha}`,
        true,
      );
    }

    const dirtyBefore = productStatus(run.worktree_path);
    if (dirtyBefore.length > 0) {
      return persistRepairFailure(db, config, run, attemptNumber, `Worktree has uncommitted product changes before repair: ${dirtyBefore.join(", ")}`, true);
    }

    const execution = executeRepairHermes(run, snapshot, attemptNumber, config);
    const evidenceDir = run.evidence_dir ?? path.join(run.worktree_path, ".ega-runner");
    repairEvidenceDir = evidenceDir;
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-stdout.log`, execution.stdout);
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-stderr.log`, execution.stderr);

    if (!execution.result) {
      return persistRepairFailure(db, config, run, attemptNumber, "Hermes did not produce a repair result", false, beforeHead, evidenceDir);
    }
    const schema = validateHermesResultSchema(execution.result);
    if (!schema.ok) {
      return persistRepairFailure(db, config, run, attemptNumber, `Invalid repair result: ${schema.error}`, false, beforeHead, evidenceDir);
    }

    const afterHead = git(run.worktree_path, ["rev-parse", "HEAD"]);
    if (execution.result.run_id !== run.id || execution.result.branch !== run.branch_name ||
        execution.result.pr !== run.pr_number || execution.result.commit !== afterHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Repair result identity does not match the run, PR, branch, and new HEAD", false, beforeHead, evidenceDir);
    }
    if (afterHead === beforeHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Hermes produced no new repair commit", false, beforeHead, evidenceDir);
    }

    if (!isAncestor(run.worktree_path, beforeHead, afterHead)) {
      return persistRepairFailure(db, config, run, attemptNumber, "Repair rewrote branch history instead of extending the observed PR head", true, beforeHead, evidenceDir);
    }

    const changedFiles = collectChangedProductPaths(run.worktree_path, run.base_sha);
    const scopeViolation = enforceScope(run.authorized_paths, changedFiles, run.worktree_path, run.base_sha);
    if (scopeViolation) {
      return persistRepairFailure(db, config, run, attemptNumber, scopeViolation.message, true);
    }

    const commit = verifyImplementationCommit(
      run.worktree_path,
      run.base_sha,
      run.branch_name,
      run.authorized_paths,
    );
    if (!commit.ok || commit.commitSha !== afterHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Repair commit verification failed", true, beforeHead, evidenceDir);
    }

    const validation = runValidationCommands(run.worktree_path, run.validation_commands);
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-validation.json`, JSON.stringify(validation, null, 2));
    if (!validation.ok) {
      return persistRepairFailure(db, config, run, attemptNumber, "Runner-owned validation failed after repair", false, beforeHead, evidenceDir);
    }

    createCommitStatus(run.worktree_path, afterHead, "pending", `EGA Runner repair attempt ${attemptNumber} validated locally`, "ega/hermes-pipeline");
    const pushed = pushBranch(run.worktree_path, run.branch_name);
    if (!pushed.ok) {
      return persistRepairFailure(db, config, run, attemptNumber, `Repair push failed: ${pushed.error}`, false, beforeHead, evidenceDir);
    }
    const remoteHead = getRemoteCommitSha(run.worktree_path, run.branch_name);
    if (remoteHead !== afterHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Remote SHA does not match repair commit", true);
    }

    const updated = await db`
      UPDATE automation.implementation_runs
      SET status = 'pr_open',
          pr_head_sha = ${afterHead},
          last_observed_pr_sha = ${afterHead},
          last_check_state = 'pending',
          last_review_state = 'pending',
          failure_code = NULL,
          result_json = ${JSON.stringify(execution.result)}::jsonb,
          last_repair_at = now(),
          next_check_at = now() + (${config.prMonitorIntervalSeconds}::text || ' seconds')::interval,
          updated_at = now()
      WHERE id = ${run.id}::uuid
        AND status = 'repairing'
      RETURNING id
    `;
    if (updated.length !== 1) throw new Error(`Repair success state was not persisted for ${run.id}`);
    createCommitStatus(run.worktree_path, afterHead, "success", `EGA Runner repair attempt ${attemptNumber} pushed`, "ega/hermes-pipeline");
    await insertEvent(db, run.id, "repair_pushed", {
      attempt_number: attemptNumber,
      previous_head_sha: beforeHead,
      new_head_sha: afterHead,
      validation_commands: validation.results.map((item) => ({ command: item.command, exit_code: item.exitCode })),
      source: "ega_runner",
    });
    await postSlackNotification({
      channel: config.slackChannel,
      runId: run.id,
      issueIdentifier: run.linear_issue_identifier,
      issueUrl: run.linear_issue_url ?? "",
      prUrl: run.pr_url,
      vercelPreviewUrl: null,
      status: "started",
      summary: `Repair attempt ${attemptNumber} pushed ${afterHead.slice(0, 12)}. Watching checks again.`,
      threadTs: run.slack_thread_ts ?? undefined,
    });
    return { status: "pr_open", headSha: afterHead, reason: "Repair pushed" };
  } catch (error) {
    return persistRepairFailure(
      db,
      config,
      run,
      attemptNumber,
      error instanceof Error ? error.message : String(error),
      false,
      repairHead,
      repairEvidenceDir,
    );
  }
}
