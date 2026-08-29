/**
 * @jest-environment node
 */
import { createUpdateService } from '../service';
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
    runtimeVersion: '1.0.2',
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

function makeConstants(version = '1.0.2') {
  return {
    expoConfig: { version, extra: { eas: { projectId: 'test' } } },
  } as unknown as typeof import('expo-constants').default;
}

describe('store snapshot stability (fix for Maximum update depth exceeded)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  });

  it('getState() === getState() when no mutation occurred', () => {
    const svc = createUpdateService({ updates: makeUpdates() as never, constants: makeConstants() as never });
    const a = svc.getState();
    const b = svc.getState();
    expect(a).toBe(b);
  });

  it('after mutation oldSnapshot !== newSnapshot and newSnapshot === getState() until next mutation', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.2', localRuntime: '1.0.2', remoteVersion: '1.0.2', remoteRuntime: '1.0.2' });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }) });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    const before = svc.getState();
    expect(before.status).toBe('IDLE');
    const beforeAgain = svc.getState();
    expect(before).toBe(beforeAgain);

    const promise = svc.check();
    // check sets CHECKING synchronously before awaiting
    const checking = svc.getState();
    expect(checking.status).toBe('CHECKING');
    expect(checking).not.toBe(before);
    const checkingAgain = svc.getState();
    expect(checking).toBe(checkingAgain);

    await promise;
    const after = svc.getState();
    expect(after.status).toBe('UP_TO_DATE');
    expect(after).not.toBe(checking);
    expect(after).not.toBe(before);
    const afterAgain = svc.getState();
    expect(after).toBe(afterAgain);
  });

  it('multiple getState calls without mutation remain stable', () => {
    const svc = createUpdateService({ updates: makeUpdates() as never, constants: makeConstants() as never });
    const s1 = svc.getState();
    const s2 = svc.getState();
    const s3 = svc.getState();
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  it('notify only after snapshot is committed (subscribe receives new snapshot)', async () => {
    mockCheckNative.mockResolvedValue({ status: 'UP_TO_DATE', localVersion: '1.0.2', localRuntime: '1.0.2', remoteVersion: '1.0.2', remoteRuntime: '1.0.2' });
    const updates = makeUpdates({ checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }) });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });
    const snapshots: unknown[] = [];
    const unsub = svc.subscribe(() => {
      snapshots.push(svc.getState());
    });
    const before = svc.getState();
    await svc.check();
    // should have notified twice: CHECKING and UP_TO_DATE
    expect(snapshots.length).toBe(2);
    expect(snapshots[0]).not.toBe(before);
    expect((snapshots[0] as { status: string }).status).toBe('CHECKING');
    expect((snapshots[1] as { status: string }).status).toBe('UP_TO_DATE');
    // latest snapshot is stable
    expect(snapshots[1]).toBe(svc.getState());
    unsub();
  });
});
