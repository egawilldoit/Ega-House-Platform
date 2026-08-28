import {
  buildApkUrlFromManifest,
  checkNativeUpdateRequired,
  classifyNativeUpdate,
  compareVersions,
  isNewerVersion,
  validateManifest,
} from '../native';
import type { ReleaseManifest } from '../types';

function manifest(version: string, runtime: string, overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    repository: 'egawilldoit/Ega-House-Platform',
    gitSha: 'a'.repeat(40),
    gitRef: 'refs/tags/mobile-v1.2.3',
    version,
    variant: 'release',
    androidPackage: 'com.ega_house.mobile',
    apiBaseUrl: 'https://ega-api.egawilldoit.online',
    builtAt: new Date().toISOString(),
    runner: 'blacksmith-2vcpu-ubuntu-2404',
    architectures: ['arm64-v8a', 'x86_64'],
    apkFile: `ega-house-${version}-${'a'.repeat(7)}-release.apk`,
    apkSha256: 'deadbeef',
    runtimeVersion: runtime,
    channel: 'production',
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('compares semver correctly', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.2')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });
  it('rejects malformed versions', () => {
    expect(() => compareVersions('bad', '1.0.0')).toThrow(/malformed/);
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/malformed/);
    expect(() => compareVersions('1..0', '1.0.0')).toThrow(/malformed/);
  });
});

describe('isNewerVersion', () => {
  it('detects newer remote', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
  });
});

describe('validateManifest', () => {
  it('passes valid manifest', () => {
    expect(() => validateManifest(manifest('1.0.0', '1.0.0'))).not.toThrow();
  });
  it('fails on missing runtimeVersion', () => {
    const m = manifest('1.0.0', '1.0.0', { runtimeVersion: '' as unknown as string });
    expect(() => validateManifest(m as unknown as Record<string, unknown>)).toThrow(/runtimeVersion/);
  });
  it('fails on malformed version', () => {
    const m = manifest('bad', 'bad', { version: 'bad' });
    expect(() => validateManifest(m)).toThrow(/malformed/);
  });
  it('fails on wrong package', () => {
    const m = manifest('1.0.0', '1.0.0', { androidPackage: 'com.bad' });
    expect(() => validateManifest(m)).toThrow(/androidPackage/);
  });
});

describe('classifyNativeUpdate - blocker 5 cases', () => {
  it('Case A: remoteVersion > localVersion => NATIVE_UPDATE_REQUIRED', () => {
    const res = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.1.0', '1.1.0'));
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
    if (res.status === 'NATIVE_UPDATE_REQUIRED') {
      expect(res.remoteVersion).toBe('1.1.0');
      expect(res.reason).toMatch(/newer native version/);
    }
  });

  it('Case B: same version different runtime => NATIVE_UPDATE_REQUIRED (invariant violation)', () => {
    const res = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.0.0', '1.0.1'));
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
    if (res.status === 'NATIVE_UPDATE_REQUIRED') {
      expect(res.remoteRuntime).toBe('1.0.1');
      expect(res.reason).toMatch(/runtime mismatch/);
    }
  });

  it('Case C: same version same runtime => UP_TO_DATE (OTA check permitted)', () => {
    const res = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.0.0', '1.0.0'));
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('remote older version => UP_TO_DATE', () => {
    const res = classifyNativeUpdate('1.1.0', '1.1.0', manifest('1.0.0', '1.0.0'));
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('builds APK URL from tag ref', () => {
    const m = manifest('1.5.0', '1.5.0', { gitRef: 'refs/tags/mobile-v1.5.0' });
    const url = buildApkUrlFromManifest(m);
    expect(url).toBe('https://github.com/egawilldoit/Ega-House-Platform/releases/download/mobile-v1.5.0/ega-house-1.5.0-aaaaaaa-release.apk');
  });

  it('OTA vs native: OTA only when not native required', () => {
    const native = classifyNativeUpdate('1.0.0', '1.0.0', manifest('2.0.0', '2.0.0'));
    expect(native.status).toBe('NATIVE_UPDATE_REQUIRED');
    const shouldAttemptOta = native.status !== 'NATIVE_UPDATE_REQUIRED';
    expect(shouldAttemptOta).toBe(false);
  });

  it('OTA vs native: OTA allowed when up-to-date', () => {
    const native = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.0.0', '1.0.0'));
    expect(native.status).toBe('UP_TO_DATE');
    const shouldAttemptOta = native.status !== 'NATIVE_UPDATE_REQUIRED';
    expect(shouldAttemptOta).toBe(true);
  });

  it('local 1.0.0/1.0.0 remote 1.0.0/1.0.0 => OTA check permitted', () => {
    const res = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.0.0', '1.0.0'));
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('local 1.0.0/runtime A remote 1.0.0/runtime B => NATIVE_UPDATE_REQUIRED', () => {
    const res = classifyNativeUpdate('1.0.0', 'A', manifest('1.0.0', 'B'));
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
  });

  it('local 1.0.0/runtime 1.0.0 remote 1.1.0/runtime 1.1.0 => NATIVE_UPDATE_REQUIRED', () => {
    const res = classifyNativeUpdate('1.0.0', '1.0.0', manifest('1.1.0', '1.1.0'));
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
  });
});

describe('checkNativeUpdateRequired error handling', () => {
  it('returns ERROR on network timeout and does not classify UP_TO_DATE', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('timeout after 8000ms'));
    const res = await checkNativeUpdateRequired({ fetchImpl: fetchImpl as unknown as typeof fetch, localVersion: '1.0.0', localRuntime: '1.0.0' });
    expect(res.status).toBe('ERROR');
    if (res.status === 'ERROR') expect(res.error).toMatch(/timeout/);
  });

  it('returns ERROR on malformed manifest (fail closed)', async () => {
    const badManifest = { version: 'bad', runtimeVersion: '', repository: 'egawilldoit/Ega-House-Platform' };
    const releaseJson = {
      tag_name: 'mobile-v1.0.1',
      assets: [{ name: 'release-manifest.json', browser_download_url: 'https://example.com/manifest.json' }],
    };
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.includes('api.github.com')) {
        return Promise.resolve({ ok: true, json: async () => releaseJson } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => badManifest } as Response);
    });
    const res = await checkNativeUpdateRequired({ fetchImpl: fetchImpl as unknown as typeof fetch, localVersion: '1.0.0', localRuntime: '1.0.0' });
    expect(res.status).toBe('ERROR');
  });
});
