import { formatDurationLabel } from "@/lib/task-session";
import type { DailyTrackedTime } from "@/lib/review-session-heatmap";

type WeekBarChartProps = {
  data: DailyTrackedTime[];
};

function toDayLabel(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function WeekBarChart({ data }: WeekBarChartProps) {
  const maxSeconds = data.reduce(
    (max, item) => Math.max(max, item.trackedSeconds),
    0,
  );

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-white p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[color:var(--foreground)]">
          This week&apos;s tracked time
        </h2>
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          Simplified daily view while history is still sparse.
        </p>
      </div>

      <div className="space-y-2">
        {data.map((entry) => {
          const widthPct =
            maxSeconds > 0 ? Math.max(8, Math.round((entry.trackedSeconds / maxSeconds) * 100)) : 8;

          return (
            <div key={entry.date} className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-3">
              <span className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                {toDayLabel(entry.date)}
              </span>
              <div className="h-2.5 rounded-full bg-[color:var(--instrument-raised)]">
                <div
                  className="h-full rounded-full bg-[var(--signal-live)]"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="text-right text-xs text-[color:var(--muted-foreground)]">
                {formatDurationLabel(entry.trackedSeconds)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

