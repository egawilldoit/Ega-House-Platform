import type { CommitStatusResult } from "./github-types.js";
import { getRepoFullName, runGh, runGit } from "./github-command.js";

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
