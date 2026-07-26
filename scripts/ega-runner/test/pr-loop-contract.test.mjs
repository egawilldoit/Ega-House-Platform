#!/usr/bin/env -S node --import tsx
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyPullRequest } from "../src/pr-monitor.ts";

function snapshot(overrides = {}) {
  return {
    pr: {
      number: 10,
      url: "https://github.com/test/repo/pull/10",
      headSha: "abc",
      headRef: "hermes/ega-1-1",
      baseRef: "main",
      state: "OPEN",
      mergeable: "MERGEABLE",
      reviewDecision: null,
      latestReviewState: null,
      latestReviewAt: null,
      isDraft: false,
      merged: false,
      ...(overrides.pr ?? {}),
    },
    checks: {
      hasChecks: true,
      allComplete: true,
      allPassing: true,
      checks: [{ name: "ci", status: "completed", conclusion: "success", detailsUrl: null, source: "check_run", diagnostic: null }],
      ...(overrides.checks ?? {}),
    },
    unresolvedThreads: overrides.unresolvedThreads ?? [],
  };
}

const basePolicy = {
  requireVercelPreview: false,
  previewReady: true,
  repairAttemptsRemaining: true,
  lastRepairAt: null,
};

test("green PR without approval waits for review", () => {
  assert.equal(classifyPullRequest(snapshot(), basePolicy), "awaiting_review");
});

test("green approved PR becomes ready to merge", () => {
  assert.equal(
    classifyPullRequest(snapshot({ pr: { reviewDecision: "APPROVED" } }), basePolicy),
    "ready_to_merge",
  );
});

test("failed check enters bounded repair", () => {
  const failed = snapshot({
    checks: {
      allComplete: true,
      allPassing: false,
      checks: [{ name: "test", status: "completed", conclusion: "failure", detailsUrl: null, source: "check_run", diagnostic: "failure log" }],
    },
  });
  assert.equal(classifyPullRequest(failed, basePolicy), "repair");
  assert.equal(
    classifyPullRequest(failed, { ...basePolicy, repairAttemptsRemaining: false }),
    "needs_human",
  );
});

test("unresolved review thread enters repair", () => {
  const reviewed = snapshot({
    unresolvedThreads: [{ id: "T1", isResolved: false, path: "src/a.ts", body: "Fix this", url: null, createdAt: "2026-07-26T08:00:00.000Z" }],
  });
  assert.equal(classifyPullRequest(reviewed, basePolicy), "repair");
});


test("handled old review does not trigger the same repair again", () => {
  const reviewed = snapshot({
    unresolvedThreads: [{ id: "T1", isResolved: false, path: "src/a.ts", body: "Fix this", url: null, createdAt: "2026-07-26T08:00:00.000Z" }],
  });
  assert.equal(
    classifyPullRequest(reviewed, { ...basePolicy, lastRepairAt: "2026-07-26T09:00:00.000Z" }),
    "awaiting_review",
  );
});


test("handled change request waits for reviewer instead of looping", () => {
  const reviewed = snapshot({
    pr: { reviewDecision: "CHANGES_REQUESTED", latestReviewAt: "2026-07-26T08:00:00.000Z" },
  });
  assert.equal(
    classifyPullRequest(reviewed, { ...basePolicy, lastRepairAt: "2026-07-26T09:00:00.000Z" }),
    "awaiting_review",
  );
});

test("conflicting or overlarge review state needs human", () => {
  assert.equal(classifyPullRequest(snapshot({ pr: { mergeable: "CONFLICTING" } }), basePolicy), "needs_human");
  assert.equal(
    classifyPullRequest(snapshot({ unresolvedThreads: [{ id: "PAGINATION_LIMIT", isResolved: false, path: null, body: "too many", url: null, createdAt: "2026-07-26T10:00:00.000Z" }] }), basePolicy),
    "needs_human",
  );
});

test("pending or absent checks never become merge-ready", () => {
  assert.equal(
    classifyPullRequest(snapshot({ checks: { hasChecks: false, allComplete: false, allPassing: false, checks: [] } }), basePolicy),
    "wait_checks",
  );
  assert.equal(
    classifyPullRequest(snapshot({ checks: { allComplete: false, allPassing: false } }), basePolicy),
    "wait_checks",
  );
});

test("required preview blocks readiness until exact-SHA preview is ready", () => {
  const approved = snapshot({ pr: { reviewDecision: "APPROVED" } });
  assert.equal(
    classifyPullRequest(approved, { ...basePolicy, requireVercelPreview: true, previewReady: false }),
    "wait_preview",
  );
});

test("merged and closed PRs are terminal", () => {
  assert.equal(classifyPullRequest(snapshot({ pr: { merged: true } }), basePolicy), "merged");
  assert.equal(classifyPullRequest(snapshot({ pr: { state: "CLOSED" } }), basePolicy), "needs_human");
});

test("source contract prevents completed-without-PR regression", () => {
  const main = readFileSync(resolve(import.meta.dirname, "../src/main.ts"), "utf8");
  const pipeline = readFileSync(resolve(import.meta.dirname, "../src/implementation-pipeline.ts"), "utf8");
  assert.match(pipeline, /status = 'pr_open'/);
  assert.match(pipeline, /"pr_failed"/);
  assert.match(pipeline, /PR_CREATE_FAILED/);
  assert.doesNotMatch(pipeline, /status = 'completed'/);
  assert.match(main, /archiveMessage/);
  assert.match(main, /monitorDuePullRequests/);
});
