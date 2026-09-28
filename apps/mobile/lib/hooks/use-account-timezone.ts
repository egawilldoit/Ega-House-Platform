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
 *
 * The cache must be invalidated after the owner changes the timezone (e.g. in
 * settings) — call `invalidateAccountTimezoneCache` after a successful write
 * so mounted consumers observe the new zone without an app restart.
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

/**
 * Drop the cached account timezone (and any in-flight read) so the next
 * consumer re-fetches the persisted value. Call after a successful
 * `setMobileTimezone` write.
 */
export function invalidateAccountTimezoneCache(): void {
  cachedTimezone = null;
  inflight = null;
}

export function useAccountTimezone(): { timezone: string; isLoading: boolean } {
  const [timezone, setTimezone] = useState<string>(() => cachedTimezone ?? 'UTC');
  const [isLoading, setIsLoading] = useState<boolean>(() => cachedTimezone === null);

  useEffect(() => {
    let cancelled = false;
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
