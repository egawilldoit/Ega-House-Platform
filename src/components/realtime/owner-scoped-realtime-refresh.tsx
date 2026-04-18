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
};

export function OwnerScopedRealtimeRefresh({
  ownerUserId,
  channelPrefix,
  tables,
  refreshDebounceMs = 250,
}: OwnerScopedRealtimeRefreshProps) {
  const router = useRouter();
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadUpdatedAtRef = useRef<string | null>(null);

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

        if (refreshTimeoutRef.current) {
          return;
        }

        refreshTimeoutRef.current = setTimeout(() => {
          refreshTimeoutRef.current = null;
          startTransition(() => {
            router.refresh();
          });
        }, refreshDebounceMs);
      },
    });

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      unsubscribe();
    };
  }, [channelPrefix, ownerUserId, refreshDebounceMs, router, tables]);

  return null;
}
