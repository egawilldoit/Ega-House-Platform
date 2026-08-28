import Constants from 'expo-constants';

import type { NativeUpdateClassification, ReleaseManifest } from './types';

const GITHUB_RELEASES_LATEST_URL =
  'https://api.github.com/repos/egawilldoit/Ega-House-Platform/releases/latest';
const APK_GITHUB_URL_BASE = 'https://github.com/egawilldoit/Ega-House-Platform/releases';
const FETCH_TIMEOUT_MS = 8000;

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
  for (let i = 0; i < len; i += 1) {
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

export function validateManifest(manifest: unknown): ReleaseManifest {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is not an object');
  const m = manifest as Record<string, unknown>;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const val = m[field];
    if (typeof val !== 'string' || val.trim() === '') {
      throw new Error(`malformed manifest: missing/invalid ${field}`);
    }
  }
  validateSemverStrict(m.version as string);
  if ((m.repository as string) !== 'egawilldoit/Ega-House-Platform') {
    throw new Error(`malformed manifest: unexpected repository ${m.repository}`);
  }
  if ((m.androidPackage as string) !== 'com.ega_house.mobile') {
    throw new Error(`malformed manifest: unexpected androidPackage ${m.androidPackage}`);
  }
  if (!/^[0-9a-f]{40}$/.test(m.gitSha as string)) {
    throw new Error(`malformed manifest: invalid gitSha ${m.gitSha}`);
  }
  if (!(m.channel as string).trim()) throw new Error('malformed manifest: empty channel');
  return m as unknown as ReleaseManifest;
}

export async function fetchLatestReleaseManifest(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
} = {}): Promise<ReleaseManifest> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  const abort = new AbortController();
  try {
    const releaseRes = await withTimeout(
      fetchImpl(GITHUB_RELEASES_LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: abort.signal,
      }),
      timeoutMs
    );
    if (!releaseRes.ok) {
      if (releaseRes.status === 404) throw new Error('no releases found');
      throw new Error(`GitHub releases API ${releaseRes.status}`);
    }
    const release = (await releaseRes.json()) as {
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    const manifestAsset = release.assets.find((a) => a.name === 'release-manifest.json');
    if (!manifestAsset) throw new Error('release-manifest.json asset missing');
    const manifestRes = await withTimeout(
      fetchImpl(manifestAsset.browser_download_url, {
        headers: { Accept: 'application/json' },
        signal: abort.signal,
      }),
      timeoutMs
    );
    if (!manifestRes.ok) throw new Error(`manifest fetch ${manifestRes.status}`);
    const raw = await manifestRes.json();
    return validateManifest(raw);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('timeout');
    throw error;
  } finally {
    abort.abort();
  }
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
    const releaseUrl = getGithubReleasesUrl();
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
    const releaseUrl = getGithubReleasesUrl();
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
      lower.includes('no releases') ||
      lower.includes('asset missing')
    ) {
      return { status: 'ERROR', error: message };
    }
    return { status: 'ERROR', error: message };
  }
}
