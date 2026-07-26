import { existsSync } from "node:fs";
import type postgres from "postgres";
import type { Config } from "./config.js";
import { insertEvent } from "./event-log.js";
import { postSlackNotification } from "./notify.js";
import { preserveAndResetRepair } from "./repair-evidence.js";
import type { RepairOutcome, RepairRunRecord } from "./repair-types.js";

export async function persistRepairFailure(
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
  if (beforeHead && evidenceDir && existsSync(run.worktree_path)) {
    try {
      preserveAndResetRepair(run, beforeHead, attemptNumber, evidenceDir);
    } catch (error) {
      exhausted = true;
      finalReason += `; reset failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const status = exhausted ? "needs_human" : "pr_open";
  const updated = await db`
    UPDATE automation.implementation_runs
    SET status = ${status},
        failure_code = ${exhausted ? "REPAIR_EXHAUSTED" : "REPAIR_ATTEMPT_FAILED"},
        last_check_state = 'failure',
        next_check_at = ${exhausted ? null : new Date(Date.now() + config.prMonitorIntervalSeconds * 1_000)},
        finished_at = CASE WHEN ${exhausted} THEN now() ELSE finished_at END,
        updated_at = now()
    WHERE id = ${run.id}::uuid
      AND status = 'repairing'
      AND pr_head_sha = ${run.pr_head_sha}
    RETURNING id
  `;
  if (updated.length !== 1) throw new Error(`Repair failure state was not persisted for ${run.id}`);
  await insertEvent(db, run.id, "repair_failed", {
    attempt_number: attemptNumber,
    exhausted,
    reason: finalReason,
    source: "ega_runner",
  }).catch(() => undefined);
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
      : `Repair attempt ${attemptNumber} failed; evidence was saved and the worktree reset: ${finalReason}`,
    threadTs: run.slack_thread_ts ?? undefined,
  }).catch(() => undefined);
  return { status, headSha: null, reason: finalReason };
}

export async function persistPostPushFailure(
  db: postgres.Sql<{}>,
  config: Config,
  run: RepairRunRecord,
  attemptNumber: number;
  pushedHead: string,
  reason: string,
): Promise<RepairOutcome> {
  const updated = await db`
    UPDATE automation.implementation_runs
    SET status = 'needs_human',
        pr_head_sha = ${pushedHead},
        last_observed_pr_sha = ${pushedHead},
        last_check_state = 'unknown',
        failure_code = 'REPAIR_POST_PUSH_RECONCILIATION_REQUIRED',
        next_check_at = NULL,
        finished_at = now(),
        updated_at = now()
    WHERE id = ${run.id}::uuid
      AND status = 'repairing'
    RETURNING id
  `;
  if (updated.length !== 1) {
    const current = await db`
      SELECT status, pr_head_sha
      FROM automation.implementation_runs
      WHERE id = ${run.id}::uuid
    `;
    const currentStatus = String(current[0]?.status ?? "");
    const currentHead = String(current[0]?.pr_head_sha ?? "");
    if (currentHead === pushedHead && currentStatus === "pr_open") {
      return { status: "pr_open", headSha: pushedHead, reason: "Pushed repair was already durably reconciled" };
    }
    if (currentHead === pushedHead && currentStatus === "needs_human") {
      return { status: "needs_human", headSha: pushedHead, reason };
    }
    throw new Error(`Pushed repair ${pushedHead} could not be reconciled to durable state`);
  }
  await insertEvent(db, run.id, "repair_post_push_reconciliation_required", {
    attempt_number: attemptNumber,
    pushed_head_sha: pushedHead,
    reason,
    source: "ega_runner",
  }).catch(() => undefined);
  await postSlackNotification({
    channel: config.slackChannel,
    runId: run.id,
    issueIdentifier: run.linear_issue_identifier,
    issueUrl: run.linear_issue_url ?? "",
    prUrl: run.pr_url,
    vercelPreviewUrl: null,
    status: "failed",
    summary: `Repair commit ${pushedHead.slice(0, 12)} reached the remote, but durable reconciliation failed: ${reason}`,
    threadTs: run.slack_thread_ts ?? undefined,
  }).catch(() => undefined);
  return { status: "needs_human", headSha: pushedHead, reason };
}
