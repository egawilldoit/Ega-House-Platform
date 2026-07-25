/**
 * EGA Runner — Durable pgmq consumer for the EGA House autonomous delivery pipeline.
 *
 * Authoritative execution order:
 *  1. Claim durable queue message
 *  2. Establish lease and heartbeat
 *  3. Resolve Linear issue + parent Spec
 *  4. Check GraphQL errors
 *  5. Build deterministic context and context hash
 *  6. Extract and validate allowed paths
 *  7. Create deterministic worktree and branch
 *  8. Persist base SHA, branch, worktree, hermes_run_id
 *  9. Start Hermes
 * 10. Preserve stdout/stderr
 * 11. Verify or recover structured result once
 * 12. Compute actual changed files, enforce scope
 * 13. Verify real implementation commit
 * 14. Push branch
 * 15. Resolve and verify pushed head SHA
 * 16. Publish commit status (pending then final)
 * 17. Open PR
 * 18. Persist PR evidence
 * 19. Archive queue message only after terminal state is durable
 *
 * Safety invariants:
 *  - Never use pgmq.pop() — messages are always read with VT
 *  - Never trust Hermes exit code/prose alone — verify against Git
 *  - Never work on main or reuse stale attempts
 *  - Never archive on ambiguity, exception, or lease loss
 */

import { loadConfig, type Config } from "./config.js";
import { getDb, closeDb } from "./db.js";
import { readMessage, setVisibilityTimeout, archiveMessage } from "./queue.js";
import {
  claimRun,
  extendLease,
  cancelRun,
  markRunStale,
  type ClaimOutcome,
} from "./run-lease.js";
import { insertEvent } from "./event-log.js";
import { fetchIssueSpec, computeContextHash } from "./context.js";
import { createWorktree, removeWorktree } from "./worktree.js";
import { verifyImplementationRunsSchema } from "./schema-preflight.js";
import { executeHermes, type HermesExecutionConfig, type ExecutionOutput, type HermesResult } from "./hermes-executor.js";
import { verifyResult, validateHermesResultSchema, verifyImplementationCommit, type VerificationResult } from "./result.js";
import { extractAllowedPathsFromDescription, collectChangedProductPaths, enforceScope } from "./scope.js";
import { createEvidenceDir, preserveHermesOutput, preserveGitEvidence, writeFailureSummary, copyWorktreeEvidence, writeEvidenceManifest, writeEvidenceFile } from "./evidence.js";
import { createCommitStatus, pushBranch, getRemoteCommitSha, createPR, updatePR, createCheckRun, updateCheckRun, waitForChecks, mergePR } from "./github.js";
import { postSlackNotification, type SlackNotificationConfig } from "./notify.js";
import { verifyVercelDeployment } from "./vercel.js";
import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import path from "node:path";

// ── State ──────────────────────────────────────────────────────────────────
interface ActiveRun {
  runId: string;
  msgId: bigint;
  readCt: number;
}

let activeRun: ActiveRun | null = null;
let shuttingDown = false;

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();

  console.log(`[ega-runner] Starting — ID: ${config.runnerId}`);
  console.log(
    `[ega-runner] Queue: ${config.queueName} | ` +
      `Poll: ${config.pollSeconds}s | VT: ${config.visibilityTimeoutSeconds}s | ` +
      `Heartbeat: ${config.heartbeatSeconds}s | Lease: ${config.leaseSeconds}s | ` +
      `Smoke: ${config.smokeMode}`,
  );

  const db = getDb(config);

  const preflight = await verifyImplementationRunsSchema(db);
  if (!preflight.ok) {
    console.error("[ega-runner] Schema preflight FAILED — missing columns detected");
    await closeDb();
    process.exit(1);
  }
  console.log("[ega-runner] Schema preflight passed");

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => handleShutdown(sig));
  }

  while (!shuttingDown) {
    try {
      await pollOnce(db, config);
    } catch (err) {
      console.error(
        `[ega-runner] Unhandled poll error:`,
        err instanceof Error ? err.message : String(err),
      );
      if (!shuttingDown) {
        await sleep(config.pollSeconds * 1000);
      }
    }
  }

  console.log("[ega-runner] Exiting main loop — cleaning up DB connection");
  await closeDb();
  console.log("[ega-runner] Stopped");
}

