import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compareVersions, semverValidateStrict } from './check-native-version-bump.mjs';
import { classifyFromFiles } from './guard-ota-native.mjs';

function makeTempManifest(version, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  const file = path.join(dir, 'manifest.json');
  const manifest = {
    repository: 'egawilldoit/Ega-House-Platform',
    gitSha: 'a'.repeat(40),
    gitRef: 'refs/tags/mobile-v1.0.1',
    version,
    runtimeVersion: version,
    variant: 'release',
    androidPackage: 'com.ega_house.mobile',
    apiBaseUrl: 'https://ega-api.egawilldoit.online',
    builtAt: new Date().toISOString(),
    runner: 'blacksmith',
    architectures: ['arm64-v8a', 'x86_64'],
    apkFile: `ega-house-${version}-abc-release.apk`,
    apkSha256: 'deadbeef',
    channel: 'production',
    ...overrides,
  };
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { file, dir, manifest };
}

test('compareVersions strict', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('bad', '1.0.0'), /malformed/);
});

test('JS-only diff + same version => ALLOW', () => {
  const res = classifyFromFiles(['apps/mobile/features/work/WorkScreen.tsx'], '', '', '');
  assert.equal(res.requiresNative, false);
  // Simulate version bump check: native false => allow regardless of version equality
  const baseline = '1.0.1';
  const candidate = '1.0.1';
  const requiresNative = res.requiresNative;
  const cmp = compareVersions(candidate, baseline);
  const shouldAllow = !requiresNative || cmp > 0;
  assert.equal(shouldAllow, true);
});

test('native diff + same version => BLOCK', () => {
  const res = classifyFromFiles(['apps/mobile/app.json'], '', '+  "version": "1.0.1"', '');
  assert.equal(res.requiresNative, true);
  const baseline = '1.0.1';
  const candidate = '1.0.1';
  const cmp = compareVersions(candidate, baseline);
  assert.equal(cmp, 0);
  const shouldAllow = !res.requiresNative || cmp > 0;
  assert.equal(shouldAllow, false);
});

test('native diff + lower version => BLOCK', () => {
  const res = classifyFromFiles(['apps/mobile/package.json'], '+    "expo": "~55.0.0"', '', '');
  assert.equal(res.requiresNative, true);
  const baseline = '1.0.1';
  const candidate = '1.0.0';
  const cmp = compareVersions(candidate, baseline);
  assert.equal(cmp < 0, true);
  const shouldAllow = !res.requiresNative || cmp > 0;
  assert.equal(shouldAllow, false);
});

test('native diff + higher version => ALLOW', () => {
  const res = classifyFromFiles(['apps/mobile/app.json'], '', '+  "permissions": ["CAMERA"]', '');
  assert.equal(res.requiresNative, true);
  const baseline = '1.0.1';
  const candidate = '1.0.2';
  const cmp = compareVersions(candidate, baseline);
  assert.equal(cmp > 0, true);
  const shouldAllow = !res.requiresNative || cmp > 0;
  assert.equal(shouldAllow, true);
});

test('malformed baseline manifest => BLOCK (fail closed)', () => {
  const { file } = makeTempManifest('bad-version', { version: 'bad' });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.throws(() => semverValidateStrict(raw.version), /malformed/);
  // The check-native-version-bump script would exit 1 for malformed baseline
  fs.rmSync(path.dirname(file), { recursive: true });
});

test('guard helpers: package-lock-only not native', () => {
  const res = classifyFromFiles(['package-lock.json'], '', '', '');
  assert.equal(res.requiresNative, false);
});
