import { Card, CardContent } from "@/components/ui/card";
import { CompactStat } from "@/components/ui/metric";
import { formatDisplayDuration } from "@/lib/presentation-format";
import type { SessionQuality } from "@/lib/services/work-analytics-service";

type SessionQualityCardProps = {
  quality: SessionQuality;
};

function progressColor(value: number, threshold: number): string {
  if (value >= threshold) return "text-status-overdue";
  if (value > threshold * 0.5) return "text-status-risk";
  return "text-status-healthy";
}

/**
 * Displays session quality metrics: average, median, longest session lengths,
 * and fragmentation counts (short/long session buckets).
 * Handles empty/no-data state gracefully.
 */
export function SessionQualityCard({ quality }: SessionQualityCardProps) {
  const hasData = quality.totalSessions > 0;

  return (
    <Card label="Quality" title="Session quality">
      <CardContent>
        {!hasData ? (
          <p className="text-[length:var(--text-meta-lg)] text-ega-text-secondary">
            No session data in this period.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <CompactStat
                label="Average"
                value={formatDisplayDuration(
                  Math.round(quality.averageSessionLengthMinutes) * 60,
                  "minute",
                )}
              />
              <CompactStat
                label="Median"
                value={formatDisplayDuration(
                  Math.round(quality.medianSessionLengthMinutes) * 60,
                  "minute",
                )}
              />
              <CompactStat
                label="Longest"
                value={formatDisplayDuration(
                  Math.round(quality.longestSessionMinutes) * 60,
                  "minute",
                )}
              />
            </div>

            <div>
              <p className="glass-label">Fragmentation</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[length:var(--text-meta-lg)]">
                <div className="flex justify-between gap-2">
                  <dt className="text-ega-text-secondary">&lt;5 min</dt>
                  <dd className={`tabular-nums ${progressColor(quality.sessionsUnder5Min, 5)}`}>
                    {quality.sessionsUnder5Min}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ega-text-secondary">&lt;15 min</dt>
                  <dd className={`tabular-nums ${progressColor(quality.sessionsUnder15Min, 10)}`}>
                    {quality.sessionsUnder15Min}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ega-text-secondary">&gt;90 min</dt>
                  <dd className={`tabular-nums ${progressColor(quality.sessionsOver90Min, 3)}`}>
                    {quality.sessionsOver90Min}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ega-text-secondary">&gt;180 min</dt>
                  <dd
                    className={`tabular-nums ${progressColor(quality.sessionsOver180Min, 2)}`}
                  >
                    {quality.sessionsOver180Min}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="text-[length:var(--text-meta)] text-ega-text-tertiary">
              {quality.totalSessions} total session
              {quality.totalSessions !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
