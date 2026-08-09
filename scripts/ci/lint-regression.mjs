#!/usr/bin/env node
/**
 * lint-regression.mjs — baseline-aware lint gate + informational full-lint
 * report with drift detection (design §8).
 *
 * The repository carries an inherited lint debt baseline captured at the
 * start of the migration's Stage 9 (39 errors / 53 warnings — see
 * scripts/ci/lint-baseline.json). Full-repo lint must therefore never be a
 * hard gate; regressions are detected per changed path:
 *
 *   changed  — eslint runs ONLY on files changed vs a base ref; a file passes
 *              iff its error/warning counts do not exceed its baseline entry;
 *              NEW files (no baseline entry) must be zero-problem. This is
 *              effectively blocking for per-PR regressions.
 *   report   — full-repo lint always runs; totals compared to the baseline;
 *              drift (> +1 warning, or any error above baseline) is reported
 *              as a failure but the job runs with continue-on-error so it
 *              never blocks the pipeline. Informational + drift detection.
 *   capture  — regenerates scripts/ci/lint-baseline.json from the live tree
 *              (deliberate baseline updates only, per design §8; PR7 must
 *              re-capture after moving src/** → apps/web/src/**).
 *
 * Usage:
 *   node scripts/ci/lint-regression.mjs changed --base <sha|ref>
 *   node scripts/ci/lint-regression.mjs report
 *   node scripts/ci/lint-regression.mjs capture
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const BASELINE_FILE = path.join(cwd, 'scripts/ci/lint-baseline.json');
const ESLINT_BIN = path.join(cwd, 'node_modules/eslint/bin/eslint.js');
const LINT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const MAX_WARNING_DRIFT = 1;

function runEslint(targets) {
  const result = spawnSync(process.execPath, [ESLINT_BIN, '--format', 'json', ...targets], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status === 2) {
    // eslint exit 2 = fatal (config/parse) error
    console.error(result.stderr || result.stdout);
    throw new Error('eslint terminated fatally (exit 2)');
  }
  return result.stdout;
}

function parseEslintOutput(stdout, baseDir) {
  const perFile = new Map();
  let totals = { errors: 0, warnings: 0 };
  try {
    for (const entry of JSON.parse(stdout)) {
      const rel = path.relative(baseDir, entry.filePath);
      const errors = entry.errorCount ?? 0;
      const warnings = entry.warningCount ?? 0;
      perFile.set(rel, { errors, warnings });
      totals.errors += errors;
      totals.warnings += warnings;
    }
  } catch (error) {
    throw new Error(`could not parse eslint JSON output: ${error.message}`);
  }
  return { perFile, totals };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    throw new Error(`${BASELINE_FILE} missing — run: node scripts/ci/lint-regression.mjs capture`);
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------
function capture() {
  console.log('capturing full-repo eslint baseline…');
  const stdout = runEslint(['.']);
  const { perFile, totals } = parseEslintOutput(stdout, cwd);
  const baseline = {
    capturedAt: new Date().toISOString(),
    sha: git(['rev-parse', 'HEAD']),
    note: 'Inherited lint debt at Stage 9 start. Updates only via deliberate PRs that also fix counted problems (design §8). PR7 must re-capture after moving src/** to apps/web/src/**.',
    totals,
    perFile: Object.fromEntries([...perFile.entries()].sort()),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`wrote ${BASELINE_FILE}`);
  console.log(`totals: ${totals.errors} errors / ${totals.warnings} warnings`);
}

// ---------------------------------------------------------------------------
// changed — per-file regression gate vs baseline
// ---------------------------------------------------------------------------
function changed(base) {
  if (!base) throw new Error('changed mode requires --base <sha|ref>');
  const baseline = readBaseline();
  console.log(`changed-path lint vs base ${base}`);

  const changedFiles = git(['diff', '--name-only', `${base}...HEAD`])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => LINT_EXTENSIONS.has(path.extname(file)) && fs.existsSync(file));

  if (changedFiles.length === 0) {
    console.log('no lintable files changed — gate passes');
    return;
  }

  const stdout = runEslint(changedFiles);
  const { perFile } = parseEslintOutput(stdout, cwd);

  const rows = [];
  let failures = 0;
  for (const file of changedFiles) {
    const actual = perFile.get(file) ?? { errors: 0, warnings: 0 };
    const entry = baseline.perFile?.[file];
    let status = 'ok';
    if (!entry) {
      // new file: zero-problem rule
      if (actual.errors > 0 || actual.warnings > 0) {
        status = 'FAIL (new file must be zero-problem)';
        failures += 1;
      }
    } else if (actual.errors > entry.errors || actual.warnings > entry.warnings) {
      status = `FAIL (baseline ${entry.errors}E/${entry.warnings}W)`;
      failures += 1;
    }
    rows.push({ file, actual, entry, status });
  }

  const width = Math.max(...rows.map((r) => r.file.length)) + 2;
  console.log('\nper-file lint regression:');
  console.log(`${'file'.padEnd(width)} now      baseline`);
  for (const { file, actual, entry, status } of rows) {
    const now = `${actual.errors}E/${actual.warnings}W`;
    const was = entry ? `${entry.errors}E/${entry.warnings}W` : '—(new)';
    console.log(`${file.padEnd(width)} ${now.padEnd(9)} ${was.padEnd(10)} ${status}`);
  }
  console.log(`\n${changedFiles.length} changed file(s) linted, ${failures} regression(s)`);

  if (failures > 0) {
    console.error('\nlint-changed: FAILED — fix the regressions (or, for deliberate baseline updates, re-capture with `lint-regression.mjs capture` in a dedicated PR that also fixes the counted problems)');
    process.exit(1);
  }
  console.log('lint-changed: PASSED');
}

// ---------------------------------------------------------------------------
// report — full lint with drift detection (informational, never blocking)
// ---------------------------------------------------------------------------
function report() {
  const baseline = readBaseline();
  console.log('full-repo lint (informational report with drift detection)…');
  const stdout = runEslint(['.']);
  const { totals } = parseEslintOutput(stdout, cwd);

  const errorDrift = totals.errors - baseline.totals.errors;
  const warningDrift = totals.warnings - baseline.totals.warnings;
  const failed = totals.errors > baseline.totals.errors || totals.warnings > baseline.totals.warnings + MAX_WARNING_DRIFT;

  const lines = [
    '### Unified lint report',
    '',
    `| metric | baseline (${baseline.sha.slice(0, 7)}) | now | drift |`,
    '|---|---|---|---|',
    `| errors | ${baseline.totals.errors} | ${totals.errors} | ${errorDrift > 0 ? '+' : ''}${errorDrift} |`,
    `| warnings | ${baseline.totals.warnings} | ${totals.warnings} | ${warningDrift > 0 ? '+' : ''}${warningDrift} |`,
    '',
    `**Gate:** ${failed ? 'DRIFT DETECTED (informational — does not block; fix or re-capture deliberately)' : 'within baseline tolerance (informational — not blocking)'}`,
    '',
    'Full-repo lint is intentionally non-blocking while the inherited debt baseline exists; the blocking gate is the `lint-changed` job (changed paths must not exceed their per-file baseline).',
  ];
  const summary = lines.join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  console.log(`lint totals: ${totals.errors} errors / ${totals.warnings} warnings (baseline ${baseline.totals.errors}/${baseline.totals.warnings})`);
  if (failed) {
    console.error('lint-report: DRIFT DETECTED (informational; job runs with continue-on-error)');
    process.exit(1);
  }
  console.log('lint-report: within baseline tolerance');
}

// ---------------------------------------------------------------------------
const [mode] = process.argv.slice(2);
const baseArgIndex = process.argv.indexOf('--base');
const base = baseArgIndex >= 0 ? process.argv[baseArgIndex + 1] : process.env.CI_BASE;

try {
  if (mode === 'capture') capture();
  else if (mode === 'changed') changed(base);
  else if (mode === 'report') report();
  else {
    console.error('usage: node scripts/ci/lint-regression.mjs <changed|report|capture> [--base <sha|ref>]');
    process.exit(2);
  }
} catch (error) {
  console.error(`lint-regression: ${error.message}`);
  process.exit(1);
}
