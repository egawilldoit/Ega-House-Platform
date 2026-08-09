import { Card, CardContent } from "@/components/ui/card";
import { formatTaskEstimate } from "@/lib/task-estimate";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock3,
  ListChecks,
  PlayCircle,
} from "lucide-react";

type TodaySummaryBarProps = {
  plannedCount: number;
  inProgressCount: number;
  blockedCount: number;
  completedCount: number;
  totalEstimateMinutes: number;
  trackedTodayLabel: string;
};

function SummaryMetric({
  label,
  value,
  detail,
  tone = "muted",
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "muted" | "active" | "warn" | "info";
  icon: typeof CircleDashed;
}) {
  return (
    <div className={`today-summary-metric today-summary-metric-${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="glass-label text-etch">{label}</p>
        <span className="today-summary-icon" aria-hidden="true">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 font-display text-xl font-semibold leading-none tracking-tight text-[color:var(--foreground)]">
        {value}
      </p>
      {detail ? <p className="mt-2 text-xs leading-5 text-[color:var(--muted-foreground)]">{detail}</p> : null}
    </div>
  );
}

export function TodaySummaryBar({
  plannedCount,
  inProgressCount,
  blockedCount,
  completedCount,
  totalEstimateMinutes,
  trackedTodayLabel,
}: TodaySummaryBarProps) {
  const totalCount = plannedCount + inProgressCount + blockedCount + completedCount;
  const openLaneCount = plannedCount + inProgressCount + blockedCount;
  const hasOpenLane = openLaneCount > 0;
  const completionPercent = hasOpenLane ? Math.round((completedCount / totalCount) * 100) : 0;
  const completionLabel = hasOpenLane ? `${completionPercent}% complete` : "no open work";
  const progressLabel = hasOpenLane ? `${completionPercent}%` : "--";
  const estimatedLabel = totalEstimateMinutes > 0 ? (formatTaskEstimate(totalEstimateMinutes) ?? "--") : "--";

  return (
    <Card className="today-summary-shell border-[var(--border)]">
      <CardContent className="px-5 pb-5 pt-5">
        <div className="today-summary-layout">
          <div className="today-summary-head">
            <div>
              <p className="glass-label text-signal-live">Today lane</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {totalCount > 0
                  ? `${totalCount} selected · ${plannedCount} planned · ${inProgressCount} active · ${completionLabel}`
                  : "No selected tasks yet. Add a focused task from suggestions or the full task queue."}
              </p>
            </div>
            <div className="today-summary-progress">
              <div className="flex items-center justify-between gap-3 text-xs text-[color:var(--muted-foreground)]">
                <span>Progress</span>
                <span className="tabular font-semibold text-[color:var(--foreground)]">{progressLabel}</span>
              </div>
              <div className="progress-flat mt-2">
                <div className="progress-flat-fill" style={{ width: `${completionPercent}%` }} />
              </div>
            </div>
          </div>

          <div className="today-summary-grid">
            <SummaryMetric
              icon={CircleDashed}
              label="Planned"
              value={String(plannedCount)}
              detail="Ready to start"
            />
            <SummaryMetric
              icon={PlayCircle}
              label="In progress"
              value={String(inProgressCount)}
              detail="Active work"
              tone="active"
            />
            <SummaryMetric
              icon={CircleAlert}
              label="Blocked"
              value={String(blockedCount)}
              detail="Needs decision"
              tone="warn"
            />
            <SummaryMetric
              icon={CircleCheck}
              label="Completed"
              value={String(completedCount)}
              detail="Closed today"
              tone="active"
            />
            <SummaryMetric
              icon={ListChecks}
              label="Estimated"
              value={estimatedLabel}
              detail="Planned load"
            />
            <SummaryMetric
              icon={Clock3}
              label="Tracked today"
              value={trackedTodayLabel}
              detail="Timer total"
              tone="info"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
