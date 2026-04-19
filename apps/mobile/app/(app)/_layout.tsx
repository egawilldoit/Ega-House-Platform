import { Redirect, Slot } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

export default function ProtectedLayout() {
  const { isAuthenticated, isReady } = useAuth();

  if (!isReady) {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(public)/welcome" />;
  }

  return <Slot />;
}
