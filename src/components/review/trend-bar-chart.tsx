import React from "react";
import { formatDurationLabel } from "@/lib/task-session";
import type { WorkAnalyticsDaily } from "@/lib/services/work-analytics-service";

type TrendBarChartProps = {
  data: WorkAnalyticsDaily[];
  title: string;
};

function toDayLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function TrendBarChart({ data, title }: TrendBarChartProps) {
  const maxMinutes = data.reduce(
    (max, item) => Math.max(max, item.workedMinutes),
    0,
  );

  const totalMinutes = data.reduce((sum, item) => sum + item.workedMinutes, 0);
  const activeDays = data.filter((item) => item.workedMinutes > 0).length;

  if (data.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-white p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">{title}</h2>
        </div>
        <div className="surface-empty px-4 py-5 text-sm leading-7 text-[color:var(--muted-foreground)]">
          No tracked time yet. Start a timer to build work trend data.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-white p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[color:var(--foreground)]">{title}</h2>
          <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            Daily worked time for the selected window.
          </p>
        </div>
        <div className="text-right text-sm text-[color:var(--muted-foreground)]">
          <div>
            <span className="font-semibold text-[color:var(--foreground)]">{formatDurationLabel(totalMinutes * 60)}</span> tracked
          </div>
          <div>
            <span className="font-semibold text-[color:var(--foreground)]">{activeDays}</span> active days
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {data.map((entry) => {
          const widthPct =
            maxMinutes > 0
              ? Math.max(6, Math.round((entry.workedMinutes / maxMinutes) * 100))
              : 6;

          return (
            <div key={entry.date} className="grid grid-cols-[6rem_minmax(0,1fr)_5rem] items-center gap-3">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)] truncate">
                {toDayLabel(entry.date)}
              </span>
              <div className="h-3 rounded-full bg-[color:var(--instrument-raised)]">
                <div
                  className="h-full rounded-full bg-[var(--signal-live)] transition-all duration-300"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <div className="text-right">
                <span className="text-xs font-medium text-[color:var(--foreground)]">
                  {formatDurationLabel(entry.workedMinutes * 60)}
                </span>
                <span className="ml-1 text-xs text-[color:var(--muted-foreground)]">
                  {entry.sessionCount}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
