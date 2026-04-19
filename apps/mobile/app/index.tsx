import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth/auth-context';

export default function IndexScreen() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/tasks" />;
  }

  return <Redirect href="/(public)/welcome" />;
}
