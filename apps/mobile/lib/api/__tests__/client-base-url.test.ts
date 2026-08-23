/**
 * Diagnostic-failure guarantee for the mobile API base URL.
 *
 * Wrong API configuration must fail LOUDLY:
 *  - an invalid EXPO_PUBLIC_API_BASE_URL throws a precise error before any
 *    request is attempted (dev and release);
 *  - a release build WITHOUT EXPO_PUBLIC_API_BASE_URL fails deterministically
 *    with an actionable error instead of silently targeting a default host
 *    (TASK 2 policy: no unsafe production fallback in release builds);
 *  - a release build with an HTTP or local-only EXPO_PUBLIC_API_BASE_URL is
 *    rejected because such origins cannot serve as production API endpoints;
 *  - a dev build may still fall back to the default host with a one-time
 *    console.warn so local experimentation stays convenient.
 */
import {
  getApiBaseUrl,
  resolveApiBaseUrl,
  resetApiBaseUrlDiagnosticsForTesting,
} from '@/lib/api/client';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_BASE_URL;
const ORIGINAL_DEV = (globalThis as { __DEV__?: boolean }).__DEV__;

function setDevMode(isDev: boolean) {
  (globalThis as { __DEV__?: boolean }).__DEV__ = isDev;
}

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL_ENV;
  }
  setDevMode(ORIGINAL_DEV ?? true);
  resetApiBaseUrlDiagnosticsForTesting();
  jest.restoreAllMocks();
});

describe('resolveApiBaseUrl diagnostic failure guarantee', () => {
  it('throws a precise error when EXPO_PUBLIC_API_BASE_URL has no scheme', () => {
    expect(() =>
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'api.example.com' }, {}, false),
    ).toThrow(/EXPO_PUBLIC_API_BASE_URL "api\.example\.com" is not a usable API base URL/);
  });

  it('throws a precise error for an unsupported scheme', () => {
    expect(() =>
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'ftp://api.example.com' }, {}, true),
    ).toThrow(/"ftp:\/\/api\.example\.com" is not a usable API base URL/);
  });

  it('accepts valid http(s) origins and trims trailing slashes', () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/' }, {}, false)).toEqual({
      url: 'https://api.example.com',
      source: 'env',
    });
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'http://10.0.2.2:3000' }, {}, true)).toEqual({
      url: 'http://10.0.2.2:3000',
      source: 'env',
    });
  });

  it('throws a deterministic error in release when EXPO_PUBLIC_API_BASE_URL is unset', () => {
    expect(() => resolveApiBaseUrl({}, {}, false)).toThrow(
      /\[mobile-api\] EXPO_PUBLIC_API_BASE_URL is not set\. Release builds must set EXPO_PUBLIC_API_BASE_URL/,
    );
  });

  it('rejects plain HTTP origins in release builds', () => {
    expect(() =>
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com' }, {}, false),
    ).toThrow(
      /\[mobile-api\] EXPO_PUBLIC_API_BASE_URL "http:\/\/api\.example\.com" uses HTTP\. Release builds require an HTTPS/,
    );
  });

  it('rejects localhost origins in release builds', () => {
    expect(() =>
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3000' }, {}, false),
    ).toThrow(/EXPO_PUBLIC_API_BASE_URL "http:\/\/localhost:3000" targets a local-only host/);
  });

  it('rejects private-network origins in release builds', () => {
    expect(() =>
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'https://10.0.2.2:3000' }, {}, false),
    ).toThrow(/EXPO_PUBLIC_API_BASE_URL "https:\/\/10\.0\.2\.2:3000" targets a local-only host/);
  });

  it('resolves the Expo dev host in dev when no env var is set', () => {
    expect(
      resolveApiBaseUrl({}, { expoConfig: { hostUri: '192.168.1.5:8081' } }, true),
    ).toEqual({
      url: 'http://192.168.1.5:3000',
      source: 'dev-host',
    });
  });
});

describe('getApiBaseUrl diagnostics', () => {
  it('fails deterministically in release builds (isDev=false) when unset', () => {
    setDevMode(false);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => getApiBaseUrl()).toThrow(
      /\[mobile-api\] EXPO_PUBLIC_API_BASE_URL is not set\. Release builds must set EXPO_PUBLIC_API_BASE_URL/,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('still falls back with a one-time warn in dev builds (isDev=true)', () => {
    setDevMode(true);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    getApiBaseUrl();
    getApiBaseUrl();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toMatch(/\[mobile-api\] no EXPO_PUBLIC_API_BASE_URL set; falling back to production default/);
    expect(message).not.toMatch(/release build/);
  });
});
