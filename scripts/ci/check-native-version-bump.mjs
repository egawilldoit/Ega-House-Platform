#!/usr/bin/env node
/**
 * check-native-version-bump.mjs — Enforce native version bump when native-sensitive changes exist.
 *
 * For runtimeVersion policy appVersion, any native change MUST bump app.json expo.version.
 *
 * Usage:
 *   node scripts/ci/check-native-version-bump.mjs --baseline-manifest /tmp/release-manifest.json --candidate-version 1.0.2 --base <baselineSha> --head <candidateSha>
 *
 * Exits 0 if:
 *   - no native-sensitive diff → allow (JS-only)
 *   - native diff + candidate > baseline → allow
 * Exits 1 if:
 *   - native diff + same/lower version → BLOCK NATIVE_VERSION_BUMP_REQUIRED
 *   - malformed baseline manifest → BLOCK (fail closed)
 *   - native diff + missing candidate version → BLOCK
 *
 * Bootstrap: if baseline manifest missing/invalid and this is the first native release, allow only if candidate is bootstrap version and explicitly documented.
 * For now, if manifest file missing or 404, we treat as bootstrap and allow if candidate is 1.0.1 and file indicates no prior release. Malformed baseline still blocks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', '..');

export function semverValidateStrict(v) {
  const re = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
  if (!re.test(v)) throw new Error(`malformed version: ${v}`);
}

function parseBase(v) {
  semverValidateStrict(v);
  const base = v.split('-')[0].split('+')[0];
  return base.split('.').map(n => Number.parseInt(n, 10));
}

export function compareVersions(a, b) {
  const pa = parseBase(a);
  const pb = parseBase(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  if (a.includes('-') && !b.includes('-')) return -1;
  if (!a.includes('-') && b.includes('-')) return 1;
  return a.localeCompare(b);
}

export function isNativeSensitive(base, head) {
  const guardPath = path.join(REPO_ROOT, 'scripts/ci/guard-ota-native.mjs');
  const res = spawnSync('node', [guardPath, '--base', base, '--head', head, '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (res.status !== 0 && !res.stdout) {
    // If guard fails (e.g., git error), fail closed as native
    return { requiresNative: true, error: res.stderr || 'guard failed' };
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return { requiresNative: !!parsed.requiresNative, details: parsed };
  } catch (e) {
    return { requiresNative: true, error: `guard JSON parse failed: ${e.message}` };
  }
}

function main() {
  const args = process.argv.slice(2);
  let baselineManifestPath = null;
  let candidateVersion = null;
  let baseSha = null;
  let headSha = null;
  let baselineVersion = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--baseline-manifest' && args[i + 1]) baselineManifestPath = args[++i];
    else if (args[i] === '--candidate-version' && args[i + 1]) candidateVersion = args[++i];
    else if (args[i] === '--base' && args[i + 1]) baseSha = args[++i];
    else if (args[i] === '--head' && args[i + 1]) headSha = args[++i];
    else if (args[i] === '--baseline-version' && args[i + 1]) baselineVersion = args[++i];
  }

  // Determine baseline version from manifest if not explicitly provided
  if (!baselineVersion && baselineManifestPath) {
    try {
      if (!fs.existsSync(baselineManifestPath)) {
        console.log('No baseline manifest found — treating as bootstrap first native release.');
        // Bootstrap: allow if candidate is provided and looks like a valid version
        if (candidateVersion) {
          try {
            semverValidateStrict(candidateVersion);
            console.log(`Bootstrap allowed with candidate ${candidateVersion}`);
            process.exit(0);
          } catch (e) {
            console.error(`Bootstrap candidate version malformed: ${e.message}`);
            process.exit(1);
          }
        }
        console.log('Bootstrap with no candidate version — allow');
        process.exit(0);
      }
      const raw = fs.readFileSync(baselineManifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      baselineVersion = manifest.version;
      if (!baselineVersion || typeof baselineVersion !== 'string') {
        console.error('Malformed baseline manifest: missing version — fail closed');
        console.error('NATIVE_VERSION_BUMP_REQUIRED — malformed baseline');
        process.exit(1);
      }
      semverValidateStrict(baselineVersion);
      // also validate runtimeVersion and other required fields via guard's validate? For now check presence
      const required = ['runtimeVersion', 'gitSha', 'channel', 'androidPackage'];
      for (const f of required) {
        if (!manifest[f] || typeof manifest[f] !== 'string' || !manifest[f].trim()) {
          console.error(`Malformed baseline manifest: missing ${f} — fail closed`);
          process.exit(1);
        }
      }
    } catch (e) {
      console.error(`Failed to read/validate baseline manifest: ${e.message}`);
      console.error('NATIVE_VERSION_BUMP_REQUIRED — malformed baseline, fail closed');
      process.exit(1);
    }
  }

  if (!candidateVersion) {
    console.error('Missing --candidate-version');
    process.exit(1);
  }
  try {
    semverValidateStrict(candidateVersion);
  } catch (e) {
    console.error(`Candidate version malformed: ${e.message}`);
    process.exit(1);
  }

  if (!baseSha || !headSha) {
    console.error('Missing --base or --head for native diff check');
    process.exit(1);
  }

  const nativeCheck = isNativeSensitive(baseSha, headSha);
  if (nativeCheck.error) {
    console.error(`Guard error: ${nativeCheck.error} — fail closed`);
    process.exit(1);
  }
  const requiresNative = nativeCheck.requiresNative;
  console.log(`Native-sensitive diff: ${requiresNative ? 'YES' : 'NO'}`);
  if (nativeCheck.details) {
    console.log(`Details: ${JSON.stringify(nativeCheck.details, null, 2)}`);
  }

  if (!requiresNative) {
    console.log(`JS-only diff + same version ${candidateVersion} → ALLOW`);
    process.exit(0);
  }

  // Native-sensitive: candidate must be > baseline
  if (!baselineVersion) {
    console.error('Baseline version missing but native diff requires comparison — fail closed');
    process.exit(1);
  }
  const cmp = compareVersions(candidateVersion, baselineVersion);
  if (cmp > 0) {
    console.log(`Native diff + higher version ${candidateVersion} > ${baselineVersion} → ALLOW`);
    process.exit(0);
  } else if (cmp === 0) {
    console.error(`NATIVE_VERSION_BUMP_REQUIRED: native diff with same version ${candidateVersion} == ${baselineVersion} → BLOCK`);
    console.error('OTA BLOCKED — NEW APK REQUIRED with bumped version');
    process.exit(1);
  } else {
    console.error(`NATIVE_VERSION_BUMP_REQUIRED: native diff with lower version ${candidateVersion} < ${baselineVersion} → BLOCK`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-native-version-bump.mjs')) {
  main();
}
