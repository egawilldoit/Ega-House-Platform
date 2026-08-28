/**
 * @jest-environment node
 */
import { checkForUpdate, downloadUpdate, getAppUpdateInfo, createUpdateService } from '../service';
import * as Native from '../native';

jest.mock('../native', () => ({
  ...jest.requireActual('../native'),
  checkNativeUpdateRequired: jest.fn(),
}));

const mockCheckNative = Native.checkNativeUpdateRequired as jest.MockedFunction<typeof Native.checkNativeUpdateRequired>;

function makeUpdates(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isEnabled: true,
    channel: 'production',
    runtimeVersion: '1.0.0',
    updateId: 'embedded-abc',
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    createdAt: null,
    checkForUpdateAsync: jest.fn(),
    fetchUpdateAsync: jest.fn(),
    reloadAsync: jest.fn(),
    ...overrides,
  } as unknown as import('../service').UpdatesModule;
}

function makeConstants(version = '1.0.0') {
  return {
    expoConfig: { version, runtimeVersion: { policy: 'fingerprint' }, extra: { eas: { projectId: 'test' } } },
  } as unknown as typeof import('expo-constants').default;
}

describe('getAppUpdateInfo', () => {
  it('exposes version/runtime/channel/updateId', () => {
    const updates = makeUpdates({ updateId: 'update-123', channel: 'preview', runtimeVersion: 'rv-1' });
    const constants = makeConstants('1.2.3');
    const info = getAppUpdateInfo({ updates: updates as never, constants: constants as never });
    expect(info.appVersion).toBe('1.2.3');
    expect(info.runtimeVersion).toBe('rv-1');
    expect(info.channel).toBe('preview');
    expect(info.updateId).toBe('update-123');
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  });

  it('returns UP_TO_DATE when updates disabled', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ isEnabled: false });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('returns NATIVE_UPDATE_REQUIRED when native newer', async () => {
    mockCheckNative.mockResolvedValue({
      status: 'NATIVE_UPDATE_REQUIRED',
      localVersion: '1.0.0',
      remoteVersion: '2.0.0',
      apkUrl: 'https://example.com/apk',
    });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }) });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('NATIVE_UPDATE_REQUIRED');
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('returns OTA_AVAILABLE when check finds update', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: '1.0.0' });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true, manifest: { id: 'u1' } }) });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('OTA_AVAILABLE');
  });

  it('returns UP_TO_DATE when no update available', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }) });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('UP_TO_DATE');
  });

  it('returns ERROR on network failure', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockRejectedValue(new Error('Network request failed')) });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('ERROR');
    expect(res.error).toMatch(/offline/i);
  });

  it('returns ERROR on timeout', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn(() => new Promise(() => {})),
    });
    const res = await checkForUpdate({ updates: updates as never, constants: makeConstants() as never }, { timeoutMs: 10 });
    expect(res.status).toBe('ERROR');
    expect(res.error).toMatch(/timeout/i);
  });
});

describe('downloadUpdate', () => {
  it('downloads and returns OTA_READY', async () => {
    const updates = makeUpdates({ fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }) });
    const res = await downloadUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('OTA_READY');
  });

  it('returns ERROR on fetch network failure', async () => {
    const updates = makeUpdates({ fetchUpdateAsync: jest.fn().mockRejectedValue(new Error('timeout after 30000ms')) });
    const res = await downloadUpdate({ updates: updates as never, constants: makeConstants() as never });
    expect(res.status).toBe('ERROR');
    expect(res.error).toMatch(/offline|timeout/i);
  });
});

describe('createUpdateService state machine', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  });

  it('transitions CHECKING -> OTA_AVAILABLE', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }) });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    expect(svc.getState().status).toBe('IDLE');
    const p = svc.check();
    expect(svc.getState().isChecking).toBe(true);
    expect(svc.getState().status).toBe('CHECKING');
    await p;
    expect(svc.getState().status).toBe('OTA_AVAILABLE');
    expect(svc.getState().isChecking).toBe(false);
  });

  it('transitions DOWNLOADING -> OTA_READY', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
      fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }),
    });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    await svc.check();
    const p = svc.download();
    expect(svc.getState().status).toBe('DOWNLOADING');
    await p;
    expect(svc.getState().status).toBe('OTA_READY');
  });

  it('handles error state and retry', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockRejectedValue(new Error('Network failed')) });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    let res = await svc.check();
    expect(res.status).toBe('ERROR');
    expect(svc.getState().status).toBe('ERROR');
    expect(svc.getState().error).toMatch(/offline/i);
    // retry succeeds
    (updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({ isAvailable: false });
    res = await svc.check();
    expect(res.status).toBe('UP_TO_DATE');
    expect(svc.getState().error).toBeNull();
  });

  it('reload only after OTA_READY', async () => {
    const updates1 = makeUpdates({ reloadAsync: jest.fn().mockResolvedValue(undefined) });
    const svc = createUpdateService({ updates: updates1 as never, constants: makeConstants() as never });
    await expect(svc.reload()).rejects.toThrow(/no downloaded update/i);
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates2 = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
      fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }),
      reloadAsync: jest.fn().mockResolvedValue(undefined),
    });
    const svc2 = createUpdateService({ updates: updates2 as never, constants: makeConstants() as never });
    await svc2.check();
    await svc2.download();
    await expect(svc2.reload()).resolves.toBeUndefined();
    expect(updates2.reloadAsync).toHaveBeenCalled();
  });

  it('exposes checking/downloading/ready/error states', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.0', remoteVersion: null });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }) });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    let state = svc.getState();
    expect(state.status).toBe('IDLE');
    expect(state.isChecking).toBe(false);
    expect(state.isReady).toBe(false);
    await svc.check();
    state = svc.getState();
    expect(state.status).toBe('OTA_AVAILABLE');
  });
});
