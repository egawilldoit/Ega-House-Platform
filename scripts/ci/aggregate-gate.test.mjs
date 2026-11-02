import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CONTRACTED_JOBS,
  SCOPE_JOB_OUTPUTS,
  evaluateAggregateGate,
} from "./aggregate-gate.mjs";

const ALL_FALSE_ROUTING = {
  web: "false",
  server: "false",
  mobile: "false",
  db: "false",
  packages: "false",
  code: "false",
  regressions: "false",
  force_full: "false",
};

const GATE_PATH = fileURLToPath(new URL("./aggregate-gate.mjs", import.meta.url));

/**
 * Build a `needs` context. The baseline is a docs-only run: every
 * path-filtered job legitimately skipped, informational jobs present.
 */
function needsFor({ outputs = {}, results = {}, omit = [], extra = {} } = {}) {
  const needs = {
    changes: { result: "success", outputs: { ...ALL_FALSE_ROUTING, ...outputs } },
    workspace: { result: "success" },
  };
  for (const job of Object.keys(SCOPE_JOB_OUTPUTS)) {
    needs[job] = { result: "skipped" };
  }
  needs["lint-report"] = { result: "skipped" };

  for (const [job, result] of Object.entries(results)) {
    needs[job] = { ...(needs[job] ?? {}), result };
  }
  for (const job of omit) delete needs[job];
  return { ...needs, ...extra };
}

function errorText(result) {
  return result.errors.join("\n");
}

test("expected job success passes", () => {
  const result = evaluateAggregateGate(
    needsFor({
      outputs: { packages: "true" },
      results: {
        contracts: "success",
        domain: "success",
        application: "success",
        "data-access": "success",
      },
    }),
  );
  assert.equal(result.ok, true, errorText(result));
  assert.deepEqual(result.errors, []);
  assert.ok(result.expected.includes("contracts"));
});

test("expected job failure fails", () => {
  const result = evaluateAggregateGate(
    needsFor({ outputs: { web: "true" }, results: { web: "failure" } }),
  );
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'web': expected result 'success'; observed result 'failure'/);
});

test("expected job cancellation fails", () => {
  const result = evaluateAggregateGate(
    needsFor({ outputs: { mobile: "true" }, results: { mobile: "cancelled" } }),
  );
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'mobile'.*observed result 'cancelled'/);
});

test("expected job skipped unexpectedly fails", () => {
  const result = evaluateAggregateGate(
    needsFor({ outputs: { regressions: "true" }, results: { regressions: "skipped" } }),
  );
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'regressions': expected result 'success'; observed result 'skipped'/);
});

test("non-expected conditional job legitimately skipped passes", () => {
  const result = evaluateAggregateGate(needsFor());
  assert.equal(result.ok, true, errorText(result));
  assert.deepEqual(result.expected, ["changes", "workspace"]);
});

test("docs-only routing with every conditional job skipped passes", () => {
  const result = evaluateAggregateGate(
    needsFor({ results: { "lint-report": "skipped" } }),
  );
  assert.equal(result.ok, true, errorText(result));
  assert.deepEqual([...result.expected].sort(), ["changes", "workspace"]);
});

test("missing always-required job fails", () => {
  const result = evaluateAggregateGate(needsFor({ omit: ["workspace"] }));
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'workspace'.*<missing>/);
});

test("missing scope-mapped job fails even when it was not expected", () => {
  const result = evaluateAggregateGate(needsFor({ omit: ["db-invariants"] }));
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'db-invariants': missing from needs/);
});

test("missing informational job fails", () => {
  const result = evaluateAggregateGate(needsFor({ omit: ["lint-report"] }));
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'lint-report': missing from needs/);
});

test("missing job result fails", () => {
  const needs = needsFor();
  delete needs["api-client"].result;
  const result = evaluateAggregateGate(needs);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'api-client'.*observed result <missing>/);
});

for (const invalid of ["", "TRUE", "yes", "1", true]) {
  test(`invalid routing boolean ${JSON.stringify(invalid)} fails`, () => {
    const result = evaluateAggregateGate(needsFor({ outputs: { web: invalid } }));
    assert.equal(result.ok, false);
    assert.match(errorText(result), /routing output 'changes\.outputs\.web'.*expected exactly 'true' or 'false'/);
  });
}

