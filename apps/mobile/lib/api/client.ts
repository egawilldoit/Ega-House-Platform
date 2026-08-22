import Constants from 'expo-constants';

import type { MobileAuthRefreshResponse, MobileAuthSession, MobileAuthUser } from '@/types/auth';

type SessionBundle = {
  session: MobileAuthSession;
  user: MobileAuthUser;
};

type ApiClientSessionHandlers = {
  getSession: () => Promise<SessionBundle | null>;
  setSession: (value: SessionBundle) => Promise<void>;
  clearSession: () => Promise<void>;
  onUnauthorized: () => void;
};

type JsonRecord = Record<string, unknown>;

let sessionHandlers: ApiClientSessionHandlers | null = null;
const DEFAULT_PRODUCTION_API_BASE_URL = 'https://www.egawilldoit.online';
const API_DEBUG_PREFIX = '[mobile-api]';

export type ApiBaseUrlSource = 'env' | 'dev-host' | 'production-default';

export type ResolvedApiBaseUrl = {
  url: string;
  source: ApiBaseUrlSource;
};

type ResolverEnv = { EXPO_PUBLIC_API_BASE_URL?: string };

type ResolverConstants = {
  expoConfig?: { hostUri?: string } | null;
  manifest2?: { extra?: { expoClient?: { hostUri?: string } | null } | null } | null;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isExpoDevRuntime() {
  return __DEV__;
}

const VALID_API_BASE_URL_PATTERN = /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i;

export function assertValidApiBaseUrl(value: string): void {
  if (!VALID_API_BASE_URL_PATTERN.test(value)) {
    throw new Error(
      `${API_DEBUG_PREFIX} EXPO_PUBLIC_API_BASE_URL "${value}" is not a usable API base URL. ` +
        'Set an absolute http(s) origin with a hostname, e.g. https://api.example.com',
    );
  }
}

export function resolveApiBaseUrl(
  env: ResolverEnv,
  constants: ResolverConstants,
  isDev: boolean,
): ResolvedApiBaseUrl {
  const envUrl = env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (envUrl) {
    assertValidApiBaseUrl(envUrl);
    return { url: trimTrailingSlash(envUrl), source: 'env' };
  }

  const hostUri =
    constants.expoConfig?.hostUri ??
    constants.manifest2?.extra?.expoClient?.hostUri ??
    null;

  if (isDev && hostUri) {
    const host = hostUri.split(':')[0];
    return { url: trimTrailingSlash(`http://${host}:3000`), source: 'dev-host' };
  }

  return { url: DEFAULT_PRODUCTION_API_BASE_URL, source: 'production-default' };
}

let didWarnProductionDefault = false;

function resolveCurrentApiBaseUrl(): ResolvedApiBaseUrl {
  return resolveApiBaseUrl(process.env, Constants, isExpoDevRuntime());
}

export function getApiBaseUrl() {
  const resolved = resolveCurrentApiBaseUrl();

  if (resolved.source === 'production-default' && !didWarnProductionDefault) {
    didWarnProductionDefault = true;
    const releaseHint = isExpoDevRuntime()
      ? ''
      : ' This is a release build; set EXPO_PUBLIC_API_BASE_URL before shipping if this host is not your backend.';
    console.warn(
      `${API_DEBUG_PREFIX} no EXPO_PUBLIC_API_BASE_URL set; falling back to production default ${resolved.url}.${releaseHint}`,
    );
  }

  return resolved.url;
}

/**
 * Test seam: clear the one-time production-default warning so suites start
 * from a clean diagnostic state. Mirrors setMobileEgaApiClientForTesting
 * in lib/api/ega.ts.
 */
export function resetApiBaseUrlDiagnosticsForTesting() {
  didWarnProductionDefault = false;
}

export function configureMobileApiClient(handlers: ApiClientSessionHandlers) {
  sessionHandlers = handlers;
}

function readJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function parseApiErrorMessage(response: Response) {
  const text = await response.text();
  const parsed = readJsonSafely<{ error?: { message?: string } }>(text);
  return parsed?.error?.message || text || `Request failed (${response.status})`;
}

function logApiDiagnostic(event: string, details: Record<string, unknown>) {
  console.info(API_DEBUG_PREFIX, event, details);
}

function buildNetworkErrorMessage(endpoint: string, error: unknown) {
  const baseUrl = getApiBaseUrl();
  const message = error instanceof Error ? error.message : String(error);

  if (!process.env.EXPO_PUBLIC_API_BASE_URL?.trim() && !isExpoDevRuntime()) {
    return `Unable to reach ${endpoint}. Release build is using fallback API base URL ${baseUrl}. Set EXPO_PUBLIC_API_BASE_URL if this is not your production backend.`;
  }

  if (baseUrl.startsWith('http://') && !isExpoDevRuntime()) {
    return `Unable to reach ${endpoint}. Android release builds require a reachable HTTPS API URL; current base URL is ${baseUrl}.`;
  }

  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('10.0.2.2')) {
    return `Unable to reach ${endpoint}. Mobile release builds cannot use local-only API hosts such as ${baseUrl}.`;
  }

  return `Unable to reach ${endpoint}: ${message}`;
}

