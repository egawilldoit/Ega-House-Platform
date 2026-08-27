import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassButton, GlassCard, GlassPill } from '@/components/mobile/glass';
import { MobileScreen, MobileScreenHeader } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';
import { useAuth } from '@/lib/auth/auth-context';

export default function ProfileScreen() {
  const { signOut, user } = useAuth();

  async function onLogout() {
    await signOut();
    router.replace('/(public)/welcome');
  }

  const initials = user?.email?.substring(0, 2).toUpperCase() ?? 'EG';

  return (
    <MobileScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MobileScreenHeader eyebrow="Account" title="Profile" />

        <GlassCard variant="fake" style={styles.avatarCard}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.avatarInfo}>
              <Text style={styles.avatarName}>EGA House</Text>
              <Text style={styles.avatarEmail}>{user?.email ?? 'Authenticated'}</Text>
            </View>
          </View>
          <View style={styles.identityFooter}>
            <GlassPill
              label="Authenticated"
              leftIcon={<Ionicons color={mobileTheme.colors.success} name="shield-checkmark-outline" size={13} />}
              tone="success"
            />
            <GlassPill
              label="Mobile workspace"
              leftIcon={<Ionicons color={mobileTheme.colors.accent} name="phone-portrait-outline" size={13} />}
              tone="primary"
            />
          </View>
        </GlassCard>

        <Pressable
          onPress={() => router.push('/(app)/settings/notifications')}
          style={({ pressed }) => [
            styles.settingsRow,
            pressed ? styles.settingsRowPressed : null,
          ]}
          accessibilityRole="button"
        >
          <View style={styles.settingsRowLeft}>
            <View style={styles.settingsIcon}>
              <Ionicons name="notifications-outline" size={18} color={mobileTheme.colors.accent} />
            </View>
            <View>
              <Text style={styles.settingsRowTitle}>Notifications</Text>
              <Text style={styles.settingsRowDesc}>Push and email reminders</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
        </Pressable>

        <GlassButton
          leftIcon={<Ionicons name="log-out-outline" size={18} color={mobileTheme.colors.textOnAccent} />}
          onPress={onLogout}
          style={styles.logoutBtn}
          title="Sign out"
          variant="danger"
        />

        <Text style={styles.versionText}>
          {`EGA House · v${Constants.expoConfig?.version ?? '1.0.0'}`}
        </Text>
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 29,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  avatarCard: { marginBottom: 14 },
  avatarEmail: { color: mobileTheme.colors.textMuted, fontSize: 13, marginTop: 2 },
  avatarInfo: { flex: 1 },
  avatarName: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: -0.2,
  },
  avatarRow: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  avatarText: { color: mobileTheme.colors.textOnAccent, fontSize: 20, fontWeight: mobileTheme.font.black },
  content: {
    paddingBottom: mobileTheme.layout.floatingTabClearance,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  identityFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  logoutBtn: {
    marginBottom: 20,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: mobileTheme.radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
    marginBottom: 14,
  },
  settingsRowPressed: { opacity: 0.7 },
  settingsRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: mobileTheme.colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsRowTitle: { fontSize: 14, fontWeight: mobileTheme.font.semibold as never, color: mobileTheme.colors.text },
  settingsRowDesc: { fontSize: 12, color: mobileTheme.colors.textMuted, marginTop: 1 },
  versionText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    textAlign: 'center',
  },
});
