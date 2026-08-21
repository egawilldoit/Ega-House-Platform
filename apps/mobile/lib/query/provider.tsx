import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { connectFocusManagerToAppState } from '@/lib/lifecycle/focus-manager';
import { getMobileQueryClient } from '@/lib/query/query-client';

export function MobileQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getMobileQueryClient);

  useEffect(() => {
    const subscription = connectFocusManagerToAppState(AppState);
    return () => subscription.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
