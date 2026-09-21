import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';
import { hasCompletedOnboarding } from '@/lib/storage/onboarding';

export default function IndexScreen() {
  const { isAuthenticated, isReady } = useAuth();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    hasCompletedOnboarding()
      .then((complete) => {
        if (!cancelled) setOnboardingComplete(complete);
      })
      .catch(() => {
        if (!cancelled) setOnboardingComplete(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isReady || onboardingComplete === null) {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/today" />;
  }

  if (!onboardingComplete) {
    return <Redirect href="/(public)/onboarding" />;
  }

  return <Redirect href="/(public)/welcome" />;
}
