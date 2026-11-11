"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type RefreshOnFocusProps = {
  /** Debounce coalesces focus + visibilitychange into one refresh. */
  debounceMs?: number;
};

/**
 * Refresh a server-rendered surface when the tab becomes visible or focused.
 *
 * MONEY-02 needs externally written rows (for example an MCP edit) to appear
 * after a reload/focus without adding a realtime subscription for the expense
 * ledger. Server components stay dynamic, so one router.refresh() re-reads the
 * canonical repository; this component only decides when to ask.
 */
export function RefreshOnFocus({ debounceMs = 250 }: RefreshOnFocusProps) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const schedule = () => {
      if (!mountedRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (timeoutRef.current) return;
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        if (mountedRef.current) router.refresh();
      }, debounceMs);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) schedule();
    };

    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [debounceMs, router]);

  return null;
}
