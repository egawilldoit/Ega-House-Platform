#!/usr/bin/env -S node --import tsx
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
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

test("web and API repository configs declare the main-only Vercel policy", () => {
  for (const configPath of ["vercel.json", "apps/server/vercel.json"]) {
    const config = readJson(configPath);
    assert.deepEqual(config.git?.deploymentEnabled, {
      "*": false,
      main: true,
    }, `${configPath} must declare ordinary feature/PR deployments disabled`);
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

test("loadConfig keeps the supported default preview gate disabled", () => {
  const overrides = {
    DATABASE_URL: "postgresql://runner:runner@127.0.0.1:5432/runner",
    EGA_RUNNER_VISIBILITY_TIMEOUT_SECONDS: "300",
    EGA_RUNNER_HEARTBEAT_SECONDS: "60",
    EGA_RUNNER_LEASE_SECONDS: "300",
    EGA_RUNNER_POLL_SECONDS: "10",
    EGA_RUNNER_MAX_TURNS: "50",
    EGA_RUNNER_REPAIR_MAX_TURNS: "25",
    EGA_RUNNER_HERMES_TIMEOUT_MS: "1800000",
    EGA_RUNNER_PR_MONITOR_INTERVAL_SECONDS: "60",
    EGA_RUNNER_PR_MONITOR_BATCH_SIZE: "5",
    EGA_RUNNER_MAX_REPAIR_ATTEMPTS: "3",
  };
  const managedKeys = [
    ...Object.keys(overrides),
    "EGA_RUNNER_REQUIRE_VERCEL_PREVIEW",
  ];
  const previous = new Map(
    managedKeys.map((key) => [key, process.env[key]]),
  );

  try {
    Object.assign(process.env, overrides);
    delete process.env.EGA_RUNNER_REQUIRE_VERCEL_PREVIEW;
    assert.equal(loadConfig().requireVercelPreview, false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

    const mismatchedResult = await verifyVercelDeployment(
      "fedcba9876543210fedcba9876543210fedcba98",
      "ega-api",
    );

    assert.equal(mismatchedResult.ok, false);
    assert.equal(mismatchedResult.preview, null);
    assert.equal(
      mismatchedResult.production,
      null,
      "an unrelated production deployment must not satisfy exact-SHA verification",
    );
    assert.doesNotMatch(mismatchedResult.findings.join("\n"), /Production deployment found/);
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
