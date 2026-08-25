#!/usr/bin/env node
/**
 * mobile-production-env-guardrail.test.mjs — Expo static inlining guardrail.
 *
 * Expo inlines EXPO_PUBLIC_* variables only when the bundled source contains a
 * statically analyzable direct property access:
 *   process.env.EXPO_PUBLIC_API_BASE_URL
 *
 * The 2026-08 release-phone bug: `resolveCurrentApiBaseUrl()` handed the whole
 * `process.env` object to `resolveApiBaseUrl(...)`, so no call site referenced
 * the property directly and the release bundle shipped with the variable
 * undefined — producing "[mobile-api] EXPO_PUBLIC_API_BASE_URL is not set" at
 * runtime even though CI exported it during prebuild/Gradle.
 *
 * This guard pins the invariant at the source level (runtime unit tests alone
 * cannot see bundler behavior):
 *   1. client.ts must contain the literal `process.env.EXPO_PUBLIC_API_BASE_URL`
 *   2. client.ts must NOT hand whole `process.env` into resolveApiBaseUrl
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLIENT_SOURCE = path.join(repoRoot, 'apps', 'mobile', 'lib', 'api', 'client.ts');

function readClientSource() {
  return fs.readFileSync(CLIENT_SOURCE, 'utf8');
}

test('client.ts contains direct Expo-compatible process.env.EXPO_PUBLIC_API_BASE_URL reference', () => {
  const source = readClientSource();
  assert.match(
    source,
    /process\.env\.EXPO_PUBLIC_API_BASE_URL/,
    'apps/mobile/lib/api/client.ts must statically reference process.env.EXPO_PUBLIC_API_BASE_URL so Expo can inline the value at build time',
  );
});

test('client.ts does not pass whole process.env into resolveApiBaseUrl', () => {
  const source = readClientSource();
  assert.doesNotMatch(
    source,
    /resolveApiBaseUrl\(\s*process\.env\s*[,)]/,
    'resolveCurrentApiBaseUrl must not hand process.env wholesale to resolveApiBaseUrl; Expo requires a direct static property reference',
  );
});
