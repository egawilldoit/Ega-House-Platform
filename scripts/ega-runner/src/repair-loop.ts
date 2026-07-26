import { existsSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import type { Config } from "./config.js";
import { insertEvent } from "./event-log.js";
import { writeEvidenceFile } from "./evidence.js";
import { createCommitStatus, getRemoteCommitSha, pushBranch, type PullRequestSnapshot } from "./github.js";
import { postSlackNotification } from "./notify.js";
import { git, isAncestor, productStatus } from "./repair-evidence.js";
import { executeRepairHermes } from "./repair-hermes.js";
import { persistPostPushFailure, persistRepairFailure } from "./repair-state.js";
import type { RepairOutcome, RepairRunRecord } from "./repair-types.js";
import { validateHermesResultSchema, verifyImplementationCommit } from "./result.js";
import { collectChangedProductPaths, enforceScope } from "./scope.js";
import { runValidationCommands } from "./validation.js";

export type { RepairOutcome, RepairRunRecord } from "./repair-types.js";

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
      AND status = ${run.status}
      AND pr_head_sha = ${run.pr_head_sha}
      AND repair_attempt_count < max_repair_attempts
    RETURNING repair_attempt_count
  `;
  if (claimed.length !== 1) {
    return { status: "pr_open", headSha: null, reason: "Repair claim was not acquired" };
  }
  const attemptNumber = Number(claimed[0].repair_attempt_count);
  const evidenceDir = run.evidence_dir ?? path.join(run.worktree_path, ".ega-runner");
  let beforeHead: string | undefined;
  let pushedHead: string | null = null;

  await insertEvent(db, run.id, "repair_started", {
    attempt_number: attemptNumber,
    pr_number: run.pr_number,
    pr_head_sha: snapshot.pr.headSha,
    failed_checks: snapshot.checks.checks.filter((check) => check.conclusion && check.conclusion !== "success").map((check) => check.name),
    unresolved_threads: snapshot.unresolvedThreads.length,
    source: "ega_runner",
  }).catch(() => undefined);

  try {
    if (!existsSync(run.worktree_path)) {
      return persistRepairFailure(db, config, run, attemptNumber, "Authoritative worktree is missing", true);
    }
    const branch = git(run.worktree_path, ["branch", "--show-current"]);
    beforeHead = git(run.worktree_path, ["rev-parse", "HEAD"]);
    if (branch !== run.branch_name || beforeHead !== snapshot.pr.headSha) {
      return persistRepairFailure(
        db,
        config,
        run,
        attemptNumber,
        `Worktree identity mismatch: branch=${branch}, head=${beforeHead}, expected=${run.branch_name}@${snapshot.pr.headSha}`,
        true,
        beforeHead,
        evidenceDir,
      );
    }
    const dirtyBefore = productStatus(run.worktree_path);
    if (dirtyBefore.length > 0) {
      return persistRepairFailure(db, config, run, attemptNumber, `Worktree was dirty before repair: ${dirtyBefore.join(", ")}`, true, beforeHead, evidenceDir);
    }

    const execution = executeRepairHermes(run, snapshot, attemptNumber, config);
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-stdout.log`, execution.stdout);
    writeEvidenceFile(evidenceDir, `repair-${attemptNumber}-stderr.log`, execution.stderr);
    if (execution.exitCode !== 0) {
      return persistRepairFailure(db, config, run, attemptNumber, `Hermes repair exited with ${execution.exitCode}`, false, beforeHead, evidenceDir);
    }
    if (!execution.result) {
      return persistRepairFailure(db, config, run, attemptNumber, "Hermes did not produce a repair result", false, beforeHead, evidenceDir);
    }
    const schema = validateHermesResultSchema(execution.result);
    if (!schema.ok) {
      return persistRepairFailure(db, config, run, attemptNumber, `Invalid repair result: ${schema.error}`, false, beforeHead, evidenceDir);
    }
    if (execution.result.status !== "completed") {
      return persistRepairFailure(db, config, run, attemptNumber, `Hermes reported repair status ${execution.result.status}`, false, beforeHead, evidenceDir);
    }

    const afterHead = git(run.worktree_path, ["rev-parse", "HEAD"]);
    if (execution.result.run_id !== run.id || execution.result.branch !== run.branch_name ||
        execution.result.pr !== run.pr_number || execution.result.commit !== afterHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Repair result identity does not match run, PR, branch, and new HEAD", false, beforeHead, evidenceDir);
    }
    if (afterHead === beforeHead) {
      return persistRepairFailure(db, config, run, attemptNumber, "Hermes produced no new repair commit", false, beforeHead, evidenceDir);
    }
    if (!isAncestor(run.worktree_path, beforeHead, afterHead)) {
      return persistRepairFailure(db, config, run, attemptNumber, "Repair rewrote branch history", true, beforeHead, evidenceDir);
    }

    const changedFiles = collectChangedProductPaths(run.worktree_path, run.base_sha);
    const scopeViolation = enforceScope(run.authorized_paths, changedFiles, run.worktree_path, run.base_sha);
    if (scopeViolation) {
      return persistRepairFailure(db, config, run, attemptNumber, scopeViolation.message, true, beforeHead, evidenceDir);
    }
    const commit = verifyImplementationCommit(run.worktree_path, run.base_sha, run.branch_name, run.authorized_paths);
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
      const observedRemote = getRemoteCommitSha(run.worktree_path, run.branch_name);
      if (observedRemote === afterHead) {
        pushedHead = afterHead;
        return persistPostPushFailure(db, config, run, attemptNumber, afterHead, `Push reported failure after remote accepted the commit: ${pushed.error}`);
      }
      return persistRepairFailure(db, config, run, attemptNumber, `Repair push failed: ${pushed.error}`, false, beforeHead, evidenceDir);
    }

    const remoteHead = getRemoteCommitSha(run.worktree_path, run.branch_name);
    if (remoteHead !== afterHead) {
      pushedHead = remoteHead ?? afterHead;
      return persistPostPushFailure(db, config, run, attemptNumber, pushedHead, `Remote SHA ${remoteHead ?? "missing"} did not match repair commit ${afterHead}`);
    }
    pushedHead = afterHead;

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
        AND pr_head_sha = ${run.pr_head_sha}
      RETURNING id
    `;
    if (updated.length !== 1) {
      return persistPostPushFailure(db, config, run, attemptNumber, afterHead, "Repair commit was pushed but success state lost its compare-and-swap");
    }

    createCommitStatus(run.worktree_path, afterHead, "success", `EGA Runner repair attempt ${attemptNumber} pushed`, "ega/hermes-pipeline");
    await insertEvent(db, run.id, "repair_pushed", {
      attempt_number: attemptNumber,
      previous_head_sha: beforeHead,
      new_head_sha: afterHead,
      validation_commands: validation.results.map((item) => ({ command: item.command, exit_code: item.exitCode })),
      source: "ega_runner",
    }).catch(() => undefined);
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
    }).catch(() => undefined);
    return { status: "pr_open", headSha: afterHead, reason: "Repair pushed" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (pushedHead) {
      return persistPostPushFailure(db, config, run, attemptNumber, pushedHead, reason);
    }
    return persistRepairFailure(db, config, run, attemptNumber, reason, false, beforeHead, evidenceDir);
  }
}
