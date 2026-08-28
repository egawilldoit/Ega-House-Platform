import { classifyNativeUpdate, compareVersions, buildApkUrlFromManifest, isNewerVersion } from '../native';
import type { ReleaseManifest } from '../types';

function manifest(version: string, overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    repository: 'egawilldoit/Ega-House-Platform',
    gitSha: 'abc1234567890abc1234567890abc1234567890abcd',
    gitRef: 'refs/tags/mobile-v1.2.3',
    version,
    variant: 'release',
    androidPackage: 'com.ega_house.mobile',
    apiBaseUrl: 'https://ega-api.egawilldoit.online',
    builtAt: new Date().toISOString(),
    runner: 'blacksmith-2vcpu-ubuntu-2404',
    architectures: ['arm64-v8a', 'x86_64'],
    apkFile: `ega-house-${version}-abc1234-release.apk`,
    apkSha256: 'deadbeef',
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
});

describe('isNewerVersion', () => {
  it('detects newer remote', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
  });
});

describe('classifyNativeUpdate', () => {
  it('returns UP_TO_DATE when manifest is null', () => {
    const res = classifyNativeUpdate('1.0.0', null);
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('returns NATIVE_UPDATE_REQUIRED when remote newer', () => {
    const res = classifyNativeUpdate('1.0.0', manifest('1.0.1'));
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
    if (res.status === 'NATIVE_UPDATE_REQUIRED') {
      expect(res.remoteVersion).toBe('1.0.1');
      expect(res.apkUrl).toContain('ega-house-1.0.1');
    }
  });

  it('returns UP_TO_DATE when remote same', () => {
    const res = classifyNativeUpdate('1.0.0', manifest('1.0.0'));
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('returns UP_TO_DATE when remote older', () => {
    const res = classifyNativeUpdate('1.1.0', manifest('1.0.0'));
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('builds APK URL from tag ref', () => {
    const m = manifest('1.5.0', { gitRef: 'refs/tags/mobile-v1.5.0' });
    const url = buildApkUrlFromManifest(m);
    expect(url).toBe('https://github.com/egawilldoit/Ega-House-Platform/releases/download/mobile-v1.5.0/ega-house-1.5.0-abc1234-release.apk');
  });

  it('OTA vs native classification: OTA only when not native required', () => {
    const local = '1.0.0';
    const otaAvailable = true;
    const native = classifyNativeUpdate(local, manifest('2.0.0'));
    expect(native.status).toBe('NATIVE_UPDATE_REQUIRED');
    // OTA must not be attempted when native required
    const shouldAttemptOta = native.status !== 'NATIVE_UPDATE_REQUIRED' && otaAvailable;
    expect(shouldAttemptOta).toBe(false);
  });

  it('OTA vs native: OTA allowed when up-to-date', () => {
    const native = classifyNativeUpdate('1.0.0', manifest('1.0.0'));
    const otaAvailable = true;
    const shouldAttemptOta = native.status !== 'NATIVE_UPDATE_REQUIRED' && otaAvailable;
    expect(shouldAttemptOta).toBe(true);
  });
});
