"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MIN_REFRESH_INTERVAL_MS = 1000;

/**
 * Timer-page cross-device reconciliation.
 *
 * A PWA tab can be backgrounded or offline while another device starts or stops
 * the timer. The page keeps the last server-rendered state; when the browser
 * reconnects, becomes visible, or regains focus, ask the server for a fresh
 * workspace instead of accumulating local time or trusting a stale session.
 *
 * Refresh calls are deduped so a reconnect burst (online + focus +
 * visibilitychange) results in at most one refresh per second.
 */
export function TimerSyncStatus() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const lastRefreshAtRef = useRef<number | null>(null);

  useEffect(() => {
    const syncConnectionState = () => setOffline(!navigator.onLine);

    const refresh = () => {
      if (!navigator.onLine) return;
      if (document.hidden) return;

      const now = Date.now();
      if (
        lastRefreshAtRef.current !== null &&
        now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS
      ) {
        return;
      }
      lastRefreshAtRef.current = now;
      router.refresh();
    };

    const handleOnline = () => {
      syncConnectionState();
      refresh();
    };
    const handleOffline = () => {
      setOffline(true);
    };
    const handleFocus = () => refresh();
    const handleVisibilityChange = () => {
      if (!document.hidden) refresh();
    };

    syncConnectionState();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="feedback-block feedback-block-warn"
    >
      Offline - showing the last synced timer state. Reconnecting will refresh it
      automatically.
    </div>
  );
}
