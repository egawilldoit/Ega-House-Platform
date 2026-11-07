"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { reconcileTimerSurface } from "@/lib/timer/reconcile-action";
import type { TimerReconcileSurface } from "@/lib/timer/reconcile-contract";

const MIN_AUTOMATIC_ATTEMPT_INTERVAL_MS = 1000;
const RECONCILE_TIMEOUT_MS = 10_000;

const OFFLINE_MESSAGE =
  "Offline - showing the last synced timer state. Reconnecting will refresh it automatically.";
const TIMEOUT_MESSAGE = "Timer sync timed out. Showing the last synced state.";
const UNAVAILABLE_FALLBACK_MESSAGE =
  "Could not confirm the timer state with the server. Showing the last synced state.";

type SyncPhase = "synced" | "checking" | "stale" | "unauthenticated";

type SyncState = {
  /** Owner this state belongs to; a mismatch means a fresh server render. */
  ownerUserId: string | null;
  phase: SyncPhase;
  message: string | null;
  syncedAt: string | null;
};

type TimerSyncStatusProps = {
  surface: TimerReconcileSurface;
  ownerUserId: string | null;
};

function initialSyncState(ownerUserId: string | null): SyncState {
  return { ownerUserId, phase: "synced", message: null, syncedAt: null };
}

function subscribeToConnection(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getOnlineSnapshot() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function getServerOnlineSnapshot() {
  return true;
}

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
  const [syncState, setSyncState] = useState<SyncState>(() =>
    initialSyncState(ownerUserId),
  );
  // An in-place owner change arrives with a fresh server render, so derive the
  // reset instead of writing state from an effect.
  const currentState =
    syncState.ownerUserId === ownerUserId
      ? syncState
      : initialSyncState(ownerUserId);
  const online = useSyncExternalStore(
    subscribeToConnection,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );

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

  const patchState = useCallback(
    (patch: Partial<Omit<SyncState, "ownerUserId">>) => {
      setSyncState((previous) => {
        const base =
          previous.ownerUserId === ownerUserId
            ? previous
            : initialSyncState(ownerUserId);
        return { ...base, ...patch, ownerUserId };
      });
    },
    [ownerUserId],
  );

  const reconcile = useCallback(
    async (options?: { force?: boolean }) => {
      if (!mountedRef.current) return;

      if (typeof navigator !== "undefined" && !navigator.onLine) {
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
      // Every accepted attempt, including an explicit forced Retry, moves the
      // watermark so an automatic focus/online burst right afterwards stays
      // deduped instead of issuing a redundant reconcile.
      lastAutomaticAttemptAtRef.current = now;

      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;

      clearPendingTimeout();
      patchState({ phase: "checking", message: null });

      timeoutRef.current = setTimeout(() => {
        if (!mountedRef.current || requestSequenceRef.current !== requestSequence) {
          return;
        }
        inFlightRef.current = false;
        timeoutRef.current = null;
        patchState({ phase: "stale", message: TIMEOUT_MESSAGE });
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
          patchState({
            phase: "synced",
            message: null,
            syncedAt: result.syncedAt,
          });
          return;
        }

        if (result.reason === "unauthenticated") {
          patchState({
            phase: "unauthenticated",
            message: result.message,
          });
          return;
        }

        patchState({
          phase: "stale",
          message: result.message || UNAVAILABLE_FALLBACK_MESSAGE,
        });
      } catch {
        if (
          !mountedRef.current ||
          requestSequenceRef.current !== requestSequence
        ) {
          return;
        }

        clearPendingTimeout();
        inFlightRef.current = false;
        patchState({
          phase: "stale",
          message: UNAVAILABLE_FALLBACK_MESSAGE,
        });
      }
    },
    [clearPendingTimeout, patchState, surface],
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
  // in-flight response, watermark, and timer from the previous identity; the
  // rendered state above derives the reset without an effect-time write.
  useEffect(() => {
    requestSequenceRef.current += 1;
    inFlightRef.current = false;
    lastAutomaticAttemptAtRef.current = null;
    clearPendingTimeout();
  }, [clearPendingTimeout, ownerUserId]);

  useEffect(() => {
    const handleOnline = () => {
      void reconcile();
    };
    const handleFocus = () => {
      void reconcile();
    };
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reconcile();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reconcile]);

  if (!online) {
    return (
      <div role="status" aria-live="polite" className="feedback-block feedback-block-warn">
        {OFFLINE_MESSAGE}
      </div>
    );
  }

  if (currentState.phase === "checking") {
    return (
      <div role="status" aria-live="polite" className="feedback-block feedback-block-warn">
        Checking the timer with the server…
      </div>
    );
  }

  if (currentState.phase === "unauthenticated") {
    return (
      <div
        role="alert"
        className="feedback-block feedback-block-warn justify-between"
      >
        <p>
          {currentState.message ??
            "Your session expired. Sign in again to sync the timer."}
        </p>
        <Link
          href={`/login?next=/${surface}`}
          className="btn-instrument btn-instrument-muted flex h-8 items-center px-3 text-sm"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  if (currentState.phase === "stale") {
    return (
      <div
        role="alert"
        className="feedback-block feedback-block-warn justify-between"
      >
        <div className="flex flex-col gap-1">
          <p>{currentState.message ?? UNAVAILABLE_FALLBACK_MESSAGE}</p>
          {currentState.syncedAt ? (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
              Last confirmed sync: {formatConfirmedSync(currentState.syncedAt)}
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
