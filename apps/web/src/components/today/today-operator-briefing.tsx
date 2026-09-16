import type { TodayPlan } from "@ega/application";

import { formatTaskEstimate } from "@/lib/task-estimate";

export type TodayOperatorBriefingProps = {
  summary: TodayPlan["summary"];
  hasActiveTimer: boolean;
  /**
   * Canonical global overdue count from `getWorkspaceShellMetrics()`.
   *
   * The metric simply labelled "overdue" on Today must use the same global
   * shell semantics as the top-bar signal so the two visible values can never
   * disagree. `summary.overdueCount` keeps selected-Today-lane semantics and is
   * intentionally not rendered here as an unqualified "overdue" number.
   */
  globalOverdueCount: number;
};

export function TodayOperatorBriefing({
  summary,
  hasActiveTimer,
  globalOverdueCount,
}: TodayOperatorBriefingProps) {
  return (
    <div className="today-operator-brief" aria-label="Daily Operator briefing">
      <div>
        <p className="glass-label text-signal-live">Morning briefing</p>
        <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">Here’s what matters today.</h2>
      </div>
      <div className="today-operator-state-strip">
        <span><strong>{formatTaskEstimate(summary.totalEstimateMinutes) ?? "—"}</strong> planned load</span>
        <span><strong>{summary.plannedCount + summary.inProgressCount}</strong> active lane</span>
        <span><strong>{globalOverdueCount}</strong> overdue</span>
        <span><strong>{hasActiveTimer ? "Live" : "None"}</strong> timer</span>
        <span><strong>{summary.completedCount}</strong> completed</span>
      </div>
    </div>
  );
}
