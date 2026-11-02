import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  MANDATORY_RELEASE_JOBS,
  REQUIRED_RELEASE_JOBS,
  REQUIRED_WEB_TEST_SHARD_JOBS,
  UNIFIED_WORKFLOW_PATH,
  runReleaseEvidence,
  selectReleaseRun,
  shardJobNames,
  validateShardContract,
  verifyReleaseJobs,
} from "./release-evidence.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const REPO = "egawilldoit/Ega-House-Platform";
const RUN_ID = 4242;
const SCRIPT_PATH = fileURLToPath(new URL("./release-evidence.mjs", import.meta.url));

function makeRun(overrides = {}) {
  return {
    id: RUN_ID,
    head_sha: SHA,
    status: "completed",
    conclusion: "success",
    path: UNIFIED_WORKFLOW_PATH,
    event: "push",
    head_branch: "main",
    head_repository: { full_name: REPO },
    created_at: "2026-01-01T00:00:00Z",
    run_attempt: 1,
    html_url: `https://github.com/${REPO}/actions/runs/${RUN_ID}`,
    ...overrides,
  };
}

function makeJob(name, conclusion = "success") {
  return { name, conclusion };
}

/** Full mandatory matrix, with per-job conclusion overrides. */
function fullJobs(conclusions = {}) {
  return REQUIRED_RELEASE_JOBS.map((name) =>
    makeJob(name, Object.hasOwn(conclusions, name) ? conclusions[name] : "success"),
  );
}

/**
 * Fake GitHub API. `runsPages` / `jobsPages` are arrays of page payloads; the
 * last page is what gets served for any page beyond the array.
 */
function fakeApi({ runs = [makeRun()], jobs = fullJobs(), jobsByAttempt = null, calls = [] } = {}) {
  const runsPages = Array.isArray(runs) ? [runs] : null;
  return async (path) => {
    calls.push(path);
    const attemptMatch = path.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?/);
    if (attemptMatch) {
      const attempt = Number(attemptMatch[2]);
      const pageMatch = path.match(/[?&]page=(\d+)/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      const pages = jobsByAttempt ? [jobsByAttempt[attempt] ?? []] : [jobs];
      return { total_count: pages[0].length, jobs: pages[Math.min(page, pages.length) - 1] };
    }
    if (path.includes("/actions/workflows/")) {
      const pageMatch = path.match(/[?&]page=(\d+)/);
      const page = pageMatch ? Number(pageMatch[1]) : 1;
      return {
        total_count: runsPages[0].length,
        workflow_runs: runsPages[Math.min(page, runsPages.length) - 1],
      };
    }
    throw new Error(`unexpected api path: ${path}`);
  };
}

function pageFillerJobs(count, prefix = "filler") {
  return Array.from({ length: count }, (_, index) => makeJob(`${prefix}-${index + 1}`));
}

function evidenceText(result) {
  return result.errors.join("\n");
}

test("complete exact-SHA push run with all mandatory jobs success is accepted", async () => {
  const calls = [];
  const jobs = [...fullJobs(), makeJob("lint-report", "skipped")];
  const apiGet = fakeApi({ jobs, calls });

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, true, evidenceText(result));
  assert.deepEqual(result.errors, []);
  assert.equal(result.run.id, RUN_ID);
  assert.equal(result.attempt, 1);
  assert.ok(calls[0].includes(UNIFIED_WORKFLOW_PATH.split("/").pop()));
  assert.ok(calls.some((path) => path.includes(`/actions/runs/${RUN_ID}/attempts/1/jobs`)));
});

test("informational lint-report is ignored by the gate", () => {
  const result = verifyReleaseJobs([...fullJobs(), makeJob("lint-report", "failure")]);
  assert.equal(result.ok, true, evidenceText(result));
  assert.equal(result.summary["lint-report"], undefined);
});

