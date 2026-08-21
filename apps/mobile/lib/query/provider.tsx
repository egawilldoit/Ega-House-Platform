import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { getMobileQueryClient } from '@/lib/query/query-client';

export function MobileQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getMobileQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
