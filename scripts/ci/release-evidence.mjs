#!/usr/bin/env node
// Fail-closed Unified validation evidence for production mobile release gates.
//
// `mobile-delivery.yml` and `mobile-ota.yml` used to accept ANY completed,
// successful `unified-platform-validation.yml` run for the source SHA. A
// path-filtered partial run (docs-only, web-only, ...) also reports
// `conclusion: success` while nearly every validation job is `skipped`, so that
// check could pass without production validation actually happening.
//
// This module owns the release-evidence contract:
// - One trusted run+attempt is selected for the exact SHA: completed success,
//   our workflow path, `push` or `workflow_dispatch` (a `pull_request` run is
//   not production evidence), branch `main`, and the same repository (forks
//   are not our evidence).
// - Exactly that attempt's jobs are read, so evidence cannot be mixed across a
//   re-run where attempt 1 failed and attempt 2 passed.
// - Every mandatory job must have run and succeeded in that attempt. Skipped,
//   failing, cancelled, missing, and duplicated jobs all block. `lint-report`
//   is informational and ignored.
// - API failures are returned as errors, never as success.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Workflow file that owns the authoritative validation matrix. */
export const UNIFIED_WORKFLOW_PATH = ".github/workflows/unified-platform-validation.yml";

/**
 * Jobs that must actually execute and succeed before a production release.
 * Informational jobs (`lint-report`) are not listed and are ignored by the
 * gate. Matrix jobs report one API job per shard, so they are named exactly as
 * the API names them rather than by their workflow job id.
 */
export const MANDATORY_RELEASE_JOBS = Object.freeze([
  "changes",
  "workspace",
  "contracts",
  "domain",
  "application",
  "data-access",
  "regressions",
  "lint-changed",
  "web",
  "web-typecheck",
  "mobile",
  "server",
  "api-client",
  "db-invariants",
  "hygiene",
]);

/** One API job name per `web-tests` shard; extra shards are ignored. */
export const REQUIRED_WEB_TEST_SHARD_JOBS = Object.freeze(["web-tests (1)", "web-tests (2)"]);

/** Every API job name the release gate requires exactly once. */
export const REQUIRED_RELEASE_JOBS = Object.freeze([
  ...MANDATORY_RELEASE_JOBS,
  ...REQUIRED_WEB_TEST_SHARD_JOBS,
]);

/** Events that can represent production validation of `main`. */
const TRUSTED_EVENTS = Object.freeze(["push", "workflow_dispatch"]);

const PER_PAGE = 100;
const MAX_PAGES = 20;
const REJECTION_DETAIL_LIMIT = 5;

function unifiedWorkflowFile() {
  return UNIFIED_WORKFLOW_PATH.split("/").pop();
}

function noCompleteRunError(sha, rejected) {
  const detail =
    rejected.length > 0
      ? `; rejected ${rejected.length} candidate run(s): ${rejected.slice(0, REJECTION_DETAIL_LIMIT).join("; ")}`
      : "";
  return `no complete Unified validation for this SHA ${sha} — dispatch force_full on main and wait for it${detail}`;
}

function noRunsError(sha) {
  return `no Unified validation runs found for SHA ${sha} — dispatch force_full on main and wait for it`;
}

/**
 * Why this run cannot be accepted as production release evidence, or null.
 */
function rejectionReason(run, { sha, repoFullName }) {
  if (!run || typeof run !== "object") return "malformed run entry";
  const id = run.id ?? "<no id>";
  if (run.head_sha !== sha) return `run ${id}: head_sha ${run.head_sha ?? "<missing>"} != ${sha}`;
  if (run.status !== "completed" || run.conclusion !== "success") {
    return `run ${id}: not a completed success (status=${run.status ?? "<missing>"} conclusion=${run.conclusion ?? "<missing>"})`;
  }
  const path = typeof run.path === "string" ? run.path : "";
  if (!path.endsWith(UNIFIED_WORKFLOW_PATH)) {
    return `run ${id}: workflow path ${path || "<missing>"} is not ${UNIFIED_WORKFLOW_PATH}`;
  }
  if (!TRUSTED_EVENTS.includes(run.event)) {
    return `run ${id}: event ${run.event ?? "<missing>"} is not trusted release evidence`;
  }
  if (run.head_branch !== "main") {
    return `run ${id}: head_branch ${run.head_branch ?? "<missing>"} is not main`;
  }
  const fullName = run.head_repository?.full_name;
  if (typeof fullName !== "string" || fullName.toLowerCase() !== repoFullName.toLowerCase()) {
    return `run ${id}: head_repository ${fullName ?? "<missing>"} is not ${repoFullName}`;
  }
  return null;
}

function runSortKey(run) {
  const created = typeof run?.created_at === "string" ? Date.parse(run.created_at) : Number.NaN;
  const id = Number(run?.id);
  return {
    created: Number.isFinite(created) ? created : 0,
    id: Number.isFinite(id) ? id : 0,
  };
}

/**
 * Select the single most recent trusted Unified validation run for `sha`.
 * Returns `{ run }` or `{ error }`.
 */