test("release requires the split web jobs, including both test shards", () => {
  assert.ok(MANDATORY_RELEASE_JOBS.includes("web"));
  assert.ok(MANDATORY_RELEASE_JOBS.includes("web-typecheck"));
  assert.ok(!MANDATORY_RELEASE_JOBS.includes("web-tests"));
  assert.deepEqual([...REQUIRED_WEB_TEST_SHARD_JOBS], ["web-tests (1)", "web-tests (2)"]);

  const result = verifyReleaseJobs(fullJobs());
  assert.equal(result.ok, true, evidenceText(result));
  assert.equal(result.summary["web"], "success");
  assert.equal(result.summary["web-typecheck"], "success");
  assert.equal(result.summary["web-tests (1)"], "success");
  assert.equal(result.summary["web-tests (2)"], "success");
});

test("a run containing an extra web-tests shard job is rejected", async () => {
  const apiGet = fakeApi({ jobs: [...fullJobs(), makeJob("web-tests (3)", "success")] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(
    evidenceText(result),
    /unexpected web-test shard job 'web-tests \(3\)' is not part of the release contract/,
  );
});

test("a duplicated required shard is reported once, never as unexpected", () => {
  const jobs = [...fullJobs(), makeJob("web-tests (1)", "success")];
  const result = verifyReleaseJobs(jobs);

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /duplicate job evidence: 2 jobs named web-tests \(1\)/);
  assert.equal((evidenceText(result).match(/duplicate job evidence/g) || []).length, 1);
  assert.doesNotMatch(evidenceText(result), /unexpected web-test shard job/);
});

test("shardJobNames derives API job names from matrix values", () => {
  assert.deepEqual(shardJobNames([1, 2]), ["web-tests (1)", "web-tests (2)"]);
  assert.deepEqual(shardJobNames(["1", "2"]), ["web-tests (1)", "web-tests (2)"]);
  assert.deepEqual(shardJobNames([]), []);
});

test("matrix [1, 2] matches the release contract regardless of order", () => {
  for (const values of [[1, 2], [2, 1], ["1", "2"]]) {
    const result = validateShardContract(values);
    assert.equal(result.ok, true, `${JSON.stringify(values)}: ${result.errors.join("; ")}`);
    assert.deepEqual(result.errors, []);
  }
});

test("matrix [1, 2, 3] is rejected as extra shards", () => {
  const result = validateShardContract([1, 2, 3]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /expected .*'web-tests \(1\)'.*'web-tests \(2\)'/);
  assert.match(result.errors.join("\n"), /unexpected 'web-tests \(3\)'/);
});

test("matrix [1] is rejected as missing the second shard", () => {
  const result = validateShardContract([1]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing 'web-tests \(2\)'/);
});

test("matrix with duplicate shards is rejected", () => {
  const result = validateShardContract([1, 1, 2]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicate web-test shard value 1/);
});

test("a non-list matrix shard value fails closed", () => {
  for (const value of [undefined, null, "1,2", 2]) {
    const result = validateShardContract(value);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  }
});

test("missing web-tests (2) shard is rejected", async () => {
  const jobs = fullJobs().filter((job) => job.name !== "web-tests (2)");
  const apiGet = fakeApi({ jobs });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /partial validation: job web-tests \(2\) did not run/);
});

test("skipped web-tests (1) shard is rejected", async () => {
  const apiGet = fakeApi({ jobs: fullJobs({ "web-tests (1)": "skipped" }) });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /partial validation: job web-tests \(1\) was skipped/);
});

test("a run with only web-tests (1) is rejected for the missing second shard", async () => {
  const jobs = fullJobs().filter((job) => job.name !== "web-tests (2)");
  jobs.push(makeJob("web-tests (1)", "success"));
  const result = verifyReleaseJobs(jobs);

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /web-tests \(2\) did not run/);
  assert.match(evidenceText(result), /duplicate job evidence: 2 jobs named web-tests \(1\)/);
});

test("missing web-typecheck is rejected", async () => {
  const jobs = fullJobs().filter((job) => job.name !== "web-typecheck");
  const apiGet = fakeApi({ jobs });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /partial validation: job web-typecheck did not run/);
});

