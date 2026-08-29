#!/usr/bin/env node
/**
 * mobile-release-selector.mjs — Deterministic stable mobile release selector (two-stage)
 *
 * Stage 1 — Stable mobile release identity (tag only, no manifest):
 *   draft == false
 *   AND prerelease == false
 *   AND tag_name matches ^mobile-v([0-9]+\.[0-9]+\.[0-9]+)$
 *
 * Stage 2 — Select highest stable mobile tag (strict semver descending)
 * Stage 3 — Validate selected highest release's manifest (fail closed, no fallback)
 *
 * Required manifest fields:
 *   repository == egawilldoit/Ega-House-Platform
 *   androidPackage == com.ega_house.mobile
 *   channel == production
 *   version == strict semver, == tag version
 *   runtimeVersion == strict semver, == version
 *   gitSha == 40-char hex
 *   gitRef == refs/tags/mobile-v<version>
 *   apkFile != empty, apkSha256 != empty
 *   APK asset with exact manifest.apkFile exists
 *
 * Bootstrap only when ZERO stable mobile tag releases exist.
 * All other failures → FAIL CLOSED (no fallback to older).
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

export function isStableMobileTagRelease(release) {
  if (release.draft) return false;
  if (release.prerelease) return false;
  const tag = release.tag_name || release.tagName || '';
  const m = tag.match(/^mobile-v(\d+\.\d+\.\d+)$/);
  if (!m) return false;
  try {
    semverValidateStrict(m[1]);
  } catch {
    return false;
  }
  return true;
}

// Backward compat: old isStableMobileRelease required manifest, now alias to tag-only for new semantics
// But keep original behavior for tests that expect manifest check? We now make it tag-only per new spec.
export function isStableMobileRelease(release) {
  return isStableMobileTagRelease(release);
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
  return manifest;
}

export function selectHighestStableMobileTagRelease(releases) {
  const candidates = releases.filter(isStableMobileTagRelease);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const va = parseMobileVersionFromTag(a.tag_name);
    const vb = parseMobileVersionFromTag(b.tag_name);
    return compareSemver(vb, va);
  });
  return candidates[0];
}

export function selectHighestStableMobileReleases(releases) {
  const one = selectHighestStableMobileTagRelease(releases);
  return one ? [one] : null;
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
  if (!asset) throw new Error(`BASELINE_METADATA_INVALID: release ${release.tag_name} missing release-manifest.json — FAIL CLOSED`);
  const url = asset.browser_download_url;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw new Error(`BASELINE_METADATA_INVALID: manifest fetch ${res.status} for ${release.tag_name} — FAIL CLOSED`);
  const manifest = await res.json();
  const tagVersion = parseMobileVersionFromTag(release.tag_name);
  validateManifest(manifest, tagVersion);
  const apkAsset = (release.assets || []).find(a => a.name === manifest.apkFile);
  if (!apkAsset) throw new Error(`BASELINE_METADATA_INVALID: release ${release.tag_name} missing APK asset ${manifest.apkFile} — FAIL CLOSED`);
  return { release, manifest, manifestUrl: url, apkAsset };
}

export async function selectLatestStableMobileRelease({ token, fetchImpl = fetch, perPage = 100, maxPages = 3 }) {
  const releases = await fetchReleasesPaginated({ token, perPage, maxPages, fetchImpl });
  const stableTags = releases.filter(isStableMobileTagRelease);
  if (stableTags.length === 0) {
    return { selected: null, bootstrap: true, reason: 'ZERO_STABLE_MOBILE_RELEASES', allReleases: releases.length, candidates: 0 };
  }
  stableTags.sort((a, b) => {
    const va = parseMobileVersionFromTag(a.tag_name);
    const vb = parseMobileVersionFromTag(b.tag_name);
    return compareSemver(vb, va);
  });
  const highest = stableTags[0];
  try {
    const result = await fetchManifestForRelease(highest, { token, fetchImpl });
    return { selected: result, bootstrap: false, reason: 'selected highest stable mobile tag', allReleases: releases.length, candidates: stableTags.length };
  } catch (e) {
    throw new Error(`BASELINE_METADATA_INVALID: highest stable mobile release ${highest.tag_name} failed validation: ${e.message} — FAIL CLOSED`);
  }
}

export function shouldBootstrapAllow(candidateVersion, hasStableRelease) {
  if (hasStableRelease) return false;
  if (candidateVersion === BOOTSTRAP_VERSION) return true;
  return false;
}

// CLI
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
