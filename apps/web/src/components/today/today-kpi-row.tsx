import {
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  CirclePlay,
  Timer,
} from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { formatTaskEstimate } from "@/lib/task-estimate";
import type { TodayPlan } from "@ega/application";

export type TodayKpiRowProps = {
  summary: TodayPlan["summary"];
  hasActiveTimer: boolean;
  /**
   * Canonical global overdue count from `getWorkspaceShellMetrics()`.
   *
   * The metric labelled "Overdue" on Today must use the same global shell
   * semantics as the sidebar/task signals so two visible values can never
   * disagree. `summary.overdueCount` keeps selected-Today-lane semantics and is
   * intentionally not rendered as an unqualified "overdue" number.
   */
  globalOverdueCount: number;
};

/** The Today KPI strip: planned, in progress, completed, tracked, overdue. */
export function TodayKpiRow({
  summary,
  hasActiveTimer,
  globalOverdueCount,
}: TodayKpiRowProps) {
  const plannedDetailed = formatTaskEstimate(summary.totalEstimateMinutes);

  return (
    <div className="kpi-grid" data-testid="today-kpi-row">
      <StatCard
        label="Planned"
        icon={CalendarCheck2}
        value={summary.plannedCount}
        subtitle={plannedDetailed ? `${plannedDetailed} planned load` : "tasks planned for today"}
        data-testid="today-kpi-planned"
      />
      <StatCard
        label="In progress"
        icon={CirclePlay}
        value={summary.inProgressCount}
        subtitle="tasks in progress"
        data-testid="today-kpi-in-progress"
      />
      <StatCard
        label="Completed"
        icon={CheckCircle2}
        value={summary.completedCount}
        subtitle="tasks completed today"
        data-testid="today-kpi-completed"
      />
      <StatCard
        label="Tracked today"
        icon={Timer}
        value={hasActiveTimer ? `${summary.trackedTodayLabel} + live` : summary.trackedTodayLabel}
        subtitle="focus time logged"
        data-testid="today-kpi-tracked"
      />
      <StatCard
        label="Overdue"
        icon={CircleAlert}
        value={globalOverdueCount}
        subtitle="tasks past due across the workspace"
        data-testid="today-kpi-overdue"
      />
    </div>
  );
}
