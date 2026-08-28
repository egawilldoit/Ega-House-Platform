import Constants from 'expo-constants';

import type { ReleaseManifest, NativeUpdateClassification } from './types';

const GITHUB_RELEASES_LATEST_URL =
  'https://api.github.com/repos/egawilldoit/Ega-House-Platform/releases/latest';
const GITHUB_RELEASE_MANIFEST_GITHUB_IO_FALLBACK: string | null = null;
const APK_GITHUB_URL_BASE = 'https://github.com/egawilldoit/Ega-House-Platform/releases';

const FETCH_TIMEOUT_MS = 8000;

/**
 * Minimal read-only native release checker that reuses the existing
 * GitHub Release `release-manifest.json` produced by the APK pipeline.
 * No new DB/service required.
 */

export type FetchImpl = typeof fetch;

function getLocalAppVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

function parseVersion(v: string): number[] {
  return v.split('.').map((n) => Number.parseInt(n, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  const raced = Promise.race([promise, timeoutPromise]) as Promise<T>;
  return raced.finally(() => clearTimeout(timeout));
}

export async function fetchLatestReleaseManifest(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
} = {}): Promise<ReleaseManifest | null> {
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
      if (releaseRes.status === 404) return null;
      throw new Error(`GitHub releases API ${releaseRes.status}`);
    }
    const release = (await releaseRes.json()) as {
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    };
    const manifestAsset = release.assets.find((a) => a.name === 'release-manifest.json');
    if (!manifestAsset) return null;
    const manifestRes = await withTimeout(
      fetchImpl(manifestAsset.browser_download_url, {
        headers: { Accept: 'application/json' },
        signal: abort.signal,
      }),
      timeoutMs
    );
    if (!manifestRes.ok) throw new Error(`manifest fetch ${manifestRes.status}`);
    const manifest = (await manifestRes.json()) as ReleaseManifest;
    return manifest;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('timeout');
    }
    throw error;
  } finally {
    abort.abort();
  }
}

export async function fetchLatestReleaseManifestWithFallback(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
} = {}): Promise<ReleaseManifest | null> {
  try {
    const manifest = await fetchLatestReleaseManifest(opts);
    if (manifest) return manifest;
  } catch {
    // fallthrough to try direct fallback if configured
  }
  if (GITHUB_RELEASE_MANIFEST_GITHUB_IO_FALLBACK) {
    try {
      const fetchImpl = opts.fetchImpl ?? fetch;
      const res = await withTimeout(
        fetchImpl(GITHUB_RELEASE_MANIFEST_GITHUB_IO_FALLBACK, { signal: new AbortController().signal }),
        opts.timeoutMs ?? FETCH_TIMEOUT_MS
      );
      if (res.ok) return (await res.json()) as ReleaseManifest;
    } catch {
      return null;
    }
  }
  return null;
}

export function classifyNativeUpdate(
  localVersion: string,
  manifest: ReleaseManifest | null
): NativeUpdateClassification {
  if (!manifest) {
    return { status: 'UP_TO_DATE', localVersion, remoteVersion: null };
  }
  const remoteVersion = manifest.version;
  if (!remoteVersion) {
    return { status: 'UP_TO_DATE', localVersion, remoteVersion: null };
  }
  if (isNewerVersion(remoteVersion, localVersion)) {
    const apkUrl = buildApkUrlFromManifest(manifest);
    return { status: 'NATIVE_UPDATE_REQUIRED', localVersion, remoteVersion, apkUrl };
  }
  return { status: 'UP_TO_DATE', localVersion, remoteVersion };
}

export async function checkNativeUpdateRequired(opts: {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  localVersion?: string;
} = {}): Promise<NativeUpdateClassification> {
  const localVersion = opts.localVersion ?? getLocalAppVersion();
  try {
    const manifest = await fetchLatestReleaseManifest(opts);
    return classifyNativeUpdate(localVersion, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes('timeout') || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('abort')) {
      return { status: 'ERROR', error: `offline: ${message}` };
    }
    return { status: 'ERROR', error: message };
  }
}

export function getGithubReleasesUrl(): string {
  return 'https://github.com/egawilldoit/Ega-House-Platform/releases';
}

export function getLatestApkUrl(manifest: ReleaseManifest | null): string {
  if (!manifest) return getGithubReleasesUrl();
  const direct = buildApkUrlFromManifest(manifest);
  return direct ?? getGithubReleasesUrl();
}
