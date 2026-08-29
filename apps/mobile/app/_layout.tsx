import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';
import SpaceMono from '../assets/fonts/SpaceMono-Regular.ttf';

import { useColorScheme } from '@/components/useColorScheme';
import { mobileTheme } from '@/components/mobile/theme';
import { AuthProvider } from '@/lib/auth/auth-context';
import { MobileQueryProvider } from '@/lib/query/provider';
import { recoverLatestUpdate } from '@/lib/updates/recovery';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  const onRecover = useCallback(async () => {
    if (recovering) return;

    setRecovering(true);
    setRecoveryMessage(null);
    try {
      const result = await recoverLatestUpdate();
      if (result === 'NO_UPDATE') {
        setRecoveryMessage('No newer update is available yet. Retry the screen or install the latest APK.');
      } else if (result === 'UPDATES_DISABLED') {
        setRecoveryMessage('OTA recovery is unavailable in this build. Install the latest APK.');
      }
    } catch (recoveryError) {
      const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      setRecoveryMessage(`Update recovery failed: ${message}`);
    } finally {
      setRecovering(false);
    }
  }, [recovering]);

  const onRetry = useCallback(async () => {
    setRecoveryMessage(null);
    await retry();
  }, [retry]);

  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.message}>{error.message}</Text>
      {recoveryMessage ? <Text style={errorStyles.recoveryMessage}>{recoveryMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={recovering}
        onPress={onRecover}
        style={[errorStyles.primaryButton, recovering && errorStyles.disabledButton]}
      >
        <Text style={errorStyles.primaryButtonText}>{recovering ? 'Checking for a fix…' : 'Recover latest update'}</Text>
      </Pressable>

      <Pressable accessibilityRole="button" disabled={recovering} onPress={onRetry} style={errorStyles.secondaryButton}>
        <Text style={errorStyles.secondaryButtonText}>Retry screen</Text>
      </Pressable>
    </View>
  );
}

export const unstable_settings = {
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono,
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <MobileQueryProvider>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar backgroundColor={mobileTheme.colors.background} style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(public)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </ThemeProvider>
      </AuthProvider>
    </MobileQueryProvider>
  );
}

const errorStyles = StyleSheet.create({
  container: {
    backgroundColor: '#0b0b0b',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  disabledButton: {
    opacity: 0.6,
  },
  message: {
    color: '#f4f4f4',
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 20,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#f4f4f4',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '700',
  },
  recoveryMessage: {
    color: '#f5c26b',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#f4f4f4',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: 12,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#f4f4f4',
    fontSize: 16,
    fontWeight: '700',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
});
