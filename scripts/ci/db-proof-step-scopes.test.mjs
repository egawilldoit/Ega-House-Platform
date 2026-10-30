import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Every scripts/db verifier that unified CI runs must actually be able to run.
 *
 * WHY THIS EXISTS. `mcp-rate-limit-concurrency-verify.mjs` was wired into the
 * `db-invariants` job with no `env:` block, while every sibling step declared
 * `PROOF_DATABASE_URL` at step scope. There is no workflow-level or job-level
 * definition of that variable, so `$PROOF_DATABASE_URL` expanded to the empty
 * string and the step invoked the verifier as `--url ""`. The verifier is
 * deliberate about refusing an absent URL - it exits 2 with
 * "Missing required --url <postgres-url>" rather than defaulting to something -
 * so the step failed rather than silently passing, but it also meant a real
 * security proof was never actually executed by CI, and nothing in the
 * repository noticed. A proof that cannot connect is not a proof.
 *
 * WHY THIS IS A STATIC CHECK. The failure mode is textual: a step that reads a
 * variable its own scope never defines. Asserting on the parsed workflow catches
 * it without needing a database or a runner, and it catches it for every
 * verifier at once rather than one hand-picked step at a time.
 *
 * WHY THE DEFINITION MUST BE IN THE STEP. Both the per-step check and the
 * precondition test below read one scope only: the step's own. A variable
 * declared at job or workflow scope would make the per-step check vacuous -
 * every step would appear to define it whether or not it did - so that scope is
 * rejected outright rather than accommodated. This is why no failure message
 * here advises moving a variable outward.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not assert that each verifier uses a
 * distinct database, and it does not require any particular URL. A shared
 * database is legitimate here because every verifier drops and recreates
 * public/auth/automation as its first act and restores them before exiting. It
 * also does not enumerate which verifiers CI must run - the inventory that
 * matters for that is `scripts/ci/audit-production.test.mjs`, which pins
 * ARCHITECTURE.md against the scripts/db directory.
 */

const WORKFLOW_PATH = new URL(
  "../../.github/workflows/unified-platform-validation.yml",
  import.meta.url,
);

const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const workflowLines = workflow.split("\n");

/** Indentation of a `run:`/`env:` key, used to walk a step's scope. */
const INDENT = /^( *)/;

/**
 * Every variable name a step's `run:` lines interpolate, in BOTH spellings
 * GitHub Actions expands.
 *
 *   $NAME / ${NAME}            the shell form, which the shell expands
 *   ${{ env.NAME }}            the expression form, which Actions expands before
 *                               the shell ever sees the line
 *
 * The second form was invisible to the previous `/\$\{?([A-Za-z_]\w*)\}?/`
 * regex: after `$` and `{` comes another `{`, so nothing matched, the step read
 * no variables, and a verifier rewritten to the expression form passed this
 * guard while still being invoked with an empty `--url`.
 *
 * Only `env.NAME` is read out of an expression. `github.*`, `needs.*`,
 * `steps.*`, `runner.*`, `matrix.*` and friends are supplied by the runner and
 * cannot be declared in a step's `env:` block at all, so counting them as
 * missing definitions would report failures for correct workflow; `secrets.*`
 * and `vars.*` come from the repository, not from this file, and a step cannot
 * define them either. `env.` is exactly the context a step's own `env:` block
 * feeds, which is the failure this file exists to catch.
 */
