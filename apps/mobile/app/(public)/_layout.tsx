import { Redirect, Slot } from 'expo-router';

import { useAuth } from '@/lib/auth/auth-context';

export default function PublicLayout() {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/tasks" />;
  }

  return <Slot />;
}