test("missing routing output fails", () => {
  const needs = needsFor();
  delete needs.changes.outputs.force_full;
  const result = evaluateAggregateGate(needs);
  assert.equal(result.ok, false);
  assert.match(errorText(result), /routing output 'changes\.outputs\.force_full'.*<missing>/);
});

test("change detection failure fails", () => {
  const result = evaluateAggregateGate(needsFor({ results: { changes: "failure" } }));
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'changes': expected result 'success'; observed result 'failure'/);
});

test("change detection cancellation fails", () => {
  const result = evaluateAggregateGate(needsFor({ results: { changes: "cancelled" } }));
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'changes'.*observed result 'cancelled'/);
});

test("change detection with unusable outputs fails instead of implying no changes", () => {
  const result = evaluateAggregateGate({ ...needsFor(), changes: { result: "success" } });
  assert.equal(result.ok, false);
  assert.match(errorText(result), /routing output 'changes\.outputs\.web'.*<missing>/);
});

test("force-full requires every non-informational job to succeed", () => {
  const result = evaluateAggregateGate(
    needsFor({ outputs: { force_full: "true" }, results: { server: "skipped" } }),
  );
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'server': expected result 'success'; observed result 'skipped'/);
});

test("force-full with the whole matrix successful passes", () => {
  const needs = needsFor({ outputs: { force_full: "true" } });
  for (const job of Object.keys(needs)) {
    if (job === "changes" || job === "lint-report") continue;
    needs[job].result = "success";
  }
  const result = evaluateAggregateGate(needs);
  assert.equal(result.ok, true, errorText(result));
  assert.ok(result.expected.includes("db-invariants"));
});

for (const lintResult of ["skipped", "failure", "cancelled"]) {
  test(`lint-report ${lintResult} never blocks, even in force-full mode`, () => {
    const needs = needsFor({ outputs: { force_full: "true" }, results: { "lint-report": lintResult } });
    for (const job of Object.keys(needs)) {
      if (job === "changes" || job === "lint-report") continue;
      needs[job].result = "success";
    }
    const result = evaluateAggregateGate(needs);
    assert.equal(result.ok, true, errorText(result));
    assert.ok(!result.expected.includes("lint-report"));
  });
}

test("unknown job key in needs fails", () => {
  const result = evaluateAggregateGate(
    needsFor({ extra: { "future-job": { result: "success" } } }),
  );
  assert.equal(result.ok, false);
  assert.match(errorText(result), /job 'future-job': unknown job in needs/);
});

test("non-object needs input fails", () => {
  for (const value of [undefined, null, [], "needs"]) {
    const result = evaluateAggregateGate(value);
    assert.equal(result.ok, false);
    assert.deepEqual(result.expected, []);
  }
});

function runCli(env) {
  return spawnSync(process.execPath, [GATE_PATH], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("CLI exits 1 when NEEDS_JSON is missing", () => {
  const env = { ...process.env };
  delete env.NEEDS_JSON;
  const result = spawnSync(process.execPath, [GATE_PATH], { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::/);
});

test("CLI exits 1 on unparseable NEEDS_JSON", () => {
  const result = runCli({ NEEDS_JSON: "{not json" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /::error::/);
});

test("CLI prints one line per job and exits 0 for a valid needs map", () => {
  const result = runCli({ NEEDS_JSON: JSON.stringify(needsFor()) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split("\n").length, CONTRACTED_JOBS.length);
  assert.match(result.stdout, /^changes: result=success expected=yes$/m);
  assert.match(result.stdout, /^lint-report: result=skipped expected=no$/m);
});

test("CLI exits 1 and reports every violation", () => {
  const needs = needsFor({ results: { changes: "failure", web: "success" }, outputs: { web: "TRUE" } });
  needs["future-job"] = { result: "success" };
  const result = runCli({ NEEDS_JSON: JSON.stringify(needs) });
  assert.equal(result.status, 1);
  const errorLines = result.stderr.split("\n").filter((line) => line.startsWith("::error::"));
  assert.ok(errorLines.length >= 3, result.stderr);
  assert.match(result.stderr, /job 'changes'/);
  assert.match(result.stderr, /changes\.outputs\.web/);
  assert.match(result.stderr, /job 'future-job'/);
});
