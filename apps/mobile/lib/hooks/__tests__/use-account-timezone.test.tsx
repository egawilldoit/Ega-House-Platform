import * as React from 'react';
import { act, create } from 'react-test-renderer';

import { fetchMobileTimeContext } from '@/lib/api/time-context';
import { invalidateAccountTimezoneCache, useAccountTimezone } from '@/lib/hooks/use-account-timezone';

jest.mock('@/lib/api/time-context', () => ({
  fetchMobileTimeContext: jest.fn(),
}));

const mockFetch = fetchMobileTimeContext as unknown as jest.Mock;

type HookResult = { timezone: string; isLoading: boolean };

function renderProbe() {
  const results: HookResult[] = [];

  function Probe() {
    results.push(useAccountTimezone());
    return null;
  }

  let renderer: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });

  return { results, renderer: renderer! };
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAccountTimezone', () => {
  beforeEach(() => {
    invalidateAccountTimezoneCache();
    mockFetch.mockReset();
  });

  it('loads and caches the account timezone for the session', async () => {
    mockFetch.mockResolvedValue({ ok: true, timeContext: { timezone: 'Africa/Casablanca' } });

    const first = renderProbe();
    expect(first.results[0]?.timezone).toBe('UTC');
    expect(first.results[0]?.isLoading).toBe(true);

    await flushAsync();
    const settled = first.results[first.results.length - 1];
    expect(settled?.timezone).toBe('Africa/Casablanca');
    expect(settled?.isLoading).toBe(false);

    mockFetch.mockResolvedValue({ ok: true, timeContext: { timezone: 'Asia/Tokyo' } });
    const second = renderProbe();
    await flushAsync();
    const cached = second.results[second.results.length - 1];
    expect(cached?.timezone).toBe('Africa/Casablanca');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to UTC when the time context read fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const { results } = renderProbe();
    await flushAsync();

    const settled = results[results.length - 1];
    expect(settled?.timezone).toBe('UTC');
    expect(settled?.isLoading).toBe(false);
  });

  it('re-fetches after the cache is invalidated', async () => {
    mockFetch.mockResolvedValue({ ok: true, timeContext: { timezone: 'Africa/Casablanca' } });

    const first = renderProbe();
    await flushAsync();
    expect(first.results[first.results.length - 1]?.timezone).toBe('Africa/Casablanca');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    invalidateAccountTimezoneCache();
    mockFetch.mockResolvedValue({ ok: true, timeContext: { timezone: 'Asia/Tokyo' } });

    const second = renderProbe();
    await flushAsync();
    expect(second.results[second.results.length - 1]?.timezone).toBe('Asia/Tokyo');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
