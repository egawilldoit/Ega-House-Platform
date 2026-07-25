/**
 * Worktree Manager — creates deterministic branches and worktrees.
 *
 * Identity chain: 1 run → 1 attempt → 1 branch → 1 worktree.
 * Never work on main. Never reuse stale attempts.
 */

import { randomUUID } from "node:crypto";
import { execSync, type ExecSyncOptions } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorktreeResult {
  /** Absolute path to the worktree */
  worktreePath: string;
  /** Branch name created for this attempt */
  branchName: string;
  /** Pinned base SHA */
  baseSha: string;
  /** Repo root (original clone) */
  repoRoot: string;
}

export interface WorktreeError {
  ok: false;
  reason: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WORKTREE_BASE_DIR = "/tmp/ega-runner-worktrees";
const REPO_URL_PREFIX = "git@github.com:";

// ── Branch naming ──────────────────────────────────────────────────────────

/**
 * Deterministic branch name per attempt.
 * Format: hermes/<issue-identifier>-<attempt>
 */
export function buildBranchName(
  issueIdentifier: string,
  attemptNumber: number,
): string {
  const slug = issueIdentifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `hermes/${slug}-${attemptNumber}`;
}

// ── Worktree creation ──────────────────────────────────────────────────────

/**
 * Create a deterministic worktree for a run attempt.
 *
 * Steps:
 *  1. Fetch latest from origin
 *  2. Create branch from base_branch
 *  3. Create git worktree at a deterministic path
 *  4. Persist worktree_path for cleanup
 *
 * Throws on failure — the caller handles cleanup and event persistence.
 */
export function createWorktree(
  repoRoot: string,
  baseBranch: string,
  issueIdentifier: string,
  attemptNumber: number,
  runId: string,
): WorktreeResult {
  const branchName = buildBranchName(issueIdentifier, attemptNumber);
  const worktreePath = `${WORKTREE_BASE_DIR}/${runId}/${attemptNumber}`;

  const opts: ExecSyncOptions = {
    cwd: repoRoot,
    stdio: "pipe",
    timeout: 60_000,
    encoding: "utf8",
  };

  try {
    // 1. Fetch latest from origin
    execSync("git fetch --quiet origin", opts);

    // 2. Get the pinned base SHA
    const baseSha = execSync(
      `git rev-parse origin/${baseBranch}`,
      opts,
    ).toString().trim();

    // 3. Create branch (fail if already exists — deterministic naming prevents stale reuse)
    try {
      execSync(`git branch ${branchName} ${baseSha}`, opts);
    } catch {
      // Branch may already exist from a previous attempt — ensure it's at the right SHA
      execSync(`git branch -f ${branchName} ${baseSha}`, opts);
    }

    // 4. Ensure worktree base dir exists
    execSync(`mkdir -p ${worktreePath}`, {
      ...opts,
      cwd: undefined,
    });

    // 5. Create worktree — use --force in case of leftover from failed run
    execSync(
      `git worktree add --force ${worktreePath} ${branchName}`,
      opts,
    );

    console.log(
      `[worktree] Created worktree at ${worktreePath} on branch ${branchName} (base: ${baseSha})`,
    );

    return { worktreePath, branchName, baseSha, repoRoot };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Worktree creation failed: ${msg}`);
  }
}

// ── Worktree cleanup ───────────────────────────────────────────────────────

/**
 * Remove a worktree and delete the branch.
 * Safe to call multiple times — idempotent.
 */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
): void {
  try {
    execSync(`git worktree remove --force ${worktreePath}`, {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch {
    // If already removed, that's fine
  }

  try {
    execSync(`git branch -D ${branchName} 2>/dev/null || true`, {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch {
    // best-effort
  }

  try {
    execSync(`rm -rf ${worktreePath} 2>/dev/null || true`, {
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch {
    // best-effort
  }

  console.log(`[worktree] Cleaned up worktree ${worktreePath} and branch ${branchName}`);
}
