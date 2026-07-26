import type postgres from "postgres";

export interface PreflightResult {
  ok: boolean;
  missingColumns: string[];
}

const REQUIRED_COLUMNS = [
  "id",
  "project_id",
  "project_slug",
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
  "evidence_dir",
  "authorized_paths",
  "validation_commands",
  "repair_attempt_count",
  "max_repair_attempts",
  "last_observed_pr_sha",
  "last_check_state",
  "last_review_state",
  "last_repair_at",
  "next_check_at",
  "created_at",
  "updated_at",
] as const;

export async function verifyImplementationRunsSchema(
  db: postgres.Sql<{}>,
): Promise<PreflightResult> {
  const rows = await db`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'automation'
      AND table_name = 'implementation_runs'
  `;
  const present = new Set(rows.map((row) => String(row.column_name)));
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !present.has(column));
  if (missingColumns.length > 0) {
    console.error("[preflight] Missing automation.implementation_runs columns:");
    for (const column of missingColumns) console.error(`  - ${column}`);
  }
  return { ok: missingColumns.length === 0, missingColumns };
}
