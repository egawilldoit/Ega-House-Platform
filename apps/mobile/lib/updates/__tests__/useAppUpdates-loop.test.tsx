import * as React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.2',
      runtimeVersion: { policy: 'appVersion' },
      extra: { eas: { projectId: '0dafbb64-7c1e-49b1-aea1-de1f8159a5e6' } },
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue({ type: 'opened' }),
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/mobile/navigation/bottomChrome', () => ({
  useBottomChromeMetrics: () => ({ contentBottomPaddingNoFab: 0 }),
}));

import { createUpdateService } from '../service';
import { useUpdateService } from '../useAppUpdates';
import * as Native from '../native';
import { UpdatesScreenContent } from '../../../features/updates/UpdatesScreen';

jest.mock('../native', () => ({
  ...jest.requireActual('../native'),
  checkNativeUpdateRequired: jest.fn(),
}));

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

describe('useUpdateService render loop regression', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (global as unknown as { __DEV__: boolean }).__DEV__ = false;
    (Native.checkNativeUpdateRequired as jest.Mock).mockResolvedValue({
      status: 'UP_TO_DATE',
      localVersion: '1.0.2',
      localRuntime: '1.0.2',
      remoteVersion: '1.0.2',
      remoteRuntime: '1.0.2',
    });
  });

  it('does not enter Maximum update depth exceeded loop', async () => {
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }),
    });
    const svc = createUpdateService({ updates: updates as never, constants: makeConstants() as never });

    let renderCount = 0;
    function Probe() {
      renderCount += 1;
      const { status } = useUpdateService(svc);
      return React.createElement('Text', null, status);
    }

    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(React.createElement(Probe));
    });

    const initialRenders = renderCount;
    // getState stability: multiple calls should not trigger rerenders
    expect(svc.getState()).toBe(svc.getState());
    // Force a few ticks to ensure no loop
    await act(async () => {
      // No mutation, should not cause extra renders
      await new Promise((res) => setTimeout(res, 10));
    });
    // Render count should be stable (initial + maybe 1 for mount), not infinite
    expect(renderCount).toBe(initialRenders);
    expect(renderCount).toBeLessThan(5);

    // Now trigger a mutation and ensure it causes exactly one rerender
    renderCount = 0;
    let probe2Renders = 0;
    function Probe2() {
      probe2Renders += 1;
      const { status } = useUpdateService(svc);
      return React.createElement('Text', null, status);
    }
    let comp2: ReturnType<typeof create>;
    await act(async () => {
      comp2 = create(React.createElement(Probe2));
    });
    const beforeCheckRenders = probe2Renders;
    await act(async () => {
      const p = svc.check();
      // svc.check synchronously sets CHECKING and notifies, should cause one rerender
      await p;
    });
    // After check, should have rerendered but not looped
    expect(probe2Renders).toBeGreaterThan(beforeCheckRenders);
    expect(probe2Renders).toBeLessThan(beforeCheckRenders + 5);
    expect(svc.getState().status).toBe('UP_TO_DATE');
  });

  it('UpdatesScreen does not loop', async () => {
    const svc = createUpdateService({ updates: makeUpdates() as never, constants: makeConstants() as never });
    jest.spyOn(require('../service'), 'getUpdateService').mockReturnValue(svc as never);

    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(React.createElement(UpdatesScreenContent));
    });
    expect(component!.toJSON()).toBeTruthy();
    const s1 = svc.getState();
    const s2 = svc.getState();
    expect(s1).toBe(s2);
  });
});
