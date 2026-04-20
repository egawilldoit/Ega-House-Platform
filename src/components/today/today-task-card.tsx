import Link from "next/link";

import { startTimerAction, stopTimerAction } from "@/app/timer/actions";
import {
  completeTodayTaskAction,
  removeTaskFromTodayAction,
  updateTodayTaskStatusAction,
} from "@/app/today/actions";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTaskToken, getTaskStatusTone, TASK_STATUS_VALUES } from "@/lib/task-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

type TodayTaskCardProps = {
  task: TodayPlannerTask;
  returnTo: string;
  isCompleted?: boolean;
  activeTimerSessionId: string | null;
};

function getTaskHref(task: TodayPlannerTask) {
  if (task.projectSlug) {
    return `/tasks/projects/${task.projectSlug}#task-${task.id}`;
  }

  return `/tasks#task-${task.id}`;
}

export function TodayTaskCard({
  task,
  returnTo,
  isCompleted = false,
  activeTimerSessionId,
}: TodayTaskCardProps) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;

  return (
    <article
      id={`today-task-${task.id}`}
      className={`rounded-[1rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4 ${
        isCompleted ? "opacity-85" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="truncate text-base font-medium text-[color:var(--foreground)]">{task.title}</h3>
            {task.hasActiveTimer ? <Badge tone="active">Active timer</Badge> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={getTaskStatusTone(task.status)}>{formatTaskToken(task.status)}</Badge>
            <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
            {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          </div>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            {task.projectName}
            {task.goalTitle ? ` · ${task.goalTitle}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TaskDueDateLabel dueDate={task.dueDate} status={task.status} />
            {task.estimateMinutes ? (
              <Badge tone="muted">Est. {formatTaskEstimate(task.estimateMinutes)}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
        {isActiveTimerTask ? (
          <form action={stopTimerAction}>
            <input type="hidden" name="sessionId" value={isActiveTimerTask} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="danger">
              Stop timer
            </Button>
          </form>
        ) : (
          <form action={startTimerAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="default">
              Start timer
            </Button>
          </form>
        )}

        {task.status !== "done" ? (
          <form action={completeTodayTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" size="sm" variant="muted">
              Mark complete
            </Button>
          </form>
        ) : null}

        <form action={updateTodayTaskStatusAction} className="flex items-center gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <select
            name="status"
            defaultValue={task.status}
            aria-label={`Change status for ${task.title}`}
            className="input-instrument min-h-8 min-w-32 px-2 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            {TASK_STATUS_VALUES.map((statusValue) => (
              <option key={statusValue} value={statusValue}>
                {formatTaskToken(statusValue)}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="ghost">
            Set
          </Button>
        </form>

        <form action={removeTaskFromTodayAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${task.title} from Today`}>
            Remove
          </Button>
        </form>

        <Link href={getTaskHref(task)} className="btn-instrument btn-instrument-muted flex h-8 items-center px-3">
          Open
        </Link>
      </div>
    </article>
  );
}