function referencedVariables(runLines) {
  const referenced = new Set();

  for (const line of runLines) {
    for (const match of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
      referenced.add(match[1]);
    }
    for (const expression of line.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      for (const match of expression[1].matchAll(/\benv\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        referenced.add(match[1]);
      }
    }
  }

  return referenced;
}

/**
 * Split the workflow into steps and, for each step, report the variable names
 * its own scope defines plus the source lines that scope covers. The line set
 * is what lets the precondition test below tell a step-scope declaration apart
 * from one at job or workflow scope.
 */
function verifierSteps() {
  const steps = [];
  let current = null;
  // Every source line the parser attributed to a step, by its line index.
  const stepOwnedLines = new Set();

  const flush = () => {
    if (current) steps.push(current);
    current = null;
  };

  for (const [index, line] of workflowLines.entries()) {
    const indent = INDENT.exec(line)[1].length;
    const isListItem = /^ *- /.test(line);

    // A list item at this workflow's step level starts a new step. A step is
    // either "- name: ..." followed by keys, or a bare "- run: ..." with no
    // name; both are steps, so the inline form must not be discarded.
    if (isListItem) {
      flush();
      stepOwnedLines.add(index);
      const inline = /- run:\s*(.*)$/.exec(line.trim());
      current = {
        header: line.trim(),
        indent,
        envKeys: new Set(),
        runLines: inline ? [inline[1]] : [],
      };
      continue;
    }
    if (!current) continue;
    stepOwnedLines.add(index);

    // Dedent back to or above the step's own list-item level: the step is over.
    if (line.trim() !== "" && indent <= current.indent) {
      flush();
      continue;
    }
    if (/^ *env:/.test(line)) continue;

    const run = /^ *run:\s*(.*)$/.exec(line);
    if (run) {
      current.runLines.push(run[1]);
      continue;
    }

    const key = /^ *([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    if (key) {
      // Keys one level deeper than the list item are the contents of the step's
      // own env: block; keys at the step level are step keys. Both are
      // definitions available to that step, which is what this check needs.
      current.envKeys.add(key[1]);
    }
  }
  flush();
  return { steps, stepOwnedLines };
}

const { steps, stepOwnedLines } = verifierSteps();

const verifierStepsFound = steps.filter((step) =>
  step.runLines.some((line) => /node scripts\/db\/[^ ]+\.mjs/.test(line)),
);

const verifierStepCount = verifierStepsFound.length;

test("the workflow declares at least one scripts/db verifier step", () => {
  assert.ok(
    verifierStepCount > 0,
    "no scripts/db verifier step was found; the parse below would pass vacuously",
  );
});

test("the parse finds every verifier step the workflow names", () => {
  // Cross-check the parser against a plain textual count. Without this, a parser
  // that silently stopped recognising `- run:` steps would report zero found and
  // the per-step check above would pass without examining anything.
  const textualCount = (
    workflow.match(/node scripts\/db\/[^ ]+\.mjs --url /g) ?? []
  ).length;
  assert.equal(
    verifierStepCount,
    textualCount,
    `the parser found ${verifierStepCount} verifier steps but the workflow contains ` +
      `${textualCount} scripts/db verifier invocations; the parse is incomplete`,
  );
});

test("every scripts/db verifier step defines every variable its command reads", () => {
  const problems = [];

  for (const step of verifierStepsFound) {
    // Variables this step's own run: lines interpolate, in either spelling.
    const referenced = referencedVariables(step.runLines);

    for (const name of referenced) {
      if (step.envKeys.has(name)) continue;
      problems.push(
        [
          `step ${step.header}`,
          `runs a scripts/db verifier but never defines $${name}, so the variable`,
          `expands to the empty string and the verifier is invoked with an empty`,
          `--url and exits without proving anything. Add it to that step's own env:`,
          `block. Job or workflow scope is not an alternative: the check named`,
          `"PROOF_DATABASE_URL is declared in step scope only" below exists because`,
          `a variable at that scope makes this one vacuous, so this failure has to`,
          `be fixed in the step.`,
        ].join(" "),
      );
    }
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});

test("PROOF_DATABASE_URL is declared in step scope only, never at workflow or job scope", () => {
  // If it ever becomes a job- or workflow-level env, the per-step check above
  // stops proving anything, because every step would appear to define it. This
  // asserts the precondition that keeps that check meaningful.
  //
  // The previous version of this test matched /^ {2}PROOF_DATABASE_URL:/ against
  // the text BEFORE the first job key, so it could only ever see a workflow-level
  // declaration: a job-level one sits at four spaces and after the split, and
  // both were invisible. Matching the key at ANY indentation over the WHOLE
  // workflow and requiring every occurrence to be a line the step parser owns is
  // the shape that cannot miss a scope, and it cannot false-positive on the
  // legitimate case either, because a step's own env: key is owned by that step.
  const declarations = [];
  for (const [index, line] of workflowLines.entries()) {
    if (/^\s*PROOF_DATABASE_URL\s*:/.test(line)) {
      declarations.push({ index, line, owned: stepOwnedLines.has(index) });
    }
  }

  assert.ok(
    declarations.length > 0,
    "no PROOF_DATABASE_URL declaration was found in the workflow; the scope " +
      "check below would pass vacuously, and the verifier steps would be reading " +
      "an undefined variable",
  );

  const outsideSteps = declarations.filter((d) => !d.owned);
  assert.deepEqual(
    outsideSteps.map((d) => `line ${d.index + 1}: ${d.line.trim()}`),
    [],
    "PROOF_DATABASE_URL is declared at workflow or job scope, where the per-step " +
      "definition check cannot see it; every verifier step would then appear to " +
      "define it whether or not it did, and that check is now vacuous. Move the " +
      "declaration back into each step's own env: block, or revisit this file.",
  );
});
