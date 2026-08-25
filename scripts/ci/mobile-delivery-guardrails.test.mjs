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

function getJobBlock(wf, jobId) {
  const idx = wf.indexOf(`\n  ${jobId}:`);
  if (idx === -1) return null;
  // Find next job header: \n  <jobId>: at same indent
  const re = /\n  [a-z0-9-]+:\s*\n/g;
  let m;
  re.lastIndex = idx + 4;
  let end = wf.length;
  while ((m = re.exec(wf)) !== null) {
    if (m.index > idx + 10) {
      end = m.index;
      break;
    }
  }
  return wf.slice(idx, end);
}

function getBlacksmithBlock(wf) {
  return getJobBlock(wf, 'build-apk');
}

function getRuntimeBlock(wf) {
  return getJobBlock(wf, 'launch-smoke') || getJobBlock(wf, 'runtime-proof');
}

function getPreflightBlock(wf) {
  return getJobBlock(wf, 'preflight');
}

test('mobile-delivery.yml exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf, 'mobile-delivery.yml must exist');
});

test('mobile-delivery has no pull_request trigger', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /pull_request\s*:/);
});

test('mobile-delivery has no automatic main push Android build', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /workflow_dispatch\s*:/);
  assert.match(wf, /tags\s*:/);
  assert.match(wf, /mobile-v/);
  const pushBlock = wf.match(/push\s*:\s*\n([\s\S]*?)(?=\n\w+:|\nconcurrency:)/);
  if (pushBlock) {
    const block = pushBlock[1];
    assert.match(block, /tags/, 'push must be tag-only');
    assert.doesNotMatch(block, /branches\s*:\s*\[[^\]]*main[^\]]*\]/);
  }
});

test('workflow_dispatch exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /workflow_dispatch\s*:/);
});

test('tag trigger mobile-v* exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /mobile-v\*.*\*/);
  assert.match(wf, /mobile-v/);
});

test('no build_variant input', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /build_variant/);
});

test('no runtime_proof input', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /runtime_proof/);
});

test('no authenticated_e2e input', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /authenticated_e2e/);
});

test('exactly one Blacksmith job', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const matches = [...wf.matchAll(/runs-on:\s*blacksmith-2vcpu-ubuntu-2404/g)];
  assert.equal(matches.length, 1);
});

test('Blacksmith runner = blacksmith-2vcpu-ubuntu-2404', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /blacksmith-2vcpu-ubuntu-2404/);
});

test('Blacksmith timeout <= 40', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block, 'build-apk block must exist');
  const m = block.match(/timeout-minutes:\s*(\d+)/);
  assert.ok(m, 'Blacksmith job must have timeout');
  assert.ok(Number(m[1]) <= 40, `timeout ${m[1]} > 40`);
});

test('no Blacksmith matrix', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /strategy\s*:\s*\n\s*matrix\s*:/);
});

test('Blacksmith contains exactly one assembleRelease', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  const count = [...block.matchAll(/assembleRelease/g)].length;
  assert.equal(count, 1, `expected 1 assembleRelease in Blacksmith, got ${count}`);
});

test('Blacksmith contains zero assembleDebug', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /assembleDebug/);
});

test('Blacksmith contains zero bundleRelease', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /bundleRelease/);
});

test('ABI property contains arm64-v8a,x86_64', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  assert.match(block, /reactNativeArchitectures=arm64-v8a,x86_64/);
});

test('ABI property does not contain armeabi-v7a,x86 in build command', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  const abiLine = [...block.matchAll(/reactNativeArchitectures=[^\n]+/g)].map((m) => m[0]).join('\n');
  assert.ok(abiLine.length > 0, 'abi line must exist');
  assert.doesNotMatch(abiLine, /armeabi-v7a/);
  assert.match(abiLine, /arm64-v8a,x86_64/);
  assert.doesNotMatch(abiLine, /armeabi/);
});

test('setup-java@v5 exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /actions\/setup-java@v5/);
  assert.doesNotMatch(wf, /actions\/setup-java@v4/);
});

test('setup-gradle@v6 exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /gradle\/actions\/setup-gradle@v6/);
});

test('cache-provider basic exists', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /cache-provider:\s*basic/);
});

test('no Sticky Disk actions', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /sticky/i);
  assert.doesNotMatch(wf, /blacksmith.*cache/);
});

test('no useblacksmith/checkout', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /useblacksmith\/checkout/);
});

test('Android setup uses current v4 if compatible', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /android-actions\/setup-android@v4/);
});

test('no doctor/typecheck inside Blacksmith job', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getBlacksmithBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /mobile:doctor/);
  assert.doesNotMatch(block, /mobile:typecheck/);
});

test('APK artifact retention = 1 day', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /ega-house-apk[\s\S]*?retention-days:\s*1/);
});

