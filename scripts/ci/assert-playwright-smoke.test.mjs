import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const titles = ['public homepage contract @smoke', 'login form is present without signing in @smoke', 'signup form is present without submission @smoke'];
function report() {
  return { errors: [], stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 }, suites: [{ specs: titles.map(title => ({ title, tags: ['smoke'], file: 'smoke-public.e2e.spec.ts', ok: true, tests: [{ projectName: 'chromium-smoke', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0 }] }] })) }] };
}
function verify(value) {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-report-'));
  try {
    const path = join(dir, 'report.json');
    writeFileSync(path, JSON.stringify(value));
    return spawnSync(process.execPath, ['scripts/ci/assert-playwright-smoke.mjs', path]).status;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('accepts the expected report and rejects incomplete or misleading outcomes', () => {
  assert.equal(verify(report()), 0);
  for (const mutate of [
    r => r.suites[0].specs.pop(),
    r => { r.stats.skipped = 1; },
    r => { r.stats.flaky = 1; },
    r => { r.suites[0].specs[0].tests[0].expectedStatus = 'failed'; },
    r => { r.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 }); },
    r => { r.suites[0].specs[0].tests[0].projectName = 'other'; },
    r => { r.errors.push({ message: 'interrupted' }); },
  ]) { const r = report(); mutate(r); assert.notEqual(verify(r), 0); }
});
