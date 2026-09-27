"use client";

import { useEffect, useState } from "react";

import {
  getDisplayTimezone,
  setDisplayTimezone,
} from "@/lib/presentation-format";

type TimeContextResponse = {
  ok: boolean;
  timeContext?: { timezone?: string | null };
};

/**
 * Client-session bootstrap for the central timestamp formatter.
 *
 * Fetches the owner's persisted EGA House timezone from the canonical
 * GET /api/time-context endpoint and installs it as the module display-timezone
 * override, so absolute timestamps render in the account timezone while
 * date-only values never shift.
 *
 * Hydration-safe: the first render (server and client) uses the UTC default;
 * the override is applied after mount and triggers a re-render.
 */
export function useDisplayTimezone(): string {
  const [timezone, setTimezone] = useState<string>(() => getDisplayTimezone());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/time-context")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: TimeContextResponse | null) => {
        if (cancelled) return;
        const next =
          payload?.ok && payload.timeContext?.timezone
            ? payload.timeContext.timezone
            : "UTC";
        setDisplayTimezone(next);
        setTimezone(next);
      })
      .catch(() => {
        if (cancelled) return;
        setDisplayTimezone("UTC");
        setTimezone("UTC");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return timezone;
}
