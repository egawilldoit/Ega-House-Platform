import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  getGoalHealthLabel,
  getGoalHealthTone,
  toGoalHealthOrNull,
} from "@/lib/goal-health";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getGoalNextStepPreview } from "@/lib/goal-next-step";
import { formatIsoDate } from "@/lib/review-week";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { formatTimerDateTime } from "@/lib/timer-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { pinTaskAction, unpinTaskAction } from "@/app/tasks/actions";
import { startTimerAction, stopTimerAction } from "@/app/timer/actions";
import { AlertCircle, AlertTriangle, ArrowUpRight, Clock as ClockIcon, Clock3, FolderOpenDot, LayoutGrid, ListTodo, Target } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";

import type {
  DashboardData,
  DashboardGoalStatus,
  DashboardProjectStatus,
  DashboardTodayTask,
} from "../_lib/dashboard-data";

type DashboardOptimizedViewProps = {
  data: DashboardData;
  ownerUserId: string | null;
  completedCount: number;
  completionRate: number | null;
  urgentCount: number;
  activeProjectCount: number;
  totalProjectCount: number;
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getHeroSummary(taskCount: number, completionRate: number | null) {
  if (taskCount > 0) {
    return `${taskCount} task${taskCount === 1 ? "" : "s"} in today's lane${
      completionRate !== null ? ` · ${completionRate}% done` : ""
    }`;
  }

  return "No work is in today's lane yet. Pin a task, start a timer, or set a due date to shape the day.";
}

function toPreviewText(value: string | null | undefined, max = 180) {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return "No summary recorded yet.";
  }

  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max).trimEnd()}…`;
}

function DashboardMetric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className={`ega-dashboard-metric ${tone === "accent" ? "is-accent" : ""}`}>
      <p className="glass-label">{label}</p>
      <p className="ega-dashboard-metric-value">{value}</p>
      <p className="ega-dashboard-metric-detail">{detail}</p>
    </div>
  );
}

function TaskRow({ task, showPinAction = true }: { task: DashboardTodayTask; showPinAction?: boolean }) {
  return (
    <article className="ega-dashboard-list-row">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              task.status === "blocked" || task.priority === "urgent"
                ? "bg-[var(--signal-error)]"
                : task.priority === "high"
                  ? "bg-[var(--signal-warn)]"
                  : task.status === "in_progress"
                    ? "bg-[var(--signal-info)]"
                    : "bg-[var(--signal-live)]"
            }`}
          />
          <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
            {task.title}
          </p>
        </div>
        <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""} · Updated {formatTimerDateTime(task.updatedAt)}
        </p>
        {task.status === "blocked" && task.blockedReason?.trim() ? (
          <p className="mt-2 rounded-[0.8rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3 py-2 text-sm leading-6 text-[var(--signal-error)]">
            Blocked: {task.blockedReason.trim()}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
          {task.estimateMinutes ? (
            <Badge tone="muted">Est. {formatTaskEstimate(task.estimateMinutes)}</Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <StatusBadge status={task.status} />
        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
        {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
        {showPinAction ? (
          <FocusPinToggleForm
            action={task.focusRank ? unpinTaskAction : pinTaskAction}
            taskId={task.id}
            returnTo="/dashboard"
            isPinned={task.focusRank !== null}
            compact
          />
        ) : null}
      </div>
    </article>
  );
}

function GoalRow({ goal }: { goal: DashboardGoalStatus }) {
  const nextStepPreview = getGoalNextStepPreview(goal.nextStep, 72);
  const goalHealth = toGoalHealthOrNull(goal.health);

  return (
    <article className="ega-dashboard-list-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
          {goal.title}
        </p>
        <p className="mt-2 text-xs leading-6 text-[color:var(--muted-foreground)]">
          {goal.projectName} · {goal.completedTaskCount}/{goal.linkedTaskCount} linked tasks complete
        </p>
        {nextStepPreview ? (
          <p className="mt-1 truncate text-xs text-[color:var(--muted-foreground)]">
            Next: {nextStepPreview}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden min-w-20 text-right sm:block">
          <div className="text-sm font-semibold text-[color:var(--foreground)]">
            {goal.progressPercent}%
          </div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            Progress
          </div>
        </div>
        <StatusBadge status={goal.status} label={formatTaskToken(goal.status)} />
        {goalHealth ? (
          <Badge tone={getGoalHealthTone(goalHealth)}>{getGoalHealthLabel(goalHealth)}</Badge>
        ) : null}
      </div>
    </article>
  );
}

function ProjectRow({ project }: { project: DashboardProjectStatus }) {
  return (
    <article className="ega-dashboard-mini-row">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
          {project.name}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
          Updated {formatTimerDateTime(project.updatedAt)}
        </p>
      </div>
      <StatusBadge status={project.status} label={formatTaskToken(project.status)} />
    </article>
  );
}

function getTaskContextHref(taskId: string, projectSlug: string | null | undefined) {
  if (!projectSlug) {
    return "/tasks";
  }

  return `/tasks/projects/${projectSlug}#task-${taskId}`;
}

function FocusPanel({
  activeTimer,
  activeTimerError,
  focusPanel,
  focusPanelError,
}: {
  activeTimer: DashboardData["activeTimer"]["data"];
  activeTimerError: string | null;
  focusPanel: DashboardData["focusPanel"]["data"];
  focusPanelError: string | null;
}) {
  if (activeTimer) {
    const activeTaskHref = getTaskContextHref(activeTimer.taskId, activeTimer.projectSlug);

    return (
      <div className="space-y-4">
        <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active">Timer running</Badge>
            <Badge tone={getTaskStatusTone(activeTimer.taskStatus)}>
              {formatTaskToken(activeTimer.taskStatus)}
            </Badge>
            <Badge tone="muted">{formatTaskToken(activeTimer.taskPriority)}</Badge>
          </div>
          <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
            {activeTimer.taskTitle}
          </p>
          <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
            {activeTimer.projectName}
            {activeTimer.goalTitle ? ` · ${activeTimer.goalTitle}` : ""} · Started{" "}
            {formatTimerDateTime(activeTimer.startedAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone="active">{activeTimer.elapsedLabel}</Badge>
          <Link href={activeTaskHref} className="btn-instrument btn-instrument-muted">
            Open task
          </Link>
          <Link href="/timer" className="btn-instrument">
            Open timer
          </Link>
          <form action={stopTimerAction}>
            <input type="hidden" name="sessionId" value={activeTimer.sessionId} />
            <input type="hidden" name="returnTo" value="/dashboard" />
            <Button type="submit" variant="danger" size="sm">
              Stop timer
            </Button>
          </form>
        </div>
      </div>
    );
  }

  if (focusPanelError) {
    return <div className="feedback-block feedback-block-error">{focusPanelError}</div>;
  }

  if (!focusPanel) {
    return (
      <EmptyState
        icon={Clock3}
        title="Focus recommendation is warming up"
        description="The recommendation engine is collecting enough task context."
      />
    );
  }

  if (focusPanel.state === "blocked_only") {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={AlertTriangle}
          title="Only blocked work detected"
          description={`${focusPanel.blockedTaskCount} open task${
            focusPanel.blockedTaskCount === 1 ? " is" : "s are"
          } blocked. Unblock work or update status to resume execution.`}
        />
        <div className="flex flex-wrap gap-2">
          <Badge tone="danger">Blocked only</Badge>
          <Badge tone="muted">{focusPanel.openTaskCount} open</Badge>
          {focusPanel.pinnedTaskCount > 0 ? (
            <Badge tone="muted">{focusPanel.pinnedTaskCount} pinned</Badge>
          ) : null}
        </div>
        <Link href="/tasks" className="btn-instrument btn-instrument-muted">
          Open tasks
        </Link>
      </div>
    );
  }

  if (focusPanel.state === "empty") {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Target}
          title="No actionable tasks yet"
          description="Capture a task or reopen a completed item to start focus time."
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/tasks" className="btn-instrument btn-instrument-muted">
            Open tasks
          </Link>
          <Link href="/timer" className="btn-instrument btn-instrument-muted">
            Open timer
          </Link>
        </div>
      </div>
    );
  }

  const { recommendation } = focusPanel;
  const recommendedTask = recommendation.task;
  const recommendedTaskHref = getTaskContextHref(
    recommendedTask.id,
    recommendedTask.projectSlug,
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="active">Recommended next</Badge>
          <Badge tone={getTaskStatusTone(recommendedTask.status)}>
            {formatTaskToken(recommendedTask.status)}
          </Badge>
          <Badge tone="muted">{formatTaskToken(recommendedTask.priority)}</Badge>
          <TaskDueDateLabel dueDate={recommendedTask.dueDate} status={recommendedTask.status} />
        </div>
        <p className="mt-3 text-sm font-semibold text-[color:var(--foreground)]">
          {recommendedTask.title}
        </p>
        <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
          {recommendedTask.projectName}
          {recommendedTask.goalTitle ? ` · ${recommendedTask.goalTitle}` : ""}
          {recommendedTask.estimateMinutes
            ? ` · Est. ${formatTaskEstimate(recommendedTask.estimateMinutes)}`
            : ""}
          {" · "}
          Updated {formatTimerDateTime(recommendedTask.updatedAt)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {recommendation.signals.slice(0, 4).map((signal) => (
          <Badge key={signal} tone="info">
            {signal}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={recommendedTask.id} />
          <input type="hidden" name="returnTo" value="/dashboard" />
          <Button type="submit" size="sm">
            Start focus timer
          </Button>
        </form>
        <FocusPinToggleForm
          action={recommendedTask.focusRank ? unpinTaskAction : pinTaskAction}
          taskId={recommendedTask.id}
          returnTo="/dashboard"
          isPinned={recommendedTask.focusRank !== null}
          compact
        />
        <Link href={recommendedTaskHref} className="btn-instrument btn-instrument-muted">
          Open task
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="muted">{recommendation.openTaskCount} open</Badge>
        {recommendation.blockedTaskCount > 0 ? (
          <Badge tone="warn">{recommendation.blockedTaskCount} blocked</Badge>
        ) : null}
        {recommendation.pinnedTaskCount > 0 ? (
          <Badge tone="muted">{recommendation.pinnedTaskCount} pinned</Badge>
        ) : null}
      </div>

      {activeTimerError ? (
        <div className="feedback-block feedback-block-error">{activeTimerError}</div>
      ) : null}
    </div>
  );
}

export function DashboardOptimizedView({
  data,
  ownerUserId,
  completedCount,
  completionRate,
  urgentCount,
  activeProjectCount,
  totalProjectCount,
}: DashboardOptimizedViewProps) {
  const {
    health,
    focusPanel,
    activeTimer,
    todayPlanner,
    projectStatuses,
    goals,
    timerSummary,
    latestReview,
    linearProject,
  } = data;

  const tasks = todayPlanner.data?.all ?? [];
  const planner = todayPlanner.data;
  const goalItems = goals.data ?? [];
  const projectItems = projectStatuses.data ?? [];
  const summary = timerSummary.data;
  const latestReviewItem = latestReview.data;
  const greeting = getGreeting();
  const projectHeadline =
    linearProject.data?.name ?? activeTimer.data?.projectName ?? "Workspace command";
  const projectNarrative = linearProject.data?.status
    ? `${formatTaskToken(linearProject.data.status)} · ${
        linearProject.data.targetDate
          ? `Target ${formatIsoDate(linearProject.data.targetDate)}`
          : "No target date"
      }`
    : activeTimer.data
      ? `Timer active on ${activeTimer.data.taskTitle}`
      : "No Linear token is configured, so this panel falls back to your local workspace state.";

  return (
    <AppShell
      eyebrow="Operational Command"
      title="Dashboard"
      description="A live snapshot of task pressure, goal movement, project health, timer activity, and review momentum."
      contentClassName="pb-20"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={health.state === "healthy" ? "done" : "blocked"}
            label={health.state === "healthy" ? "System healthy" : "Probe degraded"}
          />
          <Badge tone="muted">
            {summary ? `${summary.sessionsTodayCount} sessions today` : "Timer summary pending"}
          </Badge>
        </div>
      }
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={ownerUserId}
        channelPrefix="dashboard"
        tables={["task_sessions", "tasks"]}
      />

      <section className="ega-dashboard-hero ega-dashboard-hero-compact">
        <div className="ega-dashboard-hero-copy relative overflow-hidden">
          <p className="glass-label text-[color:var(--signal-live)]">Live Workspace State</p>
          <div className="flex items-center gap-6 mt-4">
            <div className="relative w-16 h-16 flex-shrink-0">
               <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path className="text-[var(--border)]" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  <path className="text-[var(--signal-live)]" strokeWidth="3" strokeDasharray={`${completionRate || 0}, 100`} stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
               </svg>
               <div className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-gray-700">{completionRate || 0}%</div>
            </div>
            <div>
              <h2 className="ega-dashboard-hero-title">
                {greeting}, <span>operator.</span>
              </h2>
              <p className="ega-dashboard-hero-subtitle mt-2">
                {getHeroSummary(tasks.length, completionRate)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Tasks In Focus"
            value={String(tasks.length)}
            subtitle={completedCount > 0 ? `${completedCount} completed recently` : "Backlog surfaced when today is quiet"}
            variant="green"
            icon={ListTodo}
            className="border-t-4 border-t-[#177b52]"
            trend={<ArrowUpRight className="w-3 h-3 text-[#177b52] inline-block mr-1" />}
          />
          <StatCard
            label="Urgent"
            value={String(urgentCount)}
            subtitle={urgentCount > 0 ? "Immediate attention required" : "No urgent queue"}
            variant={urgentCount > 0 ? "default" : "muted"}
            icon={AlertCircle}
            className={urgentCount > 0 ? "border-t-4 border-t-[var(--signal-warn)]" : ""}
            trend={urgentCount > 0 ? <AlertTriangle className="w-3 h-3 text-[var(--signal-warn)] inline-block mr-1" /> : undefined}
          />
          <StatCard
            label="Tracked Today"
            value={summary?.trackedTodayLabel ?? "--"}
            subtitle={summary ? summary.trackedTotalLabel : "Timer history unavailable"}
            icon={ClockIcon}
            className="border-t-4 border-t-[var(--signal-info)]"
          />
          <StatCard
            label="Projects"
            value={`${activeProjectCount}/${totalProjectCount}`}
            subtitle="Active vs total projects"
            icon={LayoutGrid}
            className="border-t-4 border-t-[var(--foreground)]"
          />
        </div>
      </section>

      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(22rem,0.72fr)]">
        <Card className="ega-dashboard-spotlight border-transparent">
          <CardContent className="p-0">
            <div className="ega-dashboard-spotlight-shell">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="active">Command center</Badge>
                {linearProject.data?.status ? (
                  <StatusBadge
                    status={linearProject.data.status}
                    label={formatTaskToken(linearProject.data.status)}
                  />
                ) : null}
                {activeTimer.error ? <Badge tone="warn">Timer feed issue</Badge> : null}
              </div>
              {health.state !== "healthy" ? (
                <div className="mt-4 flex w-fit items-center gap-2 rounded-full border border-[rgba(230,81,0,0.28)] bg-[rgba(230,81,0,0.08)] px-3 py-1.5 text-xs font-semibold tracking-wide text-[color:var(--signal-warn)] shadow-sm">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {health.statusText}
                </div>
              ) : null}

              <div className="mt-5 max-w-3xl">
                <p className="glass-label text-white/70">Current focus</p>
                <h3 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
                  {projectHeadline}
                </h3>
                <p className="mt-4 text-sm leading-7 text-white/74">{projectNarrative}</p>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className="ega-dashboard-spotlight-stat">
                  <span className="glass-label text-white/60">Timer</span>
                  <strong>{activeTimer.data?.elapsedLabel ?? "Idle"}</strong>
                  <span>{activeTimer.data ? activeTimer.data.taskTitle : "No open session"}</span>
                </div>
                <div className="ega-dashboard-spotlight-stat">
                  <span className="glass-label text-white/60">Health</span>
                  <strong>{health.state === "healthy" ? "Nominal" : "Degraded"}</strong>
                  <span>{health.statusText}</span>
                </div>
                <div className="ega-dashboard-spotlight-stat">
                  <span className="glass-label text-white/60">Longest</span>
                  <strong>{summary?.longestSessionLabel ?? "--"}</strong>
                  <span>{summary?.longestSessionTaskTitle ?? "No completed sessions yet"}</span>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/timer" className="btn-instrument">
                  Open timer
                </Link>
                <Link href="/tasks" className="btn-instrument btn-instrument-muted">
                  Review tasks
                </Link>
                <Link href="/review" className="btn-instrument btn-instrument-muted">
                  Weekly review
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-transparent bg-[color:var(--instrument)]">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Review Pulse</p>
                <CardTitle className="mt-2 text-xl">
                  {latestReviewItem ? "Latest weekly review" : "Review memory is empty"}
                </CardTitle>
                <CardDescription>
                  The newest review entry anchors the dashboard narrative alongside live system state.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/review" className="glass-label text-signal-live">
                  Open review
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {latestReview.error ? (
              <div className="feedback-block feedback-block-error">{latestReview.error}</div>
            ) : latestReviewItem ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="info" className="rounded-full border-[#90caf9] bg-[#e3f2fd] px-3 text-[#1565c0] shadow-sm">
                    {formatIsoDate(latestReviewItem.weekStart)} - {formatIsoDate(latestReviewItem.weekEnd)}
                  </Badge>
                  <Badge tone="muted" className="rounded-full px-3 shadow-sm">
                    Updated {formatTimerDateTime(latestReviewItem.updatedAt)}
                  </Badge>
                </div>
                <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
                  {toPreviewText(latestReviewItem.summary, 220)}
                </p>
              </>
            ) : (
              <EmptyState
                icon={Clock3}
                title="Review memory is empty"
                description="Save a weekly reflection and it will appear here as the dashboard narrative anchor."
                actionLabel="Open review"
                actionHref="/review"
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Goals Visible"
                value={String(goalItems.length)}
                subtitle={goalItems.length > 0 ? "Existing goals pulled in from workspace" : "No goals yet"}
                icon={Target}
              />
              <StatCard
                label="Latest Check"
                value={formatTimerDateTime(health.checkedAt)}
                subtitle="OpenClaw health probe timestamp"
                icon={ClockIcon}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <Card className="ega-glass">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Execution Queue</p>
                <CardTitle className="mt-2 text-xl">Today planner</CardTitle>
                <CardDescription>
                  The newest work items shaping today&apos;s execution pressure.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/today" className="glass-label text-signal-live">
                  Open Today
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {todayPlanner.error ? (
              <div className="feedback-block feedback-block-error">{todayPlanner.error}</div>
            ) : planner && planner.all.length > 0 ? (
              <div className="space-y-4">
                {[
                  { key: "planned", label: "Planned", items: planner.planned },
                  { key: "in-progress", label: "In progress", items: planner.inProgress },
                  { key: "blocked", label: "Blocked", items: planner.blocked },
                  { key: "completed", label: "Completed", items: planner.completed, showPinAction: false },
                ]
                  .filter((section) => section.items.length > 0)
                  .map((section) => (
                    <div key={section.key} className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="glass-label text-etch">{section.label}</p>
                        <Badge tone="muted">{section.items.length}</Badge>
                      </div>
                      {section.items.slice(0, 4).map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          showPinAction={section.showPinAction !== false}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            ) : (
              <EmptyState
                icon={Target}
                title="Today lane is empty"
                description="Pin a task, start a timer, or set a due date to shape the plan."
                actionLabel="Open Today"
                actionHref="/today"
              />
            )}
          </CardContent>
        </Card>

        <Card className="ega-glass">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Focus Panel</p>
                <CardTitle className="mt-2 text-xl">Next best work</CardTitle>
                <CardDescription>
                  Uses active timer, pinned tasks, due pressure, in-progress momentum, and recent activity to recommend what to do next.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/tasks" className="glass-label text-signal-live">
                  Open tasks
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <FocusPanel
              activeTimer={activeTimer.data}
              activeTimerError={activeTimer.error}
              focusPanel={focusPanel.data}
              focusPanelError={focusPanel.error}
            />
          </CardContent>
        </Card>

        <Card className="ega-glass">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Goal Movement</p>
                <CardTitle className="mt-2 text-xl">Existing goals on deck</CardTitle>
                <CardDescription>
                  Strategic outcomes with progress and linked-task velocity.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/goals" className="glass-label text-signal-live">
                  Open goals
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {goals.error ? (
              <div className="feedback-block feedback-block-error">{goals.error}</div>
            ) : goalItems.length > 0 ? (
              goalItems.slice(0, 4).map((goal) => <GoalRow key={goal.id} goal={goal} />)
            ) : (
              <EmptyState
                icon={Target}
                title="No goals yet"
                description="Create goals to anchor strategic execution progress."
                actionLabel="Open goals"
                actionHref="/goals"
              />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-[0.96fr_1.04fr]">
        <Card className="ega-glass">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Project State</p>
                <CardTitle className="mt-2 text-xl">Portfolio overview</CardTitle>
                <CardDescription>
                  The current balance of active and total project records.
                </CardDescription>
              </div>
              <CardAction>
                <Badge tone="muted">
                  {activeProjectCount} active / {totalProjectCount} total
                </Badge>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {projectStatuses.error ? (
              <div className="feedback-block feedback-block-error">{projectStatuses.error}</div>
            ) : projectItems.length > 0 ? (
              projectItems.slice(0, 5).map((project) => <ProjectRow key={project.id} project={project} />)
            ) : (
              <EmptyState
                icon={FolderOpenDot}
                title="No projects yet"
                description="Project records will appear here once they are created."
                actionLabel="Manage projects"
                actionHref="/tasks/projects"
              />
            )}
          </CardContent>
        </Card>

        <Card className="ega-glass">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="glass-label text-[color:var(--signal-live)]">Timer Summary</p>
                <CardTitle className="mt-2 text-xl">Session and delivery cadence</CardTitle>
                <CardDescription>
                  Session volume, total tracked time, and live timer context.
                </CardDescription>
              </div>
              <CardAction>
                <Link href="/timer" className="glass-label text-signal-live">
                  Open timer
                </Link>
              </CardAction>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {timerSummary.error ? (
              <div className="feedback-block feedback-block-error">{timerSummary.error}</div>
            ) : summary ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <DashboardMetric
                    label="Today"
                    value={summary.trackedTodayLabel}
                    detail={`${summary.sessionsTodayCount} session${summary.sessionsTodayCount === 1 ? "" : "s"} logged`}
                    tone="accent"
                  />
                  <DashboardMetric
                    label="Total"
                    value={summary.trackedTotalLabel}
                    detail="Across loaded task sessions"
                  />
                  <DashboardMetric
                    label="Longest"
                    value={summary.longestSessionLabel ?? "--"}
                    detail={summary.longestSessionTaskTitle ?? "No completed session yet"}
                  />
                </div>

                {activeTimer.data ? (
                  <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="glass-label text-[color:var(--signal-live)]">Active timer</p>
                        <p className="mt-2 text-lg font-semibold tracking-tight text-[color:var(--foreground)]">
                          {activeTimer.data.taskTitle}
                        </p>
                        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                          {activeTimer.data.projectName} · Started {formatTimerDateTime(activeTimer.data.startedAt)}
                        </p>
                      </div>
                      <Badge tone="active">{activeTimer.data.elapsedLabel}</Badge>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={Clock3}
                title="Timer summary unavailable"
                description="Tracked sessions will appear once timer history is available."
              />
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              Summary cards are sized to current activity rather than fixed panel height.
            </p>
          </CardFooter>
        </Card>
      </section>
    </AppShell>
  );
}
