import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationLabel } from "@/lib/task-session";
import type { SessionQuality } from "@/lib/services/work-analytics-service";

type SessionQualityCardProps = {
  quality: SessionQuality;
};

function progressColor(value: number, threshold: number): string {
  if (value >= threshold) return "text-red-500";
  if (value > threshold * 0.5) return "text-amber-500";
  return "text-green-600";
}

/**
 * Displays session quality metrics: average, median, longest session lengths,
 * and fragmentation counts (short/long session buckets).
 * Handles empty/no-data state gracefully.
 */
export function SessionQualityCard({ quality }: SessionQualityCardProps) {
  const hasData = quality.totalSessions > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Session quality</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="text-sm text-muted-foreground">
            No session data in this period.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Session lengths */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Average</div>
                <div className="text-lg font-semibold">
                  {formatDurationLabel(
                    Math.round(quality.averageSessionLengthMinutes) * 60,
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Median</div>
                <div className="text-lg font-semibold">
                  {formatDurationLabel(
                    Math.round(quality.medianSessionLengthMinutes) * 60,
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Longest</div>
                <div className="text-lg font-semibold">
                  {formatDurationLabel(
                    Math.round(quality.longestSessionMinutes) * 60,
                  )}
                </div>
              </div>
            </div>

            {/* Fragmentation counts */}
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                Fragmentation
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&lt;5 min</span>
                  <span className={progressColor(quality.sessionsUnder5Min, 5)}>
                    {quality.sessionsUnder5Min}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&lt;15 min</span>
                  <span
                    className={progressColor(quality.sessionsUnder15Min, 10)}
                  >
                    {quality.sessionsUnder15Min}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&gt;90 min</span>
                  <span className={progressColor(quality.sessionsOver90Min, 3)}>
                    {quality.sessionsOver90Min}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">&gt;180 min</span>
                  <span
                    className={progressColor(quality.sessionsOver180Min, 2)}
                  >
                    {quality.sessionsOver180Min}
                  </span>
                </div>
              </div>
            </div>

            {/* Total sessions */}
            <div className="text-xs text-muted-foreground">
              {quality.totalSessions} total session
              {quality.totalSessions !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
