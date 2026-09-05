#!/usr/bin/env node
/**
 * guard-ota-native.mjs — Hard native/OTA guard for production OTA safety.
 *
 * Production OTA MUST fail closed. Native-sensitive changes between
 * LAST_NATIVE_APK_SHA (manifest.gitSha) and OTA_SHA require a new APK.
 *
 * Usage:
 *   node scripts/ci/guard-ota-native.mjs --base <LAST_NATIVE_APK_SHA> --head <OTA_SHA> --check-ota-safe
 *   node scripts/ci/guard-ota-native.mjs --base origin/main --head HEAD --json
 *
 * Native-sensitive includes (conservative):
 * - Expo SDK / React Native version changes
 * - mobile native dependencies (expo-updates, expo native modules, RN modules)
 * - app.json native configuration (runtimeVersion, version, permissions, plugins, identifiers)
 * - eas.json channel/runtime
 * - native Android/iOS files, Gradle config
 * - build-time branding assets referenced by Expo config (launcher icon,
 *   native splash image, adaptive icon): the installed binary bakes these in,
 *   so a JS OTA cannot deliver them. Normal runtime images stay OTA-safe.
 *
 * Does NOT automatically classify entire root package-lock.json as native.
 */

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NATIVE_SENSITIVE_PATTERNS = [
  /^apps\/mobile\/app\.json$/,
  /^apps\/mobile\/app\.config\.(js|ts)$/,
  /^apps\/mobile\/eas\.json$/,
  /^apps\/mobile\/package\.json$/,
  /^apps\/mobile\/android\/.*$/,
  /^apps\/mobile\/ios\/.*$/,
  /^apps\/mobile\/.*\.gradle$/,
  /^apps\/mobile\/.*AndroidManifest\.xml$/,
  /^apps\/mobile\/.*\.pbxproj$/,
  /^apps\/mobile\/.*\.plist$/,
];

const NATIVE_DEP_KEYS = [
  'expo',
  'expo-updates',
  'expo-constants',
  'expo-router',
  'expo-splash-screen',
  'expo-status-bar',
  'expo-secure-store',
  'expo-blur',
  'expo-linking',
  'expo-font',
  'expo-linear-gradient',
  '@expo/vector-icons',
  'react-native',
  'react-native-reanimated',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
  '@react-native-community/datetimepicker',
  'expo-system-ui',
  'expo-navigation-bar',
  'expo-modules-core',
];

function getChangedFiles(base, head) {
  const args = ['diff', '--name-only', `${base}...${head}`];
  const cwd = process.cwd();
  const res = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) {
    return { files: [], error: res.stderr || `git diff failed for ${base}...${head}` };
  }
  const files = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { files, error: null };
}

function getDiffText(base, head, paths) {
  const args = ['diff', `${base}...${head}`, '--', ...paths];
  const res = cp.spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8' });
  if (res.status !== 0) return '';
  return res.stdout;
}

function isNativeSensitiveFile(file) {
  return NATIVE_SENSITIVE_PATTERNS.some((re) => re.test(file));
}

// Expo config paths holding build-time branding assets. The installed native
// binary bakes these in at build time (launcher icon, native splash,
// adaptive icon), so changes to the referenced files require a new APK.
// Extend this list if future Expo config fields reference more build-time
// assets. Normal runtime images are NOT listed here and stay OTA-safe.
const NATIVE_BRANDING_CONFIG_PATHS = [
  ['expo', 'icon'],
  ['expo', 'splash', 'image'],
  ['expo', 'android', 'adaptiveIcon', 'foregroundImage'],
];

// Fallback when app.json cannot be read (fail closed for the known files).
const FALLBACK_NATIVE_BRANDING_ASSETS = new Set([
  'apps/mobile/assets/images/icon.png',
  'apps/mobile/assets/images/splash-icon.png',
  'apps/mobile/assets/images/adaptive-icon.png',
]);

function readPathSegments(obj, segments) {
  let current = obj;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[segment];
  }
  return current;
}

// Derive repo-relative branding asset paths from Expo config text.
// baseDir is the mobile app directory relative to repo root.
export function resolveNativeBrandingAssets(appJsonText, baseDir = 'apps/mobile') {
  const found = new Set();
  let config;
  try {
    config = JSON.parse(appJsonText);
  } catch {
    return found;
  }
  for (const segments of NATIVE_BRANDING_CONFIG_PATHS) {
    const value = readPathSegments(config, segments);
    if (typeof value !== 'string' || !value.trim()) continue;
    const normalized = value.startsWith('./') ? value.slice(2) : value;
    if (normalized.startsWith('/') || normalized.includes('..')) continue;
    found.add(path.posix.join(baseDir, normalized));
  }
  return found;
}

function loadNativeBrandingAssets(cwd = process.cwd()) {
  try {
    const text = fs.readFileSync(path.join(cwd, 'apps/mobile/app.json'), 'utf8');
    const derived = resolveNativeBrandingAssets(text);
    if (derived.size > 0) return derived;
  } catch {
    // fall through to fail-closed fallback below
  }
  return new Set(FALLBACK_NATIVE_BRANDING_ASSETS);
}

