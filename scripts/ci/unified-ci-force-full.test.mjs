import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
  for (const output of ["web", "mobile", "server", "api-client", "db"]) {
    const section = jobSection(output === "db" ? "db-invariants" : output);
    assert.match(
      section,
      new RegExp(
        `if: needs\\.changes\\.outputs\\.${output} == 'true' \\|\\| needs\\.changes\\.outputs\\.force_full == 'true'`,
      ),
      `leaf job ${output} must run under force_full`,
    );
  }
});

test("hygiene keeps if: always() and fails on any failed or cancelled dependency", () => {
  const section = jobSection("hygiene");
  assert.match(section, /if: always\(\)/);
  for (const dep of [
    "changes",
    "workspace",
    "contracts",
    "domain",
    "application",
    "data-access",
    "regressions",
    "lint-changed",
    "lint-report",
    "web",
    "mobile",
    "server",
    "api-client",
    "db-invariants",
  ]) {
    assert.match(section, new RegExp(`needs\\.${dep}\\.result`), `hygiene must check ${dep}`);
  }
  assert.match(section, /failure\|cancelled/);
  assert.doesNotMatch(section, /failure\|cancelled\|skipped/);
});

test("hygiene rejects skips only in force-full mode", () => {
  const section = jobSection("hygiene");
  assert.match(section, /skipped/);
  assert.match(section, /needs\.changes\.outputs\.force_full.*"true"[\s\S]*?skipped|skipped[\s\S]*?needs\.changes\.outputs\.force_full.*"true"/);
});
