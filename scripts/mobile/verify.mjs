#!/usr/bin/env node
/**
 * verify.mjs — Mobile Verification Harness (workstream 20).
 *
 * Orchestrates the four mobile CI gates in order and prints an
 * evidence-classified summary. Each gate is independent evidence; the
 * summary never collapses classes into a single PASS/FAIL.
 *
 * Gates:
 *   1. mobile:doctor     — expo-doctor environment proof
 *   2. mobile:typecheck  — TypeScript compilation proof
 *   3. mobile:test       — unit + integration test suite proof
 *   4. mobile:bundle     — Android export bundle proof
 *
 * Evidence labels (strictly classified, no emulator exists in this
 * environment):
 *   UNIT TESTED        — mobile:test passed (unit + integration suites)
 *   INTEGRATION TESTED — client→hook integration suite present and passing
 *                        (covered by mobile:test; see
 *                        apps/mobile/lib/api/__tests__/integration.test.ts)
 *   BUNDLE PROVEN      — mobile:bundle produced an export
 *   EMULATOR PROVEN    — NOT AVAILABLE (no emulator in this environment)
 *   PRODUCTION PROVEN  — NOT EVALUATED (no production deployment evidence)
 *
 * Exit code is non-zero when any executed gate fails.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const GATES = [
  { name: 'mobile:doctor', npmScript: 'mobile:doctor' },
  { name: 'mobile:typecheck', npmScript: 'mobile:typecheck' },
  { name: 'mobile:test', npmScript: 'mobile:test' },
  { name: 'mobile:bundle', npmScript: 'mobile:bundle' },
];

function runGate(gate) {
  const startedAt = Date.now();
  const result = spawnSync('npm', ['run', gate.npmScript], {
    stdio: 'inherit',
    shell: true,
  });
  const durationMs = Date.now() - startedAt;
  const exitCode = result.status ?? 1;
  return { ...gate, exitCode, durationMs };
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printGateResults(results) {
  console.log('\n=== Mobile verification gates ===');
  for (const gate of results) {
    const status = gate.exitCode === 0 ? 'PASS' : `FAIL (exit ${gate.exitCode})`;
    console.log(`${gate.name.padEnd(18)} ${status}  (${formatDuration(gate.durationMs)})`);
  }
}

function printEvidenceSummary(results) {
  const passed = (name) => results.find((gate) => gate.name === name)?.exitCode === 0;
  const testsPassed = passed('mobile:test');
  const bundlePassed = passed('mobile:bundle');

  console.log('\n=== Evidence summary ===');
  console.log(`UNIT TESTED         : ${testsPassed ? 'YES' : 'NO'}`);
  console.log(`INTEGRATION TESTED  : ${testsPassed ? 'YES' : 'NO'}`);
  console.log(`BUNDLE PROVEN       : ${bundlePassed ? 'YES' : 'NO'}`);
  console.log('EMULATOR PROVEN     : NOT AVAILABLE — no emulator in environment');
  console.log('PRODUCTION PROVEN   : NOT EVALUATED');
}

function main() {
  console.log('Mobile Verification Harness: doctor → typecheck → test → bundle\n');
  const results = GATES.map(runGate);
  printGateResults(results);
  printEvidenceSummary(results);

  const failed = results.filter((gate) => gate.exitCode !== 0);
  if (failed.length > 0) {
    console.error(
      `\nVerification FAILED: ${failed.map((gate) => gate.name).join(', ')}`,
    );
    process.exit(1);
  }

  console.log('\nAll executed gates passed.');
}

main();
