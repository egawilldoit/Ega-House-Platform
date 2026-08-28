import assert from 'node:assert/strict';
import test from 'node:test';
import { isStableMobileRelease, parseMobileVersionFromTag, compareSemver, validateManifest, selectHighestStableMobileReleases } from './mobile-release-selector.mjs';

function makeRelease(tag, { draft = false, prerelease = false, hasManifest = true, manifestVersion = null } = {}) {
  const version = manifestVersion || tag.replace(/^mobile-v/, '');
  const manifest = hasManifest
    ? {
        repository: 'egawilldoit/Ega-House-Platform',
        gitSha: 'a'.repeat(40),
        gitRef: `refs/tags/${tag}`,
        version,
        runtimeVersion: version,
        androidPackage: 'com.ega_house.mobile',
        apkFile: `ega-house-${version}-abc-release.apk`,
        apkSha256: 'deadbeef',
        channel: 'production',
        variant: 'release',
        apiBaseUrl: 'https://ega-api.egawilldoit.online',
        builtAt: new Date().toISOString(),
        runner: 'blacksmith',
        architectures: ['arm64-v8a', 'x86_64'],
      }
    : null;
  return {
    tag_name: tag,
    draft,
    prerelease,
    assets: hasManifest
      ? [
          { name: 'release-manifest.json', browser_download_url: `https://example.com/${tag}/manifest.json` },
          { name: `ega-house-${version}-abc-release.apk`, browser_download_url: `https://example.com/${tag}/apk` },
        ]
      : [],
    html_url: `https://github.com/egawilldoit/Ega-House-Platform/releases/tag/${tag}`,
    _manifest: manifest,
  };
}

test('stable mobile release selection ignores unrelated newer release', () => {
  const releases = [makeRelease('architecture-wave-3', { hasManifest: false }), makeRelease('mobile-v1.0.1')];
  // isStable should be false for arch, true for mobile
  assert.equal(isStableMobileRelease(releases[0]), false);
  assert.equal(isStableMobileRelease(releases[1]), true);
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].tag_name, 'mobile-v1.0.1');
});

test('prerelease and draft are ignored', () => {
  const releases = [makeRelease('mobile-v1.0.2', { prerelease: true }), makeRelease('mobile-v1.0.1')];
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected[0].tag_name, 'mobile-v1.0.1');
  const releases2 = [makeRelease('mobile-v1.0.2', { draft: true }), makeRelease('mobile-v1.0.1')];
  const selected2 = selectHighestStableMobileReleases(releases2);
  assert.equal(selected2[0].tag_name, 'mobile-v1.0.1');
});

test('semver 1.10.0 > 1.9.0', () => {
  const releases = [makeRelease('mobile-v1.9.0'), makeRelease('mobile-v1.10.0')];
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected[0].tag_name, 'mobile-v1.10.0');
  assert.equal(compareSemver('1.10.0', '1.9.0') > 0, true);
});

test('semver 10.0.0 > 2.0.0', () => {
  const releases = [makeRelease('mobile-v2.0.0'), makeRelease('mobile-v10.0.0')];
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected[0].tag_name, 'mobile-v10.0.0');
});

test('stable tag has no manifest → not selected (fail closed candidate)', () => {
  const releases = [makeRelease('mobile-v1.0.1', { hasManifest: false })];
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected, null);
});

test('manifest version != tag version → validate fails', () => {
  const release = makeRelease('mobile-v1.0.1');
  const manifest = { ...release._manifest, version: '1.0.2', runtimeVersion: '1.0.2' };
  assert.throws(() => validateManifest(manifest, '1.0.1'), /malformed/);
});

test('manifest runtime != version → fail', () => {
  const release = makeRelease('mobile-v1.0.1');
  const manifest = { ...release._manifest, runtimeVersion: '1.0.2' };
  assert.throws(() => validateManifest(manifest, '1.0.1'), /runtimeVersion/);
});

test('GitHub API 500 → error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'error' });
  const { fetchReleasesPaginated } = await import('./mobile-release-selector.mjs');
  await assert.rejects(() => fetchReleasesPaginated({ fetchImpl, perPage: 100, maxPages: 1 }), /500/);
});

test('bootstrap: zero stable, candidate 1.0.1 → allowed, other → blocked', async () => {
  const { shouldBootstrapAllow } = await import('./mobile-release-selector.mjs');
  assert.equal(shouldBootstrapAllow('1.0.1', false), true);
  assert.equal(shouldBootstrapAllow('1.0.2', false), false);
  assert.equal(shouldBootstrapAllow('1.0.1', true), false);
});

test('OTA bootstrap must fail (no stable → OTA BLOCK)', () => {
  const releases = [];
  const selected = selectHighestStableMobileReleases(releases);
  assert.equal(selected, null);
  // OTA should fail closed when no stable
  const hasStable = selected !== null && selected.length > 0;
  assert.equal(hasStable, false);
});

test('parseMobileVersionFromTag', () => {
  assert.equal(parseMobileVersionFromTag('mobile-v1.0.1'), '1.0.1');
  assert.equal(parseMobileVersionFromTag('mobile-v1.0.1-rc.2'), null);
  assert.equal(parseMobileVersionFromTag('architecture-wave-3'), null);
});
