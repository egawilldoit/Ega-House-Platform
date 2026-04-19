import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

export default function IndexScreen() {
  const { isAuthenticated, isReady } = useAuth();

  if (!isReady) {
    return (
      <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/tasks" />;
  }

  return <Redirect href="/(public)/welcome" />;
}
