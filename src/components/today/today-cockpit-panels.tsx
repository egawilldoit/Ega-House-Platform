import Link from "next/link";

import { startTimerAction, stopTimerAction } from "@/app/timer/actions";
import { completeTodayTaskAction } from "@/app/today/actions";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import type { ActiveTimerSession } from "@/lib/services/timer-service";
import { formatTaskToken } from "@/lib/task-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { getTodayTaskHref } from "@/components/today/today-task-card";
import { Clock3, ExternalLink, ListChecks, Play, Radio, Square } from "lucide-react";

type TodayCockpitActionProps = {
  task: TodayPlannerTask;
  returnTo: string;
  activeTimerSessionId: string | null;
};

function TodayCockpitActions({
  task,
  returnTo,
  activeTimerSessionId,
}: TodayCockpitActionProps) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;

  return (
    <div className="today-cockpit-actions">
      {isActiveTimerTask ? (
        <form action={stopTimerAction}>
          <input type="hidden" name="sessionId" value={isActiveTimerTask} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="danger" className="today-cockpit-action-button">
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Stop timer
          </Button>
        </form>
      ) : (
        <form action={startTimerAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" className="today-cockpit-action-button">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Start timer
          </Button>
        </form>
      )}

      {task.status !== "done" ? (
        <form action={completeTodayTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="muted" className="today-cockpit-action-button">
            Done
          </Button>
        </form>
      ) : null}

      <Link
        href={getTodayTaskHref(task)}
        className="btn-instrument btn-instrument-muted today-cockpit-action-button flex h-8 items-center px-3 text-xs"
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
      <Card className="today-start-panel">
        <CardContent className="px-5 py-5">
          <EmptyState
            icon={ListChecks}
            title="No actionable task ready"
            description="Plan a task for today or pin one in the task queue to create a clear starting point."
            action={
              <Link href="/tasks" className="btn-instrument flex h-8 items-center px-3 text-xs">
                Open tasks
              </Link>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="today-start-panel">
      <CardHeader className="pb-3">
        <p className="glass-label text-signal-live">Start here</p>
        <CardTitle className="text-2xl">{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={task.hasActiveTimer ? "active" : "info"}>
            {task.hasActiveTimer ? "Timer running" : formatTaskToken(task.status)}
          </Badge>
          <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
          {task.isPlannedForToday ? <Badge tone="info">Planned today</Badge> : null}
          {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          {task.estimateMinutes ? (
            <Badge tone="muted">Est. {formatTaskEstimate(task.estimateMinutes)}</Badge>
          ) : null}
        </div>
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
          {task.projectName}
          {task.goalTitle ? ` · ${task.goalTitle}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
          {task.description ? (
            <span className="text-sm leading-6 text-[color:var(--muted-foreground)]">
              {task.description}
            </span>
          ) : null}
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
    <Card className="today-focus-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="glass-label text-etch">Focus queue</p>
            <CardTitle className="mt-1 text-xl">Next up</CardTitle>
          </div>
          <Badge tone="muted">{queue.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {queue.length > 0 ? (
          queue.map((task, index) => (
            <article key={task.id} className="today-focus-row">
              <div className="today-focus-rank">{index + 1}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                  {task.title}
                </p>
                <p className="mt-1 truncate text-xs text-[color:var(--muted-foreground)]">
                  {task.projectName}
                  {task.goalTitle ? ` · ${task.goalTitle}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone={task.hasActiveTimer ? "active" : "muted"}>
                    {task.hasActiveTimer ? "Active" : formatTaskToken(task.priority)}
                  </Badge>
                  {task.isPlannedForToday ? <Badge tone="info">Planned</Badge> : null}
                  <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
                </div>
              </div>
              <TodayCockpitActions
                task={task}
                returnTo={returnTo}
                activeTimerSessionId={activeTimerSessionId}
              />
            </article>
          ))
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Queue is empty"
            description="Add a task to Today or pin focus work to build a short execution queue."
            className="py-5"
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ActiveTimerPanel({
  activeTimer,
  returnTo,
}: {
  activeTimer: ActiveTimerSession | null;
  returnTo: string;
}) {
  if (!activeTimer) {
    return (
      <Card className="today-active-timer-panel">
        <CardContent className="px-5 py-5">
          <div className="flex items-start gap-3">
            <span className="today-active-timer-icon" aria-hidden="true">
              <Clock3 className="h-4 w-4" />
            </span>
            <div>
              <p className="glass-label text-etch">Active timer</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                No session is running. Start one from Start here or the focus queue.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const taskHref = activeTimer.projectSlug
    ? `/tasks/projects/${activeTimer.projectSlug}#task-${activeTimer.taskId}`
    : `/tasks#task-${activeTimer.taskId}`;

  return (
    <Card className="today-active-timer-panel today-active-timer-panel-live">
      <CardContent className="space-y-4 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="glass-label text-signal-live">Active timer</p>
            <h2 className="mt-1 truncate text-xl font-semibold text-[color:var(--foreground)]">
              {activeTimer.taskTitle}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              {activeTimer.projectName}
              {activeTimer.goalTitle ? ` · ${activeTimer.goalTitle}` : ""}
            </p>
          </div>
          <span className="today-active-timer-icon" aria-hidden="true">
            <Radio className="h-4 w-4" />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="active">{activeTimer.elapsedLabel}</Badge>
          <Badge tone="muted">{formatTaskToken(activeTimer.taskStatus)}</Badge>
          <Badge tone="muted">{formatTaskToken(activeTimer.taskPriority)}</Badge>
        </div>
        <div className="today-cockpit-actions">
          <form action={stopTimerAction}>
            <input type="hidden" name="sessionId" value={activeTimer.sessionId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="danger" className="today-cockpit-action-button">
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Stop timer
            </Button>
          </form>
          <Link href={taskHref} className="btn-instrument btn-instrument-muted today-cockpit-action-button flex h-8 items-center px-3 text-xs">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open task
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
