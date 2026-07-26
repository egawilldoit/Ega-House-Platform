import type postgres from "postgres";
import type { Config } from "./config.js";
import { insertEvent } from "./event-log.js";
import {
  inspectPullRequest,
  mergePR,
  type PullRequestSnapshot,
} from "./github.js";
import { postSlackNotification } from "./notify.js";
import { runRepairAttempt, type RepairRunRecord } from "./repair-loop.js";
import { verifyVercelDeployment } from "./vercel.js";

export type MonitorDecision =
  | "merged"
  | "needs_human"
  | "repair"
  | "wait_checks"
  | "wait_preview"
  | "awaiting_review"
  | "ready_to_merge";

export interface MonitorPolicy {
  requireVercelPreview: boolean;
  previewReady: boolean;
  repairAttemptsRemaining: boolean;
  lastRepairAt: string | null;
}

export function classifyPullRequest(
  snapshot: PullRequestSnapshot,
  policy: MonitorPolicy,
): MonitorDecision {
  if (snapshot.pr.merged) return "merged";
  if (snapshot.pr.state === "CLOSED" || snapshot.pr.mergeable === "CONFLICTING") return "needs_human";
  if (snapshot.pr.state !== "OPEN") return "needs_human";
  if (snapshot.pr.isDraft) return "awaiting_review";
  if (snapshot.unresolvedThreads.some((thread) => thread.id === "PAGINATION_LIMIT")) return "needs_human";

  const checksFailed = snapshot.checks.checks.some(
    (check) => check.status === "completed" && !["success", "neutral", "skipped"].includes(check.conclusion ?? ""),
  );
  if (checksFailed) return policy.repairAttemptsRemaining ? "repair" : "needs_human";

  const lastRepairTime = policy.lastRepairAt ? Date.parse(policy.lastRepairAt) : Number.NEGATIVE_INFINITY;
  const newReviewThread = snapshot.unresolvedThreads.some((thread) => {
    if (!policy.lastRepairAt) return true;
    if (!thread.createdAt) return false;
    return Date.parse(thread.createdAt) > lastRepairTime;
  });
  const changeRequestIsNew = snapshot.pr.reviewDecision === "CHANGES_REQUESTED" && (
    !policy.lastRepairAt ||
    (snapshot.pr.latestReviewAt !== null && Date.parse(snapshot.pr.latestReviewAt) > lastRepairTime)
  );
  if (newReviewThread || changeRequestIsNew) {
    return policy.repairAttemptsRemaining ? "repair" : "needs_human";
  }

  if (!snapshot.checks.hasChecks || !snapshot.checks.allComplete) return "wait_checks";
  if (!snapshot.checks.allPassing) return policy.repairAttemptsRemaining ? "repair" : "needs_human";
  if (policy.requireVercelPreview && !policy.previewReady) return "wait_preview";
  if (snapshot.pr.mergeable !== "MERGEABLE") return "wait_checks";

  // Previously handled review findings remain a merge blocker until a reviewer
  // resolves/re-approves them; they must not trigger the same repair repeatedly.
  if (snapshot.unresolvedThreads.length > 0 || snapshot.pr.reviewDecision === "CHANGES_REQUESTED") {
    return "awaiting_review";
  }
  if (snapshot.pr.reviewDecision !== "APPROVED") return "awaiting_review";
  return "ready_to_merge";
}