function isNativeBrandingAsset(file, brandingAssets) {
  return brandingAssets.has(file);
}

function checkNativeDiff(base, head) {
  const diffMobilePkg = getDiffText(base, head, ['apps/mobile/package.json']);
  const diffAppJson = getDiffText(base, head, ['apps/mobile/app.json']);
  const diffEas = getDiffText(base, head, ['apps/mobile/eas.json']);
  return checkNativeDiffFromTexts(diffMobilePkg, diffAppJson, diffEas);
}

export function checkNativeDiffFromTexts(diffMobilePkg, diffAppJson, _diffEas) {
  void _diffEas;
  const hits = [];
  for (const dep of NATIVE_DEP_KEYS) {
    if (diffMobilePkg.includes(`"${dep}"`)) hits.push(`dependency:${dep}`);
  }
  if (diffAppJson.includes('"runtimeVersion"') || diffAppJson.includes('runtimeVersion')) hits.push('config:runtimeVersion');
  if (diffAppJson.includes('"version"')) hits.push('config:version');
  if (diffAppJson.includes('"permissions"') || diffAppJson.includes('permissions')) hits.push('config:permissions');
  if (diffAppJson.includes('"plugins"') || diffAppJson.includes('plugins')) hits.push('config:plugins');
  if (diffAppJson.includes('"package"') || diffAppJson.includes('com.ega_house')) hits.push('config:android.package');
  if (diffAppJson.includes('"updates"') && diffAppJson.includes('requestHeaders')) hits.push('config:updates.requestHeaders');
  return hits;
}

export function classifyFromFiles(
  files,
  diffMobilePkg = '',
  diffAppJson = '',
  diffEas = '',
  brandingAssets = loadNativeBrandingAssets()
) {
  const sensitiveFiles = files.filter(
    (file) => isNativeSensitiveFile(file) || isNativeBrandingAsset(file, brandingAssets)
  );
  const depHits = checkNativeDiffFromTexts(diffMobilePkg, diffAppJson, diffEas);
  const requiresNative = sensitiveFiles.length > 0 || depHits.length > 0;
  return {
    files,
    sensitiveFiles,
    depHits,
    requiresNative,
    reason: requiresNative
      ? `Native-sensitive changes detected: ${[...sensitiveFiles, ...depHits].join(', ')}`
      : 'No native-sensitive changes detected; OTA is safe for JS/assets',
  };
}

export function classifyChanges({ base = 'origin/main', head = 'HEAD' } = {}) {
  const { files, error } = getChangedFiles(base, head);
  if (error) {
    return {
      base,
      head,
      files: [],
      sensitiveFiles: [],
      depHits: [],
      requiresNative: true,
      error,
      reason: `git diff failed: ${error} — fail closed, OTA BLOCKED`,
    };
  }
  const sensitiveFiles = files.filter(
    (file) =>
      isNativeSensitiveFile(file) ||
      isNativeBrandingAsset(file, loadNativeBrandingAssets(process.cwd()))
  );
  const depHits = checkNativeDiff(base, head);
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
  if (result.sensitiveFiles.length) lines.push(`Sensitive files: ${result.sensitiveFiles.join(', ')}`);
  if (result.depHits.length) lines.push(`Native dep/config hits: ${result.depHits.join(', ')}`);
  if (result.error) lines.push(`Error: ${result.error}`);
  lines.push(result.requiresNative ? `⚠️  ${result.reason}` : `✅ ${result.reason}`);
  if (result.requiresNative) {
    lines.push('');
    lines.push('OTA BLOCKED');
    lines.push('NEW APK REQUIRED');
    lines.push('');
    lines.push('This change touches the native runtime (SDK, native deps, permissions, plugins, runtimeVersion, android package, or build-time branding assets).');
    lines.push('OTA cannot deliver native changes. Build a new APK via Mobile Delivery (mobile-v* tag or workflow_dispatch) before publishing OTA.');
    lines.push('See docs/mobile-ota.md for rollback: eas update:rollback --branch production');
  } else {
    lines.push('OTA SAFE');
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
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--head' && args[i + 1]) head = args[++i];
    else if (args[i] === '--json') json = true;
    else if (args[i] === '--check-ota-safe') checkOtaSafe = true;
  }
  if (process.env.GUARD_BASE) base = process.env.GUARD_BASE;
  if (process.env.GUARD_HEAD) head = process.env.GUARD_HEAD;

  const result = classifyChanges({ base, head });
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatHuman(result));

  if (checkOtaSafe && result.requiresNative) {
    console.error('\nERROR: OTA BLOCKED');
    console.error('NEW APK REQUIRED');
    console.error('Native-sensitive changes between last APK and OTA SHA require a new native build.');
    process.exit(1);
  }
  if (result.error) process.exit(1);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guard-ota-native.mjs')) {
  main();
}
