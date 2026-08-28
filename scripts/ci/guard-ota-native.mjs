#!/usr/bin/env node
/**
 * guard-ota-native.mjs — Native-change guard for OTA vs APK decisions.
 *
 * Purpose: ensure changes to native-runtime inputs cannot silently be treated as OTA-only.
 * Such changes require a new compatible APK/runtime (new fingerprint / version bump).
 *
 * Native-sensitive inputs (heuristic, conservative):
 * - Expo SDK version (`expo` in apps/mobile/package.json)
 * - native deps: expo-updates, expo-constants, reanimated, screens, safe-area, svg, etc.
 * - app.json: runtimeVersion, android package, permissions, plugins, updates.url, version
 * - eas.json channel/runtime policy
 * - android/ native project (if ever checked in) — but android/ is gitignored; we still check manifest if present
 * - babel.config.js / metro config affecting bundle? (js-only, still OTA-compatible, so excluded)
 *
 * Usage:
 *   node scripts/ci/guard-ota-native.mjs --base origin/main --head HEAD
 *   node scripts/ci/guard-ota-native.mjs --json
 *   node scripts/ci/guard-ota-native.mjs --check-ota-safe   (exit 1 if native change detected and OTA would be unsafe)
 *
 * In CI (OTA workflow) we run with default base=HEAD~1 or origin/main and only warn; the
 * production publish still requires human explicit dispatch. The guard's failure mode is documented
 * and also enforced via `npm run test:guardrails` if configured to fail on risky inputs.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', '..');

const NATIVE_SENSITIVE_PATTERNS = [
  /^apps\/mobile\/app\.json$/,
  /^apps\/mobile\/app\.config\.(js|ts)$/,
  /^apps\/mobile\/eas\.json$/,
  /^apps\/mobile\/package\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^apps\/mobile\/android\/.*$/,
  /^apps\/mobile\/ios\/.*$/,
  /^apps\/mobile\/.*\.gradle$/,
  /^apps\/mobile\/.*AndroidManifest\.xml$/,
];

const NATIVE_DEP_KEYS = [
  'expo',
  'expo-updates',
  'expo-constants',
  'expo-router',
  'expo-splash-screen',
  'expo-status-bar',
  'expo-secure-store',
  'react-native',
  'react-native-reanimated',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
  '@react-native-community/datetimepicker',
  '@expo/vector-icons',
  'expo-blur',
  'expo-linking',
  'expo-font',
  'expo-linear-gradient',
];

function getChangedFiles(base, head) {
  const args = ['diff', '--name-only', `${base}...${head}`];
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.status !== 0) return [];
  return res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function isNativeSensitiveFile(file) {
  return NATIVE_SENSITIVE_PATTERNS.some((re) => re.test(file));
}

function checkPackageJsonDiff(base, head) {
  const res = spawnSync('git', ['diff', `${base}...${head}`, '--', 'apps/mobile/package.json', 'package.json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) return [];
  const diff = res.stdout;
  const hits = [];
  for (const dep of NATIVE_DEP_KEYS) {
    if (diff.includes(`"${dep}"`) || diff.includes(`'${dep}'`)) {
      hits.push(`dependency:${dep}`);
    }
  }
  if (diff.includes('"plugins"') && diff.includes('apps/mobile/app.json')) hits.push('config:plugins');
  if (diff.includes('runtimeVersion')) hits.push('config:runtimeVersion');
  if (diff.includes('android') && diff.includes('package')) hits.push('config:android.package');
  return hits;
}

export function classifyChanges({ base = 'origin/main', head = 'HEAD' } = {}) {
  const files = getChangedFiles(base, head);
  const sensitiveFiles = files.filter(isNativeSensitiveFile);
  const depHits = checkPackageJsonDiff(base, head);
  const requiresNative = sensitiveFiles.length > 0 || depHits.length > 0;
  return {
    base,
    head,
    files,
    sensitiveFiles,
    depHits,
    requiresNative,
    reason: requiresNative
      ? `Native-sensitive changes detected: ${[...sensitiveFiles, ...depHits].join(', ')}`
      : 'No native-sensitive changes detected; OTA is safe for JS/assets',
  };
}

export function formatHuman(result) {
  const lines = [];
  lines.push(`Guard OTA native check: base=${result.base} head=${result.head}`);
  lines.push(`Changed files: ${result.files.length}`);
  if (result.sensitiveFiles.length) {
    lines.push(`Sensitive files: ${result.sensitiveFiles.join(', ')}`);
  }
  if (result.depHits.length) {
    lines.push(`Native dep/config hits: ${result.depHits.join(', ')}`);
  }
  lines.push(result.requiresNative ? `⚠️  ${result.reason}` : `✅ ${result.reason}`);
  if (result.requiresNative) {
    lines.push('');
    lines.push('This change touches the native runtime (SDK, native deps, permissions, plugins, runtimeVersion, android package).');
    lines.push('OTA cannot deliver native changes. Build a new APK via Mobile Delivery (mobile-v* tag or workflow_dispatch) before publishing OTA.');
    lines.push('See docs/mobile-ota.md and docs/ci/mobile-delivery.md for rollback: `eas update:rollback --branch <channel>` or `eas update:republish`');
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  let base = 'origin/main';
  let head = 'HEAD';
  let json = false;
  let checkOtaSafe = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base' && args[i + 1]) { base = args[++i]; }
    else if (args[i] === '--head' && args[i + 1]) { head = args[++i]; }
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--check-ota-safe') checkOtaSafe = true;
  }
  // Allow env overrides for CI
  if (process.env.GUARD_BASE) base = process.env.GUARD_BASE;
  if (process.env.GUARD_HEAD) head = process.env.GUARD_HEAD;

  const result = classifyChanges({ base, head });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatHuman(result));
  }
  if (checkOtaSafe && result.requiresNative) {
    console.error('\nERROR: OTA not safe — native runtime changes require new APK');
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guard-ota-native.mjs')) {
  main();
}
