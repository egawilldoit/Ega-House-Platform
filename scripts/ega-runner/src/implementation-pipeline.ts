import { execFileSync } from "node:child_process";
import path from "node:path";
import type postgres from "postgres";
import type { Config } from "./config.js";
import { computeContextHash, fetchIssueSpec, type ContextResult, type QueuePayload } from "./context.js";
import { insertEvent } from "./event-log.js";
import {
  copyWorktreeEvidence,
  createEvidenceDir,
  preserveGitEvidence,
  preserveHermesOutput,
  writeEvidenceFile,
  writeEvidenceManifest,
  writeFailureSummary,
  type EvidenceArtifact,
} from "./evidence.js";
import {
  createCommitStatus,
  createOrReusePR,
  getPRInfo,
  getRemoteCommitSha,
  pushBranch,
} from "./github.js";
import { executeHermes, type ExecutionOutput, type HermesResult } from "./hermes-executor.js";
import { postSlackNotification } from "./notify.js";
import { validateHermesResultSchema, verifyImplementationCommit, verifyResult } from "./result.js";
import { collectChangedProductPaths, enforceScope, extractAllowedPathsFromDescription } from "./scope.js";
import { runValidationCommands, type ValidationSuiteResult } from "./validation.js";
import { createWorktree, type WorktreeResult } from "./worktree.js";

export interface PipelineOutcome {
  archiveMessage: boolean;
  status: string;
}

