export interface RepairRunRecord {
  id: string;
  status: string;
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