test("workflow_dispatch run on main is trusted evidence", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ event: "workflow_dispatch" })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });
  assert.equal(result.ok, true, evidenceText(result));
});

test("partial successful run (web-only) is rejected and names the skipped job", async () => {
  const partial = fullJobs({ "db-invariants": "skipped", server: "skipped", web: "success" }).filter(
    (job) => job.conclusion !== "skipped",
  );
  partial.push(makeJob("db-invariants", "skipped"));
  partial.push(makeJob("server", "skipped"));
  const apiGet = fakeApi({ jobs: partial });

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /db-invariants/);
  assert.match(evidenceText(result), /skipped/);
});

test("different SHA is rejected", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ head_sha: OTHER_SHA })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.equal(result.run, null);
  assert.match(evidenceText(result), /no complete Unified validation for this SHA/);
  assert.match(evidenceText(result), new RegExp(OTHER_SHA));
});

test("missing required job is rejected", async () => {
  const jobs = fullJobs().filter((job) => job.name !== "api-client");
  const apiGet = fakeApi({ jobs });

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /partial validation: job api-client did not run/);
});

test("duplicated required job is rejected", async () => {
  const apiGet = fakeApi({ jobs: [...fullJobs(), makeJob("hygiene", "success")] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /duplicate job evidence/);
  assert.match(evidenceText(result), /hygiene/);
});

test("explicitly skipped mandatory job is rejected", async () => {
  const apiGet = fakeApi({ jobs: fullJobs({ hygiene: "skipped" }) });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /job hygiene was skipped/);
});

test("failed job is rejected and names the conclusion", async () => {
  const apiGet = fakeApi({ jobs: fullJobs({ web: "failure" }) });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /job web did not succeed: conclusion failure/);
});

test("cancelled job is rejected and names the conclusion", async () => {
  const apiGet = fakeApi({ jobs: fullJobs({ workspace: "cancelled" }) });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /job workspace did not succeed: conclusion cancelled/);
});

test("job with null conclusion is rejected", async () => {
  const apiGet = fakeApi({ jobs: fullJobs({ changes: null }) });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /job changes did not succeed: conclusion null/);
});

test("incomplete workflow is rejected", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ status: "in_progress", conclusion: null })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /not a completed success/);
});

test("attempt binding: only the selected attempt's jobs are read", async () => {
  const calls = [];
  const apiGet = fakeApi({
    runs: [makeRun({ run_attempt: 2 })],
    jobsByAttempt: {
      1: fullJobs({ web: "failure", hygiene: "cancelled" }),
      2: fullJobs(),
    },
    calls,
  });

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, true, evidenceText(result));
  assert.equal(result.attempt, 2);
  const jobCalls = calls.filter((path) => path.includes("/jobs?"));
  assert.equal(jobCalls.length, 1);
  assert.ok(jobCalls[0].includes(`/attempts/2/jobs`), jobCalls[0]);
  assert.ok(!calls.some((path) => path.includes("/attempts/1/")));
});

test("run without run_attempt defaults to attempt 1", async () => {
  const run = makeRun();
  delete run.run_attempt;
  const calls = [];
  const apiGet = fakeApi({ runs: [run], calls });

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, true, evidenceText(result));
  assert.equal(result.attempt, 1);
  assert.ok(calls.some((path) => path.includes("/attempts/1/jobs")));
});

test("untrusted evidence: pull_request run is rejected", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ event: "pull_request" })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /event pull_request/);
});

test("untrusted evidence: fork head_repository is rejected", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ head_repository: { full_name: "attacker/Ega-House-Platform" } })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /head_repository attacker\/Ega-House-Platform/);
});

test("untrusted evidence: non-main head_branch is rejected", async () => {
  const apiGet = fakeApi({ runs: [makeRun({ head_branch: "feature/x" })] });
  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /head_branch feature\/x/);
});

test("repository comparison is case-insensitive", () => {
  const selection = selectReleaseRun([makeRun({ head_repository: { full_name: REPO.toLowerCase() } })], {
    sha: SHA,
    repoFullName: REPO,
  });
  assert.ok(selection.run, selection.error);
});

