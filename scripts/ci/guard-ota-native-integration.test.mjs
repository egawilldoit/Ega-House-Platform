import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_SCRIPT = path.join(REPO_ROOT, 'scripts/ci/guard-ota-native.mjs');
const VERSION_BUMP_SCRIPT = path.join(REPO_ROOT, 'scripts/ci/check-native-version-bump.mjs');

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return res;
}

function initTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-git-test-'));
  run('git', ['init'], { cwd: tmp });
  run('git', ['config', 'user.email', 'test@test.com'], { cwd: tmp });
  run('git', ['config', 'user.name', 'Test'], { cwd: tmp });
  // Create initial structure
  fs.mkdirSync(path.join(tmp, 'apps/mobile'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'apps/mobile/app.json'), JSON.stringify({ expo: { version: '1.0.1', runtimeVersion: { policy: 'appVersion' } } }, null, 2));
  fs.writeFileSync(path.join(tmp, 'apps/mobile/package.json'), JSON.stringify({ name: '@ega/mobile', version: '1.0.1', dependencies: { expo: '~54.0.0' } }, null, 2));
  fs.mkdirSync(path.join(tmp, 'apps/mobile/features/work'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'apps/mobile/features/work/WorkScreen.tsx'), 'export const a = 1;');
  run('git', ['add', '.'], { cwd: tmp });
  run('git', ['commit', '-m', 'A baseline'], { cwd: tmp });
  const shaA = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();
  return { tmp, shaA };
}

