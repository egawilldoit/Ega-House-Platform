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

type DashboardMetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: "active" | "muted" | "warn" | "error" | "info";
};

type DeploymentFocusPanelProps = {
  health: DashboardHealthData;
  activeSession: DashboardActiveSession | null;
  activeTimerError: string | null;
  project: DashboardLinearProject | null;
  projectError: string | null;
};

const panelNoticeClassName =
  "feedback-block min-h-[4.25rem] border-[var(--border)] bg-[color:var(--instrument-raised)] text-[color:var(--muted-foreground)]";

const panelCardClassName =
  "border-[var(--border)] bg-white";

const panelItemClassName =
  "rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4";

const panelLabelClassName =
  "text-[0.625rem] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]";

const panelValueClassName =
  "text-sm font-semibold normal-case tracking-normal text-[color:var(--foreground)]";

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

function formatRelativeTime(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();

  if (!Number.isFinite(diffMs)) {
    return "Pending";
  }

  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMinutes < 1) {
    return "Now";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return `${Math.floor(diffHours / 24)}d`;
}

function getMetricValueTone(tone: DashboardMetricCardProps["tone"]) {
  switch (tone) {
    case "active":
      return "text-[var(--signal-live)]";
    case "warn":
      return "text-[var(--signal-warn)]";
    case "error":
      return "text-[var(--signal-error)]";
    case "info":
      return "text-[var(--signal-info)]";
    default:
      return "text-[color:var(--foreground)]";
  }
}

function getPriorityQueueTone(task: DashboardTodayTask) {
  if (task.status === "blocked" || task.priority === "urgent") {
    return "error" as const;
  }

  if (task.priority === "high") {
    return "warn" as const;
  }

  if (task.status === "in_progress") {
    return "info" as const;
  }

  return "muted" as const;
}

function getPriorityQueueLabel(task: DashboardTodayTask) {
  if (task.status === "blocked") {
    return "Blocked";
  }

  if (task.priority === "urgent") {
    return "Critical";
  }

  if (task.priority === "high") {
    return "High";
  }

  return formatRelativeTime(task.updatedAt);
}

function getDeploymentProgressPercent(project: DashboardLinearProject | null) {
  if (!project) {
    return null;
  }

  const milestonesWithProgress = project.milestones.filter(
    (milestone) => milestone.progressPercent !== null,
  );

  if (milestonesWithProgress.length > 0) {
    return Math.round(
      milestonesWithProgress.reduce((total, milestone) => {
        return total + (milestone.progressPercent ?? 0);
      }, 0) / milestonesWithProgress.length,
    );
  }

  const totalIssues = project.issueStatusCounts.reduce((total, entry) => {
    return total + entry.count;
  }, 0);

  if (totalIssues === 0) {
    return null;
  }

  const doneIssues = project.issueStatusCounts.reduce((total, entry) => {
    return ["done", "complete", "completed"].includes(entry.state.toLowerCase())
      ? total + entry.count
      : total;
  }, 0);

  return Math.round((doneIssues / totalIssues) * 100);
}

function getDeploymentSummary(project: DashboardLinearProject | null) {
  if (!project) {
    return "No Linear project snapshot is available yet. The command center is waiting for the next synchronized project feed.";
  }

  const milestoneCount = project.milestones.length;
  const issueCount = project.issueStatusCounts.reduce((total, entry) => total + entry.count, 0);

  return [
    milestoneCount > 0
      ? `${milestoneCount} milestone${milestoneCount === 1 ? "" : "s"} tracked`
      : "Milestones pending",
    issueCount > 0 ? `${issueCount} issue states synchronized` : "Issue telemetry pending",
    project.targetDate ? `Target ${formatDate(project.targetDate)}` : "Target date not set",
  ].join(" · ");
}

function ProgressRing({ percent }: { percent: number | null }) {
  const normalizedPercent = Math.max(0, Math.min(percent ?? 0, 100));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercent / 100);

  return (
    <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
        <circle
          className="stroke-[color:var(--border)]"
          cx="50"
          cy="50"
          fill="none"
          r={radius}
          strokeWidth="6"
        />
        <circle
          className="stroke-[var(--signal-live)]"
          cx="50"
          cy="50"
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth="6"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span
          className="text-3xl font-semibold tracking-tight text-[color:var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {percent === null ? "--" : `${normalizedPercent}%`}
        </span>
        <span className={panelLabelClassName}>Complete</span>
      </div>
    </div>
  );
}

