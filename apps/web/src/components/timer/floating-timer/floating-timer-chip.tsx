"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Pin, Square } from "lucide-react";

import { useActiveTimer } from "@/components/timer/floating-timer/active-timer-provider";
import {
  formatDurationClock,
  getElapsedDurationSeconds,
} from "@/lib/timer-domain";

function ChipElapsed({ startedAt }: { startedAt: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedDurationSeconds(startedAt),
  );

  useEffect(() => {
    let wasHidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";

    const update = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        wasHidden = true;
        return;
      }
      wasHidden = false;
      setElapsedSeconds(getElapsedDurationSeconds(startedAt));
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        update();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [startedAt]);

  return (
    <span
      className="ega-timer-chip__clock"
      aria-label="Elapsed time"
      suppressHydrationWarning
    >
      {formatDurationClock(elapsedSeconds)}
    </span>
  );
}

/**
 * Persistent in-app surface for the active session. It lives in the
 * authenticated workspace shell, so it survives client navigation between
 * workspace routes. The one-second clock is isolated in `ChipElapsed`.
 */
export function FloatingTimerChip() {
  const {
    session,
    phase,
    message,
    stopPending,
    stopError,
    popoutError,
    popoutSupported,
    popoutOpen,
    openPopout,
    stopSession,
    dismissStopError,
  } = useActiveTimer();

  if (!session) {
    return null;
  }

  const isStale = phase === "stale";
  const isUnauthenticated = phase === "unauthenticated";
  const statusLabel = isUnauthenticated
    ? "Timer sync paused"
    : isStale
      ? "Timer sync delayed"
      : "Focus timer running";

  return (
    <aside
      className="ega-timer-chip"
      data-testid="floating-timer-chip"
      data-stale={isStale ? "true" : "false"}
      aria-label="Active focus timer"
    >
      <div className="ega-timer-chip__status" role="status" aria-live="polite">
        <span className="ega-timer-chip__dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </div>

      <div className="ega-timer-chip__body">
        <div className="ega-timer-chip__copy">
          <p className="ega-timer-chip__title" title={session.taskTitle}>
            {session.taskTitle}
          </p>
          <p className="ega-timer-chip__project">{session.projectName}</p>
        </div>
        <ChipElapsed startedAt={session.startedAt} />
      </div>

      {isStale && message ? (
        <p className="ega-timer-chip__note" role="status">
          {message}
        </p>
      ) : null}

      <div className="ega-timer-chip__actions">
        <Link
          href={session.taskHref}
          className="ega-timer-chip__button"
          aria-label={`Open task ${session.taskTitle}`}
        >
          <ExternalLink aria-hidden="true" />
          Open task
        </Link>

        {popoutSupported ? (
          <button
            type="button"
            className="ega-timer-chip__button"
            onClick={openPopout}
            aria-label={
              popoutOpen
                ? "Focus always-on-top timer window"
                : "Pop out timer to an always-on-top window"
            }
          >
            <Pin aria-hidden="true" />
            {popoutOpen ? "Focus window" : "Pop out"}
          </button>
        ) : null}

        <button
          type="button"
          className="ega-timer-chip__button ega-timer-chip__button--danger"
          onClick={() => stopSession(session.sessionId)}
          disabled={stopPending}
          aria-label={`Stop timer for ${session.taskTitle}`}
        >
          <Square aria-hidden="true" />
          {stopPending ? "Stopping..." : "Stop"}
        </button>
      </div>

      {stopError ? (
        <div className="ega-timer-chip__error" role="alert">
          <span>{stopError}</span>
          <button
            type="button"
            className="ega-timer-chip__dismiss"
            onClick={dismissStopError}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {popoutError ? (
        <p className="ega-timer-chip__error" role="alert">
          {popoutError}
        </p>
      ) : null}
    </aside>
  );
}
