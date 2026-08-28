#!/usr/bin/env node
/**
 * mobile-release-selector.mjs — Deterministic stable mobile release selector
 *
 * Production native baseline MUST be:
 *   draft == false
 *   AND prerelease == false
 *   AND tag_name matches ^mobile-v([0-9]+\.[0-9]+\.[0-9]+)$
 *   AND release contains asset release-manifest.json
 * Then select HIGHEST valid semantic version (strict semver).
 *
 * Validation of selected release's manifest:
 *   repository == egawilldoit/Ega-House-Platform
 *   androidPackage == com.ega_house.mobile
 *   channel == production
 *   version == strict semver, == tag version
 *   runtimeVersion == strict semver, == version
 *   gitSha == 40-char hex
 *   gitRef == refs/tags/mobile-v<version>
 *   apkFile != empty, apkSha256 != empty
 *   asset release-manifest.json exists and matches manifest.apkFile
 *
 * Bootstrap: ZERO valid stable mobile releases exist → delivery bootstrap allowed only for candidate 1.0.1, OTA must FAIL.
 * Malformed highest stable → FAIL CLOSED (do not fall back to older).
 * Network/API errors → FAIL CLOSED.
 *
 * Usage:
 *   node scripts/ci/mobile-release-selector.mjs --json --token $GH_TOKEN
 *   node scripts/ci/mobile-release-selector.mjs --check --candidate-version 1.0.1 --base <sha> --head <sha> (for version bump)
 */

const REPO = 'egawilldoit/Ega-House-Platform';
const REPO_API = `https://api.github.com/repos/${REPO}/releases`;
const EXPECTED_REPO = 'egawilldoit/Ega-House-Platform';
const EXPECTED_PACKAGE = 'com.ega_house.mobile';
const EXPECTED_CHANNEL = 'production';
const BOOTSTRAP_VERSION = '1.0.1';

export function semverValidateStrict(v) {
  const re = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
  if (!re.test(v)) throw new Error(`malformed version: ${v}`);
}

function parseBase(v) {
  semverValidateStrict(v);
  const base = v.split('-')[0].split('+')[0];
  return base.split('.').map(n => Number.parseInt(n, 10));
}

