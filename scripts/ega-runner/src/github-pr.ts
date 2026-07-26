import type { CreatePRResult, PRInfo } from "./github-types.js";
import { runGh, runGit } from "./github-command.js";

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
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
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
  const headSha = runGit(repoRoot, ["rev-parse", "--verify", `refs/heads/${branchName}^{commit}`]);
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
