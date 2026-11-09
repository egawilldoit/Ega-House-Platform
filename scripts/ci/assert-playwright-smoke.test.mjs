import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
    r => { r.suites[0].specs[0].tests[0].results[0].errors = [{ message: 'late error' }]; },
  ]) { const r = report(); mutate(r); assert.notEqual(verify(r), 0); }
});

test('accepts real pinned-runner JSON and rejects its actual skipped/failed serialization', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-runner-'));
  const require = createRequire(import.meta.url);
  try {
    const config = join(dir, 'playwright.config.cjs');
    const outputFile = join(dir, 'report.json');
    writeFileSync(config, `module.exports = { testDir: ${JSON.stringify(dir)}, workers: 1, retries: 0, projects: [{ name: 'chromium-smoke' }], reporter: [['json', { outputFile: ${JSON.stringify(outputFile)} }]] };`);
    for (const mode of ['passed', 'skipped', 'failed']) {
      const cases = titles.map((title, index) => `test(${JSON.stringify(title)}, async () => { ${index === 0 && mode === 'skipped' ? 'test.skip();' : ''} expect(${index === 0 && mode === 'failed' ? 'false' : 'true'}).toBe(true); });`).join('\n');
      writeFileSync(join(dir, 'smoke-public.e2e.spec.ts'), `import { test, expect } from ${JSON.stringify(require.resolve('@playwright/test'))};\n${cases}`);
      const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', config], { encoding: 'utf8' });
      assert.equal(run.status, mode === 'failed' ? 1 : 0, run.stderr);
      const checked = spawnSync(process.execPath, ['scripts/ci/assert-playwright-smoke.mjs', outputFile]);
      assert.equal(checked.status, mode === 'passed' ? 0 : 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed reports fail without printing report contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-malformed-'));
  try {
    const path = join(dir, 'report.json');
    writeFileSync(path, 'LOCAL_REPORT_SECRET_SENTINEL');
    const run = spawnSync(process.execPath, ['scripts/ci/assert-playwright-smoke.mjs', path], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.doesNotMatch(run.stdout + run.stderr, /LOCAL_REPORT_SECRET_SENTINEL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