interface PipelineContext {
  runId: string;
  issueIdentifier: string;
  issueId: string;
  issueUrl: string | null;
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
  attemptNumber: number;
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

function parsePayload(runId: string, payload: Record<string, unknown>): QueuePayload {
  const validationCommands = Array.isArray(payload.validation_commands)
    ? payload.validation_commands.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return {
    run_id: runId,
    project_id: String(payload.project_id ?? ""),
    project_slug: String(payload.project_slug ?? "ega-house-platform"),
    github_repo: String(payload.github_repo ?? "egawilldoit/Ega-House-Platform"),
    base_branch: String(payload.base_branch ?? "main"),
    linear_issue_id: String(payload.linear_issue_id ?? ""),
    linear_issue_identifier: String(payload.linear_issue_identifier ?? ""),
    linear_issue_url: String(payload.linear_issue_url ?? ""),
    attempt_number: Number(payload.attempt_number ?? 1),
    validation_commands: validationCommands.length > 0
      ? validationCommands
      : ["npm run typecheck", "npm run lint", "npm test", "npm run build"],
  };
}

async function persistFailure(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  status: "failed" | "validation_failed" | "pr_failed",
  failureCode: string,
  message: string,
  context: PipelineContext | null,
  slackThreadTs: string | null,
): Promise<PipelineOutcome> {
  if (context) {
    writeFailureSummary(context.evidenceDir, failureCode, message, context.attemptNumber);
  }

  await insertEvent(db, runId, "run_failed", {
    final_status: status,
    failure_code: failureCode,
    error: message,
    branch: context?.branchName ?? null,
    source: "ega_runner",
  });

  const rows = await db`
    UPDATE automation.implementation_runs
    SET status = ${status},
        failure_code = ${failureCode},
        finished_at = now(),
        claimed_by = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = ${runId}::uuid
      AND status IN ('preparing', 'running')
      AND claimed_by = ${config.runnerId}
    RETURNING id
  `;
  if (rows.length !== 1) {
    const current = await db`
      SELECT status, failure_code
      FROM automation.implementation_runs
      WHERE id = ${runId}::uuid
    `;
    if (String(current[0]?.status ?? "") !== status || String(current[0]?.failure_code ?? "") !== failureCode) {
      throw new Error(`Failed to persist terminal state ${status} for run ${runId}`);
    }
  }

  await postSlackNotification({
    channel: config.slackChannel,
    runId,
    issueIdentifier: context?.issueIdentifier ?? "unknown",
    issueUrl: context?.issueUrl ?? "",
    prUrl: null,
    vercelPreviewUrl: null,
    status: "failed",
    summary: `[${failureCode}] ${message}`,
    threadTs: slackThreadTs ?? undefined,
  }).catch(() => undefined);
  return { archiveMessage: true, status };
}

function buildPRBody(
  context: PipelineContext,
  contextResult: ContextResult,
  changedFiles: string[],
  hermesResult: HermesResult,
  validation: ValidationSuiteResult,
): string {
  return [
    `# [${context.issueIdentifier}] ${contextResult.issue.title}`,
    "",
    "## Summary",
    hermesResult.executionLog,
    "",
    "## Work contract",
    `- Linear issue: ${context.issueUrl ?? context.issueIdentifier}`,
    `- Parent spec: ${contextResult.parent ? `${contextResult.parent.identifier} — ${contextResult.parent.title}` : "None"}`,
    `- Run ID: \`${context.runId}\``,
    `- Context hash: \`${context.contextHash}\``,
    `- Base SHA: \`${context.baseSha}\``,
    `- Head SHA: \`${hermesResult.commit}\``,
    "",
    "## Files changed",
    ...changedFiles.map((file) => `- \`${file}\``),
    "",
    "## Runner-owned validation",
    ...validation.results.map((item) => `- \`${item.command}\`: ${item.passed ? "PASS" : "FAIL"} (exit ${item.exitCode})`),
    "",
    "## Standards review",
    hermesResult.standardsReview ?? "Not provided",
    "",
    "## Spec review",
    hermesResult.specReview ?? "Not provided",
    "",
    "## Risks",
    ...(hermesResult.risks.length > 0 ? hermesResult.risks.map((risk) => `- ${risk}`) : ["- None reported"]),
    "",
    "## Evidence",
    `- Durable evidence directory: \`${context.evidenceDir}\``,
    `- Hermes correlation ID: \`${context.hermesRunId}\``,
    "",
    "---",
    "Generated by EGA Runner. Human review and merge remain required unless explicit auto-merge policy is enabled.",
  ].join("\n");
}

export async function executeImplementationRun(
  db: postgres.Sql<{}>,
  config: Config,
  runId: string,
  rawPayload: Record<string, unknown>,
): Promise<PipelineOutcome> {
  const payload = parsePayload(runId, rawPayload);
  let context: PipelineContext | null = null;
  let slackThreadTs: string | null = null;
  let worktree: WorktreeResult | null = null;
  let hermesOutput: ExecutionOutput | null = null;

  try {
    const contextResult = await fetchIssueSpec(payload, db);
    if (!contextResult.authorizationCheck.ok) {
      return persistFailure(
        db,
        config,
        runId,
        "failed",
        "LINEAR_AUTH_MISSING",
        contextResult.authorizationCheck.reason ?? "Linear authorization failed",
        null,
        null,
      );
    }

    slackThreadTs = await postSlackNotification({
      channel: config.slackChannel,
      runId,
      issueIdentifier: contextResult.issue.identifier,
      issueUrl: payload.linear_issue_url,
      prUrl: null,
      vercelPreviewUrl: null,
      status: "started",
      summary: `Implementation started for ${contextResult.issue.identifier}: ${contextResult.issue.title}`,
    });

    const allowedPaths = extractAllowedPathsFromDescription(contextResult.issue.description);
    if (allowedPaths.length === 0) {
      return persistFailure(
        db,
        config,
        runId,
        "failed",
        "AUTHORIZED_SCOPE_MISSING",
        "No authorized product files could be extracted from the LiRnear issue",
        null,
        slackThreadTs,
      );
    }

    worktree = createWorktree(
      config.repoRoot,
      payload.base_branch,
      contextResult.issue.identifier,
      payload.attempt_number,
      runId,
    );

    const contextHash = computeContextHash(payload, contextResult.issue, contextResult.parent, allowedPaths, worktree.baseSha);
    const hermesRunId = `ega:${runId}:attempt:${payload.attempt_number}`;
    const evidenceDir = createEvidenceDir(config.repoRoot, contextResult.issue.identifier, runId, payload.attempt_number);
    context = {
      runId,
      issueIdentifier: contextResult.issue.identifier,
      issueId: contextResult.issue.id,
      issueUrl: payload.linear_issue_url || null,
      contextHash,
      baseSha: worktree.baseSha,
      branchName: worktree.branchName,
      worktreePath: worktree.worktreePath,
      repoRoot: config.repoRoot,
      validationCommands: payload.validation_commands,
      projectSlug: payload.project_slug,
      baseBranch: payload.base_branch,
      allowedPaths,
      hermesRunId,
      evidenceDir,
      attemptNumber: payload.attempt_number,
    };

    const prepared = await db`
      UPDATE automation.implementation_runs
      SET parent_issue_id = ${contextResult.parent?.id ?? null},
          parent_issue_identifier = ${contextResult.parent?.identifier ?? null},
          context_hash = ${contextHash},
          base_sha = ${context.baseSha},
          branch_name = ${context.branchName},
          worktree_path = ${context.worktreePath},
          hermes_run_id = ${context.hermesRunId},
          project_slug = ${context.projectSlug},
          evidence_dir = ${context.evidenceDir},
          authorized_paths = ${JSON.stringify(context.allowedPaths)}::jsonb,
          validation_commands = ${JSON.stringify(context.validationCommands)}::jsonb,
          max_repair_attempts = ${config.maxRepairAttempts},
          slack_thread_ts = ${slackThreadTs},
          status = 'running',
          updated_at = now()
      WHERE id = ${runId}::uuid
        AND claimed_by = ${config.runnerId}
        AND status = 'preparing'
      RETURNING id
    `;
    if (prepared.length !== 1) throw new Error("Run ownership was lost before Hermes started");

    await insertEvent(db, runId, "pipeline_worktree_created", {
      base_sha: context.baseSha,
      branch: context.branchName,
      worktree_path: context.worktreePath,
      context_hash: context.contextHash,
      authorized_paths: context.allowedPaths,
      source: "ega_runner",
    });

    const headBefore = git(context.worktreePath, ["rev-parse", "HEAD"]);
    const resultFilePath = path.join(context.worktreePath, ".ega-runner", "hermes-result.json");
    hermesOutput = await executeHermes({
      worktreePath: context.worktreePath,
      timeoutMs: config.hermesTimeoutMs,
      maxTurns: config.maxTurns,
      runId,
      issueId: context.issueId,
      issueIdentifier: context.issueIdentifier,
      baseSha: context.baseSha,
      validationCommands: context.validationCommands,
      extraEnv: {
        EGA_RUN_ID: runId,
        EGA_ISSUE_ID: context.issueId,
        EGA_HERMES_RUN_ID: context.hermesRunId,
      },
      authorizedPaths: context.allowedPaths,
      resultFilePath,
      hermesRunId: context.hermesRunId,
      isRecovery: false,
    });

    const artifacts: EvidenceArtifact[] = preserveHermesOutput(
      context.evidenceDir,
      hermesOutput.rawStdout,
      hermesOutput.rawStderr,
      false,
    );
    if (hermesOutput.recoveryAttempted) {
      artifacts.push(...preserveHermesOutput(
        context.evidenceDir,
        hermesOutput.recoveryStdout ?? "",
        hermesOutput.recoveryStderr ?? "",
        true,
      ));
    }
    await insertEvent(db, runId, "pipeline_hermes_exited", {
      exit_code: hermesOutput.exitCode,
      timed_out: hermesOutput.timedOut,
      recovery_attempted: hermesOutput.recoveryAttempted,
      source: "ega_runner",
    });

    if (hermesOutput.timedOut) {
      return persistFailure(db, config, runId, "failed", "HERMES_TIMEOUT", "Hermes execution timed out", context, slackThreadTs);
    }
    if (!hermesOutput.result) {
      return persistFailure(db, config, runId, "failed", "MISSING_RESULT", "Hermes did not produce a valid result contract", context, slackThreadTs);
    }
    if (hermesOutput.result.status !== "completed") {
      return persistFailure(db, config, runId, "failed", "HERMES_REPORTED_FAILURE", "Hermes result reported failure", context, slackThreadTs);
    }
    const schema = validateHermesResultSchema(hermesOutput.result);
    if (!schema.ok) {
      return persistFailure(db, config, runId, "failed", "INVALID_RESULT", schema.error ?? "Invalid Hermes result", context, slackThreadTs);
    }
    if (hermesOutput.result.run_id !== runId || hermesOutput.result.branch !== context.branchName) {
      return persistFailure(db, config, runId, "failed", "RESULT_IDENTITY_MISMATCH", "Hermes result identity does not match the owned run and branch", context, slackThreadTs);
    }

    const changedFiles = collectChangedProductPaths(context.worktreePath, context.baseSha);
    const scopeViolation = enforceScope(context.allowedPaths, changedFiles, context.worktreePath, context.baseSha);
    if (scopeViolation) {
      return persistFailure(db, config, runId, "failed", "SCOPE_VIOLATION", scopeViolation.message, context, slackThreadTs);
    }

    const resultCheck = verifyResult(context.worktreePath, hermesOutput.result, context.baseSha);
    const commitCheck = verifyImplementationCommit(
      context.worktreePath,
      context.baseSha,
      context.branchName,
      context.allowedPaths,
    );
    if (!resultCheck.ok || !commitCheck.ok || !commitCheck.commitSha) {
      const findings = [...resultCheck.findings, ...commitCheck.findings]
        .filter((finding) => !finding.passed)
        .map((finding) => `${finding.check}: ${finding.detail}`)
        .join("; ");
      return persistFailure(db, config, runId, "failed", "COMMIT_VERIFICATION_FAILED", findings || "Commit verification failed", context, slackThreadTs);
    }
    const commitSha = commitCheck.commitSha;
    if (hermesOutput.result.commit !== commitSha) {
      return persistFailure(db, config, runId, "failed", "RESULT_COMMIT_MISMATCH", `Hermes result commit ${hermesOutput.result.commit} does not match verified HEAD ${commitSha}`, context, slackThreadTs);
    }

    const validation = runValidationCommands(context.worktreePath, context.validationCommands);
    const validationArtifact = writeEvidenceFile(
      context.evidenceDir,
      "validation-results.json",
      JSON.stringify(validation, null, 2),
    );
    if (validationArtifact) artifacts.push(validationArtifact);
    if (!validation.ok) {
      return persistFailure(
        db,
        config,
        runId,
        "validation_failed",
        "VALIDATION_COMMAND_FAILED",
        "Runner-owned validation failed; no branch was pushed and no PR was opened",
        context,
        slackThreadTs,
      );
    }

    const pushed = pushBranch(context.worktreePath, context.branchName);
    if (!pushed.ok) {
      return persistFailure(db, config, runId, "failed", "PUSH_FAILED", pushed.error ?? "Branch push failed", context, slackThreadTs);
    }
    const remoteSha = getRemoteCommitSha(context.worktreePath, context.branchName);
    if (remoteSha !== commitSha) {
      return persistFailure(db, config, runId, "failed", "PUSH_SHA_MISMATCH", `Remote SHA ${remoteSha ?? "missing"} does not match ${commitSha}`, context, slackThreadTs);
    }

    createCommitStatus(
      context.worktreePath,
      commitSha,
      "pending",
      `EGA Runner opening and verifying PR for ${context.issueIdentifier}`,
      "ega/hermes-pipeline",
    );

    const prBody = buildPRBody(context, contextResult, changedFiles, hermesOutput.result, validation);
    const pr = createOrReusePR(
      context.worktreePath,
      context.branchName,
      context.baseBranch,
      commitSha,
      `[${context.issueIdentifier}] ${contextResult.issue.title}`,
      prBody,
    );
    if (!pr.ok || !pr.prNumber || !pr.url) {
      createCommitStatus(context.worktreePath, commitSha, "failure", "EGA Runner could not create and verify the PR", "ega/hermes-pipeline");
      return persistFailure(
        db,
        config,
        runId,
        "pr_failed",
        "PR_CREATE_FAILED",
        pr.error ?? "PR creation returned no verified PR",
        context,
        slackThreadTs,
      );
    }

    const verifiedPR = getPRInfo(context.worktreePath, pr.prNumber);
    if (!verifiedPR || verifiedPR.headSha !== commitSha || verifiedPR.headRef !== context.branchName || verifiedPR.baseRef !== context.baseBranch) {
      createCommitStatus(context.worktreePath, commitSha, "failure", "EGA Runner PR verification failed", "ega/hermes-pipeline");
      return persistFailure(db, config, runId, "pr_failed", "PR_VERIFY_FAILED", "Created PR did not match the owned branch, base, and commit", context, slackThreadTs);
    }

    const headAfter = git(context.worktreePath, ["rev-parse", "HEAD"]);
    artifacts.push(...preserveGitEvidence(
      context.evidenceDir,
      context.worktreePath,
      context.baseSha,
      headBefore,
      headAfter,
      changedFiles,
    ));
    artifacts.push(...copyWorktreeEvidence(context.worktreePath, context.evidenceDir));
    writeEvidenceManifest(context.evidenceDir, runId, context.issueIdentifier, context.attemptNumber, artifacts);

    const opened = await db`
      UPDATE automation.implementation_runs
      SET status = 'pr_open',
          result_json = ${JSON.stringify(hermesOutput.result)}::jsonb,
          pr_number = ${pr.prNumber},
          pr_url = ${pr.url},
          pr_head_sha = ${commitSha},
          last_observed_pr_sha = ${commitSha},
          last_check_state = 'pending',
          last_review_state = 'pending',
          repair_attempt_count = 0,
          next_check_at = now(),
          failure_code = NULL,
          claimed_by = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          updated_at = now()
      WHERE id = ${runId}::uuid
        AND claimed_by = ${config.runnerId}
        AND status = 'running'
      RETURNING id
    `;
    if (opened.length !== 1) throw new Error("Run ownership was lost before PR_OPEN was persisted");

    await insertEvent(db, runId, "pipeline_pr_open", {
      pr_number: pr.prNumber,
      pr_url: pr.url,
      pr_head_sha: commitSha,
      branch: context.branchName,
      created: pr.created,
      evidence_dir: context.evidenceDir,
      source: "ega_runner",
    });
    createCommitStatus(context.worktreePath, commitSha, "success", "EGA Runner implementation and local validation passed", "ega/hermes-pipeline");
    await postSlackNotification({
      channel: config.slackChannel,
      runId,
      issueIdentifier: context.issueIdentifier,
      issueUrl: context.issueUrl ?? "",
      prUrl: pr.url,
      vercelPreviewUrl: null,
      status: "started",
      summary: `PR #${pr.prNumber} opened and verified at ${commitSha.slice(0, 12)}. Checks and reviews are now monitored.`,
      threadTs: slackThreadTs ?? undefined,
    });

    return { archiveMessage: true, status: "pr_open" };
  } catch (error) {
    return persistFailure(
      db,
      config,
      runId,
      "failed",
      context ? "PIPELINE_ERROR" : "SETUP_ERROR",
      error instanceof Error ? error.message : String(error),
      context,
      slackThreadTs,
    );
  }
}
