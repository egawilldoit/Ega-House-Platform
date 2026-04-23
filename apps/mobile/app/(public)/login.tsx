import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { useAuth } from '@/lib/auth/auth-context';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginScreen() {
  const { signIn, error: authError, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onLogin() {
    clearError();
    const trimmedEmail = email.trim();

    if (!isValidEmail(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      await signIn(trimmedEmail, password);
      router.replace('/(app)/(tabs)/tasks');
    } catch (signInError) {
      const message =
        signInError instanceof Error ? signInError.message : 'Login failed. Try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.bgCircle1} />
      <View style={styles.bgCircle2} />

      <Pressable onPress={() => router.replace('/(public)/welcome')} style={styles.backButton}>
        <Ionicons name="chevron-back" size={22} color={mobileTheme.colors.textOnAccent} />
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.title}>Login</Text>

        <View style={styles.inputRow}>
          <Ionicons name="mail-outline" size={18} color={mobileTheme.colors.authTextSubtle} />
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            editable={!isSubmitting}
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              if (error) {
                setError('');
              }
            }}
            placeholder="Email"
            placeholderTextColor={mobileTheme.colors.authTextSubtle}
            style={styles.input}
            value={email}
          />
        </View>

        <View style={styles.inputRow}>
          <Ionicons name="lock-closed-outline" size={18} color={mobileTheme.colors.authTextSubtle} />
          <TextInput
            autoCapitalize="none"
            editable={!isSubmitting}
            onChangeText={(value) => {
              setPassword(value);
              if (error) {
                setError('');
              }
            }}
            placeholder="Password"
            placeholderTextColor={mobileTheme.colors.authTextSubtle}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>

        <Text style={styles.errorText}>{error || authError || ' '}</Text>

        <Pressable disabled={isSubmitting} onPress={onLogin} style={styles.button}>
          {isSubmitting ? (
            <ActivityIndicator color={mobileTheme.colors.textOnAccent} />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.overlayLight,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    left: mobileTheme.spacing.lg,
    position: 'absolute',
    top: 64,
    width: 40,
  },
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
  button: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    marginTop: 4,
    minHeight: 52,
    justifyContent: 'center',
    ...mobileTheme.shadow.fab,
  },
  buttonText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 16,
    fontWeight: mobileTheme.font.black,
  },
  card: {
    backgroundColor: mobileTheme.colors.authSurface,
    borderColor: mobileTheme.colors.authBorderSoft,
    borderRadius: 24,
    borderWidth: 1,
    padding: mobileTheme.spacing.lg,
    width: '100%',
  },
  container: {
    backgroundColor: mobileTheme.colors.authBackground,
    flex: 1,
    justifyContent: 'center',
    padding: mobileTheme.spacing.xl,
  },
  errorText: {
    color: mobileTheme.colors.dangerMid,
    minHeight: 20,
  },
  input: {
    color: mobileTheme.colors.textOnAccent,
    flex: 1,
    fontSize: 15,
    paddingVertical: 12,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.authSurfaceMuted,
    borderColor: mobileTheme.colors.authBorder,
    borderRadius: mobileTheme.radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: mobileTheme.spacing.sm,
    paddingHorizontal: 14,
  },
  title: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 28,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.8,
    marginBottom: mobileTheme.spacing.lg,
    textAlign: 'center',
  },
});
