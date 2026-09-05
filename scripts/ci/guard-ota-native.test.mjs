import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFromFiles, resolveNativeBrandingAssets } from './guard-ota-native.mjs';

test('guard: JS screen-only change => OTA SAFE', () => {
  const res = classifyFromFiles(['apps/mobile/features/work/WorkScreen.tsx'], '', '', '');
  assert.equal(res.requiresNative, false);
  assert.match(res.reason, /No native/);
});

test('guard: native dependency added => BLOCK', () => {
  const res = classifyFromFiles(
    ['apps/mobile/package.json'],
    '+    "expo-updates": "^29.0.20",\n',
    '',
    ''
  );
  assert.equal(res.requiresNative, true);
  assert.match(res.reason, /dependency:expo-updates/);
});

test('guard: Expo SDK change => BLOCK', () => {
  const res = classifyFromFiles(
    ['apps/mobile/package.json'],
    '+    "expo": "~55.0.0",\n',
    '',
    ''
  );
  assert.equal(res.requiresNative, true);
  assert.match(res.reason, /dependency:expo/);
});

test('guard: app.json native config change => BLOCK', () => {
  const res = classifyFromFiles(
    ['apps/mobile/app.json'],
    '',
    '+  "runtimeVersion": { "policy": "appVersion" }\n',
    ''
  );
  assert.equal(res.requiresNative, true);
});

test('guard: permission/plugin change (app.json) => BLOCK', () => {
  const res1 = classifyFromFiles(['apps/mobile/app.json'], '', '+  "permissions": ["CAMERA"]\n', '');
  assert.equal(res1.requiresNative, true);
  const res2 = classifyFromFiles(['apps/mobile/app.json'], '', '+  "plugins": ["expo-camera"]\n', '');
  assert.equal(res2.requiresNative, true);
});

test('guard: version bump => BLOCK', () => {
  const res = classifyFromFiles(
    ['apps/mobile/app.json'],
    '',
    '+    "version": "1.0.2",\n',
    ''
  );
  assert.equal(res.requiresNative, true);
});

test('guard: android package change => BLOCK', () => {
  const res = classifyFromFiles(
    ['apps/mobile/app.json'],
    '',
    '+    "package": "com.ega_house.mobile"\n',
    ''
  );
  assert.equal(res.requiresNative, true);
});

test('guard: unrelated package-lock-only churn => not automatically native', () => {
  const res = classifyFromFiles(['package-lock.json'], '', '', '');
  assert.equal(res.requiresNative, false, 'package-lock alone should not be native');
});

test('guard: package-lock with mobile dep change via diff => BLOCK, but lock alone not', () => {
  const res = classifyFromFiles(['package-lock.json'], '+    "expo-updates": "^29.0.20",\n', '', '');
  // diffMobilePkg is what matters, not files list; if file list doesn't contain mobile package.json, but diff does, we still count
  // Our classifyFromFiles takes diffMobilePkg separately, so this tests that diffMobilePkg drives dep hit even if files list is lock
  assert.equal(res.requiresNative, true);
});

test('guard: eas.json change => BLOCK', () => {
  const res = classifyFromFiles(['apps/mobile/eas.json'], '', '', '{"cli": {"version": ">= 5.9.1"}}');
  assert.equal(res.requiresNative, true);
});

test('guard: native gradle file => BLOCK', () => {
  const res = classifyFromFiles(['apps/mobile/android/app/build.gradle'], '', '', '');
  assert.equal(res.requiresNative, true);
});

const BRANDING = new Set([
  'apps/mobile/assets/images/icon.png',
  'apps/mobile/assets/images/splash-icon.png',
  'apps/mobile/assets/images/adaptive-icon.png',
]);

test('guard: launcher icon change => BLOCK (native branding)', () => {
  const res = classifyFromFiles(['apps/mobile/assets/images/icon.png'], '', '', '', BRANDING);
  assert.equal(res.requiresNative, true);
  assert.match(res.reason, /icon\.png/);
});

test('guard: native splash image change => BLOCK (native branding)', () => {
  const res = classifyFromFiles(['apps/mobile/assets/images/splash-icon.png'], '', '', '', BRANDING);
  assert.equal(res.requiresNative, true);
});

test('guard: adaptive icon change => BLOCK (native branding)', () => {
  const res = classifyFromFiles(['apps/mobile/assets/images/adaptive-icon.png'], '', '', '', BRANDING);
  assert.equal(res.requiresNative, true);
});

test('guard: normal runtime image => OTA SAFE', () => {
  const res = classifyFromFiles(
    ['apps/mobile/assets/images/some-content-image.png'],
    '',
    '',
    '',
    BRANDING
  );
  assert.equal(res.requiresNative, false);
});

test('guard: Wave-17 JS-only delta => OTA SAFE', () => {
  const res = classifyFromFiles(
    [
      'apps/mobile/features/tasks/detail/TaskDetailScreen.tsx',
      'apps/mobile/features/tasks/detail/__tests__/task-detail-add-to-today.test.tsx',
      'apps/mobile/lib/auth/auth-context.tsx',
      'apps/mobile/lib/lifecycle/resume-refresh.ts',
      'apps/mobile/lib/lifecycle/__tests__/resume-refresh.test.ts',
    ],
    '',
    '',
    '',
    BRANDING
  );
  assert.equal(res.requiresNative, false);
});

test('guard: branding derived from Expo config (no hardcoded drift)', () => {
  const derived = resolveNativeBrandingAssets(
    JSON.stringify({
      expo: {
        icon: './assets/images/icon.png',
        splash: { image: './assets/images/splash-icon.png' },
        android: { adaptiveIcon: { foregroundImage: './assets/images/adaptive-icon.png' } },
      },
    })
  );
  assert.deepEqual(derived, BRANDING);
});
