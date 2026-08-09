"use client";

import { useEffect, useState } from "react";

import { formatDurationLabel } from "@/lib/task-session";
import {
  formatDurationClock,
  getElapsedDurationSeconds,
} from "@/lib/timer-domain";

type LiveDurationProps = {
  startedAt: string;
};

export function LiveDuration({ startedAt }: LiveDurationProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedDurationSeconds(startedAt),
  );

  useEffect(() => {
    setElapsedSeconds(getElapsedDurationSeconds(startedAt));

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(getElapsedDurationSeconds(startedAt));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  return (
    <div className="space-y-2 rounded-xl border border-[rgba(22,163,74,0.14)] bg-[rgba(22,163,74,0.045)] px-4 py-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-signal-live">
        Running duration
      </p>
      <p
        className="font-mono text-3xl font-semibold tracking-[0.14em] text-[color:var(--foreground)] sm:text-4xl"
        suppressHydrationWarning
      >
        {formatDurationClock(elapsedSeconds)}
      </p>
      <p className="text-sm text-[color:var(--muted-foreground)]" suppressHydrationWarning>
        {formatDurationLabel(elapsedSeconds)} elapsed
      </p>
    </div>
  );
}
