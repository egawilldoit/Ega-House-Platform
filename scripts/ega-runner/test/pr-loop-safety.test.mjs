#!/usr/bin/env -S node --import tsx
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildBranchName, createWorktree, removeWorktree } from "../src/worktree.ts";

const source = (name) => readFileSync(resolve(import.meta.dirname, `../src/${name}`), "utf8");

test("branch naming is deterministic and sanitized", () => {
  assert.equal(buildBranchName("EGA-422 / Navbar", 3), "hermes/ega-422-navbar-3");
});

test("implementation cannot complete without a verified PR", () => {
  const main = source("main.ts");
  const pipeline = source("implementation-pipeline.ts");
  assert.match(pipeline, /status = 'pr_open'/);
  assert.match(pipeline, /PR_CREATE_FAILED/);
  assert.match(pipeline, /PR_VERIFY_FAILED/);
  assert.doesNotMatch(pipeline, /status = 'completed'/);
  assert.match(main, /archiveMessage/);
  assert.match(main, /monitorDuePullRequests/);
  assert.match(main, /if \(shuttingDown\) return/);
  assert.match(main, /new AbortController\(\)/);
  assert.match(main, /captureFailure\(error\)/);
});

test("worktree operations reject shell interpolation and stale reuse", () => {
  const worktree = source("worktree.ts");
  assert.doesNotMatch(worktree, /execSync\s*\(/);
  assert.match(worktree, /check-ref-format/);
  assert.match(worktree, /Attempt branch already exists/);
  assert.match(worktree, /Attempt worktree path already exists/);
  assert.doesNotMatch(worktree, /worktree", "add", "--force"/);
});

test("GitHub aggregation is complete and identity-preserving", () => {
  const github = source("github.ts");
  assert.match(github, /check-runs\?per_page=100&page=/);
  assert.match(github, /status\?per_page=100&page=/);
  assert.match(github, /check-run:\$\{id\}/);
  assert.match(github, /commit-status:\$\{id\}/);
  assert.match(github, /pagination incomplete/);
  assert.match(github, /refs\/heads\/\$\{branchName\}/);
  assert.match(github, /--match-head-commit/);
});

test("monitor and repair transitions use compare-and-swap ownership", () => {
  const monitor = source("pr-monitor.ts");
  const repair = source("repair-loop.ts") + source("repair-state.ts");
  assert.match(monitor, /AND status = \$\{run\.status\}/);
  assert.match(monitor, /AND pr_head_sha = \$\{run\.pr_head_sha\}/);
  assert.match(monitor, /RETURNING id/);
  assert.match(repair, /AND status = \$\{run\.status\}/);
  assert.match(repair, /REPAIR_POST_PUSH_RECONCILIATION_REQUIRED/);
});

test("repair evidence and result handling fail closed", () => {
  const repair = source("repair-loop.ts") + source("repair-state.ts") + source("repair-evidence.ts");
  const executor = source("hermes-executor.ts");
  assert.match(repair, /execution\.result\.status !== "completed"/);
  assert.match(repair, /ls-files", "--others", "--exclude-standard", "-z"/);
  assert.match(repair, /preserveAndResetRepair/);
  assert.match(executor, /recoveryStdout/);
  assert.match(executor, /Do not push, create a PR, merge/);
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function createDisposableRemote() {
  const root = mkdtempSync(join(tmpdir(), "ega-runner-worktree-test-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  git(root, ["init", "--bare", remote]);
  git(root, ["init", repo]);
  git(repo, ["config", "user.email", "runner-test@example.com"]);
  git(repo, ["config", "user.name", "Runner Test"]);
  writeFileSync(join(repo, "README.md"), "# runner test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "initial"]);
  git(repo, ["branch", "-M", "main"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  return { root, repo };
}

test("worktree creation succeeds with validated refs and argument arrays", () => {
  const { root, repo } = createDisposableRemote();
  const runId = `11111111-1111-4111-8111-${Date.now().toString().slice(-12)}`;
  let result;
  try {
    result = createWorktree(repo, "main", "EGA-TEST", 1, runId);
    assert.equal(git(result.worktreePath, ["branch", "--show-current"]), "hermes/ega-test-1");
    assert.equal(git(result.worktreePath, ["rev-parse", "HEAD"]), result.baseSha);
  } finally {
    if (result) removeWorktree(repo, result.worktreePath, result.branchName);
    rmSync(root, { recursive: true, force: true });
  }
});

test("malicious queue base ref is rejected without command execution", () => {
  const { root, repo } = createDisposableRemote();
  const marker = join(tmpdir(), `ega-runner-injection-${Date.now()}`);
  const runId = `22222222-2222-4222-8222-${Date.now().toString().slice(-12)}`;
  try {
    assert.throws(() => createWorktree(repo, `main;touch ${marker}`, "EGA-TEST", 1, runId), /Invalid base branch/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(marker, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing attempt branch is refused and never force-reset", () => {
  const { root, repo } = createDisposableRemote();
  const runId = `33333333-3333-4333-8333-${Date.now().toString().slice(-12)}`;
  try {
    git(repo, ["branch", "hermes/ega-test-2", "HEAD"]);
    const before = git(repo, ["rev-parse", "refs/heads/hermes/ega-test-2"]);
    assert.throws(() => createWorktree(repo, "main", "EGA-TEST", 2, runId), /Attempt branch already exists/);
    assert.equal(git(repo, ["rev-parse", "refs/heads/hermes/ega-test-2"]), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