test("most recent qualifying run wins, ties broken by higher id", () => {
  const older = makeRun({ id: 10, created_at: "2026-01-01T00:00:00Z" });
  const newer = makeRun({ id: 11, created_at: "2026-02-01T00:00:00Z" });
  const tieSameIdLower = makeRun({ id: 9, created_at: "2026-02-01T00:00:00Z" });

  assert.equal(selectReleaseRun([older, newer], { sha: SHA, repoFullName: REPO }).run.id, 11);

  const tieA = makeRun({ id: 30, created_at: "2026-03-01T00:00:00Z" });
  const tieB = makeRun({ id: 31, created_at: "2026-03-01T00:00:00Z" });
  assert.equal(selectReleaseRun([tieA, tieB, tieSameIdLower], { sha: SHA, repoFullName: REPO }).run.id, 31);
});

test("empty run list is rejected with its own message", () => {
  const selection = selectReleaseRun([], { sha: SHA, repoFullName: REPO });
  assert.match(selection.error, /no Unified validation runs found/);
  assert.match(selection.error, /dispatch force_full on main and wait for it/);
});

test("pagination reads every runs page and every jobs page", async () => {
  const calls = [];
  const runsPage1 = Array.from({ length: 100 }, (_, index) =>
    makeRun({ id: 1000 + index, head_sha: OTHER_SHA }),
  );
  const runsPage2 = [makeRun({ id: RUN_ID }), makeRun({ id: 5000, head_sha: OTHER_SHA })];
  const jobsPage1 = pageFillerJobs(100);
  const jobsPage2 = fullJobs();

  const apiGet = async (path) => {
    calls.push(path);
    const pageMatch = path.match(/[?&]page=(\d+)/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    if (path.includes("/jobs?")) {
      return { jobs: page === 1 ? jobsPage1 : jobsPage2 };
    }
    if (path.includes("/actions/workflows/")) {
      return { workflow_runs: page === 1 ? runsPage1 : runsPage2 };
    }
    throw new Error(`unexpected api path: ${path}`);
  };

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, true, evidenceText(result));
  assert.equal(result.run.id, RUN_ID);
  assert.ok(
    calls.some((path) => path.includes("/actions/workflows/") && path.includes("page=2")),
    "runs page 2 was requested",
  );
  assert.ok(
    calls.some((path) => path.includes("/jobs?") && path.includes("page=2")),
    "jobs page 2 was requested",
  );
  assert.equal(calls.filter((path) => path.includes("/actions/workflows/")).length, 2);
  assert.equal(calls.filter((path) => path.includes("/jobs?")).length, 2);
});

test("API error fails closed without throwing", async () => {
  const apiGet = async () => {
    throw new Error("HTTP 403: Resource not accessible by integration");
  };

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.equal(result.jobs.length, 0);
  assert.match(evidenceText(result), /release evidence API failure/);
  assert.match(evidenceText(result), /403/);
});

test("job API error fails closed even when the run is valid", async () => {
  const apiGet = async (path) => {
    if (path.includes("/jobs?")) throw new Error("HTTP 502: Bad Gateway");
    return { workflow_runs: [makeRun()] };
  };

  const result = await runReleaseEvidence({ apiGet, sha: SHA, repoFullName: REPO });

  assert.equal(result.ok, false);
  assert.match(evidenceText(result), /502/);
});

test("CLI exits 2 on missing or invalid arguments", () => {
  const missing = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--sha/);

  const badSha = spawnSync(process.execPath, [SCRIPT_PATH, "--sha", "abc", "--repo", REPO], {
    encoding: "utf8",
  });
  assert.equal(badSha.status, 2);

  const badRepo = spawnSync(process.execPath, [SCRIPT_PATH, "--sha", SHA, "--repo", "not-a-repo"], {
    encoding: "utf8",
  });
  assert.equal(badRepo.status, 2);
});
