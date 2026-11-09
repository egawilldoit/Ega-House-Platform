"use client";

import { useEffect } from "react";

/**
 * Installed-PWA badge (PO-19, issue #357). Reconciles the app badge from the
 * canonical unread count wherever the Badging API is supported; browsers
 * without it degrade to a no-op and never crash the notifications surface.
 */
export function NotificationBadgeSync({ unreadCount }: { unreadCount: number }) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const sync = unreadCount > 0
      ? (typeof nav.setAppBadge === "function"
          ? nav.setAppBadge(unreadCount).catch(() => undefined)
          : undefined)
      : (typeof nav.clearAppBadge === "function"
          ? nav.clearAppBadge().catch(() => undefined)
          : undefined);
    void sync;
  }, [unreadCount]);

  return null;
}
