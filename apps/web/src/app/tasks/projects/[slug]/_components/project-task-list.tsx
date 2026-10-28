import Link from "next/link";
import { ChevronRight, ListChecks } from "lucide-react";

import {
  cancelTaskReminderAction,
  createTaskReminderAction,
  deleteTaskAction,
  pinTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import { CreateTaskForm } from "@/app/tasks/create-task-form";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { InlineTaskUpdateForm } from "@/components/tasks/inline-task-update-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TaskFilterControls } from "@/components/tasks/task-filter-controls";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectGoalRecord, ProjectRecord } from "@ega/application";
import { buildTaskDrawerLink } from "@/lib/task-drawer-url";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatTaskRecurrenceRule } from "@/lib/task-recurrence";
import {
  formatTaskToken,
  getTaskStatusTone,
  isTaskCompletedStatus,
  type TaskStatus,
} from "@/lib/task-domain";
import type { TaskDueFilter, TaskSortValue } from "@/lib/task-list";
import type { CalendarTaskFormDefaults } from "@/lib/services/calendar-settings-service";
import type { TaskRecord } from "@/lib/services/task-service";
import { formatTimerDateTime } from "@/lib/timer-domain";

type ProjectTaskListProps = {
  project: ProjectRecord;
  goals: ProjectGoalRecord[];
  tasks: TaskRecord[];
  activeStatus: TaskStatus | null;
  activePriority: string | null;
  activeDueFilter: TaskDueFilter;
  activeSort: TaskSortValue;
  activeView: string;
  taskFilterBasePath: string;
  returnTo: string;
  taskUpdateError: string | null;
  taskUpdateSuccess: string | null;
  taskUpdateTaskId: string | null;
  focusQueue: TaskRecord[];
  projectIsArchived: boolean;
  archivedTaskCount: number;
  calendarFormDefaults: CalendarTaskFormDefaults;
};

