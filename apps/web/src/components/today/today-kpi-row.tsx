import {
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  CirclePlay,
  Timer,
} from "lucide-react";

import { StatCard } from "@/components/ui/stat-card";
import { formatDisplayDuration, formatDisplayEstimate } from "@/lib/presentation-format";
import type { TodayPlan } from "@ega/application";

const COMPACT_STAT_CARD = "pt-2.5 pb-2.5 leading-snug";

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
  const plannedDetailed = formatDisplayEstimate(summary.totalEstimateMinutes);
  // KPI strip: minute precision, so a tracked total never reads with seconds.
  const trackedDetailed = formatDisplayDuration(summary.trackedTodaySeconds, "minute");

  return (
    <div className="kpi-grid" data-testid="today-kpi-row">
      <StatCard
        label="Planned today"
        icon={CalendarCheck2}
        value={summary.plannedCount}
        subtitle={plannedDetailed ? `${plannedDetailed} planned load` : "tasks planned for today"}
        data-testid="today-kpi-planned"
        className={COMPACT_STAT_CARD}
      />
      <StatCard
        label="In progress today"
        icon={CirclePlay}
        value={summary.inProgressCount}
        subtitle="tasks in progress"
        data-testid="today-kpi-in-progress"
        className={COMPACT_STAT_CARD}
      />
      <StatCard
        label="Completed today"
        icon={CheckCircle2}
        value={summary.completedCount}
        subtitle="tasks completed today"
        data-testid="today-kpi-completed"
        className={COMPACT_STAT_CARD}
      />
      <StatCard
        label="Tracked today"
        icon={Timer}
        value={hasActiveTimer ? `${trackedDetailed} + live` : trackedDetailed}
        subtitle="focus time logged"
        data-testid="today-kpi-tracked"
        className={COMPACT_STAT_CARD}
      />
      <StatCard
        label="Overdue"
        icon={CircleAlert}
        value={globalOverdueCount}
        subtitle="tasks past due across the workspace"
        data-testid="today-kpi-overdue"
        className={COMPACT_STAT_CARD}
      />
    </div>
  );
}
