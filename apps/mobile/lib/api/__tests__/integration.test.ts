/**
 * Integration tests for the mobile API seam.
 *
 * Only `global.fetch` is stubbed. Everything between the rendered query hook
 * and the network boundary is real: TanStack Query, `useTodayWorkspaceQuery`,
 * `fetchMobileToday`, the @ega/api-client transport, and the session-token
 * binding in `lib/api/ega.ts` + `lib/api/client.ts`.
 *
 * This suite is what justifies the INTEGRATION TESTED evidence label in
 * scripts/mobile/verify.mjs; unit suites mock at the module boundary instead.
 */
import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { MobileTodayResponse } from '@ega/contracts/mobile';
import { useTodayWorkspaceQuery } from '@/features/today/query';
import { configureMobileApiClient } from '@/lib/api/client';

const TODAY_PAYLOAD: MobileTodayResponse = {
  ok: true,
  date: '2026-08-21',
  sections: {
    planned: [],
    inProgress: [],
    blocked: [],
    completed: [],
  },
  suggestions: {
    pinned: [],
    inProgress: [],
  },
  summary: {
    plannedCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 0,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 0,
    trackedTodaySeconds: 0,
    trackedTodayLabel: '0m',
  },
  activeTimer: null,
};

type TodayQueryResult = ReturnType<typeof useTodayWorkspaceQuery>;

function configureIntegrationSession() {
  configureMobileApiClient({
    getSession: async () => ({
      session: {
        accessToken: 'integration-access-token',
        refreshToken: 'integration-refresh-token',
        expiresAt: Date.now() + 60_000,
      },
      user: { id: 'user-int', email: 'integration@example.com' },
    }),
    setSession: async () => {},
    clearSession: async () => {},
    onUnauthorized: () => {},
  });
}

const activeQueryClients: QueryClient[] = [];

function renderTodayWorkspaceQuery() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  activeQueryClients.push(queryClient);

  let latestResult: TodayQueryResult | null = null;

  const Probe = () => {
    latestResult = useTodayWorkspaceQuery();
    return null;
  };

  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(Probe),
      ),
    );
  });

  return {
    getLatestResult: (): TodayQueryResult | null => latestResult,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
      queryClient.clear();
    },
  };
}

async function waitForPredicate(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Timed out waiting for query to settle');
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
}

describe('today workspace query over the mobile API seam', () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.integration.test';
    configureIntegrationSession();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalBaseUrl;
    }
    while (activeQueryClients.length > 0) {
      activeQueryClients.pop()?.clear();
    }
    jest.restoreAllMocks();
  });

  it('resolves hook data through the canonical /api/today path with bearer auth', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () =>
        ({
          ok: true,
          status: 200,
          json: async () => TODAY_PAYLOAD,
          text: async () => JSON.stringify(TODAY_PAYLOAD),
        }) as unknown as Response,
      );

    const { getLatestResult, unmount } = renderTodayWorkspaceQuery();

    try {
      await waitForPredicate(() => getLatestResult()?.data != null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(endpoint).toBe('https://api.integration.test/api/today');
      expect(init.method).toBe('GET');
      const requestHeaders = init.headers as Record<string, string>;
      expect(requestHeaders.Authorization ?? new Headers(requestHeaders).get('Authorization')).toBe(
        'Bearer integration-access-token',
      );
      expect(getLatestResult()?.data?.date).toBe('2026-08-21');
      expect(getLatestResult()?.isSuccess).toBe(true);
    } finally {
      unmount();
    }
  });

  it('surfaces server errors as hook failures with the server message', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () =>
        ({
          ok: false,
          status: 500,
          json: async () => ({ error: { code: 'INTERNAL', message: 'Today workspace unavailable.' } }),
          text: async () =>
            JSON.stringify({ error: { code: 'INTERNAL', message: 'Today workspace unavailable.' } }),
        }) as unknown as Response,
      );

    const { getLatestResult, unmount } = renderTodayWorkspaceQuery();

    try {
      await waitForPredicate(() => getLatestResult()?.isError === true);

      expect(String(getLatestResult()?.error)).toContain(
        'Today workspace unavailable.',
      );
    } finally {
      unmount();
    }
  });
});
