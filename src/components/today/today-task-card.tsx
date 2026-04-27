import Link from "next/link";

import { startTimerAction } from "@/app/timer/actions";
import {
  completeTodayTaskAction,
  markTodayTaskBlockedAction,
  removeTaskFromTodayAction,
  updateTodayTaskStatusAction,
} from "@/app/today/actions";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTaskToken, isTaskCompletedStatus, TASK_STATUS_VALUES } from "@/lib/task-domain";
import { formatTaskEstimate } from "@/lib/task-estimate";
import type { TodayPlannerTask } from "@/lib/services/today-planner-service";
import { ChevronDown, ExternalLink } from "lucide-react";

type TodayTaskCardProps = {
  task: TodayPlannerTask;
  returnTo: string;
  isCompleted?: boolean;
  activeTimerSessionId: string | null;
};

export function getTodayTaskHref(task: TodayPlannerTask) {
  if (task.projectSlug) {
    return `/tasks/projects/${task.projectSlug}#task-${task.id}`;
  }

  return `/tasks#task-${task.id}`;
}

export function getTodayTaskCardMeta(task: TodayPlannerTask) {
  const canRemoveFromToday = task.isPlannedForToday;
  const removeLabel = task.isDueToday && task.isPlannedForToday
    ? "Remove manual plan"
    : "Remove from Today";

  return {
    showDueTodayBadge: task.isDueToday,
    canRemoveFromToday,
    removeLabel,
  };
}

export function getTodayTaskStatusOptions(task: TodayPlannerTask) {
  return TASK_STATUS_VALUES.filter(
    (statusValue) => statusValue !== "blocked" || task.status === "blocked",
  );
}

export function canShowTodayTaskStartTimer(task: Pick<TodayPlannerTask, "status">) {
  return !isTaskCompletedStatus(task.status);
}

export function TodayTaskCard({
  task,
  returnTo,
  isCompleted = false,
  activeTimerSessionId,
}: TodayTaskCardProps) {
  const isActiveTimerTask = task.hasActiveTimer ? activeTimerSessionId : null;
  const cardMeta = getTodayTaskCardMeta(task);
  const statusOptions = getTodayTaskStatusOptions(task);
  const description = task.description?.trim();
  const taskIsCompleted = !canShowTodayTaskStartTimer(task);

  return (
    <article
      id={`today-task-${task.id}`}
      className={`today-task-card ${task.hasActiveTimer ? "today-task-card-active" : ""} ${
        isCompleted ? "today-task-card-completed" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 text-base font-semibold leading-6 text-[color:var(--foreground)]">{task.title}</h3>
            {task.hasActiveTimer ? <Badge tone="active">Active timer</Badge> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
            {cardMeta.showDueTodayBadge ? <Badge tone="info">Due today</Badge> : null}
            {task.focusRank ? <Badge tone="info">Pinned #{task.focusRank}</Badge> : null}
          </div>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            {task.projectName}
            {task.goalTitle ? ` · ${task.goalTitle}` : ""}
          </p>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
              {description}
            </p>
          ) : null}
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
      </div>

      <div className="today-task-actions">
        <div className="today-task-primary-actions">
          {isActiveTimerTask ? (
            <TimerStopForm sessionId={isActiveTimerTask} returnTo={returnTo} size="sm" />
          ) : !taskIsCompleted ? (
            <form action={startTimerAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" size="sm" variant="default">
                Start timer
              </Button>
            </form>
          ) : null}

          {!taskIsCompleted ? (
            <form action={completeTodayTaskAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <PendingSubmitButton type="submit" size="sm" variant="muted" pendingLabel="Marking done...">
                Mark done
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>

        <details className="action-overflow today-action-overflow">
          <summary className="today-more-button">
            More
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </summary>
          <div className="action-overflow-menu">
            <div className="space-y-2">
              <form action={updateTodayTaskStatusAction} className="space-y-2">
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <select
                  name="status"
                  defaultValue={task.status}
                  aria-label={`Change status for ${task.title}`}
                  className="input-instrument min-h-8 w-full px-2 py-0 text-[10px] uppercase tracking-[0.14em]"
                >
                  {statusOptions.map((statusValue) => (
                    <option key={statusValue} value={statusValue}>
                      {formatTaskToken(statusValue)}
                    </option>
                  ))}
                </select>
                <PendingSubmitButton
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="w-full justify-center"
                  pendingLabel="Saving..."
                >
                  Set status
                </PendingSubmitButton>
              </form>

              {cardMeta.canRemoveFromToday ? (
                <form action={removeTaskFromTodayAction}>
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <PendingSubmitButton
                    type="submit"
                    size="sm"
                    variant="ghost"
                    className="w-full justify-center"
                    aria-label={`${cardMeta.removeLabel} for ${task.title}`}
                    pendingLabel="Clearing..."
                  >
                    {cardMeta.removeLabel}
                  </PendingSubmitButton>
                </form>
              ) : null}

              {task.status !== "blocked" && !taskIsCompleted ? (
                <form action={markTodayTaskBlockedAction} className="space-y-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <label className="glass-label text-etch" htmlFor={`blocked-reason-${task.id}`}>
                    Blocked reason
                  </label>
                  <textarea
                    id={`blocked-reason-${task.id}`}
                    name="blockedReason"
                    required
                    rows={3}
                    minLength={2}
                    className="input-instrument min-h-20 w-full resize-y px-2 py-2 text-xs normal-case tracking-normal"
                    placeholder="What is blocking this?"
                  />
                  <Button type="submit" size="sm" variant="ghost" className="w-full justify-center">
                    Mark blocked
                  </Button>
                </form>
              ) : null}

              <Link
                href={getTodayTaskHref(task)}
                className="btn-instrument btn-instrument-muted flex h-8 w-full items-center justify-center px-3 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open task
              </Link>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}
