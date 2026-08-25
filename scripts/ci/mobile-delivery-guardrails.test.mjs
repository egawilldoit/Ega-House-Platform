import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readWorkflow(name) {
  const p = path.join(repoRoot, '.github', 'workflows', name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

test('mobile-delivery.yml exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf, 'mobile-delivery.yml must exist');
});

test('mobile-delivery has no pull_request trigger', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /pull_request\s*:/, 'Blacksmith must not trigger on pull_request');
});

test('mobile-delivery has no normal push to main trigger', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  // Must trigger only on workflow_dispatch and tags mobile-v*
  assert.match(wf, /workflow_dispatch\s*:/);
  assert.match(wf, /tags\s*:/);
  assert.match(wf, /mobile-v/);
  // Ensure there is no push: branches: [main] without tag filter
  // Check that push trigger if present only allows tags
  const pushBlock = wf.match(/push\s*:\s*\n([\s\S]*?)(?=\n\w+:|\nconcurrency:)/);
  if (pushBlock) {
    const block = pushBlock[1];
    assert.match(block, /tags/, 'push trigger must be tag-only');
    assert.doesNotMatch(block, /branches\s*:\s*\[[^\]]*main[^\]]*\]/);
  }
});

test('mobile-delivery contains exactly one Blacksmith runs-on declaration', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const blacksmithMatches = [...wf.matchAll(/runs-on:\s*blacksmith-2vcpu-ubuntu-2404/g)];
  assert.equal(blacksmithMatches.length, 1, `expected exactly one Blacksmith job, got ${blacksmithMatches.length}`);
});

test('Blacksmith label is blacksmith-2vcpu-ubuntu-2404 and timeout <= 40', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /blacksmith-2vcpu-ubuntu-2404/);
  assert.match(wf, /timeout-minutes:\s*40/);
  const allTimeouts = [...wf.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
  const lines = wf.split('\n');
  let inBlacksmithJob = false;
  let foundTimeout = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('blacksmith-2vcpu-ubuntu-2404')) inBlacksmithJob = true;
    if (inBlacksmithJob && lines[i].match(/timeout-minutes:\s*\d+/)) {
      foundTimeout = Number(lines[i].match(/timeout-minutes:\s*(\d+)/)[1]);
      break;
    }
  }
  assert.ok(foundTimeout === 40 || allTimeouts.includes(40), 'Blacksmith job must have timeout 40');
});

test('Blacksmith job has no matrix', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const blacksmithIdx = wf.indexOf('blacksmith-2vcpu-ubuntu-2404');
  const nextJobIdx = wf.indexOf('\n  runtime-proof:', blacksmithIdx);
  const jobHeaderStart = wf.lastIndexOf('\n  ', blacksmithIdx);
  const jobBlock = wf.slice(Math.max(0, jobHeaderStart - 500), nextJobIdx === -1 ? undefined : nextJobIdx);
  assert.doesNotMatch(jobBlock, /strategy\s*:\s*\n\s*matrix\s*:/, 'Blacksmith job must not have matrix');
});

test('APK temporary artifact retention is 1 day', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  // upload-artifact with retention-days: 1 for the exact APK handoff
  assert.match(wf, /retention-days:\s*1/);
  // APK artifact (ega-house-apk) must be retention 1; other evidence may be 7
  assert.match(wf, /ega-house-apk[\s\S]*?retention-days:\s*1/);
});

test('Android runtime job consumes downloaded artifact and contains no Gradle assemble', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  // Must contain download-artifact
  assert.match(wf, /download-artifact@v4/);
  // Must NOT contain assembleDebug / assembleRelease / gradlew build in runtime-proof job
  // Extract runtime-proof section
  const runtimeIdx = wf.indexOf('runtime-proof');
  assert.notEqual(runtimeIdx, -1, 'runtime-proof job must exist');
  const runtimeSlice = wf.slice(runtimeIdx, runtimeIdx + 15000);
  // Allow assemble in build job but not in runtime slice
  assert.doesNotMatch(runtimeSlice, /assembleDebug/);
  assert.doesNotMatch(runtimeSlice, /assembleRelease/);
  assert.doesNotMatch(runtimeSlice, /gradlew build/);
  // Ensure no expo prebuild that creates replacement APK in runtime
  // The runtime must not run prebuild:android
  assert.doesNotMatch(runtimeSlice, /prebuild:android/);
  assert.doesNotMatch(runtimeSlice, /expo prebuild/);
});

test('tagged release publishing uses checksum-verified APK', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  // Must have a publish/release job with if tag startsWith mobile-v
  assert.match(wf, /mobile-v/);
  assert.match(wf, /release/i);
  // Must reference SHA256 or checksum or manifest
  assert.match(wf, /SHA256|checksum|manifest/i);
});

test('workflow permissions follow least privilege', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  // Global permissions should be minimal (contents: read)
  assert.match(wf, /permissions\s*:/);
  assert.match(wf, /contents:\s*read/);
  // At least one job should have contents: write for release
  assert.match(wf, /contents:\s*write/);
});

test('no duplicate Android artifact uploads (only one upload-artifact for APK)', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const retentionOneCount = [...wf.matchAll(/retention-days:\s*1/g)].length;
  assert.equal(retentionOneCount, 1, 'exactly one APK upload with retention 1');
});

test('unified CI mobile path includes api-client', () => {
  const wf = readWorkflow('unified-platform-validation.yml');
  assert.ok(wf);
  // mobile filter must include api-client — search larger window from first mobile: under filters
  const filtersIdx = wf.indexOf('filters:');
  assert.notEqual(filtersIdx, -1);
  const filtersSlice = wf.slice(filtersIdx, filtersIdx + 2000);
  // Ensure the mobile section within filters contains api-client
  const mobileInFilters = filtersSlice.match(/mobile:\s*\n([\s\S]*?)(?=\n\s{8}[a-z-]+:)/);
  assert.ok(mobileInFilters, 'mobile filter block must exist');
  assert.match(mobileInFilters[1], /packages\/api-client\//, 'mobile filter must include packages/api-client/**');
});

test('old duplicate workflows are retired (mobile-apk-manual and android-runtime removed)', () => {
  const manual = readWorkflow('mobile-apk-manual.yml');
  const runtime = readWorkflow('android-runtime.yml');
  assert.equal(manual, null, 'mobile-apk-manual.yml should be retired');
  assert.equal(runtime, null, 'android-runtime.yml should be retired');
});
