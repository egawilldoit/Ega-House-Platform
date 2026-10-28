import { Card, CardContent } from "@/components/ui/card";
import { Metric } from "@/components/ui/metric";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { ProjectTimeSummary } from "@/lib/project-overview";
import { formatDurationLabel } from "@/lib/task-session";

type ProjectTimeCardProps = {
  summary: ProjectTimeSummary;
  archivedTaskCount: number;
};

export function ProjectTimeCard({ summary, archivedTaskCount }: ProjectTimeCardProps) {
  const estimateSeconds = summary.estimatedMinutes * 60;
  const hasEstimate = summary.estimatedMinutes > 0;
  const hasTrackedTime = summary.totalTrackedSeconds > 0;
  const estimateProgress = hasEstimate
    ? Math.round((summary.totalTrackedSeconds / estimateSeconds) * 100)
    : 0;
  const weekSessions = `${summary.weekSessionCount} ${
    summary.weekSessionCount === 1 ? "session" : "sessions"
  }`;

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
              hasEstimate ? formatDurationLabel(summary.totalTrackedSeconds) : "No estimate"
            }
            caption={
              hasEstimate
                ? `of ${formatDurationLabel(estimateSeconds)} estimated across ${
                    summary.estimatedTaskCount
                  } ${summary.estimatedTaskCount === 1 ? "task" : "tasks"}`
                : "Add an estimate to compare planned and tracked time."
            }
          />
        </div>

        {hasEstimate ? (
          <ProgressBar
            value={estimateProgress}
            label="Project tracked time against estimate"
            valueText={`${formatDurationLabel(
              summary.totalTrackedSeconds,
            )} tracked of ${formatDurationLabel(estimateSeconds)} estimated (${estimateProgress}%)`}
            variant={estimateProgress > 100 ? "cyan" : "green"}
          />
        ) : null}

        <p className="text-[length:var(--text-meta)] leading-[var(--leading-snug)] text-[color:var(--ega-text-tertiary)]">
          {hasTrackedTime
            ? "Actual time comes from tracked timer sessions."
            : "No time has been tracked for this project yet."}
          {archivedTaskCount > 0
            ? " Historical time for archived tasks stays included."
            : ""}
        </p>
      </CardContent>
    </Card>
  );
}
