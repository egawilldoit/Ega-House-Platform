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
  runtimeVersion?: string;
  channel?: string;
};

export type NativeUpdateClassification =
  | { status: 'UP_TO_DATE'; localVersion: string; remoteVersion: string | null }
  | { status: 'NATIVE_UPDATE_REQUIRED'; localVersion: string; remoteVersion: string; apkUrl: string | null }
  | { status: 'ERROR'; error: string };
