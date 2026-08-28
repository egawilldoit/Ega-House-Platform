import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
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
  const { status, isChecking, isDownloading, error, lastCheckedAt, check, download, reload, info } =
    useUpdateService(svc);
  const [nativeInfo, setNativeInfo] = useState<{ version: string | null; url: string | null }>({
    version: null,
    url: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchLatestReleaseManifest } = await import('@/lib/updates/native');
        const manifest = await fetchLatestReleaseManifest().catch(() => null);
        if (!cancelled && manifest) {
          const { buildApkUrlFromManifest } = await import('@/lib/updates/native');
          setNativeInfo({ version: manifest.version, url: buildApkUrlFromManifest(manifest) });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const onCheck = useCallback(async () => {
    await check();
  }, [check]);

  const onDownload = useCallback(async () => {
    await download();
  }, [download]);

  const onRestart = useCallback(async () => {
    await reload().catch(() => {});
  }, [reload]);

  const onOpenRelease = useCallback(async () => {
    const url = nativeInfo.url ?? getGithubReleasesUrl();
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url);
    }
  }, [nativeInfo.url]);

  const showDownload = status === 'OTA_AVAILABLE';
  const showRestart = status === 'OTA_READY';
  const showNative = status === 'NATIVE_UPDATE_REQUIRED';
  const showError = status === 'ERROR';

  return (
    <AppScreen padded={false} testID="updates-screen">
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentBottomPaddingNoFab }]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader eyebrow="Settings" title="App Updates" description="Over-the-air updates and native release status" />

        <Card testID="updates-info-card">
          <Text style={styles.cardTitle}>Installed</Text>
          <View style={styles.metaList}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>App version</Text>
              <Text style={styles.metaValue} testID="updates-app-version">{info.appVersion}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Runtime version</Text>
              <Text style={styles.metaValue} numberOfLines={1} testID="updates-runtime-version">
                {info.runtimeVersion || '—'}
              </Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Channel</Text>
              <Text style={styles.metaValue} testID="updates-channel">{info.channel ?? '—'}</Text>
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
                message={`A new native app version is required${nativeInfo.version ? ` (${nativeInfo.version})` : ''}. OTA cannot apply native/runtime changes. Please install the latest APK from the official GitHub Release.`}
                tone="warning"
                testID="updates-native-required"
              />
              <Text style={styles.nativeHint}>
                Native changes include Expo SDK upgrades, native dependencies, config plugins, or permissions.
              </Text>
            </View>
          ) : null}
          {showError ? (
            <FeedbackBanner message={error ?? 'Update check failed. Check your connection and retry.'} tone="danger" testID="updates-error" />
          ) : null}

          {lastCheckedAt ? <Text style={styles.lastChecked}>Last checked: {new Date(lastCheckedAt).toLocaleString()}</Text> : null}

          <View style={styles.actions}>
            {showRestart ? (
              <Button
                title="Restart & update"
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
                title="Open releases page"
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
            {(status === 'UP_TO_DATE' || status === 'ERROR' || status === 'IDLE') && !showNative ? (
              <Text style={styles.retryHint}>Retry is safe — checks are rate-limited and never poll aggressively.</Text>
            ) : null}
          </View>
        </Card>

        <Card variant="tonal" tone="low" testID="updates-help-card">
          <Text style={styles.helpTitle}>How updates work</Text>
          <Text style={styles.helpText}>
            Compatible JS and asset updates are delivered over-the-air via EAS Update. Incompatible native/runtime changes
            require a new APK from GitHub Releases. OTA is never attempted when a native update is required.
          </Text>
          <Text style={styles.helpText}>Flow: Checking → Update available → Downloading → Ready → Restart & update → Updated.</Text>
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
