"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createRoot, type Root } from "react-dom/client";

import {
  readActiveTimerSnapshotAction,
  stopActiveTimerSessionAction,
} from "@/app/(workspace)/active-timer-actions";
import { TimerPopoutView } from "@/components/timer/floating-timer/timer-popout-view";
import { createClient } from "@/lib/supabase/client";
import { subscribeToOwnerScopedRealtimeChanges } from "@/lib/supabase/realtime";
import {
  ACTIVE_TIMER_OFFLINE_MESSAGE,
  ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
  type ActiveTimerReadResult,
  type ActiveTimerSessionSnapshot,
  type ActiveTimerSyncPhase,
} from "@/lib/timer/active-timer-contract";
import {
  attachTimerPopoutLifecycle,
  prepareTimerPopoutDocument,
  requestTimerPopoutWindow,
  shouldDeferHiddenTimerRefresh,
  supportsDocumentPictureInPicture,
} from "@/lib/timer/popout-window";

const MIN_AUTOMATIC_REFRESH_INTERVAL_MS = 1500;
const REALTIME_DEBOUNCE_MS = 750;
const REFRESH_TIMEOUT_MS = 10_000;
const TIMEOUT_MESSAGE = "Timer sync timed out. Showing the last known state.";

type ProviderState = {
  session: ActiveTimerSessionSnapshot | null;
  phase: ActiveTimerSyncPhase;
  message: string | null;
  syncedAt: string | null;
  stopPendingSessionId: string | null;
  stopError: string | null;
  popoutError: string | null;
};

type ActiveTimerContextValue = {
  session: ActiveTimerSessionSnapshot | null;
  phase: ActiveTimerSyncPhase;
  message: string | null;
  syncedAt: string | null;
  stopPending: boolean;
  stopError: string | null;
  popoutError: string | null;
  popoutSupported: boolean;
  popoutOpen: boolean;
  openPopout: () => void;
  stopSession: (sessionId?: string) => void;
  dismissStopError: () => void;
  dismissPopoutError: () => void;
};

type TimerPopoutHandle = {
  window: Window;
  root: Root;
  detachLifecycle: () => void;
};

const ActiveTimerContext = createContext<ActiveTimerContextValue | null>(null);

const subscribeToPopoutSupport = () => () => {};
const getPopoutSupportSnapshot = () => supportsDocumentPictureInPicture();
const getPopoutSupportServerSnapshot = () => false;

export function useActiveTimer() {
  const value = useContext(ActiveTimerContext);
  if (!value) {
    throw new Error("useActiveTimer must be used inside ActiveTimerProvider.");
  }
  return value;
}

function toInitialState(result: ActiveTimerReadResult): ProviderState {
  if (result.ok) {
    return {
      session: result.session,
      phase: "synced",
      message: null,
      syncedAt: result.syncedAt,
      stopPendingSessionId: null,
      stopError: null,
      popoutError: null,
    };
  }

  return {
    session: null,
    phase: result.reason === "unauthenticated" ? "unauthenticated" : "stale",
    message: result.message,
    syncedAt: null,
    stopPendingSessionId: null,
    stopError: null,
    popoutError: null,
  };
}

function resultSignature(result: ActiveTimerReadResult) {
  return result.ok
    ? `ok:${result.session?.sessionId ?? "none"}:${result.session?.startedAt ?? ""}:${result.syncedAt}`
    : `error:${result.reason}:${result.message}`;
}

/**
 * Apply a newer server-rendered snapshot without discarding local operation
 * state (an in-flight stop, popout ownership or a popout error).
 */