export function DashboardMetricCard({
  label,
  value,
  detail,
  tone = "muted",
}: DashboardMetricCardProps) {
  const isHighlight = tone === "active";
  return (
    <div className={`stat-card ${isHighlight ? "stat-card-highlight" : ""}`}>
      <div className="stat-card-arrow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="7" y1="17" x2="17" y2="7" />
          <polyline points="7 7 17 7 17 17" />
        </svg>
      </div>
      <div className="stat-card-label">{label}</div>
      <div className={`stat-card-value ${!isHighlight ? getMetricValueTone(tone) : ""}`}>
        {value}
      </div>
      <div className="stat-card-detail">
        {(tone === "active" || tone === "info") && (
          <svg className="trend-up" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        )}
        {detail}
      </div>
    </div>
  );
}

export function DeploymentFocusPanel({
  health,
  activeSession,
  activeTimerError,
  project,
  projectError,
}: DeploymentFocusPanelProps) {
  const progressPercent = getDeploymentProgressPercent(project);
  const projectUrl = getSafeExternalUrl(project?.url);
  const healthLabel = health.state === "healthy" ? "Nominal" : "Degraded";
  const timerStatus = activeTimerError
    ? "Timer feed unavailable"
    : activeSession
      ? activeSession.elapsedLabel
      : "Idle";

  return (
    <Card className={`${panelCardClassName} h-full`}>
      <CardContent className="flex h-full flex-col gap-6 p-8 lg:flex-row lg:items-center">
        <div className="flex-1">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone="active">Active Deployment</Badge>
            <Badge tone={getHealthTone(health.state)}>{healthLabel}</Badge>
            {project?.status ? (
              <Badge tone={getTaskStatusTone(project.status)}>
                {formatTaskToken(project.status)}
              </Badge>
            ) : null}
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-[color:var(--foreground)]">
            {project?.name ?? activeSession?.taskTitle ?? "Operational command feed"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--muted-foreground)]">
            {projectError
              ? projectError
              : project
                ? getDeploymentSummary(project)
                : activeSession
                  ? `${activeSession.projectName}${
                      activeSession.goalTitle ? ` · ${activeSession.goalTitle}` : ""
                    } · Started ${formatTimerDateTime(activeSession.startedAt)}`
                  : "No active deployment or timer is currently running."}
          </p>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <div className={panelItemClassName}>
              <dt className={panelLabelClassName}>Status</dt>
              <dd className={`mt-2 break-words leading-5 ${panelValueClassName}`}>
                {project?.status ? formatTaskToken(project.status) : "Monitoring"}
              </dd>
            </div>
            <div className={panelItemClassName}>
              <dt className={panelLabelClassName}>Timer</dt>
              <dd className={`mt-2 break-words leading-5 ${panelValueClassName}`}>{timerStatus}</dd>
            </div>
            <div className={panelItemClassName}>
              <dt className={panelLabelClassName}>Health</dt>
              <dd className={`mt-2 break-words leading-5 ${panelValueClassName}`}>
                {health.statusText}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            {projectUrl ? (
              <Link
                href={projectUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-instrument h-10 px-4 text-[10px]"
              >
                Open Linear
              </Link>
            ) : null}
            {activeSession ? (
              <Link
                href="/timer"
                className="btn-instrument btn-instrument-muted h-10 px-4 text-[10px]"
              >
                Open Timer
              </Link>
            ) : null}
          </div>
        </div>

        <ProgressRing percent={progressPercent} />
      </CardContent>
    </Card>
  );
}

