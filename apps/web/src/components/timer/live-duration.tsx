"use client";

import { memo, useEffect, useState } from "react";

import {
  formatDurationClock,
  getElapsedDurationSeconds,
} from "@/lib/timer-domain";

type LiveDurationProps = {
  startedAt: string;
  /** Visual size of the elapsed clock. */
  size?: "md" | "lg";
  label?: string;
  className?: string;
};

/**
 * Isolated 1-second tick.
 *
 * The ticking state deliberately lives in this leaf component so parent trees
 * never re-render once per second.
 */
function LiveDurationComponent({
  startedAt,
  size = "lg",
  label = "Elapsed",
  className,
}: LiveDurationProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedDurationSeconds(startedAt),
  );
  const [renderedStartedAt, setRenderedStartedAt] = useState(startedAt);

  // Adjusting state during render (React's recommended pattern) keeps a changed
  // start time in sync without a state-setting effect.
  if (renderedStartedAt !== startedAt) {
    setRenderedStartedAt(startedAt);
    setElapsedSeconds(getElapsedDurationSeconds(startedAt));
  }

  useEffect(() => {
    let isHidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";

    const updateElapsed = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        isHidden = true;
        return;
      }
      isHidden = false;
      setElapsedSeconds(getElapsedDurationSeconds(startedAt));
    };

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        isHidden = true;
        return;
      }

      if (isHidden) {
        isHidden = false;
        setElapsedSeconds(getElapsedDurationSeconds(startedAt));
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      window.clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [startedAt]);

  return (
    <div className={className}>
      <p className="glass-label">{label}</p>
      <p
        className={
          size === "lg"
            ? "mt-1 font-mono text-3xl font-semibold tabular-nums tracking-[0.06em] text-[color:var(--ega-text)] sm:text-4xl"
            : "mt-0.5 font-mono text-xl font-semibold tabular-nums tracking-[0.04em] text-[color:var(--ega-text)]"
        }
        suppressHydrationWarning
      >
        {formatDurationClock(elapsedSeconds)}
      </p>
    </div>
  );
}

export const LiveDuration = memo(LiveDurationComponent);
