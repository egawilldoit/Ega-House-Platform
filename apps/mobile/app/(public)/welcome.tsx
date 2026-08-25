import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mobileTheme } from '@/components/mobile/theme';

export default function WelcomeScreen() {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <View pointerEvents="none" style={styles.bgCircle1} />
        <View pointerEvents="none" style={styles.bgCircle2} />

        <View style={styles.content}>
          <View accessibilityRole="image" style={styles.logoMark}>
            <Ionicons name="flash" size={32} color={mobileTheme.colors.textOnAccent} />
          </View>

          <Text accessibilityRole="text" style={styles.brand}>
            EGA House
          </Text>
          <Text accessibilityRole="header" style={styles.tagline}>
            {`Your execution\ncommand center`}
          </Text>
          <Text style={styles.subtitle}>
            Tasks, focus sessions, and daily momentum - all in one place.
          </Text>
        </View>

        <View style={styles.footer}>
          <Link href="/(public)/login" asChild>
            <Pressable
              accessibilityLabel="Get started"
              accessibilityRole="button"
              style={({ pressed }) => [styles.primaryBtn, pressed ? styles.primaryBtnPressed : null]}
            >
              <Text style={styles.primaryBtnText}>Get started</Text>
              <Ionicons name="arrow-forward" size={18} color={mobileTheme.colors.textOnAccent} />
            </Pressable>
          </Link>
          <Text style={styles.legalText}>Sign in with your EGA House account</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bgCircle1: {
    backgroundColor: mobileTheme.colors.authCircleBlue,
    borderRadius: 160,
    height: 320,
    position: 'absolute',
    right: -80,
    top: -80,
    width: 320,
  },
  bgCircle2: {
    backgroundColor: mobileTheme.colors.authCirclePurple,
    borderRadius: 100,
    bottom: 80,
    height: 200,
    left: -60,
    position: 'absolute',
    width: 200,
  },
  brand: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 16,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 2,
    marginBottom: 16,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  container: {
    backgroundColor: mobileTheme.colors.authBackground,
    flex: 1,
    justifyContent: 'space-between',
    padding: mobileTheme.spacing.xl,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 60,
  },
  footer: {
    gap: 14,
    paddingBottom: 12,
  },
  legalText: {
    color: mobileTheme.colors.authTextSubtle,
    fontSize: 12,
    textAlign: 'center',
  },
  logoMark: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.card,
    height: 68,
    justifyContent: 'center',
    marginBottom: 28,
    width: 68,
    ...mobileTheme.shadow.fab,
  },
  primaryBtn: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 18,
    ...mobileTheme.shadow.fab,
  },
  primaryBtnPressed: {
    opacity: 0.88,
  },
  primaryBtnText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 17,
    fontWeight: mobileTheme.font.black,
  },
  safeArea: {
    backgroundColor: mobileTheme.colors.authBackground,
    flex: 1,
  },
  subtitle: {
    color: mobileTheme.colors.authTextMuted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 280,
  },
  tagline: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 44,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1.5,
    lineHeight: 50,
    marginBottom: 18,
  },
});
