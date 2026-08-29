import Constants from 'expo-constants';

import type { NativeUpdateClassification, ReleaseManifest } from './types';

const GITHUB_RELEASES_LIST_URL = 'https://api.github.com/repos/egawilldoit/Ega-House-Platform/releases';
const APK_GITHUB_URL_BASE = 'https://github.com/egawilldoit/Ega-House-Platform/releases';
const FETCH_TIMEOUT_MS = 8000;
const EXPECTED_REPO = 'egawilldoit/Ega-House-Platform';
const EXPECTED_PACKAGE = 'com.ega_house.mobile';
const EXPECTED_CHANNEL = 'production';

export type FetchImpl = typeof fetch;

function getLocalAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

function validateSemverStrict(v: string): void {
  const re = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
  if (!re.test(v)) {
    throw new Error(`malformed version: ${v}`);
  }
}

function parseVersionStrict(v: string): number[] {
  validateSemverStrict(v);
  const base = v.split('-')[0].split('+')[0];
  return base.split('.').map((n) => Number.parseInt(n, 10));
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersionStrict(a);
  const pb = parseVersionStrict(b);
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

export function isNewerVersion(remote: string, local: string): boolean {
  return compareVersions(remote, local) > 0;
}

export function parseMobileVersionFromTag(tag: string): string | null {
  const m = tag.match(/^mobile-v(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

export function isStableMobileTagRelease(release: { tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string }> }): boolean {
  if (release.draft) return false;
  if (release.prerelease) return false;
  const version = parseMobileVersionFromTag(release.tag_name);
  if (!version) return false;
  try {
    validateSemverStrict(version);
  } catch {
    return false;
  }
  return true;
}

export function isStableMobileRelease(release: { tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string }> }): boolean {
  return isStableMobileTagRelease(release);
}

export function buildApkUrlFromManifest(manifest: ReleaseManifest): string | null {
  if (manifest.gitRef.startsWith('refs/tags/')) {
    const tag = manifest.gitRef.replace('refs/tags/', '');
    return `${APK_GITHUB_URL_BASE}/download/${tag}/${manifest.apkFile}`;
  }
  if (manifest.version) {
    return `${APK_GITHUB_URL_BASE}/download/mobile-v${manifest.version}/${manifest.apkFile}`;
  }
  return null;
}

export function getGithubReleasesUrl(): string {
  return 'https://github.com/egawilldoit/Ega-House-Platform/releases';
}

export function getLatestApkUrl(manifest: ReleaseManifest | null): string {
  if (!manifest) return getGithubReleasesUrl();
  const direct = buildApkUrlFromManifest(manifest);
  return direct ?? getGithubReleasesUrl();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  const raced = Promise.race([promise, timeoutPromise]) as Promise<T>;
  return raced.finally(() => clearTimeout(timeout));
}

const REQUIRED_MANIFEST_FIELDS: (keyof ReleaseManifest)[] = [
  'repository',
  'gitSha',
  'gitRef',
  'version',
  'runtimeVersion',
  'androidPackage',
  'apkFile',
  'channel',
];

export function validateManifest(manifest: unknown, expectedTagVersion?: string): ReleaseManifest {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is not an object');
  const m = manifest as Record<string, unknown>;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const val = m[field];
    if (typeof val !== 'string' || val.trim() === '') {
      throw new Error(`malformed manifest: missing/invalid ${field}`);
    }
  }
  validateSemverStrict(m.version as string);
  validateSemverStrict(m.runtimeVersion as string);
  if ((m.repository as string) !== EXPECTED_REPO) {
    throw new Error(`malformed manifest: unexpected repository ${m.repository}`);
  }
  if ((m.androidPackage as string) !== EXPECTED_PACKAGE) {
    throw new Error(`malformed manifest: unexpected androidPackage ${m.androidPackage}`);
  }
  if ((m.channel as string) !== EXPECTED_CHANNEL) {
    throw new Error(`malformed manifest: channel ${m.channel}`);
  }
  if (m.runtimeVersion !== m.version) {
    throw new Error(`malformed manifest: runtimeVersion ${m.runtimeVersion} != version ${m.version}`);
  }
  if (!/^[0-9a-f]{40}$/.test(m.gitSha as string)) {
    throw new Error(`malformed manifest: invalid gitSha ${m.gitSha}`);
  }
  const expectedRef = `refs/tags/mobile-v${m.version as string}`;
  if ((m.gitRef as string) !== expectedRef) {
    throw new Error(`malformed manifest: gitRef ${m.gitRef} != ${expectedRef}`);
  }
  if (expectedTagVersion && m.version !== expectedTagVersion) {
    throw new Error(`malformed manifest: version ${m.version} != tag version ${expectedTagVersion}`);
  }
  if (!(m.apkFile as string).trim() || !(m.apkSha256 as string)?.trim()) {
    throw new Error('malformed manifest: missing apkFile/apkSha256');
  }
  return m as unknown as ReleaseManifest;
}

export async function fetchReleasesPaginated(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  perPage?: number;
  maxPages?: number;
} = {}): Promise<Array<{ tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string; browser_download_url: string }>; html_url: string }>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const perPage = opts.perPage ?? 100;
  const maxPages = opts.maxPages ?? 2;
  const all: Array<{ tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string; browser_download_url: string }>; html_url: string }> = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_RELEASES_LIST_URL}?per_page=${perPage}&page=${page}`;
    const res = await withTimeout(
      fetchImpl(url, {
        headers: { Accept: 'application/vnd.github+json' },
      }),
      timeoutMs
    );
    if (!res.ok) throw new Error(`GitHub releases API ${res.status}`);
    const data = (await res.json()) as Array<{ tag_name: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string; browser_download_url: string }>; html_url: string }>;
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage) break;
  }
  return all;
}

export async function fetchLatestReleaseManifest(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
} = {}): Promise<ReleaseManifest> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const releases = await fetchReleasesPaginated({ fetchImpl, timeoutMs, perPage: 100, maxPages: 2 });
  const stableTags = releases.filter(isStableMobileTagRelease);
  if (stableTags.length === 0) {
    throw new Error('ZERO_STABLE_MOBILE_RELEASES: no stable mobile tag releases — bootstrap only for 1.0.2');
  }
  stableTags.sort((a, b) => {
    const va = parseMobileVersionFromTag(a.tag_name) as string;
    const vb = parseMobileVersionFromTag(b.tag_name) as string;
    return compareVersions(vb, va);
  });
  const highest = stableTags[0];
  const tagVersion = parseMobileVersionFromTag(highest.tag_name) as string;
  const manifestAsset = (highest.assets || []).find((a) => a.name === 'release-manifest.json');
  if (!manifestAsset) throw new Error(`BASELINE_METADATA_INVALID: highest stable mobile release ${highest.tag_name} missing release-manifest.json — FAIL CLOSED`);
  const manifestRes = await withTimeout(
    fetchImpl(manifestAsset.browser_download_url, {
      headers: { Accept: 'application/json' },
    }),
    timeoutMs
  );
  if (!manifestRes.ok) throw new Error(`BASELINE_METADATA_INVALID: manifest fetch ${manifestRes.status} for ${highest.tag_name} — FAIL CLOSED`);
  const raw = await manifestRes.json();
  const manifest = validateManifest(raw, tagVersion);
  const apkAsset = (highest.assets || []).find((a) => a.name === manifest.apkFile);
  if (!apkAsset) throw new Error(`BASELINE_METADATA_INVALID: release ${highest.tag_name} missing APK asset ${manifest.apkFile} — FAIL CLOSED`);
  return manifest;
}

export function classifyNativeUpdate(
  localVersion: string,
  localRuntime: string,
  manifest: ReleaseManifest
): NativeUpdateClassification {
  validateSemverStrict(localVersion);
  validateSemverStrict(manifest.version);
  const remoteVersion = manifest.version;
  const remoteRuntime = manifest.runtimeVersion;
  if (!remoteRuntime || typeof remoteRuntime !== 'string' || !remoteRuntime.trim()) {
    throw new Error('malformed manifest: missing runtimeVersion');
  }
  if (isNewerVersion(remoteVersion, localVersion)) {
    const apkUrl = buildApkUrlFromManifest(manifest);
    const releaseUrl = `https://github.com/egawilldoit/Ega-House-Platform/releases/tag/mobile-v${manifest.version}`;
    return {
      status: 'NATIVE_UPDATE_REQUIRED',
      localVersion,
      localRuntime,
      remoteVersion,
      remoteRuntime,
      apkUrl,
      releaseUrl,
      reason: `newer native version ${remoteVersion} > ${localVersion}`,
    };
  }
  if (compareVersions(remoteVersion, localVersion) === 0 && remoteRuntime !== localRuntime) {
    const apkUrl = buildApkUrlFromManifest(manifest);
    const releaseUrl = `https://github.com/egawilldoit/Ega-House-Platform/releases/tag/mobile-v${manifest.version}`;
    return {
      status: 'NATIVE_UPDATE_REQUIRED',
      localVersion,
      localRuntime,
      remoteVersion,
      remoteRuntime,
      apkUrl,
      releaseUrl,
      reason: `same version ${localVersion} but runtime mismatch ${localRuntime} != ${remoteRuntime}`,
    };
  }
  if (compareVersions(remoteVersion, localVersion) === 0 && remoteRuntime === localRuntime) {
    return {
      status: 'UP_TO_DATE',
      localVersion,
      localRuntime,
      remoteVersion,
      remoteRuntime,
    };
  }
  return {
    status: 'UP_TO_DATE',
    localVersion,
    localRuntime,
    remoteVersion,
    remoteRuntime,
  };
}

export async function checkNativeUpdateRequired(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  localVersion?: string;
  localRuntime?: string;
} = {}): Promise<NativeUpdateClassification> {
  const localVersion = opts.localVersion ?? getLocalAppVersion();
  const localRuntime = opts.localRuntime ?? (localVersion ?? '0.0.0');
  try {
    const manifest = await fetchLatestReleaseManifest(opts);
    return classifyNativeUpdate(localVersion, localRuntime, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (
      lower.includes('timeout') ||
      lower.includes('network') ||
      lower.includes('failed to fetch') ||
      lower.includes('abort') ||
      lower.includes('malformed') ||
      lower.includes('no stable') ||
      lower.includes('asset missing') ||
      lower.includes('github releases api')
    ) {
      return { status: 'ERROR', error: message };
    }
    return { status: 'ERROR', error: message };
  }
}
