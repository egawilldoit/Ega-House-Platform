"use client";

import { useEffect, useState } from "react";

import type {
  ActiveTimerSessionSnapshot,
  ActiveTimerSyncPhase,
} from "@/lib/timer/active-timer-contract";
import {
  formatDurationClock,
  getElapsedDurationSeconds,
} from "@/lib/timer-domain";

export type TimerPopoutViewProps = {
  /** Snapshot captured when this window opened; never silently retargeted. */
  session: ActiveTimerSessionSnapshot;
  /** False when the canonical timer is stopped or has moved to another session. */
  isCurrent: boolean;
  phase: ActiveTimerSyncPhase;
  message: string | null;
  stopPending: boolean;
  stopError: string | null;
  onStop: () => void;
  onClose: () => void;
};

function PopoutElapsed({ startedAt }: { startedAt: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedDurationSeconds(startedAt),
  );
  const [renderedStartedAt, setRenderedStartedAt] = useState(startedAt);

  if (renderedStartedAt !== startedAt) {
    setRenderedStartedAt(startedAt);
    setElapsedSeconds(getElapsedDurationSeconds(startedAt));
  }

  useEffect(() => {
    const update = () => {
      setElapsedSeconds(getElapsedDurationSeconds(startedAt));
    };
    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  return (
    <p className="ega-timer-popout__clock">
      <span className="ega-timer-popout__sr">Elapsed time </span>
      {formatDurationClock(elapsedSeconds)}
    </p>
  );
}

function statusCopy(isCurrent: boolean, phase: ActiveTimerSyncPhase) {
  if (!isCurrent) {
    return "Session ended";
  }
  if (phase === "unauthenticated") {
    return "Signed out";
  }
  if (phase === "stale") {
    return "Running - last known";
  }
  return "Running now";
}

/**
 * Isolated React tree rendered through its own root inside the popout window.
 * It receives plain serializable state on every provider update, so closing or
 * changing the timer can never leave detached React state in the main tab.
 */
export function TimerPopoutView({
  session,
  isCurrent,
  phase,
  message,
  stopPending,
  stopError,
  onStop,
  onClose,
}: TimerPopoutViewProps) {
  const showClock = isCurrent && phase !== "unauthenticated";
  const status = statusCopy(isCurrent, phase);

  return (
    <div className="ega-timer-popout" role="region" aria-label="Focus timer">
      <p className="ega-timer-popout__status" role="status" aria-live="polite">
        <span
          className="ega-timer-popout__dot"
          data-stopped={isCurrent ? "false" : "true"}
          aria-hidden="true"
        />
        {status}
      </p>

      <h1 className="ega-timer-popout__title">{session.taskTitle}</h1>
      <p className="ega-timer-popout__project">{session.projectName}</p>

      {showClock ? <PopoutElapsed startedAt={session.startedAt} /> : null}

      {!isCurrent ? (
        <p className="ega-timer-popout__note">
          This focus session is no longer running. The timer in EGA House has
          the current state.
        </p>
      ) : null}

      {isCurrent && phase === "stale" && message ? (
        <p className="ega-timer-popout__note" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}

      {phase === "unauthenticated" ? (
        <p className="ega-timer-popout__note" role="status">
          Sign in again in EGA House to resume timer sync.
        </p>
      ) : null}

      <div className="ega-timer-popout__actions">
        <a
          className="ega-timer-popout__button"
          href={session.taskHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open task ${session.taskTitle}`}
        >
          Open task
        </a>

        {isCurrent && phase !== "unauthenticated" ? (
          <button
            type="button"
            className="ega-timer-popout__button ega-timer-popout__button--danger"
            onClick={onStop}
            disabled={stopPending}
            aria-label={`Stop timer for ${session.taskTitle}`}
          >
            {stopPending ? "Stopping..." : "Stop timer"}
          </button>
        ) : null}

        <button
          type="button"
          className="ega-timer-popout__button"
          onClick={onClose}
          aria-label="Close focus timer window"
        >
          Close
        </button>
      </div>

      {stopError ? (
        <p className="ega-timer-popout__error" role="alert">
          {stopError}
        </p>
      ) : null}
    </div>
  );
}
