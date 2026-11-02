import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CONTRACTED_JOBS } from "./aggregate-gate.mjs";

const workflowPath = fileURLToPath(
  new URL("../../.github/workflows/unified-platform-validation.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

const FILTER_NAMES = [
  "mobile",
  "server",
  "api-client",
  "web",
  "db",
  "packages",
  "code",
  "regressions",
];

// Parse the paths-filter `filters: |` scalar by indentation rather than fixed
// column widths, so re-indenting the block cannot silently defeat these tests.
function parseFilters(text) {
  const markerIdx = text.indexOf("filters: |");
  assert.notEqual(markerIdx, -1, "workflow declares a paths-filter block");
  const bodyLines = text.slice(text.indexOf("\n", markerIdx) + 1).split("\n");
  const firstHeader = bodyLines[0].match(/^(\s+)[a-z-]+:\s*$/);
  assert.ok(firstHeader, "filters block starts with a filter header");
  const headerIndent = firstHeader[1].length;

  const sections = new Map();
  let current = null;
  for (const line of bodyLines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent < headerIndent) break;
    const header = line.match(/^\s*([a-z-]+):\s*$/);
    if (header) {
      current = header[1];
      assert.ok(!sections.has(current), `filter ${current} is declared once`);
      sections.set(current, []);
      continue;
    }
    const entry = line.match(/^\s*-\s*'(.+)'\s*$/);
    assert.ok(entry, `filter entry parses: ${line.trim()}`);
    assert.ok(current, "every filter entry belongs to a section");
    sections.get(current).push(entry[1]);
  }
  return sections;
}

function concurrencyBlock() {
  const start = workflow.search(/^concurrency:\n/m);
  assert.notEqual(start, -1, "workflow declares concurrency");
  const rest = workflow.slice(start);
  const lineEnd = rest.indexOf("\n") + 1;
  const next = rest.slice(lineEnd).search(/^\S/m);
  return next === -1 ? rest : rest.slice(0, lineEnd + next);
}

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

test("every path filter routes .npmrc, which changes install behaviour for all jobs", () => {
  const filters = parseFilters(workflow);
  assert.deepEqual(
    [...filters.keys()].sort(),
    [...FILTER_NAMES].sort(),
    "the parsed filters are exactly the documented consumer filters",
  );
  for (const name of FILTER_NAMES) {
    assert.ok(
      filters.get(name).includes(".npmrc"),
      `filter ${name} must include .npmrc because install behaviour applies to every job`,
    );
  }
});

test("concurrency gives PRs a stable group and everything else a per-run group", () => {
  const block = concurrencyBlock();
  const group = block.match(/^ {2}group: (.+)$/m);
  const cancel = block.match(/^ {2}cancel-in-progress: (.+)$/m);
  assert.ok(group, "concurrency.group is a single line");
  assert.ok(cancel, "concurrency.cancel-in-progress is a single line");

  assert.match(group[1], /format\('unified-ci-pr-\{0\}', github\.ref\)/);
  assert.match(group[1], /format\('unified-ci-run-\{0\}', github\.run_id\)/);

  // cancel-in-progress may only fire for PRs that are not forced full-matrix runs.
  assert.equal(
    cancel[1],
    "${{ github.event_name == 'pull_request' && !startsWith(github.head_ref, 'release/full-matrix/') }}",
  );
});

test("push and workflow_dispatch are never gated by the PR group expression", () => {
  // Pin the exact expression once: any drift in event gating fails loudly.
  const PR_GROUP_EXPRESSION =
    "${{ github.event_name == 'pull_request' && !startsWith(github.head_ref, 'release/full-matrix/') && format('unified-ci-pr-{0}', github.ref) || format('unified-ci-run-{0}', github.run_id) }}";
  const block = concurrencyBlock();
  const group = block.match(/^ {2}group: (.+)$/m);
  assert.ok(group, "concurrency.group is a single line");
  assert.equal(group[1], PR_GROUP_EXPRESSION);
  assert.equal(
    workflow.split(PR_GROUP_EXPRESSION).length - 1,
    1,
    "the group expression appears exactly once in the workflow",
  );

  // Structural proof that only pull_request can reach the stable PR group:
  // one event-name guard, no per-ref group outside it, and the unique per-run
  // fallback for every other event (push, workflow_dispatch).
  assert.equal((group[1].match(/github\.event_name/g) || []).length, 1);
  assert.equal((group[1].match(/github\.ref\b/g) || []).length, 1);
  assert.equal((group[1].match(/github\.run_id/g) || []).length, 1);
  assert.ok(group[1].startsWith("${{ github.event_name == 'pull_request' && "));
  assert.match(workflow, /^ {2}push:/m);
  assert.match(workflow, /^ {2}workflow_dispatch:/m);
});

test("routing keeps every documented consumer edge", () => {
  const filters = parseFilters(workflow);
  const edges = {
    web: ["apps/server/**", "packages/**", "drizzle/**", "scripts/ci/**"],
    server: ["packages/data-access/**", "packages/application/**"],
    "api-client": ["packages/contracts/**"],
    mobile: ["packages/api-client/**", "packages/contracts/**"],
    db: ["drizzle/**", "src/db/**"],
    packages: ["packages/**"],
    code: ["apps/**", "packages/**", "scripts/**"],
    regressions: ["scripts/ega-runner/**", ".agents/**"],
  };
  for (const [name, required] of Object.entries(edges)) {
    const patterns = filters.get(name);
    assert.ok(patterns, `filter ${name} exists`);
    for (const pattern of required) {
      assert.ok(patterns.includes(pattern), `filter ${name} must route ${pattern}`);
    }
  }
});
