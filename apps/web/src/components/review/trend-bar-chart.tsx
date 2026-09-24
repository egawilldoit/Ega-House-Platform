"use client";

import React from "react";
import { formatDisplayDuration } from "@/lib/presentation-format";
import type { WorkAnalyticsDaily } from "@/lib/services/work-analytics-service";

type TrendBarChartProps = {
  data: WorkAnalyticsDaily[];
  title: string;
  /** Called when a bar row is clicked, passing the date string (YYYY-MM-DD) */
  onBarClick?: (date: string, label: string) => void;
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

export function TrendBarChart({ data, title, onBarClick }: TrendBarChartProps) {
  const maxMinutes = data.reduce(
    (max, item) => Math.max(max, item.workedMinutes),
    0,
  );

  const totalMinutes = data.reduce((sum, item) => sum + item.workedMinutes, 0);
  const activeDays = data.filter((item) => item.workedMinutes > 0).length;

  if (data.length === 0) {
    return (
      <figure className="chart-figure">
        <figcaption className="sr-only">{title}</figcaption>
        <div className="surface-empty px-4 py-5 text-[length:var(--text-meta-lg)] leading-[var(--leading-relaxed)] text-ega-text-secondary">
          No tracked time yet. Start a timer to build work trend data.
        </div>
      </figure>
    );
  }

  return (
    <figure className="chart-figure">
      <figcaption className="sr-only">{title}</figcaption>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
          <span className="font-medium tabular-nums text-ega-text">
            {formatDisplayDuration(totalMinutes * 60, "minute")}
          </span>{" "}
          tracked
        </p>
        <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
          <span className="font-medium tabular-nums text-ega-text">{activeDays}</span> active days
        </p>
      </div>

      <div className="mt-3 space-y-1.5">
        {data.map((entry) => {
          const widthPct =
            maxMinutes > 0
              ? Math.max(6, Math.round((entry.workedMinutes / maxMinutes) * 100))
              : 6;

          const interactive = Boolean(onBarClick && entry.workedMinutes > 0);

          return (
            <button
              key={entry.date}
              type="button"
              onClick={() => {
                if (onBarClick && entry.workedMinutes > 0) {
                  onBarClick(entry.date, formatDateShort(entry.date));
                }
              }}
              disabled={!interactive}
              className={`group grid w-full grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-[var(--radius-sm)] px-1 py-0.5 text-left ${
                interactive
                  ? "cursor-pointer transition-colors hover:bg-ega-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ega-text"
                  : ""
              }`}
            >
              <span className="truncate text-[length:var(--text-meta)] font-medium text-ega-text-secondary">
                {toDayLabel(entry.date)}
              </span>
              <span className="block h-3 overflow-hidden rounded-[3px] bg-ega-surface-muted">
                <span
                  className="block h-full rounded-[3px] bg-data-blue-soft transition-[background-color] duration-[var(--duration-base)] motion-reduce:transition-none group-hover:bg-data-blue"
                  style={{ width: `${widthPct}%` }}
                />
              </span>
              <span className="text-right">
                <span className="text-[length:var(--text-meta)] font-medium tabular-nums text-ega-text">
                  {formatDisplayDuration(entry.workedMinutes * 60, "minute")}
                </span>
                <span className="ml-1 text-[length:var(--text-meta)] tabular-nums text-ega-text-tertiary">
                  {entry.sessionCount}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>{title} — daily focused time</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Focused time</th>
            <th scope="col">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.date}>
              <th scope="row">{entry.date}</th>
              <td>{formatDisplayDuration(entry.workedMinutes * 60, "minute")}</td>
              <td>{entry.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
