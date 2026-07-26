import type { CheckRun, CheckStatus, PullRequestSnapshot, ReviewThread } from "./github-types.js";
import { getRepoFullName, runGh } from "./github-command.js";
import { getPRInfo } from "./github-pr.js";

function readAllCheckRuns(repoRoot: string, repo: string, commitSha: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const raw = runGh(repoRoot, [
      "api",
      `repos/${repo}/commits/${commitSha}/check-runs?per_page=100&page=${page}`,
    ]);
    const data = JSON.parse(raw) as Record<string, unknown>;
    const pageRows = (data.check_runs as Array<Record<string, unknown>> | undefined) ?? [];
    const total = Number(data.total_count ?? 0);
    if (expectedTotal === null) expectedTotal = total;
    else if (expectedTotal !== total) throw new Error("GitHub check-run total changed during pagination");
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
  for (let page = 1; page <= 100; page += 1) {
    const raw = runGh(repoRoot, [
      "api",
      `repos/${repo}/commits/${commitSha}/statuses?per_page=100&page=${page}`,
    ]);
    const pageRows = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(pageRows)) throw new Error("GitHub commit-status endpoint returned an invalid payload");
    rows.push(...pageRows);
    if (pageRows.length < 100) return rows;
  }
  throw new Error("GitHub commit-status pagination incomplete after 100 pages");
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
      createdAt: typeof comment.createdAt === "string" ? comment.createdAt : null,
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
