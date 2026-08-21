/**
 * Tests for explicit API base URL resolution (lib/api/client.ts):
 * precedence order, trailing-slash trimming, empty-env handling,
 * dev-only production-fallback warning, singleton binding of the
 * resolved URL, and token-free diagnostics.
 */
import {
  configureMobileApiClient,
  getApiBaseUrl,
  mobileApiFetch,
  resolveApiBaseUrl,
} from '@/lib/api/client';
import { getMobileEgaApiClient, setMobileEgaApiClientForTesting } from '@/lib/api/ega';

const ENV_KEY = 'EXPO_PUBLIC_API_BASE_URL';

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

function freshClientModule() {
  let mod: typeof import('@/lib/api/client');
  jest.isolateModules(() => {
    mod = require('@/lib/api/client');
  });
  return mod!;
}

describe('resolveApiBaseUrl', () => {
  const PROD_DEFAULT = 'https://www.egawilldoit.online';

  it('prefers EXPO_PUBLIC_API_BASE_URL over the dev hostUri', () => {
    const resolved = resolveApiBaseUrl(
      { EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com' },
      { expoConfig: { hostUri: '192.168.1.5:8081' } },
      true,
    );
    expect(resolved).toEqual({ url: 'https://api.example.com', source: 'env' });
  });

  it('uses the Expo dev hostUri on port 3000 only in dev', () => {
    const devResolved = resolveApiBaseUrl(
      {},
      { expoConfig: { hostUri: '192.168.1.5:8081' } },
      true,
    );
    expect(devResolved).toEqual({ url: 'http://192.168.1.5:3000', source: 'dev-host' });

    const releaseResolved = resolveApiBaseUrl(
      {},
      { expoConfig: { hostUri: '192.168.1.5:8081' } },
      false,
    );
    expect(releaseResolved).toEqual({ url: PROD_DEFAULT, source: 'production-default' });
  });

  it('falls back to manifest2 hostUri then to the production default', () => {
    const fromManifest = resolveApiBaseUrl(
      {},
      { manifest2: { extra: { expoClient: { hostUri: '10.0.2.2:19000' } } } },
      true,
    );
    expect(fromManifest).toEqual({ url: 'http://10.0.2.2:3000', source: 'dev-host' });

    const noHost = resolveApiBaseUrl({}, {}, true);
    expect(noHost).toEqual({ url: PROD_DEFAULT, source: 'production-default' });
  });

  it('trims trailing slashes from every resolved URL', () => {
    expect(
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com///' }, {}, true).url,
    ).toBe('https://api.example.com');
    expect(
      resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com/' }, {}, false).url,
    ).toBe('https://api.example.com');
  });

  it('treats empty or whitespace-only env values as unset', () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: '' }, {}, true)).toEqual({
      url: PROD_DEFAULT,
      source: 'production-default',
    });
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_BASE_URL: '   ' }, {}, false)).toEqual({
      url: PROD_DEFAULT,
      source: 'production-default',
    });
  });

  it('trims whitespace around a set env value', () => {
    const resolved = resolveApiBaseUrl(
      { EXPO_PUBLIC_API_BASE_URL: '  https://api.example.com  ' },
      {},
      true,
    );
    expect(resolved).toEqual({ url: 'https://api.example.com', source: 'env' });
  });
});

describe('getApiBaseUrl production-default warning', () => {
  afterEach(() => {
    setEnv(undefined);
    jest.restoreAllMocks();
  });

  it('warns once in dev when falling back to the production default', () => {
    setEnv(undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = freshClientModule();

    mod.getApiBaseUrl();
    mod.getApiBaseUrl();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('https://www.egawilldoit.online');
    expect(String(warnSpy.mock.calls[0][0])).toContain(ENV_KEY);
  });

  it('never warns when EXPO_PUBLIC_API_BASE_URL is set', () => {
    setEnv('https://api.example.com');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = freshClientModule();

    expect(mod.getApiBaseUrl()).toBe('https://api.example.com');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('never warns in release builds even on production fallback', () => {
    setEnv(undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    const globalWithDev = globalThis as { __DEV__?: boolean };
    globalWithDev.__DEV__ = false;

    try {
      const mod = freshClientModule();
      expect(mod.getApiBaseUrl()).toBe('https://www.egawilldoit.online');
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      globalWithDev.__DEV__ = originalDev;
    }
  });
});

describe('singleton binds the resolved base URL', () => {
  afterEach(() => {
    setEnv(undefined);
    setMobileEgaApiClientForTesting(null);
    jest.restoreAllMocks();
  });

  it('builds requests against the resolved env URL', async () => {
    setEnv('https://env-resolved.example.com/');
    setMobileEgaApiClientForTesting(null);

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    } as unknown as Response);

    await getMobileEgaApiClient().health();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://env-resolved.example.com/health',
      expect.anything(),
    );
  });

  it('keeps returning the same bound client across calls', () => {
    setMobileEgaApiClientForTesting(null);
    expect(getMobileEgaApiClient()).toBe(getMobileEgaApiClient());
  });
});

describe('diagnostics never contain token values', () => {
  afterEach(() => {
    setEnv(undefined);
    jest.restoreAllMocks();
  });

  it('network-error diagnostics expose endpoint and base URL source but no tokens', async () => {
    setEnv('https://diag.example.com');
    const accessToken = 'secret-access-token-value';
    const refreshToken = 'secret-refresh-token-value';

    configureMobileApiClient({
      getSession: async () => ({
        session: { accessToken, refreshToken, expiresAt: 9999999999 },
        user: { id: 'user-1', email: 'user@example.com' },
      }),
      setSession: async () => {},
      clearSession: async () => {},
      onUnauthorized: () => {},
    });

    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(mobileApiFetch('/api/mobile/tasks')).rejects.toThrow();

    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain(accessToken);
    expect(logged).not.toContain(refreshToken);
    expect(logged).toContain('https://diag.example.com/api/mobile/tasks');
    expect(logged).toContain('apiBaseUrlSource');
    expect(logged).toContain('"env"');
  });
});
