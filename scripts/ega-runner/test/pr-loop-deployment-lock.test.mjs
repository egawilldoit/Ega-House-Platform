#!/usr/bin/env -S node --import tsx
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { classifyPullRequest } from "../src/pr-monitor.ts";
import { verifyVercelDeployment } from "../src/vercel.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

function approvedGreenSnapshot() {
  return {
    pr: {
      number: 10,
      url: "https://github.com/test/repo/pull/10",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      headRef: "wave/00-deployment-lock",
      baseRef: "main",
      state: "OPEN",
      mergeable: "MERGEABLE",
      reviewDecision: "APPROVED",
      latestReviewState: "APPROVED",
      latestReviewAt: "2026-09-02T00:00:00.000Z",
      isDraft: false,
      merged: false,
    },
    checks: {
      hasChecks: true,
      allComplete: true,
      allPassing: true,
      checks: [{
        name: "ci",
        status: "completed",
        conclusion: "success",
        detailsUrl: null,
        source: "check_run",
        diagnostic: null,
      }],
    },
    unresolvedThreads: [],
  };
}

test("web and API Vercel projects deploy only main", () => {
  for (const configPath of ["vercel.json", "apps/server/vercel.json"]) {
    const config = readJson(configPath);
    assert.deepEqual(config.git?.deploymentEnabled, {
      "*": false,
      main: true,
    }, `${configPath} must disable ordinary feature/PR deployments`);
  }
});

test("approved green PR is ready to merge without a preview when the gate is disabled", () => {
  const snapshot = approvedGreenSnapshot();
  const policy = {
    requireVercelPreview: false,
    previewReady: false,
    repairAttemptsRemaining: true,
    lastRepairAt: null,
  };

  assert.equal(classifyPullRequest(snapshot, policy), "ready_to_merge");
  assert.equal(
    classifyPullRequest(snapshot, { ...policy, requireVercelPreview: true }),
    "wait_preview",
  );
});

test("production deployment verification still observes an exact-SHA production match", async () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const fakeBin = mkdtempSync(join(tmpdir(), "ega-runner-vercel-proof-"));
  const previousPath = process.env.PATH;
  const previousToken = process.env.VERCEL_TOKEN;
  const previousCliToken = process.env.VERCEL_CLI_TOKEN;

  try {
    writeFileSync(join(fakeBin, "npx"), "#!/bin/sh\nprintf '[]'\n");
    writeFileSync(join(fakeBin, "curl"), `#!/bin/sh
case "$*" in
  *target=production*)
    printf '%s' '${JSON.stringify({
      deployments: [{
        uid: "production-deployment",
        url: "ega-api.example.test",
        state: "READY",
        createdAt: "2026-09-02T00:00:00.000Z",
        owner: "ega",
        project: "ega-api",
        meta: { githubCommitSha: sha },
      }],
    })}'
    ;;
  *)
    printf '%s' '{"deployments":[]}'
    ;;
esac
`);
    chmodSync(join(fakeBin, "npx"), 0o755);
    chmodSync(join(fakeBin, "curl"), 0o755);

    process.env.PATH = `${fakeBin}:${previousPath ?? ""}`;
    process.env.VERCEL_TOKEN = "test-token";
    delete process.env.VERCEL_CLI_TOKEN;

    const result = await verifyVercelDeployment(sha, "ega-api");

    assert.equal(result.ok, false, "production evidence must not masquerade as preview readiness");
    assert.equal(result.preview, null);
    assert.equal(result.production?.sha, sha);
    assert.equal(result.production?.state, "READY");
    assert.match(result.findings.join("\n"), /Production deployment found/);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousToken === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = previousToken;
    if (previousCliToken === undefined) delete process.env.VERCEL_CLI_TOKEN;
    else process.env.VERCEL_CLI_TOKEN = previousCliToken;
    rmSync(fakeBin, { recursive: true, force: true });
  }
});
