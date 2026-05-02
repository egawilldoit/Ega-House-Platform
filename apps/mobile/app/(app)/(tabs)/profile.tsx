import Ionicons from '@expo/vector-icons/Ionicons';
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

        <GlassCard variant="fake" style={styles.menuCard} contentStyle={styles.menuCardContent}>
          {[
            { icon: 'person-outline', label: 'Account Settings' },
            { icon: 'notifications-outline', label: 'Notifications' },
            { icon: 'color-palette-outline', label: 'Appearance' },
            { icon: 'shield-checkmark-outline', label: 'Privacy' },
          ].map(({ icon, label }, index, arr) => (
            <View key={label}>
              <Pressable style={({ pressed }) => [styles.menuRow, pressed ? styles.menuRowPressed : null]}>
                <View style={styles.menuIconWrap}>
                  <Ionicons
                    name={icon as keyof typeof Ionicons.glyphMap}
                    size={18}
                    color={mobileTheme.colors.accent}
                  />
                </View>
                <Text style={styles.menuLabel}>{label}</Text>
                <Ionicons name="chevron-forward" size={16} color={mobileTheme.colors.textSubtle} />
              </Pressable>
              {index < arr.length - 1 ? <View style={styles.menuDivider} /> : null}
            </View>
          ))}
        </GlassCard>

        <GlassButton
          leftIcon={<Ionicons name="log-out-outline" size={18} color={mobileTheme.colors.textOnAccent} />}
          onPress={onLogout}
          style={styles.logoutBtn}
          title="Sign out"
          variant="danger"
        />

        <Text style={styles.versionText}>EGA House · v1.0.0</Text>
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
  menuCard: { marginBottom: 14, overflow: 'hidden' },
  menuCardContent: { padding: 0 },
  menuDivider: {
    backgroundColor: mobileTheme.colors.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
  },
  menuIconWrap: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: mobileTheme.radius.sm,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  menuLabel: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: mobileTheme.font.semibold,
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  menuRowPressed: {
    backgroundColor: mobileTheme.glass.fakeBackground,
  },
  versionText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    textAlign: 'center',
  },
});