export function HealthCard({ health }: HealthCardProps) {
  const stateLabel = health.state === "healthy" ? "Healthy" : "Unavailable";

  return (
    <Card className={panelCardClassName}>
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
        <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">{health.statusText}</p>
        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          Last checked {formatTimerDateTime(health.checkedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

export function TodaysTasksPanel({ tasks, error }: TodaysTasksPanelProps) {
  return (
    <Card className={panelCardClassName}>
      <CardHeader>
        <CardTitle>Today&apos;s tasks</CardTitle>
        <CardDescription>
          Tasks updated today, ordered by most recent activity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className={`${panelNoticeClassName} feedback-block-error`}>
            {error}
          </p>
        ) : null}

        {!error && (!tasks || tasks.length === 0) ? (
          <p className={panelNoticeClassName}>
            No task updates yet today.
          </p>
        ) : null}

        {!error && tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article
                key={task.id}
                className={panelItemClassName}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-[color:var(--foreground)]">{task.title}</h3>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
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
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
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
    <Card className={panelCardClassName}>
      <CardHeader>
        <CardTitle>Active timer</CardTitle>
        <CardDescription>
          Current open task session where ended_at is null.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className={`${panelNoticeClassName} feedback-block-error`}>
            {error}
          </p>
        ) : null}

        {!error && !activeSession ? (
          <p className={panelNoticeClassName}>
            No active timer running.
          </p>
        ) : null}

        {!error && activeSession ? (
          <article className={`space-y-3 ${panelItemClassName}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-[color:var(--foreground)]">
                  {activeSession.taskTitle}
                </h3>
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
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

            <div className="space-y-1 text-sm text-[color:var(--muted-foreground)]">
              <p>
                Elapsed <span className="font-semibold text-[color:var(--foreground)]">{activeSession.elapsedLabel}</span>
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                Started {formatTimerDateTime(activeSession.startedAt)}
              </p>
            </div>

            {taskContextHref ? (
              <Link
                href={taskContextHref}
                className="btn-instrument btn-instrument-muted h-10 px-4 text-[10px]"
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
    <Card className={panelCardClassName}>
      <CardHeader>
        <CardTitle>Project status</CardTitle>
        <CardDescription>
          Status-only visibility from the projects table. Numeric progress is not
          currently stored.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className={`${panelNoticeClassName} feedback-block-error`}>
            {error}
          </p>
        ) : null}

        {!error && (!projects || projects.length === 0) ? (
          <p className={panelNoticeClassName}>
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
                    className={panelItemClassName}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-[color:var(--foreground)]">{project.name}</h3>
                        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
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
                            className="btn-instrument btn-instrument-muted h-9 px-3 text-[10px]"
                          >
                            Open
                          </Link>
                        ) : (
                          <span className="inline-flex min-h-9 items-center rounded-sm border border-[var(--border)] bg-[color:var(--instrument-raised)] px-3 text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
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
    <Card className={panelCardClassName}>
      <CardHeader>
        <CardTitle>Linear progress</CardTitle>
        <CardDescription>
          Server-rendered snapshot from Linear for EGA House Platform.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className={`${panelNoticeClassName} feedback-block-error`}>
            {error}
          </p>
        ) : null}

        {!error && !project ? (
          <p className={panelNoticeClassName}>
            No Linear project snapshot is available yet.
          </p>
        ) : null}

        {!error && project ? (
          <div className="space-y-4">
            <article className={panelItemClassName}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-[color:var(--foreground)]">{project.name}</h3>
                  <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
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
                  className="btn-instrument btn-instrument-muted mt-4 h-9 px-3 text-[10px]"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Linear
                </Link>
              ) : null}
            </article>

            {milestoneCount > 0 ? (
              <article className={panelItemClassName}>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge>
                    {milestoneCount} {milestoneCount === 1 ? "Milestone" : "Milestones"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  {project.milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--border)] px-3 py-2"
                    >
                      <div className="space-y-1">
                        <p className="text-sm text-[color:var(--foreground)]">{milestone.name}</p>
                        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
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

export function PriorityQueuePanel({ tasks, error }: TodaysTasksPanelProps) {
  return (
    <Card className={`${panelCardClassName} h-full`}>
      <CardContent className="flex h-full flex-col p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
              Priority Queue
            </h3>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
              Live task pressure across today&apos;s activity.
            </p>
          </div>
          <Link href="/tasks" className="glass-label shrink-0 whitespace-nowrap text-signal-live">
            View All
          </Link>
        </div>

        {error ? (
          <p className={`${panelNoticeClassName} feedback-block-error`}>
            {error}
          </p>
        ) : null}

        {!error && (!tasks || tasks.length === 0) ? (
          <p className={panelNoticeClassName}>No task pressure detected today.</p>
        ) : null}

        {!error && tasks && tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.slice(0, 5).map((task) => {
              const tone = getPriorityQueueTone(task);
              const label = getPriorityQueueLabel(task);

              return (
                <article
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-transparent px-3 py-3 transition hover:border-[var(--border)] hover:bg-[color:var(--instrument-raised)]"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                        tone === "error"
                          ? "bg-[var(--signal-error)]"
                          : tone === "warn"
                            ? "bg-[var(--signal-warn)]"
                            : tone === "info"
                              ? "bg-[var(--signal-info)]"
                              : "bg-[var(--signal-live)]"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {task.title}
                      </p>
                      <p className="mt-1 text-[0.625rem] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                        {task.projectName}
                        {task.goalTitle ? ` · ${task.goalTitle}` : ` · ${formatTaskToken(task.status)}`}
                      </p>
                    </div>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </article>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
