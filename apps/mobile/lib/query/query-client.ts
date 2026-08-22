import { QueryClient } from '@tanstack/react-query';

export function createMobileQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let mobileQueryClient: QueryClient | null = null;

export function getMobileQueryClient(): QueryClient {
  if (!mobileQueryClient) {
    mobileQueryClient = createMobileQueryClient();
  }

  return mobileQueryClient;
}

export function clearMobileQueryCache() {
  getMobileQueryClient().clear();
}
