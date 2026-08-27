import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { GlassCard } from '@/components/mobile/glass';
import { MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { useNotificationPreferencesQuery, useUpdatePreferenceMutation } from '@/features/notifications/query';
import { useNotifications } from '@/lib/notifications/provider';

export default function NotificationSettingsScreen() {
  const prefsQuery = useNotificationPreferencesQuery();
  const update = useUpdatePreferenceMutation();
  const { permissionStatus, refreshPermission } = useNotifications();
  const [updating, setUpdating] = useState<string | null>(null);

  const pref = prefsQuery.data?.preferences.find((p) => p.notificationType === 'task_reminder') ?? null;
  const pushEnabled = pref?.pushEnabled ?? true;
  const emailEnabled = pref?.emailEnabled ?? true;

  const onToggle = useCallback(
    async (field: 'pushEnabled' | 'emailEnabled', value: boolean) => {
      const key = field === 'pushEnabled' ? 'push' : 'email';
      setUpdating(key);
      try {
        await update.mutateAsync({
          notificationType: 'task_reminder',
          pushEnabled: field === 'pushEnabled' ? value : pushEnabled,
          emailEnabled: field === 'emailEnabled' ? value : emailEnabled,
        });
      } finally {
        setUpdating(null);
      }
    },
    [pushEnabled, emailEnabled, update],
  );

  if (prefsQuery.isPending) {
    return (
      <MobileScreen>
        <View style={styles.centered}>
          <ActivityIndicator color={mobileTheme.colors.accent} />
          <Text style={styles.subtitle}>Loading preferences…</Text>
        </View>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MobileScreenHeader eyebrow="Settings" title="Notifications" description="Choose how you receive task reminders" />

        <GlassCard variant="fake" style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <View style={styles.rowTitleRow}>
                <Ionicons name="phone-portrait-outline" size={16} color={mobileTheme.colors.textMuted} />
                <Text style={styles.rowTitle}>Push notifications</Text>
              </View>
              <Text style={styles.rowDesc}>Receive reminders on this device</Text>
              <View style={styles.permissionRow}>
                <Ionicons name={permissionStatus === 'granted' ? 'checkmark-circle' : 'alert-circle-outline'} size={14} color={permissionStatus === 'granted' ? mobileTheme.colors.success : mobileTheme.colors.warning} />
                <Text style={[styles.permissionText, permissionStatus === 'granted' ? styles.permissionGranted : null]}>
                  {permissionStatus === 'granted' ? 'Allowed in system settings' : permissionStatus === 'denied' ? 'Blocked in system settings' : 'Not yet requested'}
                </Text>
                {permissionStatus !== 'granted' ? (
                  <Pressable onPress={() => Linking.openSettings()}>
                    <Text style={styles.openSettings}>Open settings</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {updating === 'push' ? <ActivityIndicator size="small" /> : <Switch value={pushEnabled} onValueChange={(v) => onToggle('pushEnabled', v)} />}
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <View style={styles.rowText}>
              <View style={styles.rowTitleRow}>
                <Ionicons name="mail-outline" size={16} color={mobileTheme.colors.textMuted} />
                <Text style={styles.rowTitle}>Email notifications</Text>
              </View>
              <Text style={styles.rowDesc}>Receive reminders by email</Text>
            </View>
            {updating === 'email' ? <ActivityIndicator size="small" /> : <Switch value={emailEnabled} onValueChange={(v) => onToggle('emailEnabled', v)} />}
          </View>

          <View style={styles.hintBox}>
            <Text style={styles.hintTitle}>How it works</Text>
            <Text style={styles.hintText}>
              Choose Push, Email or Both when you schedule a reminder. Push requires system permission and a registered device. Email works immediately.
            </Text>
          </View>
        </GlassCard>

        <GlassCard variant="fake" style={styles.card}>
          <Text style={styles.cardTitle}>Device status</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>OS permission</Text>
            <Text style={[styles.statusValue, permissionStatus === 'granted' ? styles.statusValueGranted : null]}>{permissionStatus}</Text>
          </View>
          <Pressable onPress={() => refreshPermission()} style={styles.refreshBtn}>
            <Text style={styles.refreshText}>Refresh status</Text>
          </Pressable>
        </GlassCard>
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: mobileTheme.layout.floatingTabClearance, paddingHorizontal: mobileTheme.spacing.lg, paddingTop: mobileTheme.spacing.sm, gap: 14 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', gap: 12, padding: 24 },
  subtitle: { color: mobileTheme.colors.textMuted, fontSize: 13 },
  card: { gap: 0 },
  cardTitle: { fontSize: 14, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.text, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 12 },
  rowText: { flex: 1, gap: 4 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 14, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.text },
  rowDesc: { fontSize: 12, color: mobileTheme.colors.textMuted },
  permissionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  permissionText: { fontSize: 12, color: mobileTheme.colors.textSubtle },
  permissionGranted: { color: mobileTheme.colors.success },
  openSettings: { fontSize: 12, color: mobileTheme.colors.accent, fontWeight: mobileTheme.font.semibold as never },
  divider: { height: 1, backgroundColor: mobileTheme.colors.border, marginVertical: 2 },
  hintBox: { backgroundColor: mobileTheme.colors.surfaceMuted, borderRadius: 12, padding: 12, marginTop: 12, gap: 4 },
  hintTitle: { fontSize: 12, fontWeight: mobileTheme.font.bold as never, color: mobileTheme.colors.text },
  hintText: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 16 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  statusLabel: { fontSize: 13, color: mobileTheme.colors.textMuted },
  statusValue: { fontSize: 13, color: mobileTheme.colors.textSubtle, textTransform: 'capitalize', fontWeight: mobileTheme.font.semibold as never },
  statusValueGranted: { color: mobileTheme.colors.success },
  refreshBtn: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: mobileTheme.colors.surfaceMuted, borderRadius: 10 },
  refreshText: { fontSize: 12, color: mobileTheme.colors.accent, fontWeight: mobileTheme.font.semibold as never },
});