test('one and only one ega-house-apk artifact upload', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /ega-house-apk[\s\S]*?retention-days:\s*1/);
  const uploadBlocks = wf.split('upload-artifact@v4');
  const apkUploads = uploadBlocks.filter((b) => b.slice(0, 600).includes('ega-house-apk')).length;
  assert.equal(apkUploads, 1, `expected exactly 1 ega-house-apk upload, got ${apkUploads}`);
  const totalRetentionOne = [...wf.matchAll(/retention-days:\s*1/g)].length;
  assert.ok(totalRetentionOne >= 1 && totalRetentionOne <= 2, `expected 1-2 retention 1 (APK + failure diagnostics), got ${totalRetentionOne}`);
});

test('runtime downloads existing APK', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block, 'runtime/launch-smoke block must exist');
  assert.match(block, /download-artifact@v4/);
  assert.match(block, /ega-house-apk/);
});

test('runtime contains zero Gradle assemble', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /assembleRelease/);
  assert.doesNotMatch(block, /assembleDebug/);
  assert.doesNotMatch(block, /gradlew/);
});

test('runtime contains zero Expo prebuild', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /prebuild/);
  assert.doesNotMatch(block, /expo/);
});

test('runtime contains zero checkout', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /actions\/checkout/);
});

test('runtime contains zero npm ci', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /npm ci/);
});

test('runtime contains zero setup-node', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /setup-node/);
});

test('runtime contains zero Maestro', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /maestro/i);
});

test('runtime contains zero authenticated E2E', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /authenticated_e2e/i);
  assert.doesNotMatch(block, /EGA_TEST_EMAIL/);
});

test('runtime contains zero uiautomator', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /uiautomator/);
});

test('runtime contains adb install', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.match(block, /install -r/);
});

test('runtime contains am start -W', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.match(block, /am start.*-W/);
});

test('runtime contains pidof', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.match(block, /pidof/);
});

test('runtime performs approximately 10-second liveness wait', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.match(block, /sleep 10|sleep.*10/);
});

test('success path does not upload runtime evidence', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  // Success should not have unconditional upload of ci-artifacts; only failure() condition
  assert.doesNotMatch(block, /upload-artifact[\s\S]*?if:\s*always\(\)[\s\S]*?runtime/);
  // Ensure no always() upload for runtime
  const hasAlwaysUpload = /if:\s*always\(\)[\s\S]*?upload-artifact/.test(block);
  assert.equal(hasAlwaysUpload, false, 'runtime success should not upload artifact with always()');
});

test('failure path may upload 1-day diagnostics', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getRuntimeBlock(wf);
  assert.ok(block);
  assert.match(block, /if:\s*failure\(\)/);
  assert.match(block, /retention-days:\s*1/);
});

test('preflight no longer probes /health', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getPreflightBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /\/health/);
});

test('preflight no longer probes /ready', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getPreflightBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /\/ready/);
});

test('preflight no longer probes /api\/projects', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getPreflightBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /\/api\/projects/);
});

test('preflight does not poll CI repeatedly', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getPreflightBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /ATTEMPTS=5/);
  assert.doesNotMatch(block, /for i in/);
  assert.doesNotMatch(block, /sleep 15/);
});

test('arbitrary branches are not allowed', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  const block = getPreflightBlock(wf);
  assert.ok(block);
  assert.doesNotMatch(block, /refs\/heads\/ci\//);
  assert.doesNotMatch(block, /refs\/heads\/arch\//);
  assert.doesNotMatch(block, /refs\/heads\/wave\//);
  assert.match(block, /refs\/heads\/main/);
  assert.match(block, /mobile-v\*/);
});

test('api-client still propagates to mobile in unified CI', () => {
  const wf = readWorkflow('unified-platform-validation.yml');
  assert.ok(wf);
  const filtersIdx = wf.indexOf('filters:');
  assert.notEqual(filtersIdx, -1);
  const filtersSlice = wf.slice(filtersIdx, filtersIdx + 2000);
  const mobileInFilters = filtersSlice.match(/mobile:\s*\n([\s\S]*?)(?=\n\s{8}[a-z-]+:)/);
  assert.ok(mobileInFilters);
  assert.match(mobileInFilters[1], /packages\/api-client\//);
});

test('old duplicate workflows remain retired', () => {
  const manual = readWorkflow('mobile-apk-manual.yml');
  const runtime = readWorkflow('android-runtime.yml');
  assert.equal(manual, null);
  assert.equal(runtime, null);
});

test('tagged release publishes same checksum-verified APK', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.match(wf, /mobile-v/);
  assert.match(wf, /release/);
  assert.match(wf, /SHA256|checksum|manifest/i);
  assert.match(wf, /sha256sum -c/);
});

test('no Play Store/AAB workflow logic', () => {
  const wf = readWorkflow('mobile-delivery.yml');
  assert.ok(wf);
  assert.doesNotMatch(wf, /bundleRelease/);
  assert.doesNotMatch(wf, /\.aab/);
  assert.doesNotMatch(wf, /play-store-track|google-play|upload.*aab/i);
});