export function ProjectTaskList({
  project,
  goals,
  tasks,
  activeStatus,
  activePriority,
  activeDueFilter,
  activeSort,
  activeView,
  taskFilterBasePath,
  returnTo,
  taskUpdateError,
  taskUpdateSuccess,
  taskUpdateTaskId,
  focusQueue,
  projectIsArchived,
  archivedTaskCount,
  calendarFormDefaults,
}: ProjectTaskListProps) {
  return (
    <div className="workspace-split-grid">
      <Card
        label="Execution"
        title="Project tasks"
        action={
          <Badge tone="muted">
            {tasks.filter((task) => isTaskCompletedStatus(task.status)).length}/{tasks.length} done
          </Badge>
        }
      >
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface-subtle)] px-3 py-2">
            <TaskFilterControls
              basePath={taskFilterBasePath}
              activeStatus={activeStatus}
              activePriority={activePriority}
              activeDueFilter={activeDueFilter}
              activeSort={activeSort}
              activeView={activeView}
              includePriority
              activeTab="list"
            />
          </div>

          {taskUpdateSuccess ? (
            <p role="status" className="feedback-block">
              {taskUpdateSuccess}
            </p>
          ) : null}

          {tasks.length ? (
            <ul className="rows">
              {tasks.map((task, index) => {
                const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;

                return (
                  <li
                    key={task.id}
                    id={`task-${task.id}`}
                    className="scroll-mt-24 border-b border-[var(--ega-divider)] last:border-b-0"
                  >
                    <details className="group" open={Boolean(inlineError)}>
                      <summary className="row cursor-pointer list-none">
                        <span className="row-main">
                          <span className="row-title">
                            <Link
                              href={buildTaskDrawerLink(returnTo, task.id)}
                              className="hover:underline focus-visible:outline-[var(--ega-focus-outline)] focus-visible:outline-offset-2"
                            >
                              {task.title}
                            </Link>
                            {index === 0 ? <span className="sr-only"> (current focus)</span> : null}
                          </span>
                          <span className="row-meta">
                            {task.goals?.title ?? "No linked goal"}
                            {" · Updated "}
                            {formatTimerDateTime(task.updated_at)}
                          </span>
                        </span>
                        <span className="row-actions">
                          {task.status === "blocked" && task.blocked_reason?.trim() ? (
                            <span className="hidden sm:inline-flex">
                              <Badge tone="error">Blocked</Badge>
                            </span>
                          ) : null}
                          <Badge tone={getTaskStatusTone(task.status)}>
                            {formatTaskToken(task.status)}
                          </Badge>
                          <span className="hidden sm:inline-flex">
                            <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                          </span>
                          {task.focus_rank ? (
                            <span className="hidden sm:inline-flex">
                              <Badge tone="info">#{task.focus_rank}</Badge>
                            </span>
                          ) : null}
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-[color:var(--ega-text-tertiary)] transition-transform group-open:rotate-90 motion-reduce:transition-none"
                            aria-hidden="true"
                          />
                        </span>
                      </summary>

                      <div className="flex flex-col gap-3 border-t border-[var(--ega-divider)] bg-[color:var(--ega-surface-subtle)] px-4 py-3">
                        {task.due_date || task.estimate_minutes || task.task_recurrences[0] ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {task.due_date ? (
                              <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                            ) : null}
                            {task.estimate_minutes ? (
                              <Badge tone="muted">
                                Est. {formatTaskEstimate(task.estimate_minutes)}
                              </Badge>
                            ) : null}
                            {task.task_recurrences[0] ? (
                              <Badge tone="info">
                                {formatTaskRecurrenceRule(task.task_recurrences[0].rule)}
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}

                        {task.status === "blocked" && task.blocked_reason?.trim() ? (
                          <p className="feedback-block feedback-block-warn">
                            Blocked: {task.blocked_reason.trim()}
                          </p>
                        ) : null}

                        <TaskReminderPanel
                          taskId={task.id}
                          reminders={task.task_reminders}
                          returnTo={returnTo}
                          createAction={createTaskReminderAction}
                          cancelAction={cancelTaskReminderAction}
                        />

                        <InlineTaskUpdateForm
                          action={updateTaskInlineAction}
                          deleteAction={deleteTaskAction}
                          taskId={task.id}
                          taskTitle={task.title}
                          returnTo={returnTo}
                          defaultStatus={task.status}
                          defaultPriority={task.priority}
                          defaultDueDate={task.due_date}
                          defaultEstimateMinutes={task.estimate_minutes}
                          defaultScheduledStartAt={task.scheduled_start_at}
                          defaultScheduledEndAt={task.scheduled_end_at}
                          defaultCalendarSyncEnabled={task.calendar_sync_enabled}
                          defaultCalendarReminderMinutes={task.calendar_reminder_minutes}
                          defaultBlockedReason={task.blocked_reason}
                          defaultRecurrenceRule={task.task_recurrences[0]?.rule ?? null}
                          error={inlineError}
                        />

                        <FocusPinToggleForm
                          action={task.focus_rank ? unpinTaskAction : pinTaskAction}
                          taskId={task.id}
                          returnTo={returnTo}
                          isPinned={task.focus_rank !== null}
                          compact
                        />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No tasks match the current filters"
              description={
                archivedTaskCount > 0
                  ? "Reset a filter, or open the Tasks workspace to review archived tasks."
                  : "Reset one or more filters to bring the project execution list back into view."
              }
              actionLabel={archivedTaskCount > 0 ? "Open Tasks" : undefined}
              actionHref={archivedTaskCount > 0 ? `/tasks?project=${project.id}` : undefined}
            />
          )}

          {archivedTaskCount > 0 ? (
            <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              {archivedTaskCount} archived {archivedTaskCount === 1 ? "task is" : "tasks are"}{" "}
              available in the{" "}
              <Link
                href={`/tasks?project=${project.id}&archive=archived`}
                className="underline hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
              >
                Tasks workspace
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="workspace-secondary-rail">
        <Card
          label="Focus"
          title="Focus queue"
          action={<Badge tone="muted">{focusQueue.length}</Badge>}
        >
          {focusQueue.length > 0 ? (
            <ul className="rows">
              {focusQueue.slice(0, 4).map((task) => (
                <li key={task.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{task.title}</span>
                    <span className="row-meta">#{task.focus_rank}</span>
                  </span>
                  <div className="row-actions">
                    <FocusPinToggleForm
                      action={unpinTaskAction}
                      taskId={task.id}
                      returnTo={returnTo}
                      isPinned
                      compact
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <CardContent>
              <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                Pin tasks in this project to build a focused execution order.
              </p>
            </CardContent>
          )}
        </Card>

        <Card label="Create" title="New project task">
          <CardContent className="flex flex-col gap-3">
            <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
              {projectIsArchived
                ? `Restore ${project.name} before adding new execution work.`
                : `New tasks created here stay attached to ${project.name}.`}
            </p>
            {projectIsArchived ? (
              <p className="surface-empty px-4 py-4 text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-ega-text-secondary">
                This archived project remains visible for review, but new tasks should wait until
                the project is active again.
              </p>
            ) : (
              <CreateTaskForm
                projects={[{ id: project.id, name: project.name }]}
                goals={goals.map((goal) => ({
                  id: goal.id,
                  title: goal.title,
                  project_id: goal.projectId,
                }))}
                projectId={project.id}
                returnTo={returnTo}
                calendarDefaults={calendarFormDefaults}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
