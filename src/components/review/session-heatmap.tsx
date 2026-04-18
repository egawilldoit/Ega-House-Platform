import React from "react";

import { formatDurationLabel } from "@/lib/task-session";
import type { DailyTrackedTime } from "@/lib/review-session-heatmap";

const HEATMAP_INTENSITY_CLASSES = [
  "bg-[color:var(--instrument-raised)] border-[var(--border)]",
  "bg-[rgba(22,163,74,0.14)] border-[rgba(22,163,74,0.3)]",
  "bg-[rgba(22,163,74,0.26)] border-[rgba(22,163,74,0.45)]",
  "bg-[rgba(22,163,74,0.42)] border-[rgba(22,163,74,0.62)]",
  "bg-[rgba(22,163,74,0.62)] border-[rgba(22,163,74,0.82)]",
] as const;

const LEGEND_LABELS = ["None", "Low", "Medium", "High", "Peak"] as const;

function formatHeatmapDateLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function getSessionHeatmapIntensityLevel(seconds: number, maxSeconds: number) {
  if (seconds <= 0 || maxSeconds <= 0) {
    return 0;
  }

  const ratio = seconds / maxSeconds;

  if (ratio <= 0.25) {
    return 1;
  }

  if (ratio <= 0.5) {
    return 2;
  }

  if (ratio <= 0.75) {
    return 3;
  }

  return 4;
}

export function SessionHeatmap({ data }: { data: DailyTrackedTime[] }) {
  const maxSeconds = data.reduce((max, item) => Math.max(max, item.trackedSeconds), 0);
  const activeDays = data.filter((item) => item.trackedSeconds > 0).length;
  const totalSeconds = data.reduce((sum, item) => sum + item.trackedSeconds, 0);
  const windowStart = data[0]?.date;
  const windowEnd = data[data.length - 1]?.date;

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-white p-6 text-[color:var(--foreground)] shadow-[var(--shadow-card)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--foreground)]">Session heatmap</h2>
            <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
              Daily tracked time across the recent execution window (UTC).
            </p>
            {windowStart && windowEnd ? (
              <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                {formatHeatmapDateLabel(windowStart)} to {formatHeatmapDateLabel(windowEnd)}
              </p>
            ) : null}
          </div>
          <div className="text-right text-sm text-[color:var(--muted-foreground)]">
            <div>
              <span className="font-semibold text-[color:var(--foreground)]">{activeDays}</span> active days
            </div>
            <div>
              <span className="font-semibold text-[color:var(--foreground)]">{formatDurationLabel(totalSeconds)}</span> tracked
            </div>
          </div>
        </div>

        {data.length === 0 ? (
          <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
            Session heatmap is unavailable for this period.
          </div>
        ) : (
          <>
            <div
              role="list"
              aria-label="Daily tracked session time"
              className="grid grid-cols-7 gap-2"
            >
              {data.map((entry) => {
                const level = getSessionHeatmapIntensityLevel(entry.trackedSeconds, maxSeconds);
                const label = `${formatHeatmapDateLabel(entry.date)}: ${formatDurationLabel(entry.trackedSeconds)} tracked`;

                return (
                  <div
                    key={entry.date}
                    role="listitem"
                    tabIndex={0}
                    title={label}
                    aria-label={label}
                    className={`h-8 rounded-md border transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-live)] focus-visible:ring-offset-2 ${HEATMAP_INTENSITY_CLASSES[level]}`}
                  />
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[color:var(--muted-foreground)]">
                {activeDays === 0
                  ? "No tracked sessions yet. Start a timer to build consistency data."
                  : "Higher intensity indicates more tracked session time for that day."}
              </div>
              <div className="flex items-center gap-2 text-xs text-[color:var(--muted-foreground)]" aria-label="Heatmap legend">
                <span>Legend</span>
                {LEGEND_LABELS.map((label, index) => (
                  <span key={label} className="inline-flex items-center gap-1">
                    <span className={`h-3 w-3 rounded-sm border ${HEATMAP_INTENSITY_CLASSES[index]}`} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
    </div>
  );
}
