/**
 * Worktree Manager — creates one isolated branch/worktree per run attempt.
 * All Git/process calls use argument arrays; queue-provided values never enter a shell.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface WorktreeResult {
  worktreePath: string;
  branchName: string;
  baseSha: string;
  repoRoot: string;
}

export interface WorktreeError {
  ok: false;
  reason: string;
}

const WORKTREE_BASE_DIR = "/tmp/ega-runner-worktrees";

function git(repoRoot: string, args: string[], timeout = 60_000): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function validateBaseBranch(repoRoot: string, baseBranch: string): void {
  if (!baseBranch || baseBranch.length > 240 || /[\u0000-\u001f\u007f]/.test(baseBranch)) {
    throw new Error("Base branch is empty or contains invalid control characters");
  }
  try {
    git(repoRoot, ["check-ref-format", "--branch", baseBranch], 10_000);
  } catch {
    throw new Error(`Invalid base branch name: ${baseBranch}`);
  }
}

function validateRunIdentity(runId: string, attemptNumber: number): void {
  if (!/^[0-9a-f-]{16,64}$/i.test(runId)) {
    throw new Error("runId is not a valid durable run identifier");
  }
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error("attemptNumber must be a positive integer");
  }
}

export function buildBranchName(issueIdentifier: string, attemptNumber: number): string {
  const slug = issueIdentifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("Issue identifier cannot produce an empty branch name");
  const branchName = `hermes/${slug}-${attemptNumber}`;
  if (branchName.length > 240) throw new Error("Generated branch name is too long");
  return branchName;
}

export function createWorktree(
  repoRoot: string,
  baseBranch: string,
  issueIdentifier: string,
  attemptNumber: number,
  runId: string,
): WorktreeResult {
  const canonicalRoot = resolve(repoRoot);
  validateRunIdentity(runId, attemptNumber);
  validateBaseBranch(canonicalRoot, baseBranch);

  const branchName = buildBranchName(issueIdentifier, attemptNumber);
  const worktreePath = join(WORKTREE_BASE_DIR, runId, String(attemptNumber));

  try {
    git(canonicalRoot, ["fetch", "--quiet", "origin"]);
    const remoteRef = `refs/remotes/origin/${baseBranch}`;
    const baseSha = git(canonicalRoot, ["rev-parse", "--verify", `${remoteRef}^{commit}`]);

    try {
      git(canonicalRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], 10_000);
      throw new Error(`Attempt branch already exists: ${branchName}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Attempt branch already exists:")) throw error;
      // show-ref exits non-zero when the branch does not exist, which is expected.
    }

    if (existsSync(worktreePath)) {
      throw new Error(`Attempt worktree path already exists: ${worktreePath}`);
    }

    mkdirSync(dirname(worktreePath), { recursive: true });
    git(canonicalRoot, ["branch", branchName, baseSha]);
    try {
      git(canonicalRoot, ["worktree", "add", worktreePath, branchName]);
    } catch (error) {
      try {
        git(canonicalRoot, ["branch", "-D", branchName], 10_000);
      } catch {
        // Preserve the original worktree error.
      }
      throw error;
    }

    return { worktreePath, branchName, baseSha, repoRoot: canonicalRoot };
  } catch (error) {
    throw new Error(`Worktree creation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
): void {
  const canonicalRoot = resolve(repoRoot);
  try {
    git(canonicalRoot, ["worktree", "remove", "--force", resolve(worktreePath)], 30_000);
  } catch {
    // Idempotent cleanup.
  }
  try {
    git(canonicalRoot, ["branch", "-D", branchName], 10_000);
  } catch {
    // Idempotent cleanup.
  }
  try {
    rmSync(resolve(worktreePath), { recursive: true, force: true });
  } catch {
    // Best effort after Git has released the worktree.
  }
}
