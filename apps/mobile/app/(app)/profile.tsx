import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';
import { useAuth } from '@/lib/auth/auth-context';

export default function ProfileStackScreen() {
  const { signOut, user } = useAuth();

  async function onLogout() {
    await signOut();
    router.replace('/(public)/welcome');
  }

  const initials = user?.email?.substring(0, 2).toUpperCase() ?? 'EG';
  const email = user?.email ?? null;

  return (
    <AppScreen padded={false} testID="profile-screen">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          eyebrow="Account"
          title="Profile"
          description={email ? `Authenticated as ${email}` : 'Authenticated'}
        />

        <Card style={styles.avatarCard} testID="profile-identity-card">
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.avatarInfo}>
              <Text style={styles.avatarName}>EGA House</Text>
              <Text style={styles.avatarEmail}>{email ?? 'Authenticated'}</Text>
            </View>
          </View>
          <View style={styles.identityFooter}>
            <View style={[styles.pill, styles.pillSuccess]}>
              <Ionicons color={mobileTheme.colors.success} name="shield-checkmark-outline" size={13} />
              <Text style={[styles.pillText, { color: mobileTheme.colors.success }]}>Authenticated</Text>
            </View>
            <View style={[styles.pill, styles.pillPrimary]}>
              <Ionicons color={mobileTheme.colors.accent} name="phone-portrait-outline" size={13} />
              <Text style={[styles.pillText, { color: mobileTheme.colors.accent }]}>Mobile workspace</Text>
            </View>
          </View>
        </Card>

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
  avatarCard: {
    marginTop: mobileTheme.spacing.sm,
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
  identityFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.md,
  },
  pill: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillPrimary: {
    backgroundColor: mobileTheme.colors.infoBg,
  },
  pillSuccess: {
    backgroundColor: mobileTheme.colors.successBg,
  },
  pillText: {
    fontSize: 12,
    fontWeight: mobileTheme.font.bold,
  },
  versionText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: mobileTheme.spacing.md,
    textAlign: 'center',
  },
});
