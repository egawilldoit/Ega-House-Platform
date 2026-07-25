import type postgres from "postgres";

export interface PreflightResult {
  ok: boolean;
  missingColumns: string[];
}

/**
 * Runner-required columns on automation.implementation_runs.
 * These are the columns the Runner writes to or reads from at runtime.
 */
const REQUIRED_COLUMNS = [
  "id",
  "project_id",
  "linear_issue_id",
  "linear_issue_identifier",
  "linear_issue_url",
  "status",
  "attempt_number",
  "claimed_by",
  "heartbeat_at",
  "lease_expires_at",
  "started_at",
  "finished_at",
  "failure_code",
  "context_hash",
  "base_sha",
  "branch_name",
  "worktree_path",
  "hermes_run_id",
  "result_json",
  "pr_number",
  "pr_url",
  "pr_head_sha",
  "vercel_preview_url",
  "slack_thread_ts",
  "parent_issue_id",
  "parent_issue_identifier",
  "created_at",
  "updated_at",
] as const;

/**
 * Verify that all Runner-required columns exist on
 * automation.implementation_runs.
 *
 * If any are missing, logs them and returns { ok: false, missingColumns }.
 * The caller should exit non-zero without reading queue messages.
 */
export async function verifyImplementationRunsSchema(
  db: postgres.Sql<{}>,
): Promise<PreflightResult> {
  const missing: string[] = [];

  for (const col of REQUIRED_COLUMNS) {
    const rows = await db`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'automation'
        AND table_name = 'implementation_runs'
        AND column_name = ${col}
    `;
    if (rows.length === 0) {
      missing.push(col);
    }
  }

  if (missing.length > 0) {
    console.error("[preflight] MISSING COLUMNS on automation.implementation_runs:");
    for (const col of missing) {
      console.error(`  - ${col}`);
    }
    return { ok: false, missingColumns: missing };
  }

  return { ok: true, missingColumns: [] };
}
