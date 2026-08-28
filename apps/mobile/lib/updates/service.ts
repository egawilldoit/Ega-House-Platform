import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import type { AppUpdateInfo, UpdateServiceState, UpdateStatus } from './types';
import { checkNativeUpdateRequired, getGithubReleasesUrl } from './native';

const CHECK_TIMEOUT_MS = 15000;
const FETCH_TIMEOUT_MS = 30000;

export type UpdatesModule = typeof Updates;

type ServiceDeps = {
  updates: UpdatesModule;
  constants: typeof Constants;
};

function getDefaultDeps(): ServiceDeps {
  return { updates: Updates as UpdatesModule, constants: Constants };
}

export function getAppUpdateInfo(deps: ServiceDeps = getDefaultDeps()): AppUpdateInfo {
  const { updates, constants } = deps;
  const expoConfig = constants.expoConfig;
  const appVersion = expoConfig?.version ?? '1.0.0';
  const runtimeVersion =
    (typeof updates.runtimeVersion === 'string' ? updates.runtimeVersion : null) ??
    (expoConfig?.runtimeVersion as string | undefined) ??
    appVersion;
  const channel = (updates.channel as string | null) ?? null;
  const updateId = (updates.updateId as string | null) ?? null;
  const createdAt = (updates.createdAt as Date | null)?.toISOString?.() ?? null;
  const runtimeStr = typeof runtimeVersion === 'object' ? JSON.stringify(runtimeVersion) : String(runtimeVersion);
  return {
    appVersion,
    runtimeVersion: runtimeStr,
    updateId,
    channel,
    isEmbeddedLaunch: Boolean(updates.isEmbeddedLaunch),
    isEmergencyLaunch: Boolean(updates.isEmergencyLaunch),
    isEnabled: Boolean(updates.isEnabled),
    createdAt,
  };
}

