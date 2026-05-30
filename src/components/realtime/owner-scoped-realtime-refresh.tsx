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
  tables: readonly ("task_sessions" | "tasks")[];
  refreshDebounceMs?: number;
  /**
   * Optional table/event filter: only refresh for specific event types
   * or specific tables. If omitted, all matching events trigger refresh.
   */
  eventFilter?: {
    tables?: readonly ("task_sessions" | "tasks")[];
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

  useEffect(() => {
    if (!ownerUserId || tables.length === 0) {
      return undefined;
    }

    const supabase = createClient();
    const unsubscribe = subscribeToOwnerScopedRealtimeChanges(supabase, {
      ownerUserId,
      tables,
      channelPrefix,
      onPayload: (payload) => {
        // Skip refresh if component unmounted during debounce
        if (!isMountedRef.current) {
          return;
        }

        // Skip refresh when page is in background
        if (typeof document !== "undefined" && document.hidden) {
          return;
        }

        // Table/event filtering if configured
        if (eventFilter) {
          if (
            eventFilter.tables &&
            eventFilter.tables.length > 0 &&
            !eventFilter.tables.includes(payload.table as "task_sessions" | "tasks")
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

        // Avoid duplicate refresh bursts: if timeout is already queued, skip
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
      },
    });

    return () => {
      isMountedRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      unsubscribe();
    };
  }, [channelPrefix, ownerUserId, refreshDebounceMs, router, tables, eventFilter]);

  return null;
}
