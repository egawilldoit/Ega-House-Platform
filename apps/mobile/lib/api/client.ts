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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function resolveFallbackApiBaseUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.extra?.expoClient?.hostUri ??
    null;

  if (!hostUri) {
    return 'http://localhost:3000';
  }

  const host = hostUri.split(':')[0];
  return `http://${host}:3000`;
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

  const response = await fetch(`${getApiBaseUrl()}/api/mobile/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: current.session.refreshToken,
    }),
  });

  if (!response.ok) {
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
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
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
    throw new Error(await parseApiErrorMessage(response));
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