interface MonitorRunRow extends RepairRunRecord {
  status: string;
  project_slug: string | null;
  last_observed_pr_sha: string | null;
  last_check_state: string | null;
  last_review_state: string | null;
  vercel_preview_url: string | null;
  last_repair_at: string | null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRun(row: Record<string, unknown>): MonitorRunRow {
  return {
    id: String(row.id),
    status: String(row.status),
    linear_issue_id: String(row.linear_issue_id),
    linear_issue_identifier: String(row.linear_issue_identifier),
    linear_issue_url: row.linear_issue_url ? String(row.linear_issue_url) : null,
    base_sha: String(row.base_sha),
    branch_name: String(row.branch_name),
    worktree_path: String(row.worktree_path),
    pr_number: Number(row.pr_number),
    pr_url: String(row.pr_url),
    pr_head_sha: String(row.pr_head_sha),
    evidence_dir: row.evidence_dir ? String(row.evidence_dir) : null,
    authorized_paths: asStringArray(row.authorized_paths),
    validation_commands: asStringArray(row.validation_commands),
    repair_attempt_count: Number(row.repair_attempt_count ?? 0),
    max_repair_attempts: Number(row.max_repair_attempts ?? 3),
    slack_thread_ts: row.slack_thread_ts ? String(row.slack_thread_ts) : null,
    project_slug: row.project_slug ? String(row.project_slug) : null,
    last_observed_pr_sha: row.last_observed_pr_sha ? String(row.last_observed_pr_sha) : null,
    last_check_state: row.last_check_state ? String(row.last_check_state) : null,
    last_review_state: row.last_review_state ? String(row.last_review_state) : null,
    vercel_preview_url: row.vercel_preview_url ? String(row.vercel_preview_url) : null,
    last_repair_at: row.last_repair_at ? new Date(String(row.last_repair_at)).toISOString() : null,
  };
}

function checkState(snapshot: PullRequestSnapshot): string {
  if (!snapshot.checks.hasChecks) return "missing";
  if (!snapshot.checks.allComplete) return "pending";
  return snapshot.checks.allPassing ? "success" : "failure";
}

function reviewState(snapshot: PullRequestSnapshot): string {
  if (snapshot.unresolvedThreads.length > 0) return "unresolved_threads";
  return snapshot.pr.reviewDecision ?? "pending";
}

async function persistMonitorState(
  db: postgres.Sql<{}>,
  config: Config,
  run: MonitorRunRow,
  snapshot: PullRequestSnapshot,
  decision: MonitorDecision,
  previewUrl: string | null,
): Promise<boolean> {
  const status = decision === "wait_checks" || decision === "wait_preview"
    ? "pr_open"
    : decision;
  const nextCheckAt = ["pr_open", "awaiting_review", "ready_to_merge"].includes(status)
    ? new Date(Date.now() + config.prMonitorIntervalSeconds * 1_000)
    : null;

  const updated = await db`
    UPDATE automation.implementation_runs
    SET status = ${status},
        last_observed_pr_sha = ${snapshot.pr.headSha},
        last_check_state = ${checkState(snapshot)},
        last_review_state = ${reviewState(snapshot)},
        vercel_preview_url = COALESCE(${previewUrl}, vercel_preview_url),
        next_check_at = ${nextCheckAt},
        finished_at = CASE WHEN ${status} IN ('merged', 'needs_human') THEN now() ELSE finished_at END,
        updated_at = now()
    WHERE id = ${run.id}::uuid
      AND status = ${run.status}
      AND pr_head_sha = ${run.pr_head_sha}
    RETURNING id
  `;
  if (updated.length !== 1) return false;

  await insertEvent(db, run.id, "pr_monitor_observed", {
    decision,
    pr_number: run.pr_number,
    pr_head_sha: snapshot.pr.headSha,
    check_state: checkState(snapshot),
    review_state: reviewState(snapshot),
    unresolved_threads: snapshot.unresolvedThreads.length,
    preview_url: previewUrl,
    source: "ega_runner",
  }).catch(() => undefined);

  if (status !== run.status && !["pr_open"].includes(status)) {
    await postSlackNotification({
      channel: config.slackChannel,
      runId: run.id,
      issueIdentifier: run.linear_issue_identifier,
      issueUrl: run.linear_issue_url ?? "",
      prUrl: run.pr_url,
      vercelPreviewUrl: previewUrl,
      status: status === "needs_human" ? "failed" : status === "merged" ? "completed" : "started",
      summary: status === "ready_to_merge"
        ? `PR #${run.pr_number} is green, approved, and ready to merge.`
        : status === "awaiting_review"
          ? `PR #${run.pr_number} is green and awaiting human approval.`
          : status === "merged"
            ? `PR #${run.pr_number} was merged.`
            : `PR #${run.pr_number} needs human intervention.`,
      threadTs: run.slack_thread_ts ?? undefined,
    }).catch(() => undefined);
  }
  return true;
}

async function monitorOne(
  db: postgres.Sql<{}>,
  config: Config,
  run: MonitorRunRow,
): Promise<void> {
  let snapshot: PullRequestSnapshot;
  try {
    snapshot = inspectPullRequest(config.repoRoot, run.pr_number);
  } catch (error) {
    const updated = await db`
      UPDATE automation.implementation_runs
      SET next_check_at = now() + (${config.prMonitorIntervalSeconds}::text || ' seconds')::interval,
          updated_at = now()
      WHERE id = ${run.id}::uuid
        AND status = ${run.status}
        AND pr_head_sha = ${run.pr_head_sha}
      RETURNING id
    `;
    if (updated.length === 1) {
      await insertEvent(db, run.id, "pr_monitor_error", {
        error: error instanceof Error ? error.message : String(error),
        source: "ega_runner",
      }).catch(() => undefined);
    }
    return;
  }

  if (snapshot.pr.headRef !== run.branch_name || snapshot.pr.headSha !== run.pr_head_sha) {
    await persistMonitorState(db, config, run, snapshot, "needs_human", null);
    return;
  }

  let previewReady = !config.requireVercelPreview;
  let previewUrl: string | null = run.vercel_preview_url;
  if (snapshot.checks.allPassing && (config.requireVercelPreview || process.env.VERCEL_TOKEN || process.env.VERCEL_CLI_TOKEN)) {
    const vercel = await verifyVercelDeployment(snapshot.pr.headSha, run.project_slug ?? undefined);
    previewReady = vercel.ok || !config.requireVercelPreview;
    previewUrl = vercel.preview?.url ?? previewUrl;
  }

  const decision = classifyPullRequest(snapshot, {
    requireVercelPreview: config.requireVercelPreview,
    previewReady,
    repairAttemptsRemaining: run.repair_attempt_count < run.max_repair_attempts,
    lastRepairAt: run.last_repair_at,
  });

  if (decision === "repair") {
    await runRepairAttempt(db, config, run, snapshot);
    return;
  }

  const persisted = await persistMonitorState(db, config, run, snapshot, decision, previewUrl);
  if (!persisted) return;

  if (decision === "ready_to_merge" && config.autoMerge) {
    const merged = mergePR(config.repoRoot, run.pr_number, true, snapshot.pr.headSha);
    await insertEvent(db, run.id, "pr_auto_merge_requested", {
      ok: merged,
      pr_number: run.pr_number,
      source: "ega_runner",
    });
  }
}

export async function monitorDuePullRequests(
  db: postgres.Sql<{}>,
  config: Config,
): Promise<void> {
  const rows = await db`
    SELECT id, status, linear_issue_id, linear_issue_identifier, linear_issue_url,
           base_sha, branch_name, worktree_path, pr_number, pr_url, pr_head_sha,
           evidence_dir, authorized_paths, validation_commands,
           repair_attempt_count, max_repair_attempts, slack_thread_ts,
           project_slug, last_observed_pr_sha, last_check_state,
           last_review_state, vercel_preview_url, last_repair_at
    FROM automation.implementation_runs
    WHERE status IN ('pr_open', 'awaiting_review', 'ready_to_merge')
      AND pr_number IS NOT NULL
      AND (next_check_at IS NULL OR next_check_at <= now())
    ORDER BY COALESCE(next_check_at, created_at) ASC
    LIMIT ${config.prMonitorBatchSize}
  `;

  for (const row of rows) {
    await monitorOne(db, config, mapRun(row as Record<string, unknown>));
  }
}
