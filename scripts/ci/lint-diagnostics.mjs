#!/usr/bin/env node
/**
 * Print human-readable error-level ESLint diagnostics without changing the
 * baseline-aware lint-report exit semantics. Wave 6 uses this to remove
 * inherited debt by source location/rule instead of suppressing counts.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const eslintBin = path.join(process.cwd(), "node_modules/eslint/bin/eslint.js");
const result = spawnSync(process.execPath, [eslintBin, "--quiet", "."], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (result.stdout?.trim()) {
  console.log("\n### Error-level lint diagnostics\n");
  console.log(result.stdout.trimEnd());
}

if (result.stderr?.trim()) {
  console.error(result.stderr.trimEnd());
}

if (result.status === 2) {
  process.exit(2);
}

// Exit 0 here: baseline-aware report mode remains informational. The blocking
// changed-file gate still prevents new regressions, and Wave 6 will establish
// a zero-error baseline before this work is frozen.
process.exit(0);
