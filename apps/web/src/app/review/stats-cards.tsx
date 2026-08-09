import { Badge } from "@/components/ui/badge";
import { formatDurationLabel } from "@/lib/task-session";
import { formatTaskToken } from "@/lib/task-domain";

export type WeeklyStats = {
  tasksCreated: number;
  sessionsLogged: number;
  trackedSeconds: number;
  goalsTouched: number;
  goalStatusCounts: Array<{ status: string; count: number }>;
};

type StatsCardsProps = { stats: WeeklyStats };

function formatStatusToken(status: string) {
  return formatTaskToken(status);
}

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="space-y-3">
      {/* Readout rows */}
      {[
        { label: "Tasks created", value: stats.tasksCreated },
        { label: "Sessions logged", value: stats.sessionsLogged },
        { label: "Goals touched", value: stats.goalsTouched },
      ].map((row) => (
        <div key={row.label} className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--border)" }}>
          <span className="glass-label text-etch">{row.label}</span>
          <span className="font-mono tabular text-base font-medium" style={{ color: "var(--foreground)" }}>{row.value}</span>
        </div>
      ))}

      {/* Focus time — highlighted */}
      <div className="instrument-border rounded-sm px-4 py-3" style={{ borderColor: "rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.05)" }}>
        <div className="flex items-center justify-between">
          <span className="glass-label text-signal-live">Focus time</span>
          <span className="font-mono tabular text-lg font-medium text-signal-live">{formatDurationLabel(stats.trackedSeconds)}</span>
        </div>
      </div>

      {/* Goal breakdown */}
      {stats.goalStatusCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {stats.goalStatusCounts.map((entry) => (
            <Badge key={entry.status} tone="muted">
              {entry.count} {formatStatusToken(entry.status)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export type { WeeklyStats as WeeklyStatsType };