function isDevMode(): boolean {
  return __DEV__;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

export type CheckOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export async function checkForUpdate(
  deps: ServiceDeps = getDefaultDeps(),
  opts: CheckOptions = {}
): Promise<{ status: UpdateStatus; availableUpdateId?: string | null; error?: string; latestNativeVersion?: string | null; latestNativeRuntime?: string | null; apkUrl?: string | null; releaseUrl?: string | null }> {
  const { updates } = deps;
  if (isDevMode()) return { status: 'UP_TO_DATE' };
  if (!updates.isEnabled) return { status: 'UP_TO_DATE' };

  const info = getAppUpdateInfo(deps);
  const localVersion = info.appVersion;
  const localRuntime = info.runtimeVersion;

  const nativeCheck = await checkNativeUpdateRequired({
    fetchImpl: opts.fetchImpl,
    timeoutMs: Math.min(opts.timeoutMs ?? CHECK_TIMEOUT_MS, 8000),
    localVersion,
    localRuntime,
  });

  if (nativeCheck.status === 'ERROR') {
    return { status: 'ERROR', error: `native release status unavailable: ${nativeCheck.error}` };
  }
  if (nativeCheck.status === 'NATIVE_UPDATE_REQUIRED') {
    return {
      status: 'NATIVE_UPDATE_REQUIRED',
      error: nativeCheck.reason,
      latestNativeVersion: nativeCheck.remoteVersion,
      latestNativeRuntime: nativeCheck.remoteRuntime,
      apkUrl: nativeCheck.apkUrl,
      releaseUrl: nativeCheck.releaseUrl,
    };
  }

  try {
    const result = await withTimeout(updates.checkForUpdateAsync(), opts.timeoutMs ?? CHECK_TIMEOUT_MS);
    if (result.isAvailable) {
      return { status: 'OTA_AVAILABLE', availableUpdateId: (result as { manifest?: { id?: string } }).manifest?.id ?? null };
    }
    return { status: 'UP_TO_DATE' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (lower.includes('network') || lower.includes('timeout') || lower.includes('failed to fetch') || lower.includes('offline')) {
      return { status: 'ERROR', error: `offline: ${msg}` };
    }
    if (lower.includes('disabled') || lower.includes('dev client') || lower.includes('development')) {
      return { status: 'UP_TO_DATE' };
    }
    return { status: 'ERROR', error: msg };
  }
}

export async function downloadUpdate(
  deps: ServiceDeps = getDefaultDeps(),
  opts: CheckOptions = {}
): Promise<{ status: UpdateStatus; error?: string }> {
  const { updates } = deps;
  if (isDevMode()) return { status: 'ERROR', error: 'updates disabled in dev mode' };
  if (!updates.isEnabled) return { status: 'ERROR', error: 'updates disabled' };
  try {
    const result = await withTimeout(updates.fetchUpdateAsync(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
    if (result.isNew) return { status: 'OTA_READY' };
    if ((result as { isRollback?: boolean }).isRollback) return { status: 'UP_TO_DATE' };
    return { status: 'OTA_READY' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (lower.includes('network') || lower.includes('timeout') || lower.includes('offline') || lower.includes('failed to fetch')) {
      return { status: 'ERROR', error: `offline: ${msg}` };
    }
    return { status: 'ERROR', error: msg };
  }
}

export async function reloadApp(deps: ServiceDeps = getDefaultDeps()): Promise<void> {
  const { updates } = deps;
  if (isDevMode()) throw new Error('reload disabled in dev');
  if (!updates.isEnabled) throw new Error('updates disabled');
  await updates.reloadAsync();
}

export function createUpdateService(deps: ServiceDeps = getDefaultDeps()) {
  let currentStatus: UpdateStatus = 'IDLE';
  let lastError: string | null = null;
  let lastCheckedAt: string | null = null;
  let availableUpdateId: string | null = null;
  let latestNativeVersion: string | null = null;
  let latestNativeRuntimeVersion: string | null = null;
  let latestApkUrl: string | null = null;
  let latestReleaseUrl: string | null = null;
  let checking = false;
  let downloading = false;

  const listeners = new Set<() => void>();
  function notify() {
    listeners.forEach((l) => l());
  }

  function getInfo() {
    return getAppUpdateInfo(deps);
  }

  return {
    getState(): UpdateServiceState {
      const info = getInfo();
      return {
        status: currentStatus,
        isChecking: checking,
        isDownloading: downloading,
        isReady: currentStatus === 'OTA_READY',
        error: lastError,
        lastCheckedAt,
        availableUpdateId,
        latestNativeVersion,
        latestNativeRuntimeVersion,
        latestNativeReleaseUrl: latestReleaseUrl,
        latestApkUrl,
        currentUpdateId: info.updateId,
        appVersion: info.appVersion,
        runtimeVersion: info.runtimeVersion,
        channel: info.channel,
      };
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getInfo,
    async check(opts: CheckOptions = {}) {
      if (checking || downloading) return { status: currentStatus as UpdateStatus };
      checking = true;
      currentStatus = 'CHECKING';
      lastError = null;
      notify();
      const result = await checkForUpdate(deps, opts);
      checking = false;
      currentStatus = result.status;
      lastError = result.error ?? null;
      if (result.status === 'NATIVE_UPDATE_REQUIRED') {
        latestNativeVersion = result.latestNativeVersion ?? null;
        latestNativeRuntimeVersion = result.latestNativeRuntime ?? null;
        latestApkUrl = result.apkUrl ?? null;
        latestReleaseUrl = result.releaseUrl ?? getGithubReleasesUrl();
      } else if (result.status === 'ERROR') {
        // keep previous native info but surface error
      } else {
        latestNativeVersion = null;
        latestNativeRuntimeVersion = null;
      }
      availableUpdateId = result.availableUpdateId ?? null;
      lastCheckedAt = new Date().toISOString();
      notify();
      return result;
    },
    async download(opts: CheckOptions = {}) {
      if (downloading) return { status: currentStatus as UpdateStatus };
      if (currentStatus !== 'OTA_AVAILABLE') {
        const checkRes = await this.check(opts);
        if (checkRes.status !== 'OTA_AVAILABLE') return checkRes;
      }
      downloading = true;
      currentStatus = 'DOWNLOADING';
      lastError = null;
      notify();
      const result = await downloadUpdate(deps, opts);
      downloading = false;
      currentStatus = result.status;
      lastError = result.error ?? null;
      notify();
      return result;
    },
    async reload() {
      if (currentStatus !== 'OTA_READY') {
        throw new Error('no downloaded update ready to reload');
      }
      try {
        await reloadApp(deps);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        lastError = `Unable to restart and apply update: ${msg}`;
        currentStatus = 'ERROR';
        notify();
        throw new Error(lastError);
      }
    },
    reset() {
      currentStatus = 'IDLE';
      lastError = null;
      checking = false;
      downloading = false;
      latestNativeVersion = null;
      latestNativeRuntimeVersion = null;
      latestApkUrl = null;
      latestReleaseUrl = null;
      notify();
    },
  };
}

export type UpdateService = ReturnType<typeof createUpdateService>;

let singleton: UpdateService | null = null;

export function getUpdateService(): UpdateService {
  if (!singleton) singleton = createUpdateService();
  return singleton;
}

export function __resetSingletonForTests() {
  singleton = null;
}
