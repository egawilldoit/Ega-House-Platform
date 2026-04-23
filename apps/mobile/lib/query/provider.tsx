import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { createMobileQueryClient } from '@/lib/query/query-client';

export function MobileQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createMobileQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
