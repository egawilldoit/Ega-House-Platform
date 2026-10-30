"use client";

import { useEffect, useState } from "react";

/**
 * Connection-loss hint.
 *
 * `navigator.onLine` only proves the browser has a network interface; it does
 * not prove the server is reachable, so this banner never labels a failed
 * request "offline" and never offers an offline write. It only warns that a
 * save cannot be trusted until the connection returns.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-[var(--status-risk-border)] bg-[var(--status-risk-bg)] px-4 py-2 text-[length:var(--text-meta-lg)] text-[color:var(--status-risk)]"
    >
      You are offline. Changes cannot be saved until the connection returns; nothing you typed
      has been submitted.
    </div>
  );
}
