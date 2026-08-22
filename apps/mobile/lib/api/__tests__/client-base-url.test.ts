/**
 * Diagnostic-failure guarantee for the mobile API base URL.
 *
 * Wrong API configuration must fail LOUDLY:
 *  - an invalid EXPO_PUBLIC_API_BASE_URL throws a precise error before any
 *    request is attempted (dev and release);
 *  - a missing EXPO_PUBLIC_API_BASE_URL falls back to the production default
 *    with a one-time console.warn in dev AND release builds.
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

  it('falls back to the production default when unset, without throwing', () => {
    expect(resolveApiBaseUrl({}, {}, false)).toEqual({
      url: 'https://www.egawilldoit.online',
      source: 'production-default',
    });
  });
});

describe('getApiBaseUrl fallback diagnostics', () => {
  it('warns once in release builds (isDev=false) when falling back', () => {
    setDevMode(false);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    getApiBaseUrl();
    getApiBaseUrl();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(
      /\[mobile-api\] no EXPO_PUBLIC_API_BASE_URL set; falling back to production default https:\/\/www\.egawilldoit\.online\. This is a release build/,
    );
  });

  it('still warns in dev builds (isDev=true) without the release hint', () => {
    setDevMode(true);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    getApiBaseUrl();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toMatch(/\[mobile-api\] no EXPO_PUBLIC_API_BASE_URL set; falling back to production default/);
    expect(message).not.toMatch(/release build/);
  });
});
