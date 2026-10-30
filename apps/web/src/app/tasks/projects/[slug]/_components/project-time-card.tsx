import { EstimateVsActualBadge } from "@/components/tasks/estimate-vs-actual-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { EstimateVsActualAggregate } from "@ega/application";
import type { ProjectTimeSummary } from "@/lib/project-overview";
import { formatDurationLabel } from "@/lib/task-session";

type ProjectTimeCardProps = {
  summary: ProjectTimeSummary;
  /** Canonical comparison over estimated Tasks; null comparison means none. */
  estimateVsActual: EstimateVsActualAggregate;
  archivedTaskCount: number;
};

export function ProjectTimeCard({
  summary,
  estimateVsActual,
  archivedTaskCount,
}: ProjectTimeCardProps) {
  const comparison = estimateVsActual.comparison;
  const estimateSeconds = estimateVsActual.estimateMinutes * 60;
  const hasEstimate = comparison !== null;
  const hasTrackedTime = summary.totalTrackedSeconds > 0;
  const estimateProgress =
    comparison && estimateSeconds > 0
      ? Math.round((estimateVsActual.trackedSeconds / estimateSeconds) * 100)
      : null;
  const weekSessions = `${summary.weekSessionCount} ${
    summary.weekSessionCount === 1 ? "session" : "sessions"
  }`;
  const uncoveredTrackedSeconds =
    estimateVsActual.trackedSecondsOnAllTasks - estimateVsActual.trackedSeconds;

  return (
    <Card label="Time" title="Tracked time">
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            label="Tracked this week"
            value={formatDurationLabel(summary.weekTrackedSeconds)}
            caption={`${weekSessions} overlapping this week`}
          />
          <Metric
            label="Estimate vs actual"
            value={
              hasEstimate
                ? formatDurationLabel(estimateVsActual.trackedSeconds)
                : "No estimate"
            }
            caption={
              hasEstimate
                ? `of ${formatDurationLabel(estimateSeconds)} estimated across ${
                    estimateVsActual.estimatedTaskCount
                  } ${
                    estimateVsActual.estimatedTaskCount === 1 ? "task" : "tasks"
                  } with estimates`
                : "Add an estimate to compare planned and tracked time."
            }
          />
        </div>

        {hasEstimate ? (
          <div className="flex flex-wrap items-center gap-2">
            <EstimateVsActualBadge
              estimateMinutes={estimateVsActual.estimateMinutes}
              trackedSeconds={estimateVsActual.trackedSeconds}
              hasOpenSession={estimateVsActual.hasOpenSessions}
            />
            <span className="text-[length:var(--text-meta)] text-ega-text-tertiary">
              {estimateVsActual.estimatedTaskCount} of {estimateVsActual.taskCount} tasks
              estimated
              {uncoveredTrackedSeconds > 0
                ? ` · ${formatDurationLabel(uncoveredTrackedSeconds)} tracked on tasks without an estimate`
                : ""}
            </span>
          </div>
        ) : null}

        {estimateProgress !== null ? (
          <ProgressBar
            value={estimateProgress}
            label="Tracked time on estimated tasks against their estimate"
            valueText={`${formatDurationLabel(
              estimateVsActual.trackedSeconds,
            )} tracked of ${formatDurationLabel(estimateSeconds)} estimated (${estimateProgress}%)`}
            variant={estimateProgress > 100 ? "cyan" : "green"}
          />
        ) : null}

        <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-tertiary)]">
          {hasTrackedTime
            ? "Actual time comes from tracked timer sessions; the estimate comparison only counts tasks that carry an estimate."
            : "No time has been tracked for this project yet."}
          {archivedTaskCount > 0
            ? " Historical time for archived tasks stays included."
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}