async function fetchMobileApi(endpoint: string, init: RequestInit) {
  try {
    return await fetch(endpoint, init);
  } catch (error) {
    logApiDiagnostic('network-error', {
      endpoint,
      apiBaseUrl: getApiBaseUrl(),
      apiBaseUrlSource: resolveCurrentApiBaseUrl().source,
      hasExpoPublicApiBaseUrl: Boolean(process.env.EXPO_PUBLIC_API_BASE_URL?.trim()),
      isDev: isExpoDevRuntime(),
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCause:
        error instanceof Error && 'cause' in error ? String(error.cause ?? '') : undefined,
    });

    const wrappedError = new Error(buildNetworkErrorMessage(endpoint, error)) as Error & {
      cause?: unknown;
    };
    wrappedError.cause = error;
    throw wrappedError;
  }
}

/**
 * Accessor for the current mobile session access token, or null when no
 * session has been configured yet (auth context still bootstrapping).
 * Used by the @ega/api-client binding (`lib/api/ega.ts`) so the
 * platform-neutral client never touches storage itself.
 */
export async function getMobileSessionAccessToken(): Promise<string | null> {
  if (!sessionHandlers) {
    return null;
  }

  const bundle = await sessionHandlers.getSession();
  return bundle?.session.accessToken ?? null;
}

/**
 * In-flight refresh promise shared by every caller. Concurrent authenticated
 * 401s all await the SAME refresh so a rotating refresh token is used by
 * exactly one request at a time (single-flight).
 */
let refreshInFlight: Promise<boolean> | null = null;

/** Best-effort refresh through the configured session handlers. */
export function refreshMobileSessionIfConfigured(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

const TRANSIENT_REFRESH_STATUSES = new Set([500, 502, 503, 504]);

/**
 * Commit-time identity check for a refresh that started earlier. A logout or
 * account switch may complete while the refresh request is in flight; in that
 * case the captured session no longer describes the current authority and its
 * result must be discarded instead of installed (logout wins) or destructively
 * cleared (stale failure must not destroy a newer session).
 */
function isSameSessionIdentity(a: SessionBundle | null, b: SessionBundle | null) {
  return (
    a?.session.accessToken === b?.session.accessToken &&
    a?.session.refreshToken === b?.session.refreshToken &&
    a?.user.id === b?.user.id
  );
}

async function performRefresh() {
  if (!sessionHandlers) {
    return false;
  }

  const current = await sessionHandlers.getSession();
  if (!current?.session.refreshToken) {
    await sessionHandlers.clearSession();
    sessionHandlers.onUnauthorized();
    return false;
  }

  const endpoint = `${getApiBaseUrl()}/api/auth/refresh`;
  let response: Response;
  let payload: MobileAuthRefreshResponse;

  try {
    response = await fetchMobileApi(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: current.session.refreshToken,
      }),
    });

    if (!response.ok) {
      logApiDiagnostic('refresh-failed', {
        endpoint,
        status: response.status,
      });

      if (!TRANSIENT_REFRESH_STATUSES.has(response.status)) {
        const latest = await sessionHandlers.getSession();
        if (isSameSessionIdentity(latest, current)) {
          await sessionHandlers.clearSession();
          sessionHandlers.onUnauthorized();
        } else {
          logApiDiagnostic('refresh-result-discarded', {
            endpoint,
            reason: 'session-changed-during-refresh',
          });
        }
      }

      return false;
    }

    payload = (await response.json()) as MobileAuthRefreshResponse;
  } catch (error) {
    logApiDiagnostic('refresh-network-error', {
      endpoint,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const latest = await sessionHandlers.getSession();
  if (!isSameSessionIdentity(latest, current)) {
    logApiDiagnostic('refresh-result-discarded', {
      endpoint,
      reason: 'session-changed-during-refresh',
    });
    return false;
  }

  await sessionHandlers.setSession({
    session: payload.session,
    user: payload.user ?? current.user,
  });

  return true;
}

async function buildHeaders(inputHeaders: HeadersInit | undefined, withAuth: boolean) {
  const headers = new Headers(inputHeaders ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (withAuth && sessionHandlers) {
    const session = await sessionHandlers.getSession();
    if (session?.session.accessToken) {
      headers.set('Authorization', `Bearer ${session.session.accessToken}`);
    }
  }

  return headers;
}

export async function mobileApiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean; retryOnUnauthorized?: boolean } = {},
): Promise<T> {
  const {
    auth = true,
    retryOnUnauthorized = true,
    ...requestInit
  } = options;

  const headers = await buildHeaders(requestInit.headers, auth);
  const endpoint = `${getApiBaseUrl()}${path}`;
  const response = await fetchMobileApi(endpoint, {
    ...requestInit,
    headers,
  });

  if (response.status === 401 && auth && retryOnUnauthorized && sessionHandlers) {
    const refreshed = await refreshMobileSessionIfConfigured();
    if (refreshed) {
      return mobileApiFetch<T>(path, {
        ...options,
        retryOnUnauthorized: false,
      });
    }
  }

  if (!response.ok) {
    const errorMessage = await parseApiErrorMessage(response);
    logApiDiagnostic('http-error', {
      endpoint,
      status: response.status,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }

  return (readJsonSafely<JsonRecord>(text) ?? {}) as T;
}
