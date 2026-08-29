import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStableMobileTagRelease,
  parseMobileVersionFromTag,
  compareSemver,
  validateManifest,
  selectHighestStableMobileTagRelease,
  selectLatestStableMobileRelease,
} from './mobile-release-selector.mjs';

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

test('isStableMobileTagRelease: ignores manifest, only tag/draft/prerelease', () => {
  assert.equal(isStableMobileTagRelease(makeRelease('mobile-v1.0.1', { hasManifest: false })), true);
  assert.equal(isStableMobileTagRelease(makeRelease('mobile-v1.0.1', { hasManifest: true })), true);
  assert.equal(isStableMobileTagRelease(makeRelease('architecture-wave-3', { hasManifest: false })), false);
  assert.equal(isStableMobileTagRelease(makeRelease('mobile-v1.0.1-rc.2')), false);
  assert.equal(isStableMobileTagRelease(makeRelease('mobile-v1.0.1', { draft: true })), false);
});

test('stable mobile release selection ignores unrelated newer release', () => {
  const releases = [makeRelease('architecture-wave-3', { hasManifest: false }), makeRelease('mobile-v1.0.1')];
  assert.equal(isStableMobileTagRelease(releases[0]), false);
  assert.equal(isStableMobileTagRelease(releases[1]), true);
  const selected = selectHighestStableMobileTagRelease(releases);
  assert.equal(selected.tag_name, 'mobile-v1.0.1');
});

test('prerelease and draft are ignored', () => {
  const releases = [makeRelease('mobile-v1.0.2', { prerelease: true }), makeRelease('mobile-v1.0.1')];
  const selected = selectHighestStableMobileTagRelease(releases);
  assert.equal(selected.tag_name, 'mobile-v1.0.1');
  const releases2 = [makeRelease('mobile-v1.0.2', { draft: true }), makeRelease('mobile-v1.0.1')];
  const selected2 = selectHighestStableMobileTagRelease(releases2);
  assert.equal(selected2.tag_name, 'mobile-v1.0.1');
});

test('semver 1.10.0 > 1.9.0', () => {
  const releases = [makeRelease('mobile-v1.9.0'), makeRelease('mobile-v1.10.0')];
  const selected = selectHighestStableMobileTagRelease(releases);
  assert.equal(selected.tag_name, 'mobile-v1.10.0');
  assert.equal(compareSemver('1.10.0', '1.9.0') > 0, true);
});

test('semver 10.0.0 > 2.0.0', () => {
  const releases = [makeRelease('mobile-v2.0.0'), makeRelease('mobile-v10.0.0')];
  const selected = selectHighestStableMobileTagRelease(releases);
  assert.equal(selected.tag_name, 'mobile-v10.0.0');
});

test('highest stable tag selected before manifest validation (no manifest still considered stable tag)', () => {
  const releases = [makeRelease('mobile-v1.0.1', { hasManifest: false })];
  const tagRelease = selectHighestStableMobileTagRelease(releases);
  assert.equal(tagRelease.tag_name, 'mobile-v1.0.1');
  assert.equal(isStableMobileTagRelease(releases[0]), true);
});

test('selectLatestStableMobileRelease: highest missing manifest → FAIL CLOSED', async () => {
  const releases = [makeRelease('mobile-v2.0.0', { hasManifest: false }), makeRelease('mobile-v1.0.1')];
  const fetchImpl = async (url) => {
    if (url.includes('/releases?')) {
      return { ok: true, json: async () => releases };
    }
    // manifest fetch for v2.0.0 should not be called if we fail closed on missing asset check before fetch?
    // But our fetchManifestForRelease will throw because asset missing before fetch.
    throw new Error('should not fetch');
  };
  await assert.rejects(
    () => selectLatestStableMobileRelease({ fetchImpl, perPage: 100, maxPages: 1 }),
    /BASELINE_METADATA_INVALID.*2\.0\.0/
  );
});

test('selectLatestStableMobileRelease: highest malformed manifest → FAIL CLOSED, no fallback to older', async () => {
  const goodRelease = makeRelease('mobile-v1.0.1');
  const badRelease = makeRelease('mobile-v2.0.0');
  // Make badRelease's manifest runtime mismatch
  const releases = [badRelease, goodRelease];
  const fetchImpl = async (url) => {
    if (url.includes('/releases?')) {
      return { ok: true, json: async () => releases };
    }
    if (url.includes('mobile-v2.0.0/manifest.json')) {
      const badManifest = { ...badRelease._manifest, runtimeVersion: '9.9.9' };
      return { ok: true, json: async () => badManifest };
    }
    if (url.includes('mobile-v1.0.1/manifest.json')) {
      return { ok: true, json: async () => goodRelease._manifest };
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  await assert.rejects(
    () => selectLatestStableMobileRelease({ fetchImpl, perPage: 100, maxPages: 1 }),
    /BASELINE_METADATA_INVALID.*2\.0\.0/
  );
  // Ensure goodRelease's manifest was never fetched (would be fallback if we allowed)
  // Our implementation throws on highest failure without trying next, so goodRelease fetch should not happen
});

test('selectLatestStableMobileRelease: missing APK asset → FAIL CLOSED', async () => {
  const release = makeRelease('mobile-v1.0.1');
  // Remove APK asset
  release.assets = release.assets.filter(a => a.name === 'release-manifest.json');
  const fetchImpl = async (url) => {
    if (url.includes('/releases?')) return { ok: true, json: async () => [release] };
    if (url.includes('manifest.json')) return { ok: true, json: async () => release._manifest };
    throw new Error(`unexpected ${url}`);
  };
  await assert.rejects(
    () => selectLatestStableMobileRelease({ fetchImpl, perPage: 100, maxPages: 1 }),
    /missing APK/
  );
});

test('selectLatestStableMobileRelease: normal highest selection', async () => {
  const releases = [makeRelease('mobile-v1.9.0'), makeRelease('mobile-v1.10.0'), makeRelease('architecture-wave-99')];
  const fetchImpl = async (url) => {
    if (url.includes('/releases?')) return { ok: true, json: async () => releases };
    if (url.includes('mobile-v1.10.0/manifest.json')) {
      const r = releases.find(x => x.tag_name === 'mobile-v1.10.0');
      return { ok: true, json: async () => r._manifest };
    }
    throw new Error(`unexpected ${url}`);
  };
  const res = await selectLatestStableMobileRelease({ fetchImpl, perPage: 100, maxPages: 1 });
  assert.equal(res.selected.manifest.version, '1.10.0');
  assert.equal(res.selected.release.tag_name, 'mobile-v1.10.0');
});

test('manifest version != tag version → validate fails', () => {
  const release = makeRelease('mobile-v1.0.1');
  const manifest = { ...release._manifest, version: '1.0.2', runtimeVersion: '1.0.2', gitRef: 'refs/tags/mobile-v1.0.2' };
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
  const selected = selectHighestStableMobileTagRelease(releases);
  assert.equal(selected, null);
});

test('parseMobileVersionFromTag', () => {
  assert.equal(parseMobileVersionFromTag('mobile-v1.0.1'), '1.0.1');
  assert.equal(parseMobileVersionFromTag('mobile-v1.0.1-rc.2'), null);
  assert.equal(parseMobileVersionFromTag('architecture-wave-3'), null);
});
