import Link from "next/link";

import { startTimerAction } from "@/app/timer/actions";
import { completeTodayTaskAction } from "@/app/today/actions";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { LiveDuration } from "@/components/timer/live-duration";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import type { ActiveTimerSession } from "@/lib/services/timer-service";
import { formatTaskToken, isTaskCompletedStatus } from "@/lib/task-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { getTodayTaskHref } from "@/components/today/today-task-card";
import { Clock3, ExternalLink, ListChecks, Play, Radio, Square } from "lucide-react";

type TodayCockpitActionProps = {
  task: TodayPlannerTask;
  returnTo: string;
  activeTimerSessionId: string | null;
};

export function TodayCockpitActions({
  task,
  returnTo,
  activeTimerSessionId,
}: TodayCockpitActionProps) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;
  const taskIsCompleted = isTaskCompletedStatus(task.status);

  return (
    <div className="task-row-actions">
      {isActiveTimerTask ? (
        <TimerStopForm sessionId={isActiveTimerTask} returnTo={returnTo} size="sm">
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          Stop timer
        </TimerStopForm>
      ) : !taskIsCompleted ? (
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="primary">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Start timer
          </Button>
        </form>
      ) : null}

      {!taskIsCompleted ? (
        <form action={completeTodayTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="secondary"
            pendingLabel="Saving..."
          >
            Done
          </PendingSubmitButton>
        </form>
      ) : null}

      <Link
        href={getTodayTaskHref(task)}
        className="btn-instrument btn-instrument-muted flex h-7 items-center gap-1.5 px-2.5 text-xs"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        Open
      </Link>
    </div>
  );
}

export function StartHerePanel({
  task,
  returnTo,
  activeTimerSessionId,
}: {
  task: TodayPlannerTask | null;
  returnTo: string;
  activeTimerSessionId: string | null;
}) {
  if (!task) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={ListChecks}
            title="No actionable task ready"
            description="Plan a task for today or pin focus work to create a clear starting point."
            action={
              <Link href="/tasks" className="btn-instrument flex h-8 items-center px-3 text-sm">
                Open tasks
              </Link>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      label="Start here"
      title={task.title}
      data-testid="today-start-here"
      action={<Badge tone={task.hasActiveTimer ? "active" : "info"}>
        {task.hasActiveTimer ? "Timer running" : "Top priority"}
      </Badge>}
    >
      <CardContent className="flex flex-col gap-3">
        {task.description ? (
          <p className="max-w-[70ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
            {task.description}
          </p>
        ) : null}

        <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={task.hasActiveTimer ? "active" : "muted"}>
            {formatTaskToken(task.status)}
          </Badge>
          <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
          {task.isPlannedForToday ? <Badge tone="info">Planned today</Badge> : null}
          {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          {task.estimateMinutes ? (
            <Badge tone="muted">Est. {formatTaskEstimate(task.estimateMinutes)}</Badge>
          ) : null}
          <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
        </div>

        <TodayCockpitActions
          task={task}
          returnTo={returnTo}
          activeTimerSessionId={activeTimerSessionId}
        />
      </CardContent>
    </Card>
  );
}

/** Compact per-row primary action for the focus queue. */
function TodayQueueRowAction({
  task,
  returnTo,
  activeTimerSessionId,
}: TodayCockpitActionProps) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;

  if (isActiveTimerTask) {
    return (
      <TimerStopForm sessionId={isActiveTimerTask} returnTo={returnTo} size="sm">
        <Square className="h-3.5 w-3.5" aria-hidden="true" />
        Stop
      </TimerStopForm>
    );
  }

  if (isTaskCompletedStatus(task.status)) {
    return null;
  }

  return (
    <form action={startTimerAction}>
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" size="sm" variant="secondary">
        <Play className="h-3.5 w-3.5" aria-hidden="true" />
        Start
      </Button>
    </form>
  );
}

export function FocusQueuePanel({
  tasks,
  returnTo,
  activeTimerSessionId,
}: {
  tasks: TodayPlannerTask[];
  returnTo: string;
  activeTimerSessionId: string | null;
}) {
  const queue = tasks.slice(0, 7);

  return (
    <Card
      label="Queue"
      title="Today's focus queue"
      action={<Badge tone="muted">{queue.length}</Badge>}
      data-testid="today-focus-queue"
    >
      {queue.length > 0 ? (
        <ul className="rows">
          {queue.map((task, index) => (
            <li
              key={task.id}
              className={`row items-start ${task.hasActiveTimer ? "row-link" : ""}`}
            >
              <span className="rank mt-0.5" aria-hidden="true">
                {index + 1}
              </span>
              <span className="row-main">
                <span className="row-title">{task.title}</span>
                <span className="row-meta">
                  {task.projectName}
                  {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                  {task.estimateMinutes
                    ? ` · ${formatTaskEstimate(task.estimateMinutes)}`
                    : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {task.dueBucket === "overdue" ? (
                  <Badge tone="error">Overdue</Badge>
                ) : task.isPlannedForToday ? (
                  <Badge tone="info">Planned</Badge>
                ) : null}
                <TodayQueueRowAction
                  task={task}
                  returnTo={returnTo}
                  activeTimerSessionId={activeTimerSessionId}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <CardContent>
          <EmptyState
            icon={ListChecks}
            title="Queue is empty"
            description="Add a task to Today or pin focus work to build a short execution queue."
          />
        </CardContent>
      )}
    </Card>
  );
}

export function ActiveTimerPanel({
  activeTimer,
  returnTo,
  startedAt,
}: {
  activeTimer: ActiveTimerSession | null;
  returnTo: string;
  startedAt?: string | null;
}) {
  if (!activeTimer) {
    return (
      <Card label="Focus session" title="No session running" data-testid="today-timer-idle">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Clock3
              className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)]"
              aria-hidden="true"
            />
            <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
              Start a session from Start here or the focus queue. The timer keeps running
              across the workspace while it is active.
            </p>
          </div>
          <Link
            href="/timer"
            className="btn-instrument btn-instrument-muted flex h-8 w-fit items-center px-3 text-sm"
          >
            Open timer
          </Link>
        </CardContent>
      </Card>
    );
  }

  const taskHref = activeTimer.projectSlug
    ? `/tasks/projects/${activeTimer.projectSlug}#task-${activeTimer.taskId}`
    : `/tasks#task-${activeTimer.taskId}`;

  return (
    <Card
      label="Focus session"
      title={activeTimer.taskTitle}
      action={
        <span className="inline-flex items-center gap-1 text-[length:var(--text-meta)] font-medium text-[color:var(--status-healthy)]">
          <Radio className="h-3.5 w-3.5" aria-hidden="true" />
          Live
        </span>
      }
      data-testid="today-timer-active"
    >
      <CardContent className="flex flex-col gap-3">
        <p className="text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
          {activeTimer.projectName}
          {activeTimer.goalTitle ? ` · ${activeTimer.goalTitle}` : ""}
        </p>

        {startedAt ? <LiveDuration startedAt={startedAt} label="Elapsed" /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="muted">{formatTaskToken(activeTimer.taskStatus)}</Badge>
          <Badge tone="muted">{formatTaskToken(activeTimer.taskPriority)}</Badge>
        </div>

        <div className="task-row-actions">
          <TimerStopForm sessionId={activeTimer.sessionId} returnTo={returnTo} size="md">
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Stop session
          </TimerStopForm>
          <Link
            href={taskHref}
            className="btn-instrument btn-instrument-muted flex h-8 items-center gap-1.5 px-3 text-sm"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open task
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
