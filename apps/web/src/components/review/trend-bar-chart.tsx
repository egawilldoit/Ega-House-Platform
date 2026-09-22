"use client";

import React from "react";
import { formatDurationLabel } from "@/lib/task-session";
import type { WorkAnalyticsDaily } from "@/lib/services/work-analytics-service";

type TrendBarChartProps = {
  data: WorkAnalyticsDaily[];
  title: string;
  /** Called when a bar row is clicked, passing the date string (YYYY-MM-DD). */
  onBarClick?: (date: string, label: string) => void;
  compact?: boolean;
};

function toDayLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateShort(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function TrendBarChart({
  data,
  title,
  onBarClick,
  compact = false,
}: TrendBarChartProps) {
  const maxMinutes = data.reduce(
    (max, item) => Math.max(max, item.workedMinutes),
    0,
  );
  const totalMinutes = data.reduce((sum, item) => sum + item.workedMinutes, 0);
  const activeDays = data.filter((item) => item.workedMinutes > 0).length;

  if (data.length === 0) {
    return (
      <div className="analytics-chart-card">
        <div className="analytics-chart-heading">
          <div>
            <p className="analytics-section-kicker">Trend</p>
            <h2 className="analytics-chart-title">{title}</h2>
          </div>
        </div>
        <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
          No tracked time yet. Start a timer to build work trend data.
        </div>
      </div>
    );
  }

  return (
    <div className={`analytics-chart-card ${compact ? "analytics-chart-card-compact" : ""}`}>
      <div className="analytics-chart-heading">
        <div>
          <p className="analytics-section-kicker">Trend</p>
          <h2 className="analytics-chart-title">{title}</h2>
          {!compact ? (
            <p className="analytics-chart-copy">
              Daily focused time. Select a day to inspect its sessions.
            </p>
          ) : null}
        </div>

        <div className="analytics-chart-summary" aria-label="Chart summary">
          <span>
            <strong>{formatDurationLabel(totalMinutes * 60)}</strong> tracked
          </span>
          <span>
            <strong>{activeDays}</strong> active day{activeDays === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className={compact ? "space-y-1.5" : "space-y-2"}>
        {data.map((entry) => {
          const widthPct =
            maxMinutes > 0 && entry.workedMinutes > 0
              ? Math.max(4, Math.round((entry.workedMinutes / maxMinutes) * 100))
              : 0;

          const duration = formatDurationLabel(entry.workedMinutes * 60);
          const label = formatDateShort(entry.date);
          const interactive = Boolean(onBarClick && entry.workedMinutes > 0);

          return (
            <button
              key={entry.date}
              type="button"
              aria-label={`${label}: ${duration}, ${entry.sessionCount} session${entry.sessionCount === 1 ? "" : "s"}`}
              onClick={() => {
                if (interactive && onBarClick) {
                  onBarClick(entry.date, label);
                }
              }}
              disabled={!interactive}
              className={`analytics-chart-row ${interactive ? "analytics-chart-row-interactive" : ""}`}
            >
              <span className="analytics-chart-date">{toDayLabel(entry.date)}</span>

              <span className="analytics-chart-track" aria-hidden="true">
                <span
                  className="analytics-chart-bar motion-reduce:transition-none"
                  style={{ width: `${widthPct}%` }}
                />
              </span>

              <span className="analytics-chart-value">
                <strong>{duration}</strong>
                <span>{entry.sessionCount}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
