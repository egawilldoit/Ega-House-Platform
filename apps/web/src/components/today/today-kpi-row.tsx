import {
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  CirclePlay,
  Timer,
} from "lucide-react";

import { formatDisplayDuration, formatDisplayEstimate } from "@/lib/presentation-format";
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

/** The Today KPI strip: compact single-line metric bar (~40px) replacing the bulky card grid. */
export function TodayKpiRow({
  summary,
  hasActiveTimer,
  globalOverdueCount,
}: TodayKpiRowProps) {
  const plannedDetailed = formatDisplayEstimate(summary.totalEstimateMinutes);
  // KPI strip: minute precision, so a tracked total never reads with seconds.
  const trackedDetailed = formatDisplayDuration(summary.trackedTodaySeconds, "minute");

  return (
    <div
      className="flex flex-wrap items-center gap-3 sm:gap-6 rounded-lg border border-[var(--ega-border)] bg-[var(--ega-surface)] px-4 py-2.5 text-sm"
      data-testid="today-kpi-row"
    >
      <div
        className="flex items-center gap-2"
        data-testid="today-kpi-planned"
        title={plannedDetailed ? `${plannedDetailed} planned load` : "tasks planned for today"}
      >
        <CalendarCheck2 className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
        <span className="text-[color:var(--ega-text-secondary)]">Planned today:</span>
        <span className="tabular-nums font-semibold text-[color:var(--ega-text)]">{summary.plannedCount}</span>
        {plannedDetailed ? (
          <span className="text-xs text-[color:var(--ega-text-tertiary)]">({plannedDetailed})</span>
        ) : null}
      </div>

      <div className="hidden sm:block h-4 w-px bg-[var(--ega-border)]" aria-hidden="true" />

      <div
        className="flex items-center gap-2"
        data-testid="today-kpi-in-progress"
        title="tasks in progress"
      >
        <CirclePlay className="h-4 w-4 shrink-0 text-[color:var(--status-healthy)]" aria-hidden="true" />
        <span className="text-[color:var(--ega-text-secondary)]">In progress today:</span>
        <span className="tabular-nums font-semibold text-[color:var(--ega-text)]">{summary.inProgressCount}</span>
      </div>

      <div className="hidden sm:block h-4 w-px bg-[var(--ega-border)]" aria-hidden="true" />

      <div
        className="flex items-center gap-2"
        data-testid="today-kpi-completed"
        title="tasks completed today"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[color:var(--status-healthy)]" aria-hidden="true" />
        <span className="text-[color:var(--ega-text-secondary)]">Completed today:</span>
        <span className="tabular-nums font-semibold text-[color:var(--ega-text)]">{summary.completedCount}</span>
      </div>

      <div className="hidden sm:block h-4 w-px bg-[var(--ega-border)]" aria-hidden="true" />

      <div
        className="flex items-center gap-2"
        data-testid="today-kpi-tracked"
        title="focus time logged"
      >
        <Timer className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]" aria-hidden="true" />
        <span className="text-[color:var(--ega-text-secondary)]">Tracked today:</span>
        <span className="tabular-nums font-semibold text-[color:var(--ega-text)]">
          {hasActiveTimer ? `${trackedDetailed} + live` : trackedDetailed}
        </span>
      </div>

      <div className="hidden sm:block h-4 w-px bg-[var(--ega-border)]" aria-hidden="true" />

      <div
        className={`flex items-center gap-2 ${globalOverdueCount > 0 ? "text-[color:var(--status-overdue)]" : "text-[color:var(--ega-text-secondary)]"}`}
        data-testid="today-kpi-overdue"
        title="tasks past due across the workspace"
      >
        <CircleAlert
          className={`h-4 w-4 shrink-0 ${globalOverdueCount > 0 ? "text-[color:var(--status-overdue)]" : "text-[color:var(--ega-text-tertiary)]"}`}
          aria-hidden="true"
        />
        <span className={globalOverdueCount > 0 ? "font-medium" : ""}>Overdue:</span>
        <span className="tabular-nums font-semibold">{globalOverdueCount}</span>
        <span className="sr-only">tasks past due across the workspace</span>
      </div>
    </div>
  );
}
