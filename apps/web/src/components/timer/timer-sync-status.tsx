"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { reconcileTimerSurface } from "@/lib/timer/reconcile-action";
import type { TimerReconcileSurface } from "@/lib/timer/reconcile-contract";

const MIN_AUTOMATIC_ATTEMPT_INTERVAL_MS = 1000;
const RECONCILE_TIMEOUT_MS = 10_000;

const OFFLINE_MESSAGE =
  "Offline - showing the last synced timer state. Reconnecting will refresh it automatically.";
const TIMEOUT_MESSAGE = "Timer sync timed out. Showing the last synced state.";
const UNAVAILABLE_FALLBACK_MESSAGE =
  "Could not confirm the timer state with the server. Showing the last synced state.";

type SyncPhase = "synced" | "checking" | "stale" | "offline" | "unauthenticated";

type TimerSyncStatusProps = {
  surface: TimerReconcileSurface;
  ownerUserId: string | null;
};

function formatConfirmedSync(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

/**
 * Timer-page cross-device reconciliation with a verified server round trip.
 *
 * A PWA tab can be backgrounded or offline while another device starts or
 * stops the timer, and the network can fail even when `navigator.onLine` says
 * "online". This component therefore only reports `synced` after the Server
 * Function confirmed an authenticated canonical read. On failure it keeps the
 * last server-rendered state visible and offers an explicit Retry.
 *
 * Automatic checks are deduped to at most one per second, only one request is
 * ever in flight, and a response that arrives after unmount or an owner change
 * is discarded. There is no polling; the single 10s timeout is the only timer.
 */
export function TimerSyncStatus({ surface, ownerUserId }: TimerSyncStatusProps) {
  const [phase, setPhase] = useState<SyncPhase>("synced");
  const [message, setMessage] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const lastAutomaticAttemptAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reconcile = useCallback(
    async (options?: { force?: boolean }) => {
      if (!mountedRef.current) return;

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setPhase("offline");
        return;
      }

      const now = Date.now();
      if (
        !options?.force &&
        lastAutomaticAttemptAtRef.current !== null &&
        now - lastAutomaticAttemptAtRef.current < MIN_AUTOMATIC_ATTEMPT_INTERVAL_MS
      ) {
        return;
      }

      // One request at a time. An explicit Retry after a timeout can still run
      // because the timeout clears the in-flight flag.
      if (inFlightRef.current) return;

      inFlightRef.current = true;
      if (!options?.force) lastAutomaticAttemptAtRef.current = now;

      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;

      clearPendingTimeout();
      setPhase("checking");
      setMessage(null);

      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || requestSequenceRef.current !== requestSequence) {
          return;
        }
        inFlightRef.current = false;
        timeoutRef.current = null;
        setPhase("stale");
        setMessage(TIMEOUT_MESSAGE);
      }, RECONCILE_TIMEOUT_MS);

      try {
        const result = await reconcileTimerSurface(surface);

        if (
          !mountedRef.current ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }

        clearPendingTimeout();
        inFlightRef.current = false;

        if (result.ok) {
          setSyncedAt(result.syncedAt);
          setMessage(null);
          setPhase("synced");
          return;
        }

        if (result.reason === "unauthenticated") {
          setMessage(result.message);
          setPhase("unauthenticated");
          return;
        }

        setMessage(result.message || UNAVAILABLE_FALLBACK_MESSAGE);
        setPhase("stale");
      } catch {
        if (
          !mountedRef.current ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }

        clearPendingTimeout();
        inFlightRef.current = false;
        setMessage(UNAVAILABLE_FALLBACK_MESSAGE);
        setPhase("stale");
      }
    },
    [clearPendingTimeout, surface],
  );

  // Mount lifecycle: track liveness and refuse state writes after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      inFlightRef.current = false;
      clearPendingTimeout();
    };
  }, [clearPendingTimeout]);

  // Owner changes (account switch) mean a new server render entirely. Drop any
  // in-flight response, watermark, and message from the previous identity.
  useEffect(() => {
    requestSequenceRef.current += 1;
    inFlightRef.current = false;
    lastAutomaticAttemptAtRef.current = null;
    clearPendingTimeout();
    setSyncedAt(null);
    setMessage(null);
    setPhase(
      typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "synced",
    );
  }, [clearPendingTimeout, ownerUserId]);

  useEffect(() => {
    const handleOnline = () => {
      void reconcile();
    };
    const handleOffline = () => {
      if (!mountedRef.current) return;
      setPhase("offline");
    };
    const handleFocus = () => {
      void reconcile();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reconcile();
    };

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
  }, [reconcile]);

  if (phase === "checking") {
    return (
      <div role="status" aria-live="polite" className="feedback-block feedback-block-warn">
        Checking the timer with the server…
      </div>
    );
  }

  if (phase === "offline") {
    return (
      <div role="status" aria-live="polite" className="feedback-block feedback-block-warn">
        {OFFLINE_MESSAGE}
      </div>
    );
  }

  if (phase === "unauthenticated") {
    return (
      <div
        role="alert"
        className="feedback-block feedback-block-warn justify-between"
      >
        <p>{message ?? "Your session expired. Sign in again to sync the timer."}</p>
        <Link
          href={`/login?next=/${surface}`}
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  if (phase === "stale") {
    return (
      <div
        role="alert"
        className="feedback-block feedback-block-warn justify-between"
      >
        <div className="flex flex-col gap-1">
          <p>{message ?? UNAVAILABLE_FALLBACK_MESSAGE}</p>
          {syncedAt ? (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Last confirmed sync: {formatConfirmedSync(syncedAt)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
          onClick={() => {
            void reconcile({ force: true });
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return null;
}
