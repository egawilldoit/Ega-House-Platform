import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBottomChromeMetrics } from '@/components/mobile/navigation/bottomChrome';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { useAuth } from '@/lib/auth/auth-context';

export default function ProfileStackScreen() {
  const { contentBottomPaddingNoFab } = useBottomChromeMetrics();
  const { signOut, user } = useAuth();

  async function onLogout() {
    await signOut();
    router.replace('/(public)/welcome');
  }

  const initials = user?.email?.substring(0, 2).toUpperCase() ?? 'EG';
  const email = user?.email ?? null;

  return (
    <AppScreen padded={false} testID="profile-screen">
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: contentBottomPaddingNoFab }]} showsVerticalScrollIndicator={false}>
        <ScreenHeader eyebrow="Account" title="Profile" />

        <Card style={styles.identityCard} testID="profile-identity-card">
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.avatarInfo}>
              <Text style={styles.avatarName}>EGA House</Text>
              <Text style={styles.avatarEmail} numberOfLines={1}>
                {email ?? '—'}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailsList}>
            <View style={styles.detailRow}>
              <Ionicons color={mobileTheme.colors.textSubtle} name="mail-outline" size={16} />
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>Email</Text>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {email ?? 'Not signed in'}
                </Text>
              </View>
            </View>

            <View style={[styles.detailRow, styles.detailRowBorder]}>
              <Ionicons color={mobileTheme.colors.success} name="shield-checkmark-outline" size={16} />
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>Session</Text>
                <Text style={styles.detailValue}>Authenticated session</Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Ionicons color={mobileTheme.colors.accent} name="phone-portrait-outline" size={16} />
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>Workspace</Text>
                <Text style={styles.detailValue}>Mobile</Text>
              </View>
            </View>
          </View>
        </Card>

        <Pressable
          onPress={() => router.push('/(app)/settings/notifications')}
          style={({ pressed }: { pressed: boolean }) => [styles.notificationCard, pressed ? styles.pressed : null]}
          accessibilityRole="button"
        >
          <Card style={styles.notificationInner}>
            <View style={styles.notificationRow}>
              <View style={styles.notificationIcon}>
                <Ionicons name="notifications-outline" size={18} color={mobileTheme.colors.accent} />
              </View>
              <View style={styles.notificationCopy}>
                <Text style={styles.notificationTitle}>Notifications</Text>
                <Text style={styles.notificationDesc}>Push and email reminders</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
            </View>
          </Card>
        </Pressable>

        <Card style={styles.actionCard} testID="profile-actions-card">
          <View style={styles.actionRow}>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>Sign out</Text>
              <Text style={styles.actionHint}>End current session on this device</Text>
            </View>
            <Button
              title="Sign out"
              variant="danger"
              size="sm"
              leftIcon={<Ionicons color={mobileTheme.colors.textOnAccent} name="log-out-outline" size={16} />}
              onPress={onLogout}
              testID="profile-sign-out"
            />
          </View>
        </Card>

        <Link href="/(app)/updates" asChild>
          <Pressable testID="profile-updates-link">
            <Card style={styles.updatesCard} testID="profile-updates-card">
              <View style={styles.updatesRow}>
                <View style={styles.updatesIcon}>
                  <Ionicons name="cloud-download-outline" size={18} color={mobileTheme.colors.accent} />
                </View>
                <View style={styles.updatesCopy}>
                  <Text style={styles.updatesTitle}>App Updates</Text>
                  <Text style={styles.updatesHint} numberOfLines={2}>
                    OTA TEST #2 · v1.0.3 · LIVE
                  </Text>
                  <Text style={styles.updatesMeta} testID="profile-version-channel">
                    {`v${Constants.expoConfig?.version ?? '1.0.0'} · ${(Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ? 'EAS' : 'standalone'}`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
              </View>
            </Card>
          </Pressable>
        </Link>

        <Text style={styles.versionText} testID="profile-version">{`EGA House · v${Constants.expoConfig?.version ?? '1.0.0'}`}</Text>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  actionCopy: {
    flex: 1,
    marginRight: mobileTheme.spacing.md,
  },
  actionHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.bold,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 29,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  avatarEmail: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  avatarInfo: {
    flex: 1,
  },
  avatarName: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
  avatarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  avatarText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 20,
    fontWeight: mobileTheme.font.black,
  },
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  detailCopy: {
    flex: 1,
    gap: 1,
  },
  detailLabel: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  detailRowBorder: {
    borderBottomColor: mobileTheme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: mobileTheme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailsList: {
    gap: 0,
  },
  divider: {
    backgroundColor: mobileTheme.colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: mobileTheme.spacing.md,
  },
  identityCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  versionText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: mobileTheme.spacing.md,
    textAlign: 'center',
  },
  notificationCard: { marginTop: mobileTheme.spacing.sm },
  notificationInner: { padding: 0 },
  notificationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: mobileTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationCopy: { flex: 1, gap: 1 },
  notificationTitle: { fontSize: 14, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.text },
  notificationDesc: { fontSize: 12, color: mobileTheme.colors.textMuted },
  pressed: { opacity: 0.7 },
  updatesCard: {
    marginTop: mobileTheme.spacing.sm,
  },
  updatesCopy: {
    flex: 1,
  },
  updatesHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 2,
  },
  updatesIcon: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.primaryContainer,
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  updatesMeta: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.semibold,
    marginTop: 4,
  },
  updatesRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  updatesTitle: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: mobileTheme.font.bold,
  },
});
