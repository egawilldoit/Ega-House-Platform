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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isExpoDevRuntime() {
  return __DEV__;
}

function resolveFallbackApiBaseUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.extra?.expoClient?.hostUri ??
    null;

  if (isExpoDevRuntime() && hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:3000`;
  }

  return DEFAULT_PRODUCTION_API_BASE_URL;
}

export function getApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  return trimTrailingSlash(envUrl || resolveFallbackApiBaseUrl());
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

  const endpoint = `${getApiBaseUrl()}/api/mobile/auth/refresh`;
  const response = await fetchMobileApi(endpoint, {
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
    await sessionHandlers.clearSession();
    sessionHandlers.onUnauthorized();
    return false;
  }

  const payload = (await response.json()) as MobileAuthRefreshResponse;
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
    const refreshed = await performRefresh();
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
