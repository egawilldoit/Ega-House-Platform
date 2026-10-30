import { Badge } from "@/components/ui/badge";
import { CompactStat } from "@/components/ui/metric";
import { formatDisplayDuration } from "@/lib/presentation-format";
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
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <CompactStat label="Tasks created" value={stats.tasksCreated} />
        <CompactStat label="Sessions logged" value={stats.sessionsLogged} />
        <CompactStat label="Focus time" value={formatDisplayDuration(stats.trackedSeconds, "minute")} />
        <CompactStat label="Goals touched" value={stats.goalsTouched} />
      </div>

      {stats.goalStatusCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {stats.goalStatusCounts.map((entry) => (
            <Badge key={entry.status} tone="muted">
              {entry.count} {formatStatusToken(entry.status)}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type { WeeklyStats as WeeklyStatsType };
