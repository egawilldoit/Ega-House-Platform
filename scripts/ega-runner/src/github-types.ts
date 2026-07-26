export interface PRInfo {
  number: number;
  url: string;
  headSha: string;
  headRef: string;
  baseRef: string;
  state: string;
  mergeable: string | null;
  reviewDecision: string | null;
  latestReviewState: string | null;
  latestReviewAt: string | null;
  isDraft: boolean;
  merged: boolean;
}

export interface CheckRun {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  source: "check_run" | "commit_status";
  diagnostic: string | null;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string | null;
  body: string;
  url: string | null;
  createdAt: string | null;
}

export interface PullRequestSnapshot {
  pr: PRInfo;
  checks: CheckStatus;
  unresolvedThreads: ReviewThread[];
}

export interface GitHubSyncConfig {
  repoRoot: string;
  prNumber: number;
  commitSha: string;
  runId: string;
  issueIdentifier: string;
}

export interface CommitStatusResult {
  ok: boolean;
  error?: string;
}

export interface CreatePRResult {
  ok: boolean;
  created: boolean;
  prNumber: number | null;
  url: string | null;
  error?: string;
}

export interface CheckStatus {
  hasChecks: boolean;
  allComplete: boolean;
  allPassing: boolean;
  checks: CheckRun[];
}