test('real git-history: JS-only same version => ALLOW', () => {
  const { tmp, shaA } = initTempRepo();
  try {
    // B: JS-only change
    fs.writeFileSync(path.join(tmp, 'apps/mobile/features/work/WorkScreen.tsx'), 'export const a = 2; // js only');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'B js only'], { cwd: tmp });
    const shaB = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();
    // Guard should be OTA SAFE
    const guardRes = run('node', [GUARD_SCRIPT, '--base', shaA, '--head', shaB, '--check-ota-safe'], { cwd: tmp });
    assert.equal(guardRes.status, 0, `JS-only should be OTA SAFE, stderr: ${guardRes.stderr} stdout: ${guardRes.stdout}`);

    // Version bump check: JS-only same version should ALLOW
    // Create baseline manifest for A
    const baselineManifest = {
      repository: 'egawilldoit/Ega-House-Platform',
      gitSha: shaA,
      gitRef: 'refs/tags/mobile-v1.0.1',
      version: '1.0.1',
      runtimeVersion: '1.0.1',
      androidPackage: 'com.ega_house.mobile',
      apkFile: 'ega-house-1.0.1-abc-release.apk',
      apkSha256: 'deadbeef',
      channel: 'production',
      variant: 'release',
      apiBaseUrl: 'https://ega-api.egawilldoit.online',
      builtAt: new Date().toISOString(),
      runner: 'blacksmith',
      architectures: ['arm64-v8a', 'x86_64'],
    };
    const manifestPath = path.join(tmp, 'baseline-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(baselineManifest));
    const bumpRes = run('node', [VERSION_BUMP_SCRIPT, '--baseline-manifest', manifestPath, '--candidate-version', '1.0.1', '--base', shaA, '--head', shaB], { cwd: tmp });
    assert.equal(bumpRes.status, 0, `JS-only same version should ALLOW version bump check, stderr: ${bumpRes.stderr}`);

    // Also prove git diff base...head succeeds
    const diffRes = run('git', ['diff', '--name-only', `${shaA}...${shaB}`], { cwd: tmp });
    assert.equal(diffRes.status, 0);
    assert.match(diffRes.stdout, /WorkScreen/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('real git-history: native sensitive same version => BLOCK', () => {
  const { tmp, shaA } = initTempRepo();
  try {
    // C: native package/config change, same version
    fs.writeFileSync(path.join(tmp, 'apps/mobile/package.json'), JSON.stringify({ name: '@ega/mobile', version: '1.0.1', dependencies: { expo: '~54.0.0', 'expo-updates': '^29.0.20' } }, null, 2));
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'C native same version'], { cwd: tmp });
    const shaC = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();

    const guardRes = run('node', [GUARD_SCRIPT, '--base', shaA, '--head', shaC, '--check-ota-safe'], { cwd: tmp });
    assert.equal(guardRes.status, 1, 'native same version should be BLOCK');
    assert.match(guardRes.stdout + guardRes.stderr, /OTA BLOCKED/);

    const baselineManifest = {
      repository: 'egawilldoit/Ega-House-Platform',
      gitSha: shaA,
      gitRef: 'refs/tags/mobile-v1.0.1',
      version: '1.0.1',
      runtimeVersion: '1.0.1',
      androidPackage: 'com.ega_house.mobile',
      apkFile: 'ega-house-1.0.1-abc-release.apk',
      apkSha256: 'deadbeef',
      channel: 'production',
      variant: 'release',
      apiBaseUrl: 'https://ega-api.egawilldoit.online',
      builtAt: new Date().toISOString(),
      runner: 'blacksmith',
      architectures: ['arm64-v8a', 'x86_64'],
    };
    const manifestPath = path.join(tmp, 'baseline-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(baselineManifest));
    const bumpRes = run('node', [VERSION_BUMP_SCRIPT, '--baseline-manifest', manifestPath, '--candidate-version', '1.0.1', '--base', shaA, '--head', shaC], { cwd: tmp });
    assert.equal(bumpRes.status, 1, 'native same version should BLOCK version bump');
    assert.match(bumpRes.stdout + bumpRes.stderr, /NATIVE_VERSION_BUMP_REQUIRED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('real git-history: native + higher version => ALLOW', () => {
  const { tmp, shaA } = initTempRepo();
  try {
    // D: native change + higher version
    fs.writeFileSync(path.join(tmp, 'apps/mobile/app.json'), JSON.stringify({ expo: { version: '1.0.2', runtimeVersion: { policy: 'appVersion' } } }, null, 2));
    fs.writeFileSync(path.join(tmp, 'apps/mobile/package.json'), JSON.stringify({ name: '@ega/mobile', version: '1.0.2', dependencies: { expo: '~54.0.0', 'expo-updates': '^29.0.20' } }, null, 2));
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'D native higher version'], { cwd: tmp });
    const shaD = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();

    const guardRes = run('node', [GUARD_SCRIPT, '--base', shaA, '--head', shaD, '--check-ota-safe'], { cwd: tmp });
    // Guard itself will still be BLOCK because native diff exists, but version bump gate should allow because version higher
    // Guard alone should be BLOCK (since it only checks native diff, not version)
    assert.equal(guardRes.status, 1, 'guard alone should BLOCK native diff');

    const baselineManifest = {
      repository: 'egawilldoit/Ega-House-Platform',
      gitSha: shaA,
      gitRef: 'refs/tags/mobile-v1.0.1',
      version: '1.0.1',
      runtimeVersion: '1.0.1',
      androidPackage: 'com.ega_house.mobile',
      apkFile: 'ega-house-1.0.1-abc-release.apk',
      apkSha256: 'deadbeef',
      channel: 'production',
      variant: 'release',
      apiBaseUrl: 'https://ega-api.egawilldoit.online',
      builtAt: new Date().toISOString(),
      runner: 'blacksmith',
      architectures: ['arm64-v8a', 'x86_64'],
    };
    const manifestPath = path.join(tmp, 'baseline-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(baselineManifest));
    const bumpRes = run('node', [VERSION_BUMP_SCRIPT, '--baseline-manifest', manifestPath, '--candidate-version', '1.0.2', '--base', shaA, '--head', shaD], { cwd: tmp });
    assert.equal(bumpRes.status, 0, 'native higher version should ALLOW');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('real git-history: configured launcher icon change => BLOCK, runtime image => ALLOW', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-brand-test-'));
  try {
    run('git', ['init'], { cwd: tmp });
    run('git', ['config', 'user.email', 'test@test.com'], { cwd: tmp });
    run('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    fs.mkdirSync(path.join(tmp, 'apps/mobile/assets/images'), { recursive: true });
    // Expo config references icon + splash as build-time branding; a plain
    // content image is only a runtime asset.
    fs.writeFileSync(
      path.join(tmp, 'apps/mobile/app.json'),
      JSON.stringify(
        {
          expo: {
            version: '1.0.4',
            icon: './assets/images/icon.png',
            splash: { image: './assets/images/splash-icon.png' },
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/icon.png'), 'icon-a');
    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/hero.png'), 'hero-a');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'A branding baseline'], { cwd: tmp });
    const shaA = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();

    // B: launcher icon bytes change (mirrors dbb35288 new icons)
    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/icon.png'), 'icon-b');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'B new icons'], { cwd: tmp });
    const shaB = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();
    const iconRes = run('node', [GUARD_SCRIPT, '--base', shaA, '--head', shaB, '--check-ota-safe'], {
      cwd: tmp,
    });
    assert.equal(iconRes.status, 1, 'configured icon change must BLOCK');
    assert.match(iconRes.stdout + iconRes.stderr, /OTA BLOCKED/);
    assert.match(iconRes.stdout + iconRes.stderr, /icon\.png/);

    // C: runtime content image change only
    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/hero.png'), 'hero-b');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'C hero art'], { cwd: tmp });
    const shaC = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();
    const heroRes = run(
      'node',
      [GUARD_SCRIPT, '--base', shaB, '--head', shaC, '--check-ota-safe'],
      { cwd: tmp }
    );
    assert.equal(
      heroRes.status,
      0,
      `runtime image should stay OTA SAFE, stderr: ${heroRes.stderr} stdout: ${heroRes.stdout}`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('real git-history: worktree config skew cannot hide a head-revision branding change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-skew-test-'));
  try {
    run('git', ['init'], { cwd: tmp });
    run('git', ['config', 'user.email', 'test@test.com'], { cwd: tmp });
    run('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    fs.mkdirSync(path.join(tmp, 'apps/mobile/assets/images'), { recursive: true });
    const appJsonFor = (icon) =>
      JSON.stringify({ expo: { version: '1.0.4', icon } }, null, 2);
    fs.writeFileSync(path.join(tmp, 'apps/mobile/app.json'), appJsonFor('./assets/images/icon.png'));
    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/icon.png'), 'icon-a');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'A branding baseline'], { cwd: tmp });
    const shaA = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();

    fs.writeFileSync(path.join(tmp, 'apps/mobile/assets/images/icon.png'), 'icon-b');
    run('git', ['add', '.'], { cwd: tmp });
    run('git', ['commit', '-m', 'B new icon'], { cwd: tmp });
    const shaB = run('git', ['rev-parse', 'HEAD'], { cwd: tmp }).stdout.trim();

    // Dirty the working tree so its config disagrees with the compared head.
    fs.writeFileSync(
      path.join(tmp, 'apps/mobile/app.json'),
      appJsonFor('./assets/images/totally-different.png')
    );

    const guardRes = run('node', [GUARD_SCRIPT, '--base', shaA, '--head', shaB, '--check-ota-safe'], {
      cwd: tmp,
    });
    assert.equal(guardRes.status, 1, 'head-revision branding change must BLOCK despite worktree skew');
    assert.match(guardRes.stdout + guardRes.stderr, /OTA BLOCKED/);
    assert.match(guardRes.stdout + guardRes.stderr, /icon\.png/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('real git-history: missing baseline SHA => BLOCK', () => {  const { tmp, shaA } = initTempRepo();
  try {
    const fakeSha = 'f'.repeat(40);
    const guardRes = run('node', [GUARD_SCRIPT, '--base', fakeSha, '--head', shaA, '--check-ota-safe'], { cwd: tmp });
    // git diff with missing sha should fail and guard should fail closed (BLOCK)
    assert.equal(guardRes.status, 1, 'missing baseline SHA should BLOCK');
    assert.match(guardRes.stdout + guardRes.stderr, /OTA BLOCKED|git diff failed/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
