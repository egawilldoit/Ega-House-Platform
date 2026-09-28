import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { fetchMobileTimeContext, setMobileTimezone } from '@/lib/api/time-context';

jest.mock('@/lib/api/time-context', () => ({
  fetchMobileTimeContext: jest.fn(),
  setMobileTimezone: jest.fn(),
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

import TimezoneSettingsScreen from '../timezone';

const mockFetch = fetchMobileTimeContext as unknown as jest.Mock;
const mockSet = setMobileTimezone as unknown as jest.Mock;

type TimeContextResponse = {
  ok: boolean;
  timeContext?: { timezone?: string | null; fallback?: string | null } | null;
};

function mockDeviceTimezone(zone: string | undefined) {
  const Original = Intl.DateTimeFormat;
  const MockDateTimeFormat = function () {
    return {
      resolvedOptions: () => ({ timeZone: zone }),
      format: () => '',
    };
  };
  Object.defineProperty(Intl, 'DateTimeFormat', {
    value: MockDateTimeFormat,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(Intl, 'DateTimeFormat', {
      value: Original,
      configurable: true,
      writable: true,
    });
  };
}

function renderScreen() {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(<TimezoneSettingsScreen />);
  });
  return renderer!;
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

function findAllByTestID(component: ReactTestRenderer, testID: string) {
  return component.root.findAll((node) => node.props?.testID === testID);
}

function findPressableByTestID(component: ReactTestRenderer, testID: string) {
  return component.root.findAll(
    (node) => node.props?.testID === testID && typeof node.props?.onPress === 'function',
  );
}

function textOf(component: ReactTestRenderer, testID: string) {
  const nodes = findAllByTestID(component, testID);
  const texts = nodes.flatMap((node) =>
    node.children
      ?.filter((child): child is string => typeof child === 'string')
      .map((child) => child as string) ?? [],
  );
  return texts.join(' ');
}

describe('TimezoneSettingsScreen', () => {
  let restoreIntl: (() => void) | null = null;

  beforeEach(() => {
    mockFetch.mockReset();
    mockSet.mockReset();
  });

  afterEach(() => {
    restoreIntl?.();
    restoreIntl = null;
  });

  it('loads the account timezone and shows the device timezone', async () => {
    restoreIntl = mockDeviceTimezone('Africa/Casablanca');
    const response: TimeContextResponse = {
      ok: true,
      timeContext: { timezone: 'Africa/Casablanca', fallback: 'none' },
    };
    mockFetch.mockResolvedValue(response);

    const component = renderScreen();
    await flushAsync();

    expect(textOf(component, 'ega-timezone-value')).toBe('Africa/Casablanca');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(findPressableByTestID(component, 'use-device-timezone')).toHaveLength(0);
  });

  it('offers Use device timezone when the device zone differs from the account zone', async () => {
    restoreIntl = mockDeviceTimezone('Asia/Tokyo');
    mockFetch.mockResolvedValue({
      ok: true,
      timeContext: { timezone: 'Africa/Casablanca', fallback: 'none' },
    });
    mockSet.mockResolvedValue({ ok: true });

    const component = renderScreen();
    await flushAsync();

    const buttons = findPressableByTestID(component, 'use-device-timezone');
    expect(buttons.length).toBeGreaterThan(0);

    await act(async () => {
      buttons[0]?.props.onPress();
      await Promise.resolve();
    });

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('Asia/Tokyo');
  });

  it('submits a manually entered IANA timezone', async () => {
    restoreIntl = mockDeviceTimezone('Africa/Casablanca');
    mockFetch.mockResolvedValue({
      ok: true,
      timeContext: { timezone: 'Africa/Casablanca', fallback: 'none' },
    });
    mockSet.mockResolvedValue({ ok: true });

    const component = renderScreen();
    await flushAsync();

    const input = findAllByTestID(component, 'timezone-manual-input')[0];
    expect(input).toBeDefined();

    await act(async () => {
      input?.props.onChangeText('America/New_York');
      await Promise.resolve();
    });

    const submit = findPressableByTestID(component, 'timezone-manual-submit')[0];
    expect(submit).toBeDefined();

    await act(async () => {
      submit?.props.onPress();
      await Promise.resolve();
    });

    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith('America/New_York');
  });

  it('shows an error when the timezone save fails', async () => {
    restoreIntl = mockDeviceTimezone('Africa/Casablanca');
    mockFetch.mockResolvedValue({
      ok: true,
      timeContext: { timezone: 'Africa/Casablanca', fallback: 'none' },
    });
    mockSet.mockRejectedValue(new Error('server rejected the zone'));

    const component = renderScreen();
    await flushAsync();

    const quickPick = findPressableByTestID(component, 'timezone-quick-Asia/Tokyo')[0];
    expect(quickPick).toBeDefined();

    await act(async () => {
      quickPick?.props.onPress();
      await Promise.resolve();
    });

    const errors = findAllByTestID(component, 'timezone-error');
    expect(errors.length).toBeGreaterThan(0);
    expect(textOf(component, 'timezone-error')).toContain('Could not save that timezone');
  });
});
