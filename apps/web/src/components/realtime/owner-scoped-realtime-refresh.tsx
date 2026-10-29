"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  getRealtimePayloadUpdatedAt,
  subscribeToOwnerScopedRealtimeChanges,
} from "@/lib/supabase/realtime";

type OwnerScopedRealtimeRefreshProps = {
  ownerUserId: string | null;
  channelPrefix: string;
  tables: readonly ("task_sessions" | "tasks" | "week_reviews")[];
  refreshDebounceMs?: number;
  /**
   * Optional table/event filter: only refresh for specific event types
   * or specific tables. If omitted, all matching events trigger refresh.
   */
  eventFilter?: {
    tables?: readonly ("task_sessions" | "tasks" | "week_reviews")[];
    events?: readonly ("INSERT" | "UPDATE" | "DELETE")[];
  };
};

/**
 * Owner-scoped realtime refresh component.
 *
 * Subscribes to Supabase realtime changes for the given owner and tables,
 * then calls router.refresh() after a debounce interval to keep the page
 * up to date.
 *
 * Improvements over the original:
 * - Debounce increased from 250ms to 1000ms to reduce visible page rerenders
 * - Skips router.refresh() when document is hidden (background tab)
 * - Guards against duplicate refresh bursts beyond the first queued one
 * - Optionally filters by table/event type for more targeted refreshes
 * - Cleanup ensures no stale timeouts or subscriptions after unmount
 */
export function OwnerScopedRealtimeRefresh({
  ownerUserId,
  channelPrefix,
  tables,
  refreshDebounceMs = 1000,
  eventFilter,
}: OwnerScopedRealtimeRefreshProps) {
  const router = useRouter();
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadUpdatedAtRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const hasPendingWhileHiddenRef = useRef(false);

  useEffect(() => {
    if (!ownerUserId || tables.length === 0) {
      return undefined;
    }

    const supabase = createClient();
    const scheduleRefresh = () => {
      if (!isMountedRef.current) {
        return;
      }
      if (typeof document !== "undefined" && document.hidden) {
        hasPendingWhileHiddenRef.current = true;
        return;
      }

      if (refreshTimeoutRef.current) {
        return;
      }

      refreshTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          return;
        }
        refreshTimeoutRef.current = null;
        startTransition(() => {
          router.refresh();
        });
      }, refreshDebounceMs);
    };

    const handleVisibilityChange = () => {
      if (!isMountedRef.current) {
        return;
      }
      if (typeof document === "undefined") {
        return;
      }
      if (!document.hidden && hasPendingWhileHiddenRef.current) {
        hasPendingWhileHiddenRef.current = false;
        if (!refreshTimeoutRef.current) {
          refreshTimeoutRef.current = setTimeout(() => {
            if (!isMountedRef.current) {
              return;
            }
            refreshTimeoutRef.current = null;
            startTransition(() => {
              router.refresh();
            });
          }, 0);
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    const unsubscribe = subscribeToOwnerScopedRealtimeChanges(supabase, {
      ownerUserId,
      tables,
      channelPrefix,
      onPayload: (payload) => {
        // Skip refresh if component unmounted during debounce
        if (!isMountedRef.current) {
          return;
        }

        // Table/event filtering if configured
        if (eventFilter) {
          if (
            eventFilter.tables &&
            eventFilter.tables.length > 0 &&
            !eventFilter.tables.includes(payload.table as "task_sessions" | "tasks" | "week_reviews")
          ) {
            return;
          }
          if (
            eventFilter.events &&
            eventFilter.events.length > 0 &&
            !eventFilter.events.includes(payload.eventType)
          ) {
            return;
          }
        }

        const payloadUpdatedAt = getRealtimePayloadUpdatedAt(payload);
        if (
          payloadUpdatedAt &&
          lastPayloadUpdatedAtRef.current &&
          payloadUpdatedAt < lastPayloadUpdatedAtRef.current
        ) {
          return;
        }

        if (payloadUpdatedAt) {
          lastPayloadUpdatedAtRef.current = payloadUpdatedAt;
        }

        if (typeof document !== "undefined" && document.hidden) {
          hasPendingWhileHiddenRef.current = true;
          return;
        }

        scheduleRefresh();
      },
    });

    return () => {
      isMountedRef.current = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      hasPendingWhileHiddenRef.current = false;
      unsubscribe();
    };
  }, [channelPrefix, ownerUserId, refreshDebounceMs, router, tables, eventFilter]);

  return null;
}
