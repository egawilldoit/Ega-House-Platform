import React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import type { DailyTrackedTime } from "@/lib/review-session-heatmap";

/**
 * Intensity scale built from the data-blue token (never a status colour).
 * `color-mix` keeps the scale tied to the token instead of a hard-coded hex.
 */
const HEATMAP_INTENSITY_STYLES: React.CSSProperties[] = [
  {
    background: "var(--ega-surface-subtle)",
    borderColor: "var(--ega-border)",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 14%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 30%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 26%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 45%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 42%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 62%, var(--ega-border))",
  },
  {
    background: "color-mix(in srgb, var(--ega-data-blue) 64%, var(--ega-surface))",
    borderColor: "color-mix(in srgb, var(--ega-data-blue) 82%, var(--ega-border))",
  },
];

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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Session heatmap</CardTitle>
            <CardDescription className="mt-1">
              Daily tracked time across the recent execution window (UTC).
            </CardDescription>
            {windowStart && windowEnd ? (
              <p className="mt-1 text-[length:var(--text-meta)] text-ega-text-tertiary">
                {formatHeatmapDateLabel(windowStart)} to {formatHeatmapDateLabel(windowEnd)}
              </p>
            ) : null}
          </div>
          <div className="text-right text-[length:var(--text-meta)] text-ega-text-secondary">
            <p>
              <span className="font-medium tabular-nums text-ega-text">{activeDays}</span> active days
            </p>
            <p>
              <span className="font-medium tabular-nums text-ega-text">
                {formatDurationLabel(totalSeconds)}
              </span>{" "}
              tracked
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {data.length === 0 ? (
          <div className="surface-empty px-4 py-5 text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
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
                    title={label}
                    aria-label={label}
                    className="h-8 rounded-[var(--radius-xs)] border"
                    style={HEATMAP_INTENSITY_STYLES[level]}
                  />
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
                {activeDays === 0
                  ? "No tracked sessions yet. Start a timer to build consistency data."
                  : "Higher intensity indicates more tracked session time for that day."}
              </p>
              <div
                className="flex items-center gap-2 text-[length:var(--text-meta)] text-ega-text-secondary"
                aria-label="Heatmap legend"
              >
                <span>Legend</span>
                {LEGEND_LABELS.map((label, index) => (
                  <span key={label} className="inline-flex items-center gap-1">
                    <span
                      className="h-3 w-3 rounded-[2px] border"
                      style={HEATMAP_INTENSITY_STYLES[index]}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <table className="sr-only">
              <caption>Daily tracked session time</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Tracked time</th>
                </tr>
              </thead>
              <tbody>
                {data.map((entry) => (
                  <tr key={entry.date}>
                    <th scope="row">{entry.date}</th>
                    <td>{formatDurationLabel(entry.trackedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
