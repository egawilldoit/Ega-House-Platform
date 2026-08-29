import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { FeedbackBanner } from '@/components/mobile/ui/FeedbackBanner';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { getGithubReleasesUrl } from '@/lib/updates/native';
import { useUpdateService } from '@/lib/updates/useAppUpdates';
import { getUpdateService } from '@/lib/updates/service';
import type { UpdateStatus } from '@/lib/updates/types';

function statusLabel(status: UpdateStatus): string {
  switch (status) {
    case 'IDLE':
      return 'Idle';
    case 'CHECKING':
      return 'Checking…';
    case 'OTA_AVAILABLE':
      return 'Update available';
    case 'DOWNLOADING':
      return 'Downloading…';
    case 'OTA_READY':
      return 'Ready to restart';
    case 'UP_TO_DATE':
      return 'Up to date';
    case 'NATIVE_UPDATE_REQUIRED':
      return 'New app version required';
    case 'ERROR':
      return 'Error';
    default:
      return status;
  }
}

function statusTone(status: UpdateStatus): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'UP_TO_DATE':
      return 'success';
    case 'OTA_AVAILABLE':
    case 'DOWNLOADING':
    case 'CHECKING':
      return 'info';
    case 'OTA_READY':
      return 'warning';
    case 'NATIVE_UPDATE_REQUIRED':
      return 'warning';
    case 'ERROR':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function UpdatesScreenContent() {
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const svc = getUpdateService();
  const {
    status,
    isChecking,
    isDownloading,
    error,
    lastCheckedAt,
    check,
    download,
    reload,
    info,
    latestNativeVersion,
    latestNativeRuntimeVersion,
    latestApkUrl,
    latestNativeReleaseUrl,
    appVersion,
    runtimeVersion,
    channel,
    downloadedUpdateReady,
  } = useUpdateService(svc) as ReturnType<typeof useUpdateService> & {
    latestNativeVersion: string | null;
    latestNativeRuntimeVersion: string | null;
    latestApkUrl: string | null;
    latestNativeReleaseUrl: string | null;
    appVersion: string;
    runtimeVersion: string;
    channel: string | null;
    downloadedUpdateReady: boolean;
  };

  const onCheck = useCallback(async () => {
    await check();
  }, [check]);

  const onDownload = useCallback(async () => {
    await download();
  }, [download]);

  const onRestart = useCallback(async () => {
    try {
      await reload();
    } catch {
      // error is surfaced via service state (ERROR with retryable message)
    }
  }, [reload]);

  const onOpenRelease = useCallback(async () => {
    const url = latestApkUrl ?? latestNativeReleaseUrl ?? getGithubReleasesUrl();
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url);
    }
  }, [latestApkUrl, latestNativeReleaseUrl]);

  const showDownload = status === 'OTA_AVAILABLE';
  const showRestart = status === 'OTA_READY' || (downloadedUpdateReady && status === 'ERROR' && error?.includes('Unable to restart'));
  const showNative = status === 'NATIVE_UPDATE_REQUIRED';
  const isNativeUnavailable = status === 'ERROR' && error?.includes('native release status unavailable');
  const isReloadError = status === 'ERROR' && error?.includes('Unable to restart');

  return (
    <AppScreen padded={false} testID="updates-screen">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPaddingNoFab }]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader eyebrow="Settings" title="App Updates" description="OTA TEST #2 · v1.0.3 · LIVE — production" />

        <Card testID="updates-info-card">
          <Text style={styles.cardTitle}>Installed</Text>
          <View style={styles.metaList}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>App version</Text>
              <Text style={styles.metaValue} testID="updates-app-version">{appVersion}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Runtime version</Text>
              <Text style={styles.metaValue} numberOfLines={1} testID="updates-runtime-version">
                {runtimeVersion || '—'}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Channel</Text>
              <Text style={styles.metaValue} testID="updates-channel">{channel ?? '—'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Update ID</Text>
              <Text style={styles.metaValue} numberOfLines={1} testID="updates-update-id">
                {info.updateId ? `${info.updateId.slice(0, 12)}…` : 'embedded'}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Launch</Text>
              <Text style={styles.metaValue}>{info.isEmbeddedLaunch ? 'embedded' : 'update'}</Text>
            </View>
          </View>
        </Card>

        <Card testID="updates-status-card">
          <View style={styles.statusHeader}>
            <Text style={styles.cardTitle}>Status</Text>
            <View style={[styles.badge, toneStyle(statusTone(status)).badge]}>
              <Text style={[styles.badgeText, toneStyle(statusTone(status)).text]}>{statusLabel(status)}</Text>
            </View>
          </View>

          {status === 'IDLE' ? (
            <Text style={styles.hint}>Tap “Check for updates” to see if a compatible OTA update is available.</Text>
          ) : null}
          {status === 'CHECKING' ? <Text style={styles.hint}>Checking for a compatible update…</Text> : null}
          {status === 'DOWNLOADING' ? <Text style={styles.hint}>Downloading update… keep the app open.</Text> : null}
          {status === 'UP_TO_DATE' ? (
            <FeedbackBanner message="You’re up to date. No compatible OTA update found." tone="success" testID="updates-up-to-date" />
          ) : null}
          {status === 'OTA_AVAILABLE' ? (
            <FeedbackBanner message="A compatible OTA update is available. Download when ready." tone="info" />
          ) : null}
          {status === 'OTA_READY' ? (
            <FeedbackBanner message="Update downloaded and ready. Restart to apply." tone="warning" />
          ) : null}
          {showNative ? (
            <View style={styles.nativeBlock}>
              <FeedbackBanner
                message={`New app version required — Installed: ${appVersion}${latestNativeVersion ? ` · Available: ${latestNativeVersion}` : ''}${latestNativeRuntimeVersion && latestNativeRuntimeVersion !== latestNativeVersion ? ` (runtime ${latestNativeRuntimeVersion})` : ''}. A full APK update is required.`}
                tone="warning"
                testID="updates-native-required"
              />
              <Text style={styles.nativeHint}>
                Native changes include Expo SDK upgrades, native dependencies, config plugins, or permissions.
              </Text>
            </View>
          ) : null}
          {status === 'ERROR' ? (
            <FeedbackBanner
              message={
                isNativeUnavailable
                  ? "Couldn't verify the latest app version. Check your connection and retry."
                  : (error ?? 'Update check failed. Check your connection and retry.')
              }
              tone="danger"
              testID="updates-error"
            />
          ) : null}

          {lastCheckedAt ? <Text style={styles.lastChecked}>Last checked: {new Date(lastCheckedAt).toLocaleString()}</Text> : null}

          <View style={styles.actions}>
            {showRestart ? (
              <Button
                title={isReloadError ? 'Retry restart' : 'Restart & update'}
                onPress={onRestart}
                leftIcon={<Ionicons name="refresh" size={16} color={mobileTheme.colors.textOnAccent} />}
                testID="updates-restart"
              />
            ) : showDownload ? (
              <Button
                title={isDownloading ? 'Downloading…' : 'Download update'}
                onPress={onDownload}
                loading={isDownloading}
                disabled={isDownloading}
                leftIcon={<Ionicons name="download-outline" size={16} color={mobileTheme.colors.textOnAccent} />}
                testID="updates-download"
              />
            ) : showNative ? (
              <Button
                title="Open official release"
                variant="secondary"
                onPress={onOpenRelease}
                leftIcon={<Ionicons name="open-outline" size={16} color={mobileTheme.colors.text} />}
                testID="updates-open-release"
              />
            ) : (
              <Button
                title={isChecking ? 'Checking…' : 'Check for updates'}
                onPress={onCheck}
                loading={isChecking}
                disabled={isChecking || isDownloading}
                leftIcon={<Ionicons name="sync" size={16} color={mobileTheme.colors.textOnAccent} />}
                testID="updates-check"
              />
            )}
            {isReloadError ? (
              <FeedbackBanner message="Unable to restart and apply update. Retry restart." tone="danger" />
            ) : null}
            {(status === 'UP_TO_DATE' || status === 'ERROR' || status === 'IDLE') && !showNative && !isReloadError ? (
              <Text style={styles.retryHint}>Retry is safe — checks are rate-limited and never poll aggressively.</Text>
            ) : null}
          </View>
        </Card>

        <Card variant="tonal" tone="low" testID="updates-help-card">
          <Text style={styles.helpTitle}>How updates work</Text>
          <Text style={styles.helpText}>
            Compatible JS and asset updates are delivered over-the-air via EAS Update on the production channel.
            Incompatible native/runtime changes require a new APK from GitHub Releases. OTA is never attempted when a
            native update is required.
          </Text>
          <Text style={styles.helpText}>Flow: Checking → Update available → Downloading → Ready → Restart & update → Updated. OTA TEST #2 · v1.0.3 · LIVE</Text>
        </Card>
      </ScrollView>
    </AppScreen>
  );
}

