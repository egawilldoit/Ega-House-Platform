import type { ReactNode } from "react";

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
  /**
   * Today's configured work target, already derived by the morning startup
   * model. Display-only: when positive, tracked time is drawn against it.
   */
  workTargetMinutes?: number;
  workTargetLabel?: string;
};

function Metric({
  testId,
  label,
  title,
  children,
}: {
  testId: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={testId} title={title}>
      <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">{children}</span>
    </div>
  );
}

/** The Today metrics: a quiet figure grid inside the focus stage. */
export function TodayKpiRow({
  summary,
  hasActiveTimer,
  globalOverdueCount,
  workTargetMinutes = 0,
  workTargetLabel,
}: TodayKpiRowProps) {
  const plannedDetailed = formatDisplayEstimate(summary.totalEstimateMinutes);
  // KPI strip: minute precision, so a tracked total never reads with seconds.
  const trackedDetailed = formatDisplayDuration(summary.trackedTodaySeconds, "minute");
  const targetPercent =
    workTargetMinutes > 0
      ? Math.min(100, Math.round((summary.trackedTodaySeconds / 60 / workTargetMinutes) * 100))
      : null;
  const figure = "tabular-nums text-xl font-medium text-[color:var(--ega-text)]";

  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="today-kpi-row">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Metric
          testId="today-kpi-planned"
          label="Planned today"
          title={plannedDetailed ? `${plannedDetailed} planned load` : "tasks planned for today"}
        >
          <span className={figure}>{summary.plannedCount}</span>
          {plannedDetailed ? (
            <span className="tabular-nums text-xs text-[color:var(--ega-text-tertiary)]">
              ({plannedDetailed})
            </span>
          ) : null}
        </Metric>
        <Metric testId="today-kpi-in-progress" label="In progress today" title="tasks in progress">
          <span className={figure}>{summary.inProgressCount}</span>
        </Metric>
        <Metric testId="today-kpi-completed" label="Completed today" title="tasks completed today">
          <span className={figure}>{summary.completedCount}</span>
        </Metric>
        <Metric testId="today-kpi-overdue" label="Overdue" title="tasks past due across the workspace">
          <span
            className={`tabular-nums text-xl font-medium ${globalOverdueCount > 0 ? "text-[color:var(--status-overdue)]" : "text-[color:var(--ega-text)]"}`}
          >
            {globalOverdueCount}
          </span>
          <span className="sr-only">tasks past due across the workspace</span>
        </Metric>
      </div>

      <div className="flex flex-col gap-2" data-testid="today-kpi-tracked" title="focus time logged">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            Tracked today
          </span>
          <span className="tabular-nums text-[color:var(--ega-text-secondary)]">
            <span className="font-medium text-[color:var(--ega-text)]">
              {hasActiveTimer ? `${trackedDetailed} + live` : trackedDetailed}
            </span>
            {targetPercent !== null && workTargetLabel ? ` / ${workTargetLabel}` : null}
          </span>
        </div>
        {targetPercent !== null ? (
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-[var(--ega-border)]"
            role="progressbar"
            aria-label="Tracked time against today's work target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={targetPercent}
          >
            <div
              className="tw-progress-fill h-full rounded-full bg-[var(--tw-accent,var(--status-healthy))]"
              style={{ width: `${targetPercent}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
