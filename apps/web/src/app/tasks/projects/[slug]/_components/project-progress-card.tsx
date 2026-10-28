import Link from "next/link";
import { CircleSlash } from "lucide-react";

import type { ProjectProgressSummary } from "@ega/application";

import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getProjectStatusBarColor } from "@/lib/project-overview";
import { formatTaskToken } from "@/lib/task-domain";

type ProjectProgressCardProps = {
  projectId: string;
  progress: ProjectProgressSummary;
  archivedTaskCount: number;
};

function statusFilterHref(projectId: string, status: string) {
  const params = new URLSearchParams({ project: projectId, status });
  return `/tasks?${params.toString()}`;
}

export function ProjectProgressCard({
  projectId,
  progress,
  archivedTaskCount,
}: ProjectProgressCardProps) {
  const { totalTaskCount, completedTaskCount, progressPercent, statusCounts } = progress;

  return (
    <Card
      label="Progress"
      title="Completion"
      action={
        <span className="text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]">
          {completedTaskCount}/{totalTaskCount} done
        </span>
      }
    >
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-[length:var(--text-page)] font-semibold leading-none tracking-[var(--tracking-tight)] tabular-nums text-[color:var(--ega-text)]">
            {progressPercent}%
          </p>
          <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
            {progress.openTaskCount} open
            {archivedTaskCount > 0 ? ` · ${archivedTaskCount} archived` : ""}
          </p>
        </div>

        <ProgressBar
          value={progressPercent}
          label="Project completion"
          valueText={`${completedTaskCount} of ${totalTaskCount} tasks done (${progressPercent}%)`}
          variant="green"
          size="md"
        />

        {statusCounts.length ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-stretch gap-1" role="group" aria-label="Tasks by status">
              {statusCounts.map((entry) => (
                <Link
                  key={entry.status}
                  href={statusFilterHref(projectId, entry.status)}
                  aria-label={`${entry.count} ${formatTaskToken(entry.status)} ${
                    entry.count === 1 ? "task" : "tasks"
                  } — open the filtered task list`}
                  className="group flex min-h-8 min-w-8 items-center rounded-[var(--radius-sm)] px-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
                  style={{ flexGrow: entry.count, flexBasis: 0 }}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-full rounded-[var(--radius-pill)] transition-[filter] group-hover:brightness-110 motion-reduce:transition-none"
                    style={{ background: getProjectStatusBarColor(entry.status) }}
                  />
                </Link>
              ))}
            </div>

            <ul className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Status legend">
              {statusCounts.map((entry) => (
                <li key={entry.status} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: getProjectStatusBarColor(entry.status) }}
                  />
                  <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                    {formatTaskToken(entry.status)}
                  </span>
                  <span className="tabular-nums text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text)]">
                    {entry.count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--ega-border)] px-3 py-3">
            <CircleSlash
              className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
                No active tasks yet
              </p>
              <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
                Progress starts at zero and updates when this project has tasks.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