function toneStyle(tone: string) {
  switch (tone) {
    case 'success':
      return { badge: { backgroundColor: mobileTheme.colors.successContainer }, text: { color: mobileTheme.colors.onSuccessContainer } };
    case 'warning':
      return { badge: { backgroundColor: mobileTheme.colors.warningContainer }, text: { color: mobileTheme.colors.onWarningContainer } };
    case 'danger':
      return { badge: { backgroundColor: mobileTheme.colors.dangerContainer }, text: { color: mobileTheme.colors.onDangerContainer } };
    case 'info':
      return { badge: { backgroundColor: mobileTheme.colors.infoContainer }, text: { color: mobileTheme.colors.onInfoContainer } };
    default:
      return { badge: { backgroundColor: mobileTheme.colors.neutralContainer }, text: { color: mobileTheme.colors.onNeutralContainer } };
  }
}

const styles = StyleSheet.create({
  actions: {
    gap: 10,
    marginTop: mobileTheme.spacing.md,
  },
  badge: {
    borderRadius: mobileTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
  },
  cardTitle: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 0.1,
  },
  content: {
    gap: mobileTheme.spacing.md,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  helpText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  helpTitle: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  hint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  lastChecked: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 8,
  },
  metaLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    width: 130,
  },
  metaList: {
    gap: 8,
    marginTop: 12,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaValue: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    textAlign: 'right',
  },
  nativeBlock: {
    gap: 8,
    marginTop: 6,
  },
  nativeHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    lineHeight: 15,
  },
  retryHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
