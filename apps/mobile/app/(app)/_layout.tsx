import { Redirect, Slot } from 'expo-router';

import { useAuth } from '@/lib/auth/auth-context';

export default function ProtectedLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Redirect href="/(public)/welcome" />;
  }

  return <Slot />;
}
