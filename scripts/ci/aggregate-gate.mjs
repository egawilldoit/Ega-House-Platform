#!/usr/bin/env node
// Fail-closed aggregate gate for .github/workflows/unified-platform-validation.yml.
//
// The `hygiene` job is the single required status check. It must never report
// success for a run whose dependency jobs did not actually prove their slice.
// The inline shell version of this check accepted `skipped` whenever
// force_full was not active, so a conditional job that was skipped because the
// change detector failed could be mistaken for "nothing to validate".
//
// This module owns the contract:
// - `changes` and `workspace` always run and must succeed.
// - Scope-mapped jobs are expected when force_full is on or their routing
//   output is exactly the string "true"; otherwise they may be skipped.
// - Routing outputs are validated as exactly "true" or "false", so a broken
//   change detector is a hard failure instead of an implicit "nothing changed".
// - `lint-report` is informational and never blocks.
// - Any job key in `needs` that is not registered here fails, so future jobs
//   must be added to this contract deliberately.

import { pathToFileURL } from "node:url";

/** Jobs that are never path-filtered and must always succeed. */
export const ALWAYS_REQUIRED_JOBS = Object.freeze(["changes", "workspace"]);

/** Path-filtered jobs mapped to the `changes` output that gates them. */
export const SCOPE_JOB_OUTPUTS = Object.freeze({
  contracts: "packages",
  domain: "packages",
  application: "packages",
  "data-access": "packages",
  regressions: "regressions",
  "lint-changed": "code",
  web: "web",
  mobile: "mobile",
  server: "server",
  "api-client": "api-client",
  "db-invariants": "db",
});

/** Jobs whose conclusion is reported but never blocks the gate. */
export const INFORMATIONAL_JOBS = Object.freeze(["lint-report"]);

/** Every `changes.outputs` value the gate depends on. */
export const ROUTING_OUTPUTS = Object.freeze([
  "web",
  "server",
  "mobile",
  "db",
  "packages",
  "code",
  "regressions",
  "force_full",
]);

/** Every job id the gate knows about; anything else in `needs` is an error. */
export const CONTRACTED_JOBS = Object.freeze([
  ...ALWAYS_REQUIRED_JOBS,
  ...Object.keys(SCOPE_JOB_OUTPUTS),
  ...INFORMATIONAL_JOBS,
]);

const ROUTING_VALUES = Object.freeze(["true", "false"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describe(value) {
  if (value === undefined) return "<missing>";
  if (typeof value === "string") return value.length === 0 ? "<empty string>" : `'${value}'`;
  return JSON.stringify(value);
}

function observedResult(need) {
  return isPlainObject(need) ? need.result : undefined;
}

function checkResult(job, need, allowed, expectedState, errors) {
  const observed = observedResult(need);
  if (!allowed.includes(observed)) {
    errors.push(`job '${job}': expected ${expectedState}; observed result ${describe(observed)}`);
  }
}

/**
 * Evaluate a GitHub Actions `needs` context against the validation contract.
 *
 * @param {unknown} needs Parsed `needs` context (`job id -> { result, outputs }`).
 * @returns {{ ok: boolean, errors: string[], expected: string[] }}
 *   `expected` is the set of jobs the gate requires to have executed and
 *   succeeded. Informational jobs are deliberately absent from it.
 */
export function evaluateAggregateGate(needs) {
  if (!isPlainObject(needs)) {
    return {
      ok: false,
      errors: [`needs: expected a job map; observed ${describe(needs)}`],
      expected: [],
    };
  }

  const errors = [];
  const expected = [];

  // Rules 1 and 2: mandatory jobs must be present and must have succeeded.
  for (const job of ALWAYS_REQUIRED_JOBS) {
    expected.push(job);
    checkResult(job, needs[job], ["success"], "result 'success'", errors);
  }

  const changesOutputs = isPlainObject(needs.changes?.outputs) ? needs.changes.outputs : {};

  // Rule 3: routing outputs must be exactly "true" or "false". A missing,
  // empty or unrecognised value is a failure, never an implicit false.
  for (const output of ROUTING_OUTPUTS) {
    const value = changesOutputs[output];
    if (!ROUTING_VALUES.includes(value)) {
      errors.push(
        `routing output 'changes.outputs.${output}': expected exactly 'true' or 'false'; observed ${describe(value)}`,
      );
    }
  }

  // Rule 4: only the literal string "true" enables force_full.
  const forceFull = changesOutputs.force_full === "true";

  // Rule 5: scope-mapped jobs are expected under force_full or when their
  // routing output is "true". Expected jobs must succeed; at other times the
  // only acceptable non-success conclusion is "skipped".
  for (const [job, scopeOutput] of Object.entries(SCOPE_JOB_OUTPUTS)) {
    const isExpected = forceFull || changesOutputs[scopeOutput] === "true";
    if (isExpected) expected.push(job);

    if (!(job in needs)) {
      // Rule 6: a missing mandatory job key is a failure.
      errors.push(
        `job '${job}': missing from needs; expected an explicit ${isExpected ? "'success'" : "'success' or 'skipped'"} result`,
      );
      continue;
    }

    checkResult(
      job,
      needs[job],
      isExpected ? ["success"] : ["success", "skipped"],
      isExpected ? "result 'success'" : "result 'success' or 'skipped'",
      errors,
    );
  }

  // Rule 7 plus rule 8: lint-report is informational even in force-full mode,
  // so its result is never inspected; rule 8's "every other job succeeds" is
  // already enforced by the mandatory and scope checks above.
  for (const job of INFORMATIONAL_JOBS) {
    if (!(job in needs)) {
      errors.push(
        `job '${job}': missing from needs; expected an explicit result (informational, so not required to succeed)`,
      );
    }
  }

  // Rule 6: unregistered jobs fail closed so future jobs must join the contract.
  for (const job of Object.keys(needs)) {
    if (!CONTRACTED_JOBS.includes(job)) {
      errors.push(
        `job '${job}': unknown job in needs; register it in scripts/ci/aggregate-gate.mjs before depending on it`,
      );
    }
  }

  return { ok: errors.length === 0, errors, expected };
}

function orderedJobNames(needs) {
  const names = CONTRACTED_JOBS.filter((job) => job in needs);
  const extra = Object.keys(needs)
    .filter((job) => !CONTRACTED_JOBS.includes(job))
    .sort();
  return [...names, ...extra];
}

function main(env = process.env) {
  const raw = env.NEEDS_JSON;
  if (raw === undefined || raw.trim() === "") {
    console.error(
      "::error::aggregate gate: NEEDS_JSON is missing or empty; cannot verify dependency job results",
    );
    return 1;
  }

  let needs;
  try {
    needs = JSON.parse(raw);
  } catch (error) {
    console.error(`::error::aggregate gate: NEEDS_JSON is not valid JSON (${error.message})`);
    return 1;
  }

  if (!isPlainObject(needs)) {
    console.error("::error::aggregate gate: NEEDS_JSON must be a JSON object mapping job ids to results");
    return 1;
  }

  const { ok, errors, expected } = evaluateAggregateGate(needs);
  const expectedSet = new Set(expected);

  for (const job of orderedJobNames(needs)) {
    const observed = observedResult(needs[job]);
    console.log(
      `${job}: result=${observed === undefined ? "<missing>" : observed} expected=${expectedSet.has(job) ? "yes" : "no"}`,
    );
  }

  if (!ok) {
    for (const error of errors) console.error(`::error::${error}`);
    return 1;
  }

  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = main();
}
