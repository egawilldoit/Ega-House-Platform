import * as React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.1',
      runtimeVersion: { policy: 'appVersion' },
      extra: { eas: { projectId: '73d127b6-c8f6-450c-8d97-2dca8434cd59' } },
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

const mockState: {
  status: import('@/lib/updates/types').UpdateStatus;
  isChecking: boolean;
  isDownloading: boolean;
  isReady: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  availableUpdateId: string | null;
  latestNativeVersion: string | null;
  latestNativeRuntimeVersion: string | null;
  latestApkUrl: string | null;
  latestNativeReleaseUrl: string | null;
  appVersion: string;
  runtimeVersion: string;
  channel: string | null;
  downloadedUpdateReady: boolean;
  info: {
    appVersion: string;
    runtimeVersion: string;
    updateId: string | null;
    channel: string | null;
    isEmbeddedLaunch: boolean;
    isEmergencyLaunch: boolean;
    isEnabled: boolean;
    createdAt: string | null;
  };
  check: jest.Mock;
  download: jest.Mock;
  reload: jest.Mock;
} = {
  status: 'IDLE',
  isChecking: false,
  isDownloading: false,
  isReady: false,
  error: null,
  lastCheckedAt: null,
  availableUpdateId: null,
  latestNativeVersion: null,
  latestNativeRuntimeVersion: null,
  latestApkUrl: null,
  latestNativeReleaseUrl: null,
  appVersion: '1.0.1',
  runtimeVersion: '1.0.1',
  channel: 'production',
  downloadedUpdateReady: false,
  info: {
    appVersion: '1.0.1',
    runtimeVersion: '1.0.1',
    updateId: null,
    channel: 'production',
    isEmbeddedLaunch: true,
    isEmergencyLaunch: false,
    isEnabled: true,
    createdAt: null,
  },
  check: jest.fn().mockResolvedValue({ status: 'UP_TO_DATE' }),
  download: jest.fn().mockResolvedValue({ status: 'OTA_READY' }),
  reload: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/lib/updates/useAppUpdates', () => ({
  useUpdateService: jest.fn(() => mockState),
  useAppUpdateInfo: jest.fn(() => mockState.info),
}));

jest.mock('@/lib/updates/service', () => ({
  getUpdateService: jest.fn(() => ({})),
}));

jest.mock('@/lib/updates/native', () => ({
  fetchLatestReleaseManifest: jest.fn().mockResolvedValue(null),
  buildApkUrlFromManifest: jest.fn().mockReturnValue(null),
  getGithubReleasesUrl: jest.fn().mockReturnValue('https://github.com/egawilldoit/Ega-House-Platform/releases'),
}));

import { UpdatesScreenContent } from '../UpdatesScreen';

function findText(component: ReturnType<typeof create>, text: string) {
  const json = component.toJSON();
  if (!json) return false;
  return JSON.stringify(json).includes(text);
}

describe('UpdatesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.status = 'IDLE';
    mockState.isChecking = false;
    mockState.error = null;
    mockState.downloadedUpdateReady = false;
  });

  it('renders installed version and channel', async () => {
    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(<UpdatesScreenContent />);
    });
    expect(findText(component!, 'App version')).toBe(true);
    expect(findText(component!, 'production')).toBe(true);
  });

  it('shows Check for updates button in IDLE', async () => {
    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(<UpdatesScreenContent />);
    });
    expect(findText(component!, 'Check for updates')).toBe(true);
  });

  it('shows native required state correctly', async () => {
    mockState.status = 'NATIVE_UPDATE_REQUIRED';
    mockState.latestNativeVersion = '1.0.2';
    mockState.latestApkUrl = 'https://example.com/apk';
    mockState.appVersion = '1.0.1';
    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(<UpdatesScreenContent />);
    });
    expect(findText(component!, 'New app version required')).toBe(true);
    expect(findText(component!, 'Open official release')).toBe(true);
  });

  it('surfaces error state', async () => {
    mockState.status = 'ERROR';
    mockState.error = 'offline: Network request failed';
    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(<UpdatesScreenContent />);
    });
    expect(findText(component!, 'offline')).toBe(true);
  });

  it('shows Retry restart when reload fails and downloaded update is ready', async () => {
    mockState.status = 'ERROR';
    mockState.error = 'Unable to restart and apply update: reload failed';
    mockState.downloadedUpdateReady = true;
    let component: ReturnType<typeof create>;
    await act(async () => {
      component = create(<UpdatesScreenContent />);
    });
    expect(findText(component!, 'Retry restart')).toBe(true);
    expect(findText(component!, 'Unable to restart')).toBe(true);
  });
});
