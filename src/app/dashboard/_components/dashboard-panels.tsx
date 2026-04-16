import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { formatTimerDateTime } from "@/lib/timer-domain";

import type {
  DashboardActiveSession,
  DashboardHealthData,
  DashboardLinearProject,
  DashboardProjectStatus,
  DashboardTodayTask,
} from "../_lib/dashboard-data";

type HealthCardProps = {
  health: DashboardHealthData;
};

type TodaysTasksPanelProps = {
  tasks: DashboardTodayTask[] | null;
  error: string | null;
};

type ActiveTimerPanelProps = {
  activeSession: DashboardActiveSession | null;
  error: string | null;
};

type ProjectStatusPanelProps = {
  projects: DashboardProjectStatus[] | null;
  error: string | null;
};

type LinearProgressPanelProps = {
  project: DashboardLinearProject | null;
  error: string | null;
};

const panelNoticeClassName =
  "min-h-[4.25rem] rounded-2xl px-4 py-3 text-sm leading-7";

function getHealthTone(state: DashboardHealthData["state"]) {
  return state === "healthy" ? "success" : "warn";
}

function getProjectHref(slug: string | null | undefined) {
  const normalizedSlug = slug?.trim();

  if (!normalizedSlug) {
    return null;
  }

  return `/tasks/projects/${encodeURIComponent(normalizedSlug)}`;
}

function getTaskContextHref(session: DashboardActiveSession) {
  const projectHref = getProjectHref(session.projectSlug);
  if (!projectHref) {
    return null;
  }

  return `${projectHref}#task-${session.taskId}`;
}

function getSafeExternalUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function HealthCard({ health }: HealthCardProps) {
  const stateLabel = health.state === "healthy" ? "Healthy" : "Unavailable";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform health</CardTitle>
        <CardDescription>
          Server-side OpenClaw probe status for this dashboard render.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={getHealthTone(health.state)}>{stateLabel}</Badge>
        </div>
        <p className="text-sm leading-7 text-slate-300">{health.statusText}</p>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
          Last checked {formatTimerDateTime(health.checkedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

export function TodaysTasksPanel({ tasks, error }: TodaysTasksPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s tasks</CardTitle>
        <CardDescription>
          Tasks updated today, ordered by most recent activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            className={`${panelNoticeClassName} border border-rose-400/35 bg-rose-400/10 text-rose-100`}
          >
            {error}
          </p>
        ) : null}

        {!error && (!tasks || tasks.length === 0) ? (
          <p
            className={`${panelNoticeClassName} border border-dashed border-white/10 bg-white/[0.02] text-slate-400`}
          >
            No task updates yet today.
          </p>
        ) : null}

        {!error && tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article
                key={task.id}
                className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-slate-100">{task.title}</h3>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {task.projectName}
                      {task.goalTitle ? ` - ${task.goalTitle}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={getTaskStatusTone(task.status)}>
                      {formatTaskToken(task.status)}
                    </Badge>
                    <Badge>{formatTaskToken(task.priority)}</Badge>
                  </div>
                </div>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                  Updated {formatTimerDateTime(task.updatedAt)}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ActiveTimerPanel({ activeSession, error }: ActiveTimerPanelProps) {
  const taskContextHref = activeSession ? getTaskContextHref(activeSession) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active timer</CardTitle>
        <CardDescription>
          Current open task session where ended_at is null.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            className={`${panelNoticeClassName} border border-rose-400/35 bg-rose-400/10 text-rose-100`}
          >
            {error}
          </p>
        ) : null}

        {!error && !activeSession ? (
          <p
            className={`${panelNoticeClassName} border border-dashed border-white/10 bg-white/[0.02] text-slate-400`}
          >
            No active timer running.
          </p>
        ) : null}

        {!error && activeSession ? (
          <article className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-slate-100">
                  {activeSession.taskTitle}
                </h3>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {activeSession.projectName}
                  {activeSession.goalTitle ? ` - ${activeSession.goalTitle}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={getTaskStatusTone(activeSession.taskStatus)}>
                  {formatTaskToken(activeSession.taskStatus)}
                </Badge>
                <Badge>{formatTaskToken(activeSession.taskPriority)}</Badge>
              </div>
            </div>

            <div className="space-y-1 text-sm text-slate-300">
              <p>
                Elapsed <span className="font-semibold text-slate-100">{activeSession.elapsedLabel}</span>
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Started {formatTimerDateTime(activeSession.startedAt)}
              </p>
            </div>

            {taskContextHref ? (
              <Link
                href={taskContextHref}
                className="inline-flex min-h-10 items-center rounded-full border border-white/12 bg-white/[0.03] px-4 text-sm font-medium text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100"
              >
                Open task context
              </Link>
            ) : null}
          </article>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProjectStatusPanel({ projects, error }: ProjectStatusPanelProps) {
  const statusCounts =
    projects?.reduce<Record<string, number>>((counts, project) => {
      counts[project.status] = (counts[project.status] ?? 0) + 1;
      return counts;
    }, {}) ?? {};

  const statusBreakdown = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project status</CardTitle>
        <CardDescription>
          Status-only visibility from the projects table. Numeric progress is not
          currently stored.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            className={`${panelNoticeClassName} border border-rose-400/35 bg-rose-400/10 text-rose-100`}
          >
            {error}
          </p>
        ) : null}

        {!error && (!projects || projects.length === 0) ? (
          <p
            className={`${panelNoticeClassName} border border-dashed border-white/10 bg-white/[0.02] text-slate-400`}
          >
            No projects yet.
          </p>
        ) : null}

        {!error && projects && projects.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {statusBreakdown.map((entry) => (
                <Badge key={entry.status} tone={getTaskStatusTone(entry.status)}>
                  {entry.count} {formatTaskToken(entry.status)}
                </Badge>
              ))}
            </div>

            <div className="space-y-3">
              {projects.map((project) => {
                const projectHref = getProjectHref(project.slug);

                return (
                  <article
                    key={project.id}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-slate-100">{project.name}</h3>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Updated {formatTimerDateTime(project.updatedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={getTaskStatusTone(project.status)}>
                          {formatTaskToken(project.status)}
                        </Badge>
                        {projectHref ? (
                          <Link
                            href={projectHref}
                            className="inline-flex min-h-9 items-center rounded-full border border-white/12 bg-white/[0.03] px-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100"
                          >
                            Open
                          </Link>
                        ) : (
                          <span className="inline-flex min-h-9 items-center rounded-full border border-white/12 bg-white/[0.02] px-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                            Unavailable
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LinearProgressPanel({ project, error }: LinearProgressPanelProps) {
  const projectUrl = getSafeExternalUrl(project?.url);
  const milestoneCount = project?.milestones.length ?? 0;
  const milestoneWithProgressCount =
    project?.milestones.filter((milestone) => milestone.progressPercent !== null).length ??
    0;
  const milestoneAverageProgress =
    milestoneWithProgressCount > 0
      ? Math.round(
          (project?.milestones.reduce((total, milestone) => {
            return total + (milestone.progressPercent ?? 0);
          }, 0) ?? 0) / milestoneWithProgressCount,
        )
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linear progress</CardTitle>
        <CardDescription>
          Server-rendered snapshot from Linear for EGA House Platform.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p
            className={`${panelNoticeClassName} border border-rose-400/35 bg-rose-400/10 text-rose-100`}
          >
            {error}
          </p>
        ) : null}

        {!error && !project ? (
          <p
            className={`${panelNoticeClassName} border border-dashed border-white/10 bg-white/[0.02] text-slate-400`}
          >
            No Linear project snapshot is available yet.
          </p>
        ) : null}

        {!error && project ? (
          <div className="space-y-4">
            <article className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-slate-100">{project.name}</h3>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Updated {formatTimerDateTime(project.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {project.status ? (
                    <Badge tone={getTaskStatusTone(project.status)}>
                      {formatTaskToken(project.status)}
                    </Badge>
                  ) : null}
                  {project.priority ? <Badge>{project.priority}</Badge> : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {project.targetDate ? (
                  <Badge tone="warn">Target {formatDate(project.targetDate)}</Badge>
                ) : (
                  <Badge>Target not set</Badge>
                )}
                {milestoneAverageProgress !== null ? (
                  <Badge tone="accent">
                    Milestone avg {milestoneAverageProgress}%
                  </Badge>
                ) : null}
              </div>

              {projectUrl ? (
                <Link
                  href={projectUrl}
                  className="mt-4 inline-flex min-h-9 items-center rounded-full border border-white/12 bg-white/[0.03] px-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/10 hover:text-cyan-100"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Linear
                </Link>
              ) : null}
            </article>

            {milestoneCount > 0 ? (
              <article className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge>
                    {milestoneCount} {milestoneCount === 1 ? "Milestone" : "Milestones"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  {project.milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 px-3 py-2"
                    >
                      <div className="space-y-1">
                        <p className="text-sm text-slate-100">{milestone.name}</p>
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {milestone.targetDate
                            ? `Target ${formatDate(milestone.targetDate)}`
                            : "No target"}
                        </p>
                      </div>
                      <Badge tone="accent">
                        {milestone.progressPercent === null
                          ? "No progress"
                          : `${milestone.progressPercent}%`}
                      </Badge>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}

            {project.issueStatusCounts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {project.issueStatusCounts.map((entry) => (
                  <Badge key={entry.state} tone={getTaskStatusTone(entry.state)}>
                    {entry.count} {formatTaskToken(entry.state)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