function applyServerSnapshot(
  previous: ProviderState,
  result: ActiveTimerReadResult,
): ProviderState {
  if (result.ok) {
    const incomingSyncedAt = Date.parse(result.syncedAt);
    const currentSyncedAt = previous.syncedAt
      ? Date.parse(previous.syncedAt)
      : Number.NaN;
    if (
      Number.isFinite(incomingSyncedAt) &&
      Number.isFinite(currentSyncedAt) &&
      incomingSyncedAt < currentSyncedAt
    ) {
      // A router.refresh started before a stop can commit after it. Never let
      // an older server snapshot resurrect a session already confirmed stopped.
      return previous;
    }

    return {
      ...previous,
      session: result.session,
      phase: "synced",
      message: null,
      syncedAt: result.syncedAt,
      stopError:
        previous.session?.sessionId === result.session?.sessionId
          ? previous.stopError
          : null,
    };
  }

  if (result.reason === "unauthenticated") {
    return {
      ...previous,
      session: null,
      phase: "unauthenticated",
      message: result.message,
      stopPendingSessionId: null,
    };
  }

  return {
    ...previous,
    phase: previous.phase === "unauthenticated" ? previous.phase : "stale",
    message: result.message,
  };
}

type ActiveTimerProviderProps = {
  ownerUserId: string | null;
  initialResult: ActiveTimerReadResult;
  children: ReactNode;
};

/**
 * Global canonical state for the floating focus timer.
 *
 * Reads happen only on verified server actions, owner-scoped realtime changes,
 * focus/visibility/online transitions and explicit stops. There is no polling
 * and no per-second server write; the one-second clock lives in leaf components.
 */