// ── Single poll cycle ──────────────────────────────────────────────────────
async function pollOnce(
  db: postgres.Sql<{}>,
  config: Config,
): Promise<void> {
  if (shuttingDown) return;

  const msg = await readMessage(db, config.queueName, config.visibilityTimeoutSeconds);
  if (!msg) {
    if (config.smokeMode) {
      console.log("[ega-runner] Smoke mode: no queue message — nothing to process");
      shuttingDown = true;
      return;
    }
    await sleep(config.pollSeconds * 1000);
    return;
  }

  console.log(
    `[ega-runner] Read queue message msg_id=${msg.msg_id} read_ct=${msg.read_ct}`,
  );

  const payload = msg.message;
  const runId = payload.run_id as string | undefined;

  if (!runId || typeof runId !== "string") {
    console.error(
      `[ega-runner] Malformed queue message msg_id=${msg.msg_id}: missing or invalid run_id`,
    );
    await archiveSafely(db, config.queueName, msg.msg_id);
    return;
  }

  const outcome = await claimRun(db, runId, config.runnerId, config.leaseSeconds);

  switch (outcome.outcome) {
    case "CLAIMED": {
      activeRun = { runId, msgId: msg.msg_id, readCt: msg.read_ct };

      console.log(
        `[ega-runner] Claimed run ${runId} (${outcome.run.linear_issue_identifier ?? "?"})` +
          ` — status → preparing, lease expires in ${config.leaseSeconds}s`,
      );

      try {
        await insertEvent(db, runId, "run_preparing", {
          runner_id: config.runnerId,
          queue_message_id: Number(msg.msg_id),
          read_count: msg.read_ct,
          visibility_timeout_seconds: config.visibilityTimeoutSeconds,
          lease_seconds: config.leaseSeconds,
          source: "ega_runner",
        });
        console.log(`[ega-runner] Event run_preparing persisted for ${runId}`);

        await executeWithHeartbeat(db, config, runId, async () => {
          if (config.smokeMode) {
            await executeSmokeFlow(db, config, runId);
          } else {
            await executePipeline(db, config, runId, payload);
          }
        });

        console.log(`[ega-runner] Processing complete for run ${runId} — archiving queue message`);
        await archiveSafely(db, config.queueName, msg.msg_id);
        console.log(`[ega-runner] Queue message ${msg.msg_id} archived`);
      } catch (err) {
        const msg_err = err instanceof Error ? err.message : String(err);
        console.error(`[ega-runner] Processing failed for run ${runId}: ${msg_err}`);

        try {
          await insertEvent(db, runId, "run_error", {
            error: msg_err,
            runner_id: config.runnerId,
            source: "ega_runner",
          });
        } catch {
          // Best-effort
        }

        console.log(
          `[ega-runner] NOT archiving msg_id=${msg.msg_id} — ` +
            `message will become visible again after VT expiry`,
        );
      } finally {
        activeRun = null;
      }

      if (config.smokeMode) {
        console.log("[ega-runner] Smoke mode: single cycle complete — initiating shutdown");
        shuttingDown = true;
      }
      break;
    }

    case "ACTIVE_VALID_LEASE":
      console.log(`[ega-runner] Queue message for run ${runId}: ${outcome.reason} — preserving`);
      break;

    case "STALE_EXPIRED_LEASE": {
      console.log(`[ega-runner] Stale run detected for ${runId}: ${outcome.reason}`);
      const staleResult = await markRunStale(db, runId, "LEASE_EXPIRED");
      if (!staleResult.ok) {
        console.error(`[ega-runner] Could not mark run ${runId} stale: ${staleResult.reason} — preserving`);
        break;
      }
      try {
        await insertEvent(db, runId, "run_stale", {
          runner_id: config.runnerId,
          reason: "LEASE_EXPIRED",
          previous_owner: outcome.run.claimed_by,
          lease_expired_at: outcome.run.lease_expires_at?.toISOString(),
          source: "ega_runner",
        });
      } catch { /* best-effort */ }
      console.log(`[ega-runner] Stale state persisted — archiving queue message`);
      await archiveSafely(db, config.queueName, msg.msg_id);
      break;
    }

    case "TERMINAL":
      console.log(`[ega-runner] Queue message for terminal run ${runId}: ${outcome.reason} — archiving`);
      await archiveSafely(db, config.queueName, msg.msg_id);
      break;

    case "NOT_FOUND":
      console.error(`[ega-runner] ${outcome.reason} — archiving`);
      await archiveSafely(db, config.queueName, msg.msg_id);
      break;

    case "CLAIM_RACE_LOST":
      console.log(`[ega-runner] ${outcome.reason} — preserving for retry`);
      break;

    case "UNKNOWN_INCONSISTENT_STATE":
      console.error(`[ega-runner] FAIL CLOSED: ${outcome.reason} — preserving message`);
      try {
        await insertEvent(db, runId, "run_classification_error", {
          runner_id: config.runnerId,
          outcome: outcome.outcome,
          reason: outcome.reason,
          run_status: (outcome as ClaimOutcome & { run?: { status?: string } }).run?.status ?? "unknown",
          queue_message_id: Number(msg.msg_id),
          source: "ega_runner",
        });
      } catch { /* best-effort */ }
      break;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE EXECUTION — hardened with all gates
// ═════════════════════════════════════════════════════════════════════════════

interface PipelineContext {
  runId: string;
  issueIdentifier: string;
  issueId: string;
  issueUrl: string;
  contextHash: string;
  baseSha: string;
  branchName: string;
  worktreePath: string;
  repoRoot: string;
  validationCommands: string[];
  projectSlug: string;
  baseBranch: string;
  allowedPaths: string[];
  hermesRunId: string;
  evidenceDir: string;
}

async function executePipeline(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // ── 0. Parse payload ─────────────────────────────────────────────────────
  const payload_parsed = {
    run_id: payload.run_id as string,
    project_id: payload.project_id as string,
    project_slug: payload.project_slug as string || "ega-house-platform",
    github_repo: payload.github_repo as string || "egawilldoit/Ega-House-Platform",
    base_branch: payload.base_branch as string || "main",
    linear_issue_id: payload.linear_issue_id as string,
    linear_issue_identifier: payload.linear_issue_identifier as string,
    linear_issue_url: payload.linear_issue_url as string,
    attempt_number: (payload.attempt_number as number) || 1,
    validation_commands: (payload.validation_commands as string[]) || ["npm run typecheck", "npm run lint", "npm test"],
  };

  console.log(`[pipeline] Starting pipeline for ${payload_parsed.linear_issue_identifier} (run ${runId})`);

  let pipelineCtx: PipelineContext | null = null;
  let worktreeResult: import("./worktree.js").WorktreeResult | null = null;
  const repoRoot = process.env.EGA_RUNNER_REPO_ROOT || process.cwd();
  let hermesOutput: ExecutionOutput | null = null;
  let recoveryModifiedProductFiles = false;
  let slackTs: string | null = null;

  try {
    // ── 1. Resolve Linear issue + parent Spec ─────────────────────────────
    await insertEvent(db, runId, "pipeline_fetching_context", {
      issue_id: payload_parsed.linear_issue_id,
      source: "ega_runner",
    });

    const contextResult = await fetchIssueSpec(
      payload_parsed as import("./context.js").QueuePayload,
      db,
    );

    if (!contextResult.authorizationCheck.ok) {
      console.error(`[pipeline] Authorization failed: ${contextResult.authorizationCheck.reason}`);
      await insertEvent(db, runId, "pipeline_auth_failed", {
        reason: contextResult.authorizationCheck.reason,
        source: "ega_runner",
      });
      await cancelRun(db, runId, config.runnerId, "AUTH_FAILED");
      await postSlackNotification({
        channel: config.slackChannel || "#hermes-today",
        runId,
        issueIdentifier: contextResult.issue.identifier,
        issueUrl: payload_parsed.linear_issue_url,
        prUrl: null,
        vercelPreviewUrl: null,
        status: "failed",
        summary: `Authorization failed: ${contextResult.authorizationCheck.reason}`,
      });
      return;
    }

    console.log(`[pipeline] Authorization passed for ${contextResult.issue.identifier}`);

    // Persist parent info
    const parentId = contextResult.parent?.id ?? null;
    const parentIdentifier = contextResult.parent?.identifier ?? null;

    await insertEvent(db, runId, "pipeline_context_fetched", {
      issue_identifier: contextResult.issue.identifier,
      parent_issue_id: parentId,
      parent_issue_identifier: parentIdentifier,
      ready_for_hermes: contextResult.issue.readyForHermes,
      source: "ega_runner",
    });

    // ── 2. Post "started" Slack notification ──────────────────────────────
    slackTs = await postSlackNotification({
      channel: config.slackChannel || "#hermes-today",
      runId,
      issueIdentifier: contextResult.issue.identifier,
      issueUrl: payload_parsed.linear_issue_url,
      prUrl: null,
      vercelPreviewUrl: null,
      status: "started",
      summary: `Pipeline started for ${contextResult.issue.identifier}: ${contextResult.issue.title}`,
    });

    // ── 3. Extract and validate allowed paths ────────────────────────────
    const allowedPaths = extractAllowedPathsFromDescription(contextResult.issue.description);
    await insertEvent(db, runId, "pipeline_allowed_paths", {
      path_count: allowedPaths.length,
      paths: allowedPaths,
      source: "ega_runner",
    });
    console.log(`[pipeline] Extracted ${allowedPaths.length} authorized path(s)`);

    if (allowedPaths.length === 0) {
      const msg = `No authorized file paths extracted from issue description — scope extraction failed`;
      console.error(`[pipeline] ${msg}`);
      await insertEvent(db, runId, "pipeline_scope_missing", {
        issue_identifier: contextResult.issue.identifier,
        source: "ega_runner",
      });
      await cancelRun(db, runId, config.runnerId, "AUTHORIZED_SCOPE_MISSING");
      await postSlackNotification({
        channel: config.slackChannel || "#hermes-today",
        runId,
        issueIdentifier: contextResult.issue.identifier,
        issueUrl: payload_parsed.linear_issue_url,
        prUrl: null,
        vercelPreviewUrl: null,
        status: "failed",
        summary: msg,
      });
      return;
    }

    // ── 4. Create worktree and branch ─────────────────────────────────────
    await insertEvent(db, runId, "pipeline_creating_worktree", {
      base_branch: payload_parsed.base_branch,
      attempt_number: payload_parsed.attempt_number,
      source: "ega_runner",
    });

    const hermesRunId = `ega:${runId}:attempt:${payload_parsed.attempt_number}`;
    const evidenceDir = createEvidenceDir(
      repoRoot,
      contextResult.issue.identifier,
      runId,
      payload_parsed.attempt_number,
    );

    worktreeResult = createWorktree(
      repoRoot,
      payload_parsed.base_branch,
      payload_parsed.linear_issue_identifier,
      payload_parsed.attempt_number,
      runId,
    );

    // Compute expanded deterministic context hash
    const contextHash = computeContextHash(
      payload_parsed as import("./context.js").QueuePayload,
      contextResult.issue,
      contextResult.parent,
      allowedPaths,
      worktreeResult.baseSha,
    );

    pipelineCtx = {
      runId,
      issueIdentifier: contextResult.issue.identifier,
      issueId: contextResult.issue.id,
      issueUrl: payload_parsed.linear_issue_url,
      contextHash,
      baseSha: worktreeResult.baseSha,
      branchName: worktreeResult.branchName,
      worktreePath: worktreeResult.worktreePath,
      repoRoot: worktreeResult.repoRoot,
      validationCommands: payload_parsed.validation_commands,
      projectSlug: payload_parsed.project_slug,
      baseBranch: payload_parsed.base_branch,
      allowedPaths,
      hermesRunId,
      evidenceDir,
    };

    // ── 5. Persist base SHA, branch, worktree, hermes_run_id BEFORE Hermes starts ──
    await db`
      UPDATE automation.implementation_runs
      SET
        context_hash = ${pipelineCtx.contextHash},
        base_sha = ${pipelineCtx.baseSha},
        branch_name = ${pipelineCtx.branchName},
        worktree_path = ${pipelineCtx.worktreePath},
        hermes_run_id = ${pipelineCtx.hermesRunId},
        status = 'running',
        updated_at = now()
      WHERE id = ${runId}::uuid
        AND claimed_by = ${config.runnerId}
    `;

    console.log(`[pipeline] Worktree ready: ${pipelineCtx.worktreePath} @ ${pipelineCtx.baseSha.substring(0, 12)}`);

    await insertEvent(db, runId, "pipeline_worktree_created", {
      worktree_path: pipelineCtx.worktreePath,
      base_sha: pipelineCtx.baseSha,
      branch: pipelineCtx.branchName,
      context_hash: pipelineCtx.contextHash,
      hermes_run_id: pipelineCtx.hermesRunId,
      source: "ega_runner",
    });

    await insertEvent(db, runId, "pipeline_hermes_identity_created", {
      hermes_run_id: pipelineCtx.hermesRunId,
      source: "ega_runner",
    });

    // ── 6. Start Hermes ──────────────────────────────────────────────────
    const headBefore = execSyncSafe(`git rev-parse HEAD`, worktreeResult.worktreePath);

    await insertEvent(db, runId, "pipeline_hermes_started", {
      worktree_path: pipelineCtx.worktreePath,
      max_turns: config.maxTurns || 50,
      timeout_ms: config.hermesTimeoutMs || 1800000,
      validation_commands: pipelineCtx.validationCommands,
      hermes_run_id: pipelineCtx.hermesRunId,
      authorized_paths: pipelineCtx.allowedPaths,
      source: "ega_runner",
    });

    const resultFilePath = path.resolve(pipelineCtx.worktreePath, ".ega-runner", "hermes-result.json");

    hermesOutput = await executeHermes({
      worktreePath: pipelineCtx.worktreePath,
      timeoutMs: config.hermesTimeoutMs || 1800000,
      maxTurns: config.maxTurns || 50,
      runId,
      issueId: pipelineCtx.issueId,
      issueIdentifier: pipelineCtx.issueIdentifier,
      baseSha: pipelineCtx.baseSha,
      validationCommands: pipelineCtx.validationCommands,
      extraEnv: {
        EGA_RUN_ID: runId,
        EGA_ISSUE_ID: pipelineCtx.issueId,
        EGA_HERMES_RUN_ID: pipelineCtx.hermesRunId,
      },
      authorizedPaths: pipelineCtx.allowedPaths,
      resultFilePath,
      hermesRunId: pipelineCtx.hermesRunId,
      isRecovery: false,
    });

    // ── 7. Preserve stdout/stderr ────────────────────────────────────────
    const stdoutArtifacts = preserveHermesOutput(
      pipelineCtx.evidenceDir,
      hermesOutput.rawStdout,
      hermesOutput.rawStderr,
      hermesOutput.recoveryAttempted,
    );

    await insertEvent(db, runId, "pipeline_hermes_exited", {
      exit_code: hermesOutput.exitCode,
      timed_out: hermesOutput.timedOut,
      signal: hermesOutput.signal,
      recovery_attempted: hermesOutput.recoveryAttempted,
      has_result: hermesOutput.result !== null,
      source: "ega_runner",
    });

    // ── 8. Check timeout ────────────────────────────────────────────────
    if (hermesOutput.timedOut) {
      console.error(`[pipeline] Hermes timed out after ${config.hermesTimeoutMs || 1800000}ms`);
      const msg = `Hermes timed out after ${(config.hermesTimeoutMs || 1800000) / 60000} minutes`;
      await persistFailureAndNotify(db, config, runId, pipelineCtx, "HERMES_TIMEOUT", msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, "HERMES_TIMEOUT", msg, []);
      return;
    }

    // ── 9. Recovery scope check ──────────────────────────────────────────
    if (hermesOutput.recoveryAttempted) {
      const headAfterRecovery = execSyncSafe(`git rev-parse HEAD`, pipelineCtx.worktreePath);
      if (headAfterRecovery !== headBefore) {
        recoveryModifiedProductFiles = true;
        console.error("[pipeline] Recovery attempt modified product working tree");
        const msg = "Recovery attempt modified product files — scope violation";
        await persistFailureAndNotify(db, config, runId, pipelineCtx, "RESULT_RECOVERY_SCOPE_VIOLATION", msg, slackTs);
        await writeFailureEvidence(pipelineCtx, hermesOutput.result, "RESULT_RECOVERY_SCOPE_VIOLATION", msg, []);
        return;
      }
    }

    // ── 10. Verify or recover structured result ──────────────────────────
    if (!hermesOutput.result) {
      const msg = `Hermes did not produce a valid result file after ${hermesOutput.recoveryAttempted ? "recovery" : "execution"}`;
      const failureCode = hermesOutput.recoveryAttempted ? "MISSING_RESULT" : "MISSING_RESULT";
      console.error(`[pipeline] ${msg}`);
      await persistFailureAndNotify(db, config, runId, pipelineCtx, failureCode, msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, failureCode, msg, []);
      return;
    }

    // Validate schema
    const schemaCheck = validateHermesResultSchema(hermesOutput.result);
    if (!schemaCheck.ok) {
      const msg = `Invalid result schema: ${schemaCheck.error}`;
      console.error(`[pipeline] ${msg}`);
      await persistFailureAndNotify(db, config, runId, pipelineCtx, "INVALID_RESULT", msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, "INVALID_RESULT", msg, []);
      return;
    }

    // ── 11. Compute actual changed files ──────────────────────────────────
    const changedFiles = collectChangedProductPaths(pipelineCtx.worktreePath, pipelineCtx.baseSha);
    console.log(`[pipeline] Changed files: ${changedFiles.length} file(s)`);

    await insertEvent(db, runId, "pipeline_changed_files_computed", {
      file_count: changedFiles.length,
      files: changedFiles,
      source: "ega_runner",
    });

    // ── 12. Enforce scope ────────────────────────────────────────────────
    if (pipelineCtx.allowedPaths.length > 0) {
      const scopeViolation = enforceScope(pipelineCtx.allowedPaths, changedFiles, pipelineCtx.worktreePath, pipelineCtx.baseSha);
      if (scopeViolation) {
        const msg = scopeViolation.message;
        console.error(`[pipeline] ${msg}`);
        await persistFailureAndNotify(db, config, runId, pipelineCtx, "SCOPE_VIOLATION", msg, slackTs);
        await writeFailureEvidence(pipelineCtx, hermesOutput.result, "SCOPE_VIOLATION", msg, changedFiles);
        return;
      }
      console.log(`[pipeline] Scope enforcement: PASSED (${changedFiles.length} file(s) in authorized scope)`);
    }

    // ── 13. Verify Hermes result against Git ──────────────────────────────
    const resultCheck = verifyResult(pipelineCtx.worktreePath, hermesOutput.result, pipelineCtx.baseSha);

    await insertEvent(db, runId, "pipeline_hermes_result_verified", {
      ok: resultCheck.ok,
      findings_count: resultCheck.findings.length,
      source: "ega_runner",
    });

    // ── 14. Verify real implementation commit ─────────────────────────────
    const commitCheck = verifyImplementationCommit(
      pipelineCtx.worktreePath,
      pipelineCtx.baseSha,
      pipelineCtx.branchName,
      pipelineCtx.allowedPaths,
    );

    // Write findings to events
    for (const f of commitCheck.findings) {
      await insertEvent(db, runId, "pipeline_commit_finding", {
        check: f.check,
        passed: f.passed,
        detail: f.detail,
        source: "ega_runner",
      }).catch(() => {});
    }

    if (!commitCheck.ok) {
      const failureCode = commitCheck.findings.some(f => f.check === "implementation_commit_exists" && !f.passed)
        ? "MISSING_IMPLEMENTATION_COMMIT"
        : commitCheck.findings.some(f => f.check === "implementation_diff" && !f.passed)
          ? "NO_IMPLEMENTATION_CHANGE"
          : commitCheck.findings.some(f => f.check === "implementation_diff_scope" && !f.passed)
            ? "SCOPE_VIOLATION"
            : "COMMIT_VERIFICATION_FAILED";

      const msg = `Implementation commit verification failed: ${commitCheck.findings.filter(f => !f.passed).map(f => `${f.check}: ${f.detail}`).join("; ")}`;
      console.error(`[pipeline] ${msg}`);
      await persistFailureAndNotify(db, config, runId, pipelineCtx, failureCode, msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, failureCode, msg, changedFiles);
      return;
    }

    const commitSha = commitCheck.commitSha!;

    // ── 15. Persist result_json ──────────────────────────────────────────
    await db`
      UPDATE automation.implementation_runs
      SET
        result_json = ${JSON.stringify(hermesOutput.result)},
        updated_at = now()
      WHERE id = ${runId}::uuid
        AND claimed_by = ${config.runnerId}
    `;

    // ── 16. Push the branch ──────────────────────────────────────────────
    await insertEvent(db, runId, "pipeline_pushing_branch", {
      branch: pipelineCtx.branchName,
      source: "ega_runner",
    });

    const pushResult = pushBranch(pipelineCtx.repoRoot, pipelineCtx.branchName);
    if (!pushResult.ok) {
      const msg = `Branch push failed: ${pushResult.error}`;
      console.error(`[pipeline] ${msg}`);
      await persistFailureAndNotify(db, config, runId, pipelineCtx, "PUSH_FAILED", msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, "PUSH_FAILED", msg, changedFiles);
      return;
    }

    // ── 17. Resolve and verify pushed head SHA ──────────────────────────
    const pushedSha = getRemoteCommitSha(pipelineCtx.repoRoot, pipelineCtx.branchName);
    if (!pushedSha || pushedSha !== commitSha) {
      const msg = `Pushed SHA mismatch: local=${commitSha.substring(0, 12)} remote=${pushedSha?.substring(0, 12) ?? "null"}`;
      console.error(`[pipeline] ${msg}`);
      await persistFailureAndNotify(db, config, runId, pipelineCtx, "PUSH_SHA_MISMATCH", msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, "PUSH_SHA_MISMATCH", msg, changedFiles);
      return;
    }

    await insertEvent(db, runId, "pipeline_branch_pushed", {
      branch: pipelineCtx.branchName,
      commit_sha: commitSha,
      remote_sha: pushedSha,
      source: "ega_runner",
    });

    // ── 18. Publish pending commit status ────────────────────────────────
    const pendingStatus = createCommitStatus(
      pipelineCtx.repoRoot,
      pushedSha,
      "pending",
      `EGA Hermes Pipeline: implementation in progress (run ${runId.substring(0, 8)})`,
      "ega/hermes-pipeline",
    );

    if (pendingStatus.ok) {
      await insertEvent(db, runId, "pipeline_commit_status_pending", {
        sha: pushedSha,
        context: "ega/hermes-pipeline",
        source: "ega_runner",
      });
    } else if (pendingStatus.error === "GITHUB_STATUS_PERMISSION_DENIED") {
      await insertEvent(db, runId, "pipeline_commit_status_permission_denied", {
        sha: pushedSha,
        error: pendingStatus.error,
        source: "ega_runner",
      });
    }

    // ── 19. Run verification (result + commit already verified above) ────
    const verificationOk = resultCheck.ok && commitCheck.ok;
    const failedFindings = [
      ...resultCheck.findings.filter(f => !f.passed),
      ...commitCheck.findings.filter(f => !f.passed),
    ];

    await insertEvent(db, runId, "pipeline_verification_complete", {
      ok: verificationOk,
      findings_count: failedFindings.length,
      findings_summary: failedFindings.map(f => f.check).join(", "),
      branch: pipelineCtx.branchName,
      commit_sha: commitSha.substring(0, 12),
      source: "ega_runner",
    });

    if (!verificationOk) {
      const msg = `Verification failed: ${failedFindings.map(f => `${f.check}: ${f.detail}`).join("; ")}`;
      await persistFailureAndNotify(db, config, runId, pipelineCtx, "VERIFICATION_FAILED", msg, slackTs);
      await writeFailureEvidence(pipelineCtx, hermesOutput.result, "VERIFICATION_FAILED", msg, changedFiles);
      return;
    }

    // ── 20. Publish success/failure commit status ────────────────────────
    const finalStatus = createCommitStatus(
      pipelineCtx.repoRoot,
      pushedSha,
      "success",
      "EGA Hermes Pipeline: all checks passed",
      "ega/hermes-pipeline",
    );

    await insertEvent(db, runId, "pipeline_commit_status_final", {
      sha: pushedSha,
      state: "success",
      context: "ega/hermes-pipeline",
      ok: finalStatus.ok,
      error: finalStatus.error,
      source: "ega_runner",
    });

    // ── 21. Open PR ──────────────────────────────────────────────────────
    let prUrl: string | null = null;
    let prNumber: number | null = null;

    try {
      const prTitle = `[${pipelineCtx.issueIdentifier}] ${contextResult.issue.title}`;
      const prBody = buildPRBody(pipelineCtx, contextResult, changedFiles, hermesOutput.result);
      const prResult = createPR(pipelineCtx.repoRoot, pipelineCtx.branchName, pipelineCtx.baseBranch, prTitle, prBody);
      prNumber = prResult.prNumber;
      prUrl = prResult.url;

      if (prNumber) {
        await insertEvent(db, runId, "pipeline_pr_created", {
          pr_number: prNumber,
          pr_url: prUrl,
          source: "ega_runner",
        });

        await db`
          UPDATE automation.implementation_runs
          SET
            pr_number = ${prNumber},
            pr_url = ${prUrl},
            updated_at = now()
          WHERE id = ${runId}::uuid
            AND claimed_by = ${config.runnerId}
        `;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] PR creation error: ${msg}`);
      await insertEvent(db, runId, "pipeline_pr_failed", {
        error: msg,
        source: "ega_runner",
      });
    }

    // ── 22. Persist final evidence ───────────────────────────────────────
    const headAfter = execSyncSafe(`git rev-parse HEAD`, pipelineCtx.worktreePath);
    const gitEvidenceArtifacts = preserveGitEvidence(
      pipelineCtx.evidenceDir,
      pipelineCtx.worktreePath,
      pipelineCtx.baseSha,
      headBefore,
      headAfter,
      changedFiles,
    );

    const resultArtifacts = copyWorktreeEvidence(pipelineCtx.worktreePath, pipelineCtx.evidenceDir);
    const allArtifacts = [
      ...stdoutArtifacts,
      ...gitEvidenceArtifacts,
      ...resultArtifacts,
    ];

    writeEvidenceManifest(pipelineCtx.evidenceDir, runId, pipelineCtx.issueIdentifier, payload_parsed.attempt_number, allArtifacts);

    // ── 23. Mark completed ───────────────────────────────────────────────
    await db`
      UPDATE automation.implementation_runs
      SET
        status = 'completed',
        pr_number = ${prNumber},
        pr_url = ${prUrl},
        pr_head_sha = ${commitSha},
        finished_at = now()
      WHERE id = ${runId}::uuid
        AND claimed_by = ${config.runnerId}
    `;

    await insertEvent(db, runId, "run_completed", {
      final_status: "completed",
      branch: pipelineCtx.branchName,
      commit_sha: commitSha.substring(0, 12),
      pr_number: prNumber,
      pr_url: prUrl,
      evidence_dir: pipelineCtx.evidenceDir,
      source: "ega_runner",
    });

    // ── 24. Slack notification ───────────────────────────────────────────
    await postSlackNotification({
      channel: config.slackChannel || "#hermes-today",
      runId,
      issueIdentifier: pipelineCtx.issueIdentifier,
      issueUrl: pipelineCtx.issueUrl,
      prUrl,
      vercelPreviewUrl: null,
      status: "completed",
      summary: `Pipeline completed for ${pipelineCtx.issueIdentifier}. PR: ${prUrl ?? "N/A"}`,
      threadTs: slackTs ?? undefined,
    });

    console.log(`[pipeline] Pipeline complete for ${pipelineCtx.issueIdentifier} — status=completed`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Fatal error: ${msg}`);

    const failureCode = pipelineCtx ? "PIPELINE_ERROR" : "SETUP_ERROR";

    if (pipelineCtx) {
      await persistFailureAndNotify(db, config, runId, pipelineCtx, failureCode, msg, slackTs);
    } else {
      await cancelRun(db, runId, config.runnerId, failureCode);
      await insertEvent(db, runId, "run_failed", {
        failure_code: failureCode,
        error: msg,
        source: "ega_runner",
      }).catch(() => {});
      await postSlackNotification({
        channel: config.slackChannel || "#hermes-today",
        runId,
        issueIdentifier: payload_parsed.linear_issue_identifier,
        issueUrl: payload_parsed.linear_issue_url,
        prUrl: null,
        vercelPreviewUrl: null,
        status: "failed",
        summary: `${failureCode}: ${msg}`,
      });
    }

    // Cleanup worktree
    if (worktreeResult) {
      try {
        removeWorktree(repoRoot, worktreeResult.worktreePath, worktreeResult.branchName);
      } catch {
        // best-effort
      }
    }

    throw err;
  }
}

// ── Failure helpers ─────────────────────────────────────────────────────────

async function persistFailureAndNotify(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  ctx: PipelineContext,
  failureCode: string,
  message: string,
  slackTs: string | null,
): Promise<void> {
  await cancelRun(db, runId, config.runnerId, failureCode);

  await insertEvent(db, runId, "run_failed", {
    failure_code: failureCode,
    error: message,
    branch: ctx.branchName,
    source: "ega_runner",
  });

  await postSlackNotification({
    channel: config.slackChannel || "#hermes-today",
    runId,
    issueIdentifier: ctx.issueIdentifier,
    issueUrl: ctx.issueUrl,
    prUrl: null,
    vercelPreviewUrl: null,
    status: "failed",
    summary: `[${failureCode}] ${message}`,
    threadTs: slackTs ?? undefined,
  });
}

async function writeFailureEvidence(
  ctx: PipelineContext,
  result: HermesResult | null,
  failureCode: string,
  message: string,
  changedFiles: string[],
): Promise<void> {
  writeFailureSummary(ctx.evidenceDir, failureCode, message, 1);
  if (result) {
    writeEvidenceFile(ctx.evidenceDir, "hermes-result.json", JSON.stringify(result, null, 2));
  }
  writeEvidenceFile(ctx.evidenceDir, "changed-files.txt", changedFiles.join("\n"));
}

function buildPRBody(
  ctx: PipelineContext,
  contextResult: { issue: { identifier: string; title: string }; parent: { identifier: string | null; title: string | null } | null },
  changedFiles: string[],
  result: HermesResult,
): string {
  const lines = [
    `# [${ctx.issueIdentifier}] ${contextResult.issue.title}`,
    ``,
    `## Summary`,
    result.executionLog,
    ``,
    `## Files Changed`,
    changedFiles.map(f => `- \`${f}\``).join("\n"),
    ``,
    `## Validation`,
    ...result.validations.map(v => `- \`${v.command}\`: ${v.passed ? "PASS" : "FAIL"} (exit ${v.exitCode})`),
    ``,
    `## Standards Review`,
    result.standardsReview ?? "N/A",
    ``,
    `## Spec Review`,
    result.specReview ?? "N/A",
    ``,
    `## Risks`,
    ...result.risks.map(r => `- ${r}`),
    ``,
    `## Parent Spec`,
    contextResult.parent
      ? `${contextResult.parent.identifier}: ${contextResult.parent.title ?? "N/A"}`
      : "No parent spec",
    ``,
    `## Evidence`,
    `- Evidence: \`${ctx.evidenceDir}\``,
    `- Run ID: \`${ctx.runId}\``,
    `- Hermes Correlation ID: \`${ctx.hermesRunId}\``,
    ``,
    `---`,
    `_Generated by EGA Runner_`,
  ];
  return lines.join("\n");
}

// ── Smoke flow ──────────────────────────────────────────────────────────────
async function executeSmokeFlow(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
): Promise<void> {
  console.log(`[ega-runner] SMOKE: starting smoke flow for ${runId}`);

  await insertEvent(db, runId, "runner_smoke_started", {
    runner_id: config.runnerId,
    source: "ega_runner",
  });

  const beatCycles = 3;
  for (let i = 1; i <= beatCycles; i++) {
    console.log(`[ega-runner] SMOKE: heartbeat cycle ${i}/${beatCycles} (waiting ${config.heartbeatSeconds}s)`);
    await sleep(config.heartbeatSeconds * 1000);
  }

  await insertEvent(db, runId, "runner_smoke_completed", {
    runner_id: config.runnerId,
    heartbeat_cycles: beatCycles,
    lease_seconds: config.leaseSeconds,
    visibility_timeout_seconds: config.visibilityTimeoutSeconds,
    source: "ega_runner",
  });

  const cancelled = await cancelRun(db, runId, config.runnerId, "SMOKE_TEST_CLEANUP");
  if (!cancelled) {
    console.error(`[ega-runner] SMOKE: could not cancel run ${runId} — lease may have been lost`);
    throw new Error("smoke cleanup failed — could not cancel run");
  }

  await insertEvent(db, runId, "run_cancelled", {
    reason: "smoke_test_cleanup",
    result: "runner_smoke_passed",
    runner_id: config.runnerId,
    source: "ega_runner",
  });

  console.log(`[ega-runner] SMOKE: run ${runId} cancelled — smoke flow complete`);
}

// ── Heartbeat loop ─────────────────────────────────────────────────────────
async function executeWithHeartbeat(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  work: () => Promise<void>,
): Promise<void> {
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatError = false;

  try {
    heartbeatInterval = setInterval(async () => {
      if (shuttingDown) return;

      const leaseResult = await extendLease(db, runId, config.runnerId, config.leaseSeconds);
      if (!leaseResult.ok) {
        console.error(`[ega-runner] ${leaseResult.reason}`);
        heartbeatError = true;
        return;
      }

      if (activeRun) {
        try {
          await setVisibilityTimeout(db, config.queueName, activeRun.msgId, config.visibilityTimeoutSeconds);
        } catch (err) {
          console.error(`[ega-runner] pgmq.set_vt failed: ${err instanceof Error ? err.message : String(err)}`);
          heartbeatError = true;
        }
      }
    }, config.heartbeatSeconds * 1000);

    await work();
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }

  if (heartbeatError) {
    throw new Error("heartbeat failure detected — processing aborted");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
async function archiveSafely(db: postgres.Sql<{}>, queueName: string, msgId: bigint): Promise<void> {
  try {
    await archiveMessage(db, queueName, msgId);
  } catch (err) {
    console.error(`[ega-runner] Failed to archive msg_id=${msgId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleShutdown(signal: string): void {
  if (shuttingDown) {
    console.log(`[ega-runner] Forced exit (double ${signal})`);
    process.exit(1);
  }

  shuttingDown = true;
  console.log(
    `[ega-runner] ${signal} received — graceful shutdown requested` +
      (activeRun
        ? ` (active run ${activeRun.runId} will be abandoned — VT will expire)`
        : ""),
  );
}

function execSyncSafe(command: string, cwd: string): string {
  try {
    const { execSync } = require("node:child_process");
    return execSync(command, { cwd, stdio: "pipe", encoding: "utf8", timeout: 30000 }).toString().trim();
  } catch {
    return "";
  }
}

// ── Entry ──────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error(
    "[ega-runner] Fatal:",
    err instanceof Error ? err.message : String(err),
  );
  closeDb().finally(() => process.exit(1));
});