export function selectReleaseRun(runs, { sha, repoFullName } = {}) {
  if (!sha || typeof sha !== "string") return { error: "selectReleaseRun requires sha" };
  if (!repoFullName || typeof repoFullName !== "string") {
    return { error: "selectReleaseRun requires repoFullName" };
  }
  if (!Array.isArray(runs) || runs.length === 0) return { error: noRunsError(sha) };

  const accepted = [];
  const rejected = [];
  for (const run of runs) {
    const reason = rejectionReason(run, { sha, repoFullName });
    if (reason === null) accepted.push(run);
    else rejected.push(reason);
  }
  if (accepted.length === 0) return { error: noCompleteRunError(sha, rejected) };

  accepted.sort((a, b) => {
    const left = runSortKey(a);
    const right = runSortKey(b);
    if (left.created !== right.created) return right.created - left.created;
    return right.id - left.id;
  });
  return { run: accepted[0] };
}

function describeConclusion(conclusion) {
  return conclusion === null || conclusion === undefined ? "null" : String(conclusion);
}

/**
 * Require exactly one successful job for every mandatory name in one attempt.
 * Returns `{ ok, errors, summary }` where `summary[name]` is the observed
 * conclusion (`missing` / `duplicate` when there is no single conclusion).
 */
export function verifyReleaseJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const errors = [];
  const summary = {};

  for (const name of REQUIRED_RELEASE_JOBS) {
    const matches = list.filter((job) => job && job.name === name);
    if (matches.length === 0) {
      summary[name] = "missing";
      errors.push(`partial validation: job ${name} did not run`);
      continue;
    }
    if (matches.length > 1) {
      summary[name] = "duplicate";
      errors.push(`duplicate job evidence: ${matches.length} jobs named ${name} in one attempt`);
      continue;
    }
    const conclusion = matches[0].conclusion ?? null;
    summary[name] = describeConclusion(conclusion);
    if (conclusion === "skipped") {
      errors.push(`partial validation: job ${name} was skipped`);
    } else if (conclusion !== "success") {
      errors.push(`job ${name} did not succeed: conclusion ${describeConclusion(conclusion)}`);
    }
  }

  return { ok: errors.length === 0, errors, summary };
}

async function collectPages(apiGet, buildPath, extractList, label) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await apiGet(buildPath(page));
    const pageItems = extractList(body);
    if (!Array.isArray(pageItems)) {
      throw new Error(`${label} page ${page} response did not contain a list`);
    }
    items.push(...pageItems);
    if (pageItems.length < PER_PAGE) break;
  }
  return items;
}

function normalizeAttempt(runAttempt) {
  const value = Number(runAttempt);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * Read and verify release evidence through an injected `apiGet(path)`.
 * Returns `{ ok, errors, run, attempt, jobs }`; never throws.
 */
export async function runReleaseEvidence({ apiGet, sha, repoFullName } = {}) {
  const failure = (errors) => ({ ok: false, errors, run: null, attempt: null, jobs: [] });

  if (typeof apiGet !== "function") return failure(["release evidence requires an apiGet function"]);
  if (!sha || typeof sha !== "string") return failure(["release evidence requires sha"]);
  if (!repoFullName || typeof repoFullName !== "string") {
    return failure(["release evidence requires repoFullName"]);
  }

  try {
    const runs = await collectPages(
      apiGet,
      (page) =>
        `/repos/${repoFullName}/actions/workflows/${unifiedWorkflowFile()}/runs?head_sha=${sha}&per_page=${PER_PAGE}&page=${page}`,
      (body) => body?.workflow_runs,
      "workflow runs",
    );

    const selection = selectReleaseRun(runs, { sha, repoFullName });
    if (selection.error) return failure([selection.error]);

    const run = selection.run;
    const attempt = normalizeAttempt(run.run_attempt);
    const jobs = await collectPages(
      apiGet,
      (page) => `/repos/${repoFullName}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=${PER_PAGE}&page=${page}`,
      (body) => body?.jobs,
      "workflow jobs",
    );

    const verification = verifyReleaseJobs(jobs);
    return { ok: verification.ok, errors: verification.errors, run, attempt, jobs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure([`release evidence API failure: ${message}`]);
  }
}

// CLI -----------------------------------------------------------------------

const USAGE = "usage: node scripts/ci/release-evidence.mjs --sha <sha> --repo <owner/name>";

function parseArgs(argv) {
  const parsed = { sha: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sha" && argv[i + 1] !== undefined) {
      parsed.sha = argv[i + 1];
      i += 1;
    } else if (arg === "--repo" && argv[i + 1] !== undefined) {
      parsed.repo = argv[i + 1];
      i += 1;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (!parsed.sha || !/^[0-9a-f]{40}$/i.test(parsed.sha)) {
    return { error: "--sha must be a full 40-character commit SHA" };
  }
  if (!parsed.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(parsed.repo)) {
    return { error: "--repo must be owner/name" };
  }
  return parsed;
}

/** Build an `apiGet` backed by the authenticated GitHub CLI. */
export function createGhApiGet() {
  return (path) => {
    const raw = execFileSync("gh", ["api", path.replace(/^\/+/, "")], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  };
}

function printRun(result) {
  if (!result.run) return;
  console.log(`selected run ${result.run.id} attempt ${result.attempt} ${result.run.html_url ?? ""}`.trim());
  const verification = verifyReleaseJobs(result.jobs);
  for (const name of REQUIRED_RELEASE_JOBS) {
    console.log(`  ${name}: ${verification.summary[name]}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`::error::${args.error}`);
    console.error(USAGE);
    return 2;
  }

  const result = await runReleaseEvidence({
    apiGet: createGhApiGet(),
    sha: args.sha,
    repoFullName: args.repo,
  });

  printRun(result);

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`::error::${error}`);
    }
    return 1;
  }

  console.log(`Unified validation is complete for ${args.sha} (all mandatory jobs succeeded)`);
  return 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`::error::release evidence check crashed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
