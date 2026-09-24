import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDisplayDuration } from "@/lib/presentation-format";
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
    <Card>
      <CardHeader>
        <CardTitle>This week&apos;s tracked time</CardTitle>
        <CardDescription className="mt-1">
          Simplified daily view while history is still sparse.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {data.map((entry) => {
            const widthPct =
              maxSeconds > 0
                ? Math.max(8, Math.round((entry.trackedSeconds / maxSeconds) * 100))
                : 8;

            return (
              <div
                key={entry.date}
                className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem] items-center gap-3"
              >
                <span className="text-[length:var(--text-meta)] font-medium text-ega-text-secondary">
                  {toDayLabel(entry.date)}
                </span>
                <span className="block h-2.5 overflow-hidden rounded-[3px] bg-ega-surface-muted">
                  <span
                    className="block h-full rounded-[3px] bg-data-blue-soft"
                    style={{ width: `${widthPct}%` }}
                  />
                </span>
                <span className="text-right text-[length:var(--text-meta)] tabular-nums text-ega-text-secondary">
                  {formatDisplayDuration(entry.trackedSeconds, "minute")}
                </span>
              </div>
            );
          })}
        </div>

        <table className="sr-only">
          <caption>This week&apos;s tracked time</caption>
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
                <td>{formatDisplayDuration(entry.trackedSeconds, "minute")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
