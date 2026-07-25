import { execSync } from "node:child_process";

export interface PRInfo {
  number: number;
  url: string;
  headSha: string;
  baseRef: string;
  state: string;
  mergeable: boolean | null;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
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

export function createCommitStatus(
  repoRoot: string,
  sha: string,
  state: "pending" | "success" | "failure" | "error",
  description: string,
  context: string,
): CommitStatusResult {
  try {
    execSync(
      `gh api --method POST repos/:owner/:repo/statuses/${sha} \
        --field state="${state}" \
        --field description="${sanitizeForGitHub(description)}" \
        --field context="${context}"`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30_000,
      },
    ).toString().trim();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPermError = msg.includes("permission") || msg.includes("403") || msg.includes("Not enough") || msg.includes("Resource not accessible");
    if (isPermError) {
      return { ok: false, error: "GITHUB_STATUS_PERMISSION_DENIED" };
    }
    return { ok: false, error: msg.substring(0, 500) };
  }
}

export function pushBranch(repoRoot: string, branchName: string): CommitStatusResult {
  try {
    execSync(
      `git push origin ${branchName} 2>&1`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 120_000,
      },
    ).toString().trim();
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.substring(0, 500) };
  }
}

export function getRemoteCommitSha(repoRoot: string, branchName: string): string | null {
  try {
    const sha = execSync(
      `git rev-parse origin/${branchName} 2>/dev/null || true`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30_000,
      },
    ).toString().trim();
    return sha || null;
  } catch {
    return null;
  }
}

export function createPR(
  repoRoot: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string,
): { prNumber: number | null; url: string | null } {
  try {
    const output = execSync(
      `gh pr create \
        --base "${baseBranch}" \
        --head "${branchName}" \
        --title "${sanitizeForGitHub(title)}" \
        --body "${sanitizeForGitHub(body)}" \
        --fill 2>/dev/null || true`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 60_000,
      },
    ).toString().trim();

    const urlMatch = output.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
    if (urlMatch) {
      return { prNumber: parseInt(urlMatch[1], 10), url: urlMatch[0] };
    }

    const numMatch = output.match(/#(\d+)/);
    if (numMatch) {
      const prUrl = `https://github.com/${getRepoFullName(repoRoot)}/pull/${numMatch[1]}`;
      return { prNumber: parseInt(numMatch[1], 10), url: prUrl };
    }

    return { prNumber: null, url: output || null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[github] Failed to create PR: ${msg}`);
    return { prNumber: null, url: null };
  }
}

function getRepoFullName(repoRoot: string): string {
  try {
    const remote = execSync(
      `git remote get-url origin 2>/dev/null || true`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8", timeout: 10_000 },
    ).toString().trim();
    const match = remote.match(/(?:github\.com[:\/])([^\/]+)\/([^\/\.]+)/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {}
  return "unknown/repo";
}

export function updatePR(
  repoRoot: string,
  prNumber: number,
  body: string,
): boolean {
  try {
    execSync(
      `gh pr edit ${prNumber} --body "${sanitizeForGitHub(body)}"`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export function createCheckRun(
  repoRoot: string,
  commitSha: string,
  runId: string,
): bigint | null {
  console.log("[github] Check Run API disabled in V1 — use Commit Status API instead");
  return null;
}

export function updateCheckRun(
  repoRoot: string,
  checkRunId: bigint,
  conclusion: "success" | "failure" | "neutral" | "cancelled",
  summary: string,
  detailsUrl?: string,
): boolean {
  console.log("[github] Check Run API disabled in V1 — use Commit Status API instead");
  return false;
}

export interface CheckStatus {
  allComplete: boolean;
  allPassing: boolean;
  checks: CheckRun[];
}

export async function waitForChecks(
  repoRoot: string,
  commitSha: string,
  timeoutMs = 600_000,
  pollMs = 15_000,
): Promise<CheckStatus> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const output = execSync(
        `gh api repos/:owner/:repo/commits/${commitSha}/check-runs`,
        {
          cwd: repoRoot,
          stdio: "pipe",
          encoding: "utf8",
          timeout: 30_000,
        },
      ).toString().trim();

      const data = JSON.parse(output);
      const allChecks: CheckRun[] = (data.check_runs ?? []).map((r: Record<string, unknown>) => ({
        name: r.name as string,
        status: r.status as string,
        conclusion: (r.conclusion as string) ?? null,
        detailsUrl: (r.details_url as string) ?? null,
      }));

      const incomplete = allChecks.filter((c) => c.status !== "completed");
      const failed = allChecks.filter((c) => c.status === "completed" && c.conclusion !== "success");

      if (incomplete.length === 0) {
        return {
          allComplete: true,
          allPassing: failed.length === 0,
          checks: allChecks,
        };
      }
    } catch {
      // Transient error — retry
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  return { allComplete: false, allPassing: false, checks: [] };
}

export function requestReview(
  repoRoot: string,
  prNumber: number,
  reviewers: string[],
): boolean {
  try {
    execSync(
      `gh pr edit ${prNumber} --add-reviewer "${reviewers.join(",")}"`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    return true;
  } catch (err) {
    console.error(`[github] Failed to request review: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function mergePR(
  repoRoot: string,
  prNumber: number,
  autoMerge: boolean,
): boolean {
  if (!autoMerge) {
    console.log(
      `[github] V1 HUMAN REVIEW GATE: PR #${prNumber} is ready but not auto-merged. ` +
        `Set EGA_RUNNER_AUTO_MERGE=true to enable auto-merge.`,
    );
    return false;
  }

  try {
    execSync(`gh pr merge ${prNumber} --merge --auto`, {
      cwd: repoRoot,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 30_000,
    });
    console.log(`[github] PR #${prNumber} merged`);
    return true;
  } catch (err) {
    console.error(`[github] Failed to merge PR: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function getPRInfo(
  repoRoot: string,
  prNumber: number,
): PRInfo | null {
  try {
    const output = execSync(
      `gh pr view ${prNumber} --json number,url,headRefOid,baseRefName,state,mergeable`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        encoding: "utf8",
        timeout: 30_000,
      },
    ).toString().trim();
    return JSON.parse(output) as PRInfo;
  } catch {
    return null;
  }
}

function sanitizeForGitHub(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .substring(0, 1000);
}
