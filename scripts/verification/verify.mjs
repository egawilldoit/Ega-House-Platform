#!/usr/bin/env node
/**
 * EGA House verification harness.
 *
 * Runs the Mobile + Web verification matrix from a clean checkout or worktree,
 * captures exact exit codes / totals / durations, and prints an evidence-label
 * summary. Exits non-zero when any executed check fails.
 *
 * Usage:
 *   node scripts/verification/verify.mjs [--quick] [--only mobile|web|structural]
 *
 * Evidence classes are reported honestly: this harness proves COMMAND-level
 * results only. It never grants RUNTIME evidence (no emulator/device is
 * involved) and never promotes one class to another.
 *
 * Requirements:
 *   - npm ci must have succeeded (see note: origin/mobile-v1 lockfile is out
 *     of sync; use `npm install` then restore package-lock.json locally).
 *   - web build requires DATABASE_URL to be set at build time even though no
 *     connection is made; the harness passes a placeholder unless one exists.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const quick = args.includes('--quick');
const onlyArg = args.find((a) => a.startsWith('--only'))?.split('=')[1];
const only = onlyArg ?? null;

function run(name, command, { env = {}, cwd = repoRoot } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, {
    shell: true,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: '1', ...env },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    name,
    command,
    exitCode: result.status ?? (result.error ? -1 : null),
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    durationMs: Date.now() - startedAt,
    tail: output.split('\n').filter(Boolean).slice(-25).join('\n'),
  };
}

function extract(log, pattern) {
  const match = log.match(pattern);
  return match ? match[0] : null;
}

function label(result, successLabel, failureLabel = 'COMMAND FAILED') {
  if (result.exitCode === 0) return successLabel;
  if (result.timedOut) return 'TIMED OUT';
  return failureLabel;
}

const suites = {
  structural: [
    { name: 'workspace-purity', command: 'npm run ci:purity' },
    { name: 'security-proofs', command: 'npm run ci:security' },
    { name: 'workspace-proofs', command: 'npm run ci:workspace' },
    { name: 'architecture-boundaries', command: 'npm run check:architecture' },
  ],
  mobile: [
    { name: 'mobile:typecheck', command: 'npm run mobile:typecheck' },
    { name: 'mobile:test', command: 'npm run mobile:test' },
    {
      name: 'mobile:doctor',
      command: 'npm run mobile:doctor',
      // Known finding on mobile-v1@58e8458: expo-doctor fails on three patch
      // version mismatches (expo/expo-constants/jest-expo). Kept in the matrix;
      // its failure must not mask other failures.
      nonBlocking: true,
    },
    {
      name: 'mobile:bundle',
      command: 'npm run mobile:bundle',
      postCleanup: () => {
        rmSync(path.join(repoRoot, 'apps/mobile/.expo/ci-export'), { recursive: true, force: true });
      },
    },
  ],
  web: [
    { name: 'web:typecheck', command: 'npm run web:typecheck' },
    { name: 'web:test', command: 'npm run web:test' },
    { name: 'web:test-session', command: 'npm run test:session' },
    { name: 'web:test-timer-recovery', command: 'npm run test:timer-recovery' },
    {
      name: 'web:build',
      command: 'npm run web:build',
      env: process.env.DATABASE_URL
        ? {}
        : { DATABASE_URL: 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder' },
      postCleanup: () => {
        rmSync(path.join(repoRoot, 'apps/web/.next'), { recursive: true, force: true });
      },
    },
  ],
};

if (quick) {
  suites.mobile = suites.mobile.filter((c) => c.name !== 'mobile:bundle');
  suites.web = suites.web.filter((c) => c.name !== 'web:build');
}

const selected = only ? Object.fromEntries(Object.entries(suites).filter(([k]) => k === only)) : suites;

const results = [];
for (const [suiteName, checks] of Object.entries(selected)) {
  for (const check of checks) {
    process.stdout.write(`[${suiteName}] running ${check.name} ... \n`);
    const result = run(check.name, check.command, { env: check.env ?? {} });
    result.suite = suiteName;
    result.nonBlocking = Boolean(check.nonBlocking);
    if (check.postCleanup) check.postCleanup();
    results.push(result);
    console.log(`  -> exit=${result.exitCode} (${(result.durationMs / 1000).toFixed(1)}s)`);
  }
}

// Totals extraction (honest reporting; missing patterns stay null).
for (const result of results) {
  if (result.name === 'mobile:test') {
    result.totals = extract(result.tail, /Tests:\s+\d+ passed.*|Tests:\s+\d+ failed.*/)?.replace(
      /\s+/g,
      ' ',
    );
  }
  if (result.name === 'mobile:doctor') {
    result.totals = extract(result.tail, /\d+\/\d+ checks passed/);
  }
  if (result.name === 'web:test') {
    result.totals = extract(result.tail, /Tests\s+\d+\s+passed[\s\S]{0,40}/)?.replace(/\s+/g, ' ');
  }
}

let pkgVersions = null;
try {
  pkgVersions = {
    node: process.version,
    expoSdk: require(`${repoRoot}/apps/mobile/package.json`).dependencies.expo,
    next: require(`${repoRoot}/apps/web/package.json`).dependencies.next,
  };
} catch {}

const blockingFailures = results.filter((r) => r.exitCode !== 0 && !r.nonBlocking);

console.log('\n=== EVIDENCE SUMMARY ===');
for (const result of results) {
  const evidence = label(result, 'STRUCTURAL PASS / UNIT TESTED (command-level)');
  console.log(
    `${result.suite.padEnd(12)} ${result.name.padEnd(24)} exit=${String(result.exitCode).padEnd(4)} ${evidence}${
      result.nonBlocking ? ' (non-blocking known finding)' : ''
    }${result.totals ? ` | ${result.totals}` : ''}`,
  );
}
if (pkgVersions) {
  console.log(`toolchain: node=${pkgVersions.node} expo=${pkgVersions.expoSdk} next=${pkgVersions.next}`);
}

const outDir = path.join(repoRoot, 'scripts/verification/results');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const outFile = path.join(outDir, `verify-${stamp}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ generatedAt: new Date().toISOString(), results, toolchain: pkgVersions }, null, 2),
);
console.log(`results written: ${path.relative(repoRoot, outFile)}`);

if (blockingFailures.length > 0) {
  console.error(`\nFAIL: ${blockingFailures.length} blocking check(s) failed.`);
  process.exit(1);
}
console.log('\nOK: all blocking checks passed.');
