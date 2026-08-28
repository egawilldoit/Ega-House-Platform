export type UpdatesChannel = string;

export type AppUpdateInfo = {
  appVersion: string;
  runtimeVersion: string;
  updateId: string | null;
  channel: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  isEnabled: boolean;
  createdAt: string | null;
};

export type UpdateStatus =
  | 'IDLE'
  | 'CHECKING'
  | 'OTA_AVAILABLE'
  | 'DOWNLOADING'
  | 'OTA_READY'
  | 'UP_TO_DATE'
  | 'NATIVE_UPDATE_REQUIRED'
  | 'ERROR';

export type OtaCheckResult =
  | { status: 'UP_TO_DATE'; reason: string }
  | { status: 'OTA_AVAILABLE'; manifest: unknown }
  | { status: 'NATIVE_UPDATE_REQUIRED'; reason: string; latestVersion: string | null }
  | { status: 'ERROR'; error: string };

export type UpdateServiceState = {
  status: UpdateStatus;
  isChecking: boolean;
  isDownloading: boolean;
  isReady: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  availableUpdateId: string | null;
  latestNativeVersion: string | null;
  latestNativeRuntimeVersion: string | null;
  latestNativeReleaseUrl: string | null;
  latestApkUrl: string | null;
  currentUpdateId: string | null;
  appVersion: string;
  runtimeVersion: string;
  channel: string | null;
};

export type ReleaseManifest = {
  repository: string;
  gitSha: string;
  gitRef: string;
  version: string;
  variant: string;
  androidPackage: string;
  apiBaseUrl: string;
  builtAt: string;
  runner: string;
  architectures: string[];
  apkFile: string;
  apkSha256: string;
  runtimeVersion: string;
  channel: string;
};

export type NativeUpdateClassification =
  | { status: 'UP_TO_DATE'; localVersion: string; localRuntime: string; remoteVersion: string; remoteRuntime: string }
  | { status: 'NATIVE_UPDATE_REQUIRED'; localVersion: string; localRuntime: string; remoteVersion: string; remoteRuntime: string; apkUrl: string | null; reason: string; releaseUrl: string }
  | { status: 'ERROR'; error: string };
