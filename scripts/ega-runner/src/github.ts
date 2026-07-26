import { execFileSync } from "node:child_process";

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

function runGh(repoRoot: string, args: string[], timeout = 30_000): string {
  return execFileSync("gh", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function runGit(repoRoot: string, args: string[], timeout = 30_000): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function parsePRInfo(value: Record<string, unknown>): PRInfo {
  const reviews = Array.isArray(value.reviews)
    ? (value.reviews as Array<Record<string, unknown>>)
    : [];
  const latestReview = reviews
    .filter((review) => typeof review.submittedAt === "string")
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
  return {
    number: Number(value.number),
    url: String(value.url),
    headSha: String(value.headRefOid),
    headRef: String(value.headRefName),
    baseRef: String(value.baseRefName),
    state: String(value.state),
    mergeable: typeof value.mergeable === "string" ? value.mergeable : null,
    reviewDecision: typeof value.reviewDecision === "string" && value.reviewDecision
      ? value.reviewDecision
      : null,
    latestReviewState: latestReview && typeof latestReview.state === "string"
      ? latestReview.state
      : null,
    latestReviewAt: latestReview && typeof latestReview.submittedAt === "string"
      ? latestReview.submittedAt
      : null,
    isDraft: value.isDraft === true,
    merged: Boolean(value.mergedAt),
  };
}

export function getRepoFullName(repoRoot: string): string {
  const remote = runGit(repoRoot, ["remote", "get-url", "origin"], 10_000);
  const match = remote.match(/(?:github\.com[:/])([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Unable to resolve GitHub repository from origin: ${remote}`);
  }
  return `${match[1]}/${match[2]}`;
}

export function createCommitStatus(
  repoRoot: string,
  sha: string,
  state: "pending" | "success" | "failure" | "error",
  description: string,
  context: string,
): CommitStatusResult {
  try {
    const repo = getRepoFullName(repoRoot);
    runGh(repoRoot, [
      "api",
      "--method",
      "POST",
      `repos/${repo}/statuses/${sha}`,
      "--field",
      `state=${state}`,
      "--field",
      `description=${description.slice(0, 140)}`,
      "--field",
      `context=${context}`,
    ]);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permissionDenied = /permission|403|not enough|resource not accessible/i.test(message);
    return {
      ok: false,
      error: permissionDenied ? "GITHUB_STATUS_PERMISSION_DENIED" : message.slice(0, 500),
    };
  }
}

export function pushBranch(repoRoot: string, branchName: string): CommitStatusResult {
  try {
    runGit(repoRoot, ["push", "origin", branchName], 120_000);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
}

export function getRemoteCommitSha(repoRoot: string, branchName: string): string | null {
  try {
    const output = runGit(repoRoot, ["ls-remote", "--heads", "origin", `refs/heads/${branchName}`]);
    return output.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

export function getPRInfo(repoRoot: string, prNumber: number): PRInfo | null {
  try {
    const raw = runGh(repoRoot, [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,url,headRefOid,headRefName,baseRefName,state,mergeable,reviewDecision,reviews,isDraft,mergedAt",
    ]);
    return parsePRInfo(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function findOpenPRsForBranch(
  repoRoot: string,
  branchName: string,
  baseBranch: string,
): PRInfo[] {
  const raw = runGh(repoRoot, [
    "pr",
    "list",
    "--state",
    "open",
    "--head",
    branchName,
    "--base",
    baseBranch,
    "--limit",
    "10",
    "--json",
    "number,url,headRefOid,headRefName,baseRefName,state,mergeable,reviewDecision,reviews,isDraft,mergedAt",
  ]);
  return (JSON.parse(raw) as Array<Record<string, unknown>>).map(parsePRInfo);
}

export function createOrReusePR(
  repoRoot: string,
  branchName: string,
  baseBranch: string,
  expectedHeadSha: string,
  title: string,
  body: string,
): CreatePRResult {
  try {
    const existingPRs = findOpenPRsForBranch(repoRoot, branchName, baseBranch);
    if (existingPRs.length > 1) {
      return {
        ok: false,
        created: false,
        prNumber: null,
        url: null,
        error: `Ambiguous PR state: ${existingPRs.length} open PRs use ${branchName} → ${baseBranch}`,
      };
    }
    const existing = existingPRs[0];
    if (existing) {
      if (existing.headSha !== expectedHeadSha) {
        return {
          ok: false,
          created: false,
          prNumber: existing.number,
          url: existing.url,
          error: `Existing PR head ${existing.headSha} does not match expected ${expectedHeadSha}`,
        };
      }
      return {
        ok: true,
        created: false,
        prNumber: existing.number,
        url: existing.url,
      };
    }

    const url = runGh(repoRoot, [
      "pr",
      "create",
      "--base",
      baseBranch,
      "--head",
      branchName,
      "--title",
      title,
      "--body",
      body,
    ], 60_000);
    const match = url.match(/\/pull\/(\d+)/);
    if (!match) {
      return { ok: false, created: false, prNumber: null, url: null, error: `Unexpected gh output: ${url}` };
    }

    const prNumber = Number(match[1]);
    const verified = getPRInfo(repoRoot, prNumber);
    if (!verified) {
      return { ok: false, created: true, prNumber, url, error: "Created PR could not be re-read" };
    }
    if (verified.headRef !== branchName || verified.baseRef !== baseBranch || verified.headSha !== expectedHeadSha) {
      return {
        ok: false,
        created: true,
        prNumber,
        url,
        error: `PR verification mismatch: head=${verified.headRef}@${verified.headSha} base=${verified.baseRef}`,
      };
    }
    return { ok: true, created: true, prNumber, url };
  } catch (error) {
    return {
      ok: false,
      created: false,
      prNumber: null,
      url: null,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
    };
  }
}

/** Backward-compatible wrapper. New code should use createOrReusePR(). */
export function createPR(
  repoRoot: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string,
): { prNumber: number | null; url: string | null } {
  const headSha = runGit(repoRoot, ["rev-parse", `refs/heads/${branchName}^{commit}`]);
  const result = createOrReusePR(repoRoot, branchName, baseBranch, headSha, title, body);
  return { prNumber: result.ok ? result.prNumber : null, url: result.ok ? result.url : null };
}

export function updatePR(repoRoot: string, prNumber: number, body: string): boolean {
  try {
    runGh(repoRoot, ["pr", "edit", String(prNumber), "--body", body]);
    return true;
  } catch {
    return false;
  }
}

function readAllCheckRuns(repoRoot: string, repo: string, commitSha: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const raw = runGh(repoRoot, ["api", `repos/${repo}/commits/${commitSha}/check-runs?per_page=100&page=${page}`, "--Header", "Accept: application/vnd.github+json"]);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const total = Number(data.total_count ?? 0);
    const pageRows = (data.check_runs as Array<Record<string, unknown>> | undefined) ?? [];
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error("GitHub check-run total changed during pagination");
    rows.push(...pageRows);
    if (rows.length >= total) break;
    if (pageRows.length === 0) throw new Error(`GitHub check-run pagination stopped at ${rows.length}/${total}`);
  }
  if (expectedTotal !== null && rows.length !== expectedTotal) {
    throw new Error(`GitHub check-run pagination incomplete: ${rows.length}/${expectedTotal}`);
  }
  return rows;
}

function readAllCommitStatuses(repoRoot: string, repo: string, commitSha: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const raw = runGh(repoRoot, ["api", `repos/${repo}/commits/${commitSha}/statuser?per_page=100&page=${page}`]);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const total = Number(data.total_count ?? 0);
    const pageRows = (data.statuses as Array<Record<string, unknown>> | undefined) ?? [];
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error("GitHub commit-status total changed during pagination");
    rows.push(...pageRows);
    if (rows.length >= total) break;
    if (pageRows.length === 0) throw new Error(`GitHub commit-status pagination stopped at ${rows.length}/${total}`);
  }
  if (expectedTotal !== null && rows.length !== expectedTotal) {
    throw new Error(`GitHub commit-status pagination incomplete: ${rows.length}/${expectedTotal}`);
  }
  return rows;
}

function readChecks(repoRoot: string, commitSha: string): CheckStatus {
  const repo = getRepoFullName(repoRoot);
  const checks: CheckRun[] = [];

  for (const item of readAllCheckRuns(repoRoot, repo, commitSha)) {
    const id = String(item.id ?? "");
    if (!id) throw new Error("GitHub check run is missing its stable ID");
    const app = item.app as Record<string, unknown> | null | undefined;
    const suite = item.check_suite as Record<string, unknown> | null | undefined;
    checks.push({
      id: `check-run:${id}:${String(app?.id ?? "no-app")}:${String(suite?.id ?? "no-suite")}`,
      name: String(item.name ?? "unnamed-check"),
      status: String(item.status ?? "unknown"),
      conclusion: typeof item.conclusion === "string" ? item.conclusion : null,
      detailsUrl: typeof item.details_url === "string" ? item.details_url : null,
      source: "check_run",
      diagnostic: null,
    });
  }

  for (const item of readAllCommitStatuses(repoRoot, repo, commitSha)) {
    const context = String(item.context ?? "unnamed-status");
    if (context === "ega/hermes-pipeline") continue;
    const id = String(item.id ?? "");
    if (!id) throw new Error("GitHub commit status is missing its stable ID");
    const state = String(item.state ?? "pending");
    checks.push({
      id: `commit-status:${id}`,
      name: context,
      status: state === "pending" ? "in_progress" : "completed",
      conclusion: state === "success" ? "success" : state === "pending" ? null : "failure",
      detailsUrl: typeof item.target_url === "string" ? item.target_url : null,
      source: "commit_status",
      diagnostic: null,
    });
  }

  const unique = [...new Map(checks.map((check) => [check.id, check])).values()];
  if (unique.length !== checks.length) throw new Error("GitHub returned duplicate check/status IDs across pages");

  const diagnosticCache = new Map<string, string | null>();
  for (const check of unique) {
    if (check.status !== "completed" || ["success", "neutral", "skipped"].includes(check.conclusion ?? "")) continue;
    const runId = check.detailsUrl?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
    if (!runId) continue;
    if (!diagnosticCache.has(runId)) {
      try {
        diagnosticCache.set(runId, runGh(repoRoot, ["run", "view", runId, "--log-failed"], 60_000).slice(-20_000));
      } catch {
        diagnosticCache.set(runId, null);
      }
    }
    check.diagnostic = diagnosticCache.get(runId) ?? null;
  }
  const hasChecks = unique.length > 0;
  const allComplete = hasChecks && unique.every((check) => check.status === "completed");
  const acceptedConclusions = new Set(["success", "neutral", "skipped"]);
  const allPassing = allComplete && unique.every((check) => acceptedConclusions.has(check.conclusion ?? ""));
  return { hasChecks, allComplete, allPassing, checks: unique };
}

function readReviewThreads(repoRoot: string, prNumber: number): ReviewThread[] {
  const repo = getRepoFullName(repoRoot);
  const [owner, name] = repo.split("/");
  const query = `
    query($owner:String!, $name:String!, $number:Int!) {
      repository(owner:$owner, name:$name) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            pageInfo { hasNextPage }
            nodes {
              id
              isResolved
              comments(first:1) { nodes { body path url createdAt } }
            }
          }
        }
      }
    }
  `;
  const raw = runGh(repoRoot, [
    "api",
    "graphql",
    "--field",
    `query=${query}`,
    "--field",
    `owner=${owner}`,
    "--field",
    `name=${name}`,
    "--field",
    `number=${prNumber}`,
  ]);
  const data = JSON.parse(raw) as Record<string, any>;
  const connection = data.data?.repository?.pullRequest?.reviewThreads ?? {};
  const nodes = connection.nodes ?? [];
  const threads: ReviewThread[] = nodes.map((node: Record<string, any>) => {
    const comment = node.comments?.nodes?.[0] ?? {};
    return {
      id: String(node.id),
      isResolved: node.isResolved === true,
      path: typeof comment.path === "string" ? comment.path : null,
      body: typeof comment.body === "string" ? comment.body : "",
      url: typeof comment.url === "string" ? comment.url : null,
      creatdAt: typeof comment.createdAt === "string" ? comment.createdAt : null,
    };
  });
  if (connection.pageInfo?.hasNextPage === true) {
    threads.push({
      id: "PAGINATION_LIMIT",
      isResolved: false,
      path: null,
      body: "PR has more than 100 review threads; bounded Runner inspection requires human review.",
      url: null,
      createdAt: new Date().toISOString(),
    });
  }
  return threads;
}

export function inspectPullRequest(
  repoRoot: string,
  prNumber: number,
  expectedHeadSha?: string,
): PullRequestSnapshot {
  const pr = getPRInfo(repoRoot, prNumber);
  if (!pr) throw new Error(`PR #${prNumber} could not be read`);
  if (expectedHeadSha && pr.headSha !== expectedHeadSha) {
    throw new Error(`PR #${prNumber} head ${pr.headSha} does not match expected ${expectedHeadSha}`);
  }
  return {
    pr,
    checks: readChecks(repoRoot, pr.headSha),
    unresolvedThreads: readReviewThreads(repoRoot, prNumber).filter((thread) => !thread.isResolved),
  };
}

export async function waitForChecks(
  repoRoot: string,
  commitSha: string,
  timeoutMs = 600_000,
  pollMs = 15_000,
): Promise<CheckStatus> {
  const deadline = Date.now() + timeoutMs;
  let latest: CheckStatus = { hasChecks: false, allComplete: false, allPassing: false, checks: [] };
  while (Date.now() < deadline) {
    try {
      latest = readChecks(repoRoot, commitSha);
      if (latest.allComplete) return latest;
    } catch {
      // Transient GitHub failure. Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return latest;
}

export function requestReview(repoRoot: string, prNumber: number, reviewers: string[]): boolean {
  if (reviewers.length === 0) return true;
  try {
    runGh(repoRoot, ["pr", "edit", String(prNumber), "--add-reviewer", reviewers.join(",")]);
    return true;
  } catch {
    return false;
  }
}

export function mergePR(
  repoRoot: string,
  prNumber: number,
  autoMerge: boolean,
  expectedHeadSha?: string,
): boolean {
  if (!autoMerge || !expectedHeadSha) return false;
  try {
    runGh(repoRoot, [
      "pr",
      "merge",
      String(prNumber),
      "--merge",
      "--auto",
      "--match-head-commit",
      expectedHeadSha,
    ]);
    return true;
  } catch {
    return false;
  }
}

export function createCheckRun(
  _repoRoot: string,
  _commitSha: string,
  _runId: string,
): bigint | null {
  console.log("[github] Check Run API disabled in V1 — use Commit Status API instead");
  return null;
}

export function updateCheckRun(
  _repoRoot: string,
  _checkRunId: bigint,
  _conclusion: "success" | "failure" | "neutral" | "cancelled",
  _summary: string,
  _detailsUrl?: string,
): boolean {
  console.log("[github] Check Run API disabled in V1 — use Commit Status API instead");
  return false;
}