export function ActiveTimerProvider({
  ownerUserId,
  initialResult,
  children,
}: ActiveTimerProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<ProviderState>(() =>
    toInitialState(initialResult),
  );
  const [serverSignature, setServerSignature] = useState(() =>
    resultSignature(initialResult),
  );
  const incomingSignature = resultSignature(initialResult);
  if (incomingSignature !== serverSignature) {
    // A router.refresh() on the same route delivers a newer authoritative
    // server snapshot. Merge it instead of ignoring it until the next event.
    setServerSignature(incomingSignature);
    setState((previous) => applyServerSnapshot(previous, initialResult));
  }
  const [popoutOpen, setPopoutOpen] = useState(false);
  const [popoutPinnedSession, setPopoutPinnedSession] =
    useState<ActiveTimerSessionSnapshot | null>(null);

  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const stopInFlightRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const lastAttemptAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(options?: { force?: boolean }) => void>(() => {});
  const hiddenPendingRef = useRef(false);
  const popoutRef = useRef<TimerPopoutHandle | null>(null);
  const popoutOpeningRef = useRef(false);
  const lastPathnameRef = useRef(pathname);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearTrailingRefresh = useCallback(() => {
    if (trailingTimeoutRef.current !== null) {
      clearTimeout(trailingTimeoutRef.current);
      trailingTimeoutRef.current = null;
    }
  }, []);

  const scheduleTrailingRefresh = useCallback(
    (delayMs: number) => {
      if (trailingTimeoutRef.current !== null) {
        return;
      }
      trailingTimeoutRef.current = setTimeout(() => {
        trailingTimeoutRef.current = null;
        if (mountedRef.current) {
          refreshRef.current({ force: true });
        }
      }, Math.max(50, delayMs));
    },
    [],
  );

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!ownerUserId || !mountedRef.current) {
        return;
      }

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setState((previous) =>
          previous.phase === "unauthenticated"
            ? previous
            : {
                ...previous,
                phase: "stale",
                message: ACTIVE_TIMER_OFFLINE_MESSAGE,
              },
        );
        return;
      }

      if (inFlightRef.current) {
        // Keep the signal: a read that started before this event cannot prove
        // the newer state. Retry once it has had room to finish.
        scheduleTrailingRefresh(250);
        return;
      }

      const now = Date.now();
      if (
        !options?.force &&
        lastAttemptAtRef.current !== null &&
        now - lastAttemptAtRef.current < MIN_AUTOMATIC_REFRESH_INTERVAL_MS
      ) {
        scheduleTrailingRefresh(
          MIN_AUTOMATIC_REFRESH_INTERVAL_MS -
            (now - lastAttemptAtRef.current),
        );
        return;
      }

      clearTrailingRefresh();
      inFlightRef.current = true;
      lastAttemptAtRef.current = now;

      const sequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = sequence;

      clearPendingTimeout();

      timeoutRef.current = setTimeout(() => {
        if (
          !mountedRef.current ||
          requestSequenceRef.current !== sequence
        ) {
          return;
        }
        inFlightRef.current = false;
        timeoutRef.current = null;
        setState((previous) => ({
          ...previous,
          phase: "stale",
          message: TIMEOUT_MESSAGE,
        }));
      }, REFRESH_TIMEOUT_MS);

      try {
        const result = await readActiveTimerSnapshotAction();

        if (
          !mountedRef.current ||
          requestSequenceRef.current !== sequence
        ) {
          return;
        }

        clearPendingTimeout();
        inFlightRef.current = false;

        if (result.ok) {
          setState((previous) => ({
            ...previous,
            session: result.session,
            phase: "synced",
            message: null,
            syncedAt: result.syncedAt,
            stopError:
              previous.session?.sessionId === result.session?.sessionId
                ? previous.stopError
                : null,
          }));
          return;
        }

        setState((previous) => ({
          ...previous,
          session:
            result.reason === "unauthenticated" ? null : previous.session,
          phase:
            result.reason === "unauthenticated"
              ? "unauthenticated"
              : "stale",
          message: result.message || ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
          ...(result.reason === "unauthenticated"
            ? { stopPendingSessionId: null }
            : {}),
        }));
      } catch {
        if (
          !mountedRef.current ||
          requestSequenceRef.current !== sequence
        ) {
          return;
        }

        clearPendingTimeout();
        inFlightRef.current = false;
        setState((previous) => ({
          ...previous,
          phase: "stale",
          message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
        }));
      }
    },
    [clearPendingTimeout, clearTrailingRefresh, ownerUserId, scheduleTrailingRefresh],
  );

  useEffect(() => {
    refreshRef.current = (options) => {
      void refresh(options);
    };
  }, [refresh]);

  // App Router layouts persist across client navigation. A route change is
  // therefore an explicit refresh signal: server actions that redirect after
  // starting/stopping a timer may not re-render this provider's props.
  useEffect(() => {
    if (lastPathnameRef.current === pathname) {
      return;
    }
    lastPathnameRef.current = pathname;
    void refresh({ force: true });
  }, [pathname, refresh]);

  const stopSession = useCallback(
    async (sessionId?: string) => {
      const target = sessionId ?? stateRef.current.session?.sessionId;
      if (!target || stopInFlightRef.current) {
        return;
      }

      stopInFlightRef.current = target;
      setState((previous) => ({
        ...previous,
        stopPendingSessionId: target,
        stopError: null,
        popoutError: null,
      }));

      try {
        const result = await stopActiveTimerSessionAction(target);

        if (!mountedRef.current) {
          return;
        }

        if (!result.ok) {
          setState((previous) => ({
            ...previous,
            session:
              result.reason === "unauthenticated" ? null : previous.session,
            phase:
              result.reason === "unauthenticated"
                ? "unauthenticated"
                : previous.phase,
            stopPendingSessionId: null,
            stopError: result.message,
          }));
          return;
        }

        setState((previous) => {
          const stoppedCurrent =
            previous.session?.sessionId === target ||
            previous.session === null;
          return {
            ...previous,
            session: stoppedCurrent ? null : previous.session,
            phase: stoppedCurrent ? "synced" : previous.phase,
            message: stoppedCurrent ? null : previous.message,
            syncedAt: result.syncedAt,
            stopPendingSessionId: null,
            stopError: null,
          };
        });

        // Invalidate any read that started before this committed stop so it
        // cannot re-show the stopped session when it resolves later.
        requestSequenceRef.current += 1;
        inFlightRef.current = false;
        clearPendingTimeout();

        startTransition(() => {
          router.refresh();
        });
        // Reconcile once in case another device started a newer session while
        // this exact one was being stopped.
        void refresh({ force: true });
      } catch {
        if (!mountedRef.current) {
          return;
        }
        setState((previous) => ({
          ...previous,
          stopPendingSessionId: null,
          stopError: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
        }));
      } finally {
        if (stopInFlightRef.current === target) {
          stopInFlightRef.current = null;
        }
      }
    },
    [clearPendingTimeout, refresh, router],
  );

  const openPopout = useCallback(() => {
    const current = stateRef.current.session;
    if (!current) {
      return;
    }

    if (popoutRef.current) {
      popoutRef.current.window.focus();
      return;
    }

    if (popoutOpeningRef.current) {
      return;
    }

    popoutOpeningRef.current = true;

    void (async () => {
      let popoutWindow: Window | null = null;
      try {
        popoutWindow = await requestTimerPopoutWindow();

        if (!mountedRef.current) {
          try {
            popoutWindow.close();
          } catch {
            // Provider already unmounted; close is best effort.
          }
          return;
        }

        if (popoutRef.current) {
          // A second click raced the first request. Keep one owned window.
          try {
            popoutWindow.close();
          } catch {
            // Ignore a browser close refusal.
          }
          popoutRef.current.window.focus();
          return;
        }

        const container = prepareTimerPopoutDocument(
          popoutWindow.document,
          document,
        );
        const root = createRoot(container);
        const handle: TimerPopoutHandle = {
          window: popoutWindow,
          root,
          detachLifecycle: () => {},
        };

        handle.detachLifecycle = attachTimerPopoutLifecycle(
          popoutWindow,
          () => {
            if (popoutRef.current !== handle) {
              return;
            }
            popoutRef.current = null;
            try {
              root.unmount();
            } catch {
              // The popout document may already be gone.
            }
            setPopoutOpen(false);
            setPopoutPinnedSession(null);
          },
        );

        popoutRef.current = handle;
        // The popout document is about:blank; resolve the task link against the
        // opener origin so Open task cannot navigate a dead relative URL.
        setPopoutPinnedSession({
          ...current,
          taskHref: new URL(current.taskHref, window.location.origin).toString(),
        });
        setPopoutOpen(true);
        setState((previous) => ({ ...previous, popoutError: null }));
      } catch {
        if (popoutWindow && !popoutWindow.closed) {
          try {
            popoutWindow.close();
          } catch {
            // Ignore close restrictions after a failed setup.
          }
        }
        setState((previous) => ({
          ...previous,
          popoutError:
            "This browser could not open the always-on-top timer window. The in-app timer still works.",
        }));
      } finally {
        popoutOpeningRef.current = false;
      }
    })();
  }, []);

  // Keep event-handler reads current without mutating refs during render.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Feature detection after mount keeps server HTML and first client render
  // identical on browsers that do not expose the API.
  const popoutSupported = useSyncExternalStore(
    subscribeToPopoutSupport,
    getPopoutSupportSnapshot,
    getPopoutSupportServerSnapshot,
  );

  // Mount lifecycle and in-flight response invalidation.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      inFlightRef.current = false;
      stopInFlightRef.current = null;
      clearPendingTimeout();
      clearTrailingRefresh();
    };
  }, [clearPendingTimeout, clearTrailingRefresh]);

  // Owner-scoped realtime on task_sessions only. Bursts are debounced and the
  // canonical read is single-flight, so page-level refreshes cannot stack.
  useEffect(() => {
    if (!ownerUserId) {
      return undefined;
    }

    let active = true;
    let debounceRef: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    try {
      const supabase = createClient();
      const schedule = () => {
        if (!active || !mountedRef.current) {
          return;
        }
        if (
          typeof document !== "undefined" &&
          shouldDeferHiddenTimerRefresh(
            document.hidden,
            popoutRef.current !== null,
          )
        ) {
          hiddenPendingRef.current = true;
          return;
        }
        if (debounceRef) {
          return;
        }
        debounceRef = setTimeout(() => {
          debounceRef = null;
          if (active && mountedRef.current) {
            void refresh();
          }
        }, REALTIME_DEBOUNCE_MS);
      };

      unsubscribe = subscribeToOwnerScopedRealtimeChanges(supabase, {
        ownerUserId,
        tables: ["task_sessions"],
        channelPrefix: "floating-timer",
        onPayload: schedule,
      });
    } catch {
      // Realtime is an enhancement; focus/visibility/online still reconcile.
    }

    return () => {
      active = false;
      if (debounceRef) {
        clearTimeout(debounceRef);
        debounceRef = null;
      }
      unsubscribe?.();
    };
  }, [ownerUserId, refresh]);

  // Network and focus transitions. Timer state never polls on a clock.
  useEffect(() => {
    const handleFocus = () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      void refresh();
    };
    const handleOnline = () => {
      hiddenPendingRef.current = false;
      void refresh({ force: true });
    };
    const handleOffline = () => {
      setState((previous) =>
        previous.phase === "unauthenticated"
          ? previous
          : {
              ...previous,
              phase: "stale",
              message: ACTIVE_TIMER_OFFLINE_MESSAGE,
            },
      );
    };
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.hidden) {
        hiddenPendingRef.current = true;
        return;
      }
      const wasHidden = hiddenPendingRef.current;
      hiddenPendingRef.current = false;
      void refresh({ force: wasHidden });
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  const renderPopout = useCallback(() => {
    const handle = popoutRef.current;
    if (!handle || !popoutPinnedSession) {
      return;
    }

    const mainState = state;
    const isCurrent =
      mainState.session?.sessionId === popoutPinnedSession.sessionId;

    handle.root.render(
      <TimerPopoutView
        session={popoutPinnedSession}
        isCurrent={isCurrent}
        phase={mainState.phase}
        message={mainState.message}
        stopPending={
          mainState.stopPendingSessionId === popoutPinnedSession.sessionId
        }
        stopError={mainState.stopError}
        onStop={() => {
          void stopSession(popoutPinnedSession.sessionId);
        }}
        onClose={() => {
          try {
            handle.window.close();
          } catch {
            // A browser may refuse programmatic close; native close still works.
          }
        }}
      />,
    );
  }, [popoutPinnedSession, state, stopSession]);

  useEffect(() => {
    renderPopout();
  }, [renderPopout]);

  // Close the owned window when the provider leaves the tree (logout, account
  // switch, hard navigation). A manually closed window has already detached.
  useEffect(() => {
    return () => {
      const handle = popoutRef.current;
      if (!handle) {
        return;
      }
      popoutRef.current = null;
      handle.detachLifecycle();
      try {
        handle.root.unmount();
      } catch {
        // Window/document already disposed.
      }
      try {
        handle.window.close();
      } catch {
        // Ignore close restrictions during teardown.
      }
    };
  }, []);

  const dismissStopError = useCallback(() => {
    setState((previous) => ({ ...previous, stopError: null }));
  }, []);

  const dismissPopoutError = useCallback(() => {
    setState((previous) => ({ ...previous, popoutError: null }));
  }, []);

  const value = useMemo<ActiveTimerContextValue>(
    () => ({
      session: state.session,
      phase: state.phase,
      message: state.message,
      syncedAt: state.syncedAt,
      stopPending: state.stopPendingSessionId !== null,
      stopError: state.stopError,
      popoutError: state.popoutError,
      popoutSupported,
      popoutOpen,
      openPopout,
      stopSession: (sessionId?: string) => {
        void stopSession(sessionId);
      },
      dismissStopError,
      dismissPopoutError,
    }),
    [
      dismissPopoutError,
      dismissStopError,
      openPopout,
      popoutOpen,
      popoutSupported,
      state.message,
      state.phase,
      state.popoutError,
      state.session,
      state.stopError,
      state.stopPendingSessionId,
      state.syncedAt,
      stopSession,
    ],
  );

  return (
    <ActiveTimerContext.Provider value={value}>
      {children}
    </ActiveTimerContext.Provider>
  );
}
