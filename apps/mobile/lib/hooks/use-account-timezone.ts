'use client';

import { useEffect, useState } from 'react';

import { fetchMobileTimeContext } from '@/lib/api/time-context';

/**
 * Canonical account timezone for the authenticated mobile owner.
 *
 * Reads the persisted EGA House timezone through the typed mobile Time Context
 * API (GET /api/time-context). The result is fetched once per app session and
 * cached at module level so every consumer agrees on the same zone without
 * repeated network calls.
 *
 * While loading (and on failure) the effective timezone falls back to UTC,
 * matching the server's deterministic fallback.
 */
let cachedTimezone: string | null = null;
let inflight: Promise<string> | null = null;

function loadAccountTimezone(): Promise<string> {
  if (cachedTimezone) return Promise.resolve(cachedTimezone);
  if (inflight) return inflight;
  inflight = fetchMobileTimeContext()
    .then((result) => {
      const timezone = result?.timeContext?.timezone ?? 'UTC';
      cachedTimezone = timezone;
      return timezone;
    })
    .catch(() => 'UTC')
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useAccountTimezone(): { timezone: string; isLoading: boolean } {
  const [timezone, setTimezone] = useState<string>(() => cachedTimezone ?? 'UTC');
  const [isLoading, setIsLoading] = useState<boolean>(() => cachedTimezone === null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(cachedTimezone === null);
    loadAccountTimezone().then((next) => {
      if (cancelled) return;
      setTimezone(next);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { timezone, isLoading };
}
