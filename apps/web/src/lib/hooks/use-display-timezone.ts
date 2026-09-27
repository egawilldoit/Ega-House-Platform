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
 * the override is applied after mount and triggers a re-render. The override
 * is also re-fetched when the window regains focus so a timezone change made
 * in another tab (or while the tab was backgrounded) is picked up without a
 * remount.
 */
export function useDisplayTimezone(): string {
  const [timezone, setTimezone] = useState<string>(() => getDisplayTimezone());

  useEffect(() => {
    let cancelled = false;

    const applyTimezone = (payload: TimeContextResponse | null) => {
      const next =
        payload?.ok && payload.timeContext?.timezone
          ? payload.timeContext.timezone
          : "UTC";
      setDisplayTimezone(next);
      setTimezone(next);
    };

    const loadTimezone = () => {
      fetch("/api/time-context")
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: TimeContextResponse | null) => {
          if (cancelled) return;
          applyTimezone(payload);
        })
        .catch(() => {
          if (cancelled) return;
          applyTimezone(null);
        });
    };

    loadTimezone();
    window.addEventListener("focus", loadTimezone);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadTimezone);
    };
  }, []);

  return timezone;
}