export function compareSemver(a, b) {
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

export function isStableMobileRelease(release) {
  if (release.draft) return false;
  if (release.prerelease) return false;
  const tag = release.tag_name || release.tagName || '';
  const m = tag.match(/^mobile-v(\d+\.\d+\.\d+)$/);
  if (!m) return false;
  const version = m[1];
  try {
    semverValidateStrict(version);
  } catch {
    return false;
  }
  const assets = release.assets || [];
  const hasManifest = assets.some(a => a.name === 'release-manifest.json');
  if (!hasManifest) return false;
  return true;
}

export function parseMobileVersionFromTag(tag) {
  const m = tag.match(/^mobile-v(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

export function validateManifest(manifest, expectedTagVersion) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is not an object');
  const required = ['repository', 'gitSha', 'gitRef', 'version', 'runtimeVersion', 'androidPackage', 'apkFile', 'apkSha256', 'channel'];
  for (const f of required) {
    const v = manifest[f];
    if (typeof v !== 'string' || !v.trim()) throw new Error(`malformed manifest: missing/invalid ${f}`);
  }
  if (manifest.repository !== EXPECTED_REPO) throw new Error(`malformed manifest: repository ${manifest.repository}`);
  if (manifest.androidPackage !== EXPECTED_PACKAGE) throw new Error(`malformed manifest: androidPackage ${manifest.androidPackage}`);
  if (manifest.channel !== EXPECTED_CHANNEL) throw new Error(`malformed manifest: channel ${manifest.channel}`);
  semverValidateStrict(manifest.version);
  semverValidateStrict(manifest.runtimeVersion);
  if (manifest.runtimeVersion !== manifest.version) throw new Error(`malformed manifest: runtimeVersion ${manifest.runtimeVersion} != version ${manifest.version}`);
  if (!/^[0-9a-f]{40}$/.test(manifest.gitSha)) throw new Error(`malformed manifest: gitSha ${manifest.gitSha}`);
  const expectedRef = `refs/tags/mobile-v${manifest.version}`;
  if (manifest.gitRef !== expectedRef) throw new Error(`malformed manifest: gitRef ${manifest.gitRef} != ${expectedRef}`);
  if (expectedTagVersion && manifest.version !== expectedTagVersion) {
    throw new Error(`malformed manifest: version ${manifest.version} != tag version ${expectedTagVersion}`);
  }
  // Validate APK asset exists in release assets (checked separately, but ensure manifest.apkFile matches)
  return manifest;
}

export function selectHighestStableMobileReleases(releases) {
  // Filter stable mobile releases with manifest asset
  const candidates = releases.filter(isStableMobileRelease);
  if (candidates.length === 0) return null;
  // Sort by semver descending (highest first)
  candidates.sort((a, b) => {
    const va = parseMobileVersionFromTag(a.tag_name);
    const vb = parseMobileVersionFromTag(b.tag_name);
    // descending: b - a
    return compareSemver(vb, va);
  });
  return candidates;
}

export async function fetchReleasesPaginated({ token, perPage = 100, maxPages = 3, fetchImpl = fetch }) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${REPO_API}?per_page=${perPage}&page=${page}`;
    const headers = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub releases API ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage) break;
  }
  return all;
}

export async function fetchManifestForRelease(release, { token, fetchImpl = fetch }) {
  const asset = (release.assets || []).find(a => a.name === 'release-manifest.json');
  if (!asset) throw new Error(`release ${release.tag_name} missing release-manifest.json`);
  const url = asset.browser_download_url;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Use fetch with timeout? Caller handles.
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`manifest fetch ${res.status} for ${release.tag_name}`);
  const manifest = await res.json();
  const tagVersion = parseMobileVersionFromTag(release.tag_name);
  validateManifest(manifest, tagVersion);
  // Also verify asset apkFile exists in release assets
  const apkAsset = (release.assets || []).find(a => a.name === manifest.apkFile);
  if (!apkAsset) throw new Error(`release ${release.tag_name} missing APK asset ${manifest.apkFile}`);
  return { release, manifest, manifestUrl: url, apkAsset };
}

export async function selectLatestStableMobileRelease({ token, fetchImpl = fetch, perPage = 100, maxPages = 3 }) {
  const releases = await fetchReleasesPaginated({ token, perPage, maxPages, fetchImpl });
  const candidates = selectHighestStableMobileReleases(releases);
  if (!candidates || candidates.length === 0) {
    return { selected: null, reason: 'ZERO valid stable mobile releases exist', allReleases: releases.length, candidates: 0 };
  }
  // Try highest first; if highest fails validation (missing manifest or malformed), FAIL CLOSED (do not fall back silently)
  // However, per spec, ignore malformed ones only if a newer/other fully valid can be selected deterministically.
  // Since we sorted descending, the highest is the deterministic choice. If it fails, we fail closed.
  // But to allow ignoring malformed lower ones, we need to iterate and return first valid. If highest fails, we fail rather than return next.
  // Implement: try highest; if it fails validation, throw FAIL CLOSED.
  const sorted = candidates; // already sorted descending
  let lastError = null;
  for (let i = 0; i < sorted.length; i++) {
    const release = sorted[i];
    try {
      const result = await fetchManifestForRelease(release, { token, fetchImpl });
      // Success: this is the highest valid (if i===0) or if i>0, it means higher ones were malformed but we would have already failed.
      // To enforce fail-closed for highest malformed, check if i>0 and previous failed, we should not have continued.
      // So if i===0 and success, return it. If i>0, it means we are falling back, which is only allowed if higher was not malformed but simply not stable? But all in candidates are stable.
      // For now, if highest succeeds, return it. If highest fails, we throw and do not try next.
      return { selected: result, reason: 'selected highest stable mobile release', allReleases: releases.length, candidates: candidates.length };
    } catch (e) {
      lastError = e;
      if (i === 0) {
        throw new Error(`highest stable mobile release ${release.tag_name} failed validation: ${e.message} — FAIL CLOSED`);
      }
      // For lower candidates, we would have already returned highest valid, so this path shouldn't be reached if highest succeeded.
      // If we are here, it means highest succeeded, we wouldn't be iterating further. So we can break.
      // But to be safe, if we are iterating because highest failed, we already threw.
      continue;
    }
  }
  // If we reach here, no candidate succeeded but we had candidates — this means highest failed and we threw, or all failed.
  throw new Error(`no valid stable mobile release: ${lastError?.message || 'unknown'}`);
}

export function shouldBootstrapAllow(candidateVersion, hasStableRelease) {
  if (hasStableRelease) return false; // bootstrap only when zero stable
  if (candidateVersion === BOOTSTRAP_VERSION) return true;
  return false;
}

// CLI handling
async function main() {
  const args = process.argv.slice(2);
  let json = false;
  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
  let perPage = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--token' && args[i + 1]) token = args[++i];
    else if (args[i] === '--per-page' && args[i + 1]) perPage = parseInt(args[++i], 10);
  }
  try {
    const result = await selectLatestStableMobileRelease({ token, perPage });
    if (!result.selected) {
      if (json) console.log(JSON.stringify({ bootstrap: true, reason: result.reason, candidateAllowed: BOOTSTRAP_VERSION }, null, 2));
      else console.log(`No stable mobile release found — bootstrap allowed only for ${BOOTSTRAP_VERSION}`);
      process.exit(0);
    }
    const out = {
      tagName: result.selected.release.tag_name,
      version: result.selected.manifest.version,
      runtimeVersion: result.selected.manifest.runtimeVersion,
      gitSha: result.selected.manifest.gitSha,
      gitRef: result.selected.manifest.gitRef,
      apkFile: result.selected.manifest.apkFile,
      apkSha256: result.selected.manifest.apkSha256,
      androidPackage: result.selected.manifest.androidPackage,
      channel: result.selected.manifest.channel,
      releaseUrl: result.selected.release.html_url,
      manifestUrl: result.selected.manifestUrl,
      manifest: result.selected.manifest,
    };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`Selected stable mobile release: ${out.tagName} version ${out.version} sha ${out.gitSha}`);
      console.log(JSON.stringify(out, null, 2));
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mobile-release-selector.mjs')) {
  main();
}
