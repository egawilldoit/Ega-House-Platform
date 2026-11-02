import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CONTRACTED_JOBS } from "./aggregate-gate.mjs";

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/unified-platform-validation.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

function jobSection(name) {
  const start = workflow.search(new RegExp(`^  ${name}:\\n`, "m"));
  assert.notEqual(start, -1, `job ${name} exists`);
  const next = workflow.slice(start + 1).search(/^  [a-z][a-z0-9-]*:\n/m);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

test("workflow_dispatch exposes force_full boolean input defaulting to false", () => {
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*force_full:/);
  assert.match(workflow, /force_full:\s*\n\s*description: .+\n\s*type: boolean\n\s*default: false/);
});

test("changes job outputs force_full resolved from dispatch input or release/full-matrix/ head ref", () => {
  const section = jobSection("changes");
  assert.match(section, /force_full: \$\{\{ steps\.force_full\.outputs\.force_full \}\}/);
  assert.match(section, /inputs\.force_full.*"true"/);
  assert.match(section, /release\/full-matrix\/\*/);
});

test("every path-filtered leaf job ORs in force_full", () => {
  const leafJobs = {
    web: "web",
    mobile: "mobile",
    server: "server",
    "api-client": "api-client",
    "db-invariants": "db",
    contracts: "packages",
    domain: "packages",
    application: "packages",
    "data-access": "packages",
    regressions: "regressions",
    "lint-changed": "code",
  };
  for (const [job, output] of Object.entries(leafJobs)) {
    const section = jobSection(job);
    assert.match(
      section,
      new RegExp(
        `if: needs\\.changes\\.outputs\\.${output} == 'true' \\|\\| needs\\.changes\\.outputs\\.force_full == 'true'`,
      ),
      `leaf job ${job} must run under force_full`,
    );
  }
});

test("lint-report only runs on demand or in force-full mode", () => {
  const section = jobSection("lint-report");
  assert.match(section, /if: needs\.changes\.outputs\.force_full == 'true' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(section, /continue-on-error: true/);
});

test("hygiene keeps if: always(), forwards the needs JSON and runs the aggregate gate", () => {
  const section = jobSection("hygiene");
  assert.match(section, /if: always\(\)/);
  assert.match(section, /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(section, /run: node scripts\/ci\/aggregate-gate\.mjs/);
  // The gate owns result evaluation; the job must not reintroduce inline
  // per-job result checks that could drift from the tested contract.
  assert.doesNotMatch(section, /needs\.[a-z][a-z0-9-]*\.result/);
});

test("aggregate-gate contract covers exactly the jobs in hygiene.needs", () => {
  const section = jobSection("hygiene");
  const match = section.match(/needs: \[([^\]]*)\]/);
  assert.ok(match, "hygiene declares a needs list");
  const declared = match[1]
    .split(",")
    .map((job) => job.trim())
    .filter(Boolean);
  assert.equal(new Set(declared).size, declared.length, "hygiene.needs has no duplicate jobs");
  assert.deepEqual(
    [...declared].sort(),
    [...CONTRACTED_JOBS].sort(),
    "every hygiene dependency is in the aggregate gate contract and vice versa",
  );
});
