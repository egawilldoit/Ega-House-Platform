import Link from "next/link";
import {
  archiveTaskAction,
  cancelTaskReminderAction,
  createTaskReminderAction,
  deleteTaskAction,
  pinTaskAction,
  unarchiveTaskAction,
  unpinTaskAction,
  updateTaskInlineAction,
} from "@/app/tasks/actions";
import { startTimerAction } from "@/app/timer/actions";
import { CreateTaskForm } from "@/app/tasks/create-task-form";
import { FocusPinToggleForm } from "@/components/tasks/focus-pin-toggle-form";
import { TaskDueDateLabel } from "@/components/tasks/task-due-date-label";
import { TaskKanbanCard } from "@/components/tasks/task-kanban-card";
import { TaskSavedViewsPanel } from "@/components/tasks/task-saved-views-panel";
import { InlineTaskUpdateForm } from "@/components/tasks/inline-task-update-form";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import { TaskFilterControls } from "@/components/tasks/task-filter-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { buildTaskListUrl } from "@/lib/task-list";
import { formatDurationLabel } from "@/lib/task-session";
import { formatTaskToken, isTaskCompletedStatus } from "@/lib/task-domain";
import { isTaskArchived } from "@/lib/task-archive";
import { formatTaskEstimate } from "@/lib/task-estimate";
import { formatTaskRecurrenceRule } from "@/lib/task-recurrence";
import { Clock3, Folder, ListChecks, Pin } from "lucide-react";
import type { TasksPageModel } from "../_lib/tasks-page-model";

function getTaskSignalTone(status: string, priority: string) {
  if (status === "blocked" || priority === "urgent") return "bg-[var(--signal-error)]";
  if (priority === "high") return "bg-[var(--signal-warn)]";
  if (status === "in_progress") return "bg-[var(--signal-live)]";
  return "bg-[var(--signal-info)]";
}

export function TasksPageView({ model }: { model: TasksPageModel }) {
  const {
    parsed,
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    savedViews,
    resolvedSavedViewFeedback,
    calendarFormDefaults,
    activeProjectId,
    activeGoalId,
    returnPath,
    taskUrlFilters,
    focusQueue,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
  } = model;
  const { activeStatus, activeView, activeLayout, activeDueFilter, savedViewDefinitionFilters } = parsed;
  const taskUpdateError = parsed.taskUpdateError;
  const taskUpdateSuccess = parsed.taskUpdateSuccess;
  const taskUpdateTaskId = parsed.taskUpdateTaskId;

  const listHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "list" });
  const kanbanHref = buildTaskListUrl("/tasks", { ...taskUrlFilters, view: activeView, layout: "kanban" });
  const archivedTaskCount = summary.archived;

  return (
    <div className="workspace-main-rail-grid tasks-dashboard-grid">
      <div className="space-y-5">
        <Card className="ega-glass-strong overflow-hidden rounded-[1.5rem]">
          <CardHeader className="gap-5 border-b border-[rgba(15,23,42,0.07)] p-6 pb-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href={buildTaskListUrl("/tasks", { ...taskUrlFilters, view: "active", layout: activeLayout })}
                className={`tasks-view-tab ${activeView === "active" ? "tasks-view-tab-active" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"}`}
              >
                Active
              </Link>
              <Link
                href={buildTaskListUrl("/tasks", { ...taskUrlFilters, view: "archived", layout: activeLayout })}
                className={`tasks-view-tab ${activeView === "archived" ? "tasks-view-tab-active" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"}`}
              >
                Archived
              </Link>
              <Link
                href={buildTaskListUrl("/tasks", { ...taskUrlFilters, view: "all", layout: activeLayout })}
                className={`tasks-view-tab ${activeView === "all" ? "tasks-view-tab-active" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"}`}
              >
                All
              </Link>
              <span className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:inline-flex" />
              <Link
                href={listHref}
                className={`tasks-view-tab ${activeLayout === "list" ? "tasks-view-tab-active" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"}`}
                aria-current={activeLayout === "list" ? "page" : undefined}
              >
                List
              </Link>
              <Link
                href={kanbanHref}
                className={`tasks-view-tab ${activeLayout === "kanban" ? "tasks-view-tab-active" : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"}`}
                aria-current={activeLayout === "kanban" ? "page" : undefined}
              >
                Kanban
              </Link>
              <span className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:inline-flex" />
              <Badge tone="muted" className="ega-glass-pill">
                {summary.total} total
              </Badge>
              <Badge tone={archivedTaskCount > 0 ? "warn" : "muted"}>{archivedTaskCount} archived</Badge>
              <Badge tone="active">{tasks.length} visible</Badge>
              <Badge tone={blockedCount > 0 ? "warn" : "muted"}>{blockedCount} blocked</Badge>
              <Badge tone={inProgressCount > 0 ? "info" : "muted"}>{inProgressCount} in progress</Badge>
              <Badge tone={overdueCount > 0 ? "error" : "muted"}>{overdueCount} overdue</Badge>
              <Badge tone={dueSoonCount > 0 ? "warn" : "muted"}>{dueSoonCount} due soon</Badge>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <CardTitle className="text-[1.35rem]">Active execution queue</CardTitle>
                <p className="mt-4 text-sm font-semibold text-[color:var(--foreground)]">Operational task slice</p>
                <CardDescription>
                  {tasks.length} item{tasks.length !== 1 ? "s" : ""} in the current queue
                  {activeLayout === "kanban" ? " ready for board planning." : " with inline state control."}
                </CardDescription>
              </div>
              <CardAction className="hidden sm:flex">
                <Badge tone="muted" className="ega-glass-pill">
                  URL filters
                </Badge>
              </CardAction>
            </div>
            <div className="ega-glass-soft rounded-[1.25rem] p-4">
              <TaskFilterControls
                basePath="/tasks"
                activeStatus={activeStatus}
                activeProjectId={activeProjectId}
                activeGoalId={activeGoalId}
                activeDueFilter={activeDueFilter}
                activeSort={parsed.activeSort}
                activeView={activeView}
                activeLayout={activeLayout}
                projectOptions={projects}
                goalOptions={goals.map((g) => ({ id: g.id, title: g.title }))}
              />
            </div>
            {taskUpdateSuccess ? <p className="feedback-block feedback-block-success">{taskUpdateSuccess}</p> : null}
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {activeLayout === "kanban" ? (
              <div className="tasks-kanban-board">
                {kanbanBoard.columns.map((column) => {
                  const columnTasks = kanbanBoard.tasksByStatus[column.status];
                  return (
                    <section key={column.status} className="tasks-kanban-column ega-glass-soft min-h-56 rounded-[1rem] border border-[rgba(15,23,42,0.08)] p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-[color:var(--foreground)]">{column.label}</h2>
                        <Badge tone="muted">
                          {columnTasks.length} task{columnTasks.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {columnTasks.length === 0 ? (
                        <div className="mt-4 rounded-[0.9rem] border border-dashed border-[rgba(15,23,42,0.14)] px-3 py-8 text-center">
                          <p className="text-sm font-medium text-[color:var(--foreground)]">No {column.label.toLowerCase()} tasks</p>
                          <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">Current filters have no tasks in this status.</p>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {columnTasks.map((task) => {
                            const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;
                            return (
                              <TaskKanbanCard
                                key={task.id}
                                task={task}
                                signalTone={getTaskSignalTone(task.status, task.priority)}
                                updateAction={updateTaskInlineAction}
                                startTimerAction={startTimerAction}
                                pinAction={pinTaskAction}
                                unpinAction={unpinTaskAction}
                                archiveAction={archiveTaskAction}
                                unarchiveAction={unarchiveTaskAction}
                                deleteAction={deleteTaskAction}
                                createReminderAction={createTaskReminderAction}
                                cancelReminderAction={cancelTaskReminderAction}
                                returnTo={returnPath}
                                trackedSeconds={taskTotalDurations[task.id]}
                                error={inlineError}
                              />
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : tasks.length === 0 ? (
              <EmptyState icon={ListChecks} title="No tasks match current filters" description="Reset one or more filters to bring the execution queue back into view." actionLabel="Reset filters" actionHref="/tasks" />
            ) : (
              tasks.map((task) => {
                const inlineError = taskUpdateTaskId === task.id ? taskUpdateError : null;
                const taskArchived = isTaskArchived(task.archived_at);
                const taskCompleted = isTaskCompletedStatus(task.status);
                return (
                  <article key={task.id} id={`task-${task.id}`} className="tasks-task-card scroll-mt-24">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                      <div className="min-w-0">
                        <div className="flex items-start gap-3">
                          <span className={`mt-2.5 h-3 w-3 shrink-0 rounded-full ring-4 ring-white ${getTaskSignalTone(task.status, task.priority)}`} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h2 className="truncate text-lg font-semibold leading-tight text-[color:var(--foreground)]">{task.title}</h2>
                                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[color:var(--muted-foreground)]">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Folder className="h-3.5 w-3.5" aria-hidden="true" />
                                    {task.projects?.name ?? "No project"}
                                  </span>
                                  {task.goals?.title ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                                      {task.goals.title}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 xl:hidden">
                                <StatusBadge status={task.status} />
                                <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                                {taskArchived ? <Badge tone="warn">Archived</Badge> : null}
                                {task.focus_rank ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
                              </div>
                            </div>
                            {task.description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">{task.description}</p> : null}
                            {task.status === "blocked" && task.blocked_reason?.trim() ? (
                              <p className="mt-2 rounded-[0.8rem] border border-[rgba(220,38,38,0.18)] bg-[rgba(220,38,38,0.06)] px-3 py-2 text-sm leading-6 text-[var(--signal-error)]">
                                Blocked: {task.blocked_reason.trim()}
                              </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <TaskDueDateLabel dueDate={task.due_date} status={task.status} />
                              <Badge tone="muted" className="ega-glass-pill gap-1.5">
                                <Clock3 className="h-3 w-3" aria-hidden="true" />
                                Tracked {formatDurationLabel(taskTotalDurations[task.id] ?? 0)}
                              </Badge>
                              {task.estimate_minutes ? <Badge tone="muted">Est. {formatTaskEstimate(task.estimate_minutes)}</Badge> : null}
                              {task.task_recurrences[0] ? <Badge tone="info">{formatTaskRecurrenceRule(task.task_recurrences[0].rule)}</Badge> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="hidden flex-wrap gap-2 xl:flex">
                        <StatusBadge status={task.status} />
                        <Badge tone="muted">{formatTaskToken(task.priority)}</Badge>
                        {taskArchived ? <Badge tone="warn">Archived</Badge> : null}
                        {task.focus_rank ? <Badge tone="info">Pinned #{task.focus_rank}</Badge> : null}
                        {task.task_recurrences[0] ? <Badge tone="info">{formatTaskRecurrenceRule(task.task_recurrences[0].rule)}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-5 grid gap-4 border-t border-[rgba(15,23,42,0.08)] pt-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
                      <div className="flex flex-wrap gap-3">
                        <div className="ega-glass-soft grid min-w-32 gap-1 rounded-[0.9rem] px-3 py-3">
                          <p className="glass-label text-etch">Tracked</p>
                          <p className="text-sm font-medium text-[color:var(--foreground)]">{formatDurationLabel(taskTotalDurations[task.id] ?? 0)}</p>
                        </div>
                        {task.estimate_minutes ? (
                          <div className="ega-glass-soft grid min-w-32 gap-1 rounded-[0.9rem] px-3 py-3">
                            <p className="glass-label text-etch">Estimate</p>
                            <p className="text-sm font-medium text-[color:var(--foreground)]">{formatTaskEstimate(task.estimate_minutes)}</p>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-4">
                        <TaskReminderPanel taskId={task.id} reminders={task.task_reminders} returnTo={returnPath} createAction={createTaskReminderAction} cancelAction={cancelTaskReminderAction} />
                        <InlineTaskUpdateForm
                          action={updateTaskInlineAction}
                          deleteAction={deleteTaskAction}
                          archiveAction={archiveTaskAction}
                          unarchiveAction={unarchiveTaskAction}
                          taskId={task.id}
                          taskTitle={task.title}
                          returnTo={returnPath}
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
                          archivedAt={task.archived_at}
                          error={inlineError}
                          overflowActions={
                            !taskArchived ? (
                              <>
                                {!taskCompleted ? (
                                  <form action={startTimerAction}>
                                    <input type="hidden" name="taskId" value={task.id} />
                                    <input type="hidden" name="returnTo" value={returnPath} />
                                    <Button type="submit" size="sm" variant="ghost" className="w-full justify-center">
                                      Start timer
                                    </Button>
                                  </form>
                                ) : null}
                                <FocusPinToggleForm action={task.focus_rank ? unpinTaskAction : pinTaskAction} taskId={task.id} returnTo={returnPath} isPinned={task.focus_rank !== null} className="w-full" fullWidth />
                              </>
                            ) : null
                          }
                        />
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </CardContent>
          <CardFooter className="justify-between border-t border-[rgba(15,23,42,0.07)] bg-[rgba(255,255,255,0.42)]">
            <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">Filters stay encoded in the URL for direct return to this queue slice.</p>
            <Link href="/tasks/projects" className="glass-label text-signal-live">
              Manage projects
            </Link>
          </CardFooter>
        </Card>
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader>
            <p className="glass-label text-signal-live">Initialize Task</p>
            <CardTitle className="text-xl">Create directly into the queue</CardTitle>
            <CardDescription>Open a new task directly into the current execution surface.</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {projects.length === 0 ? (
              <div className="space-y-3">
                <div className="ega-glass-empty rounded-[1rem] px-4 py-4 text-center">
                  <p className="glass-label text-etch">No projects yet. Create one first.</p>
                </div>
                <Link href="/tasks/projects/new" className="btn-instrument flex h-9 items-center justify-center px-4">
                  Create project
                </Link>
              </div>
            ) : (
              <CreateTaskForm projects={projects} goals={goals} projectId={activeProjectId ?? undefined} returnTo={returnPath} calendarDefaults={calendarFormDefaults} />
            )}
          </CardContent>
        </Card>
      </div>
      <aside className="workspace-secondary-rail tasks-side-rail space-y-5">
        <TaskSavedViewsPanel
          currentFilters={{
            status: activeStatus,
            projectId: activeProjectId,
            goalId: activeGoalId,
            dueFilter: parsed.activeDueFilter,
            sortValue: parsed.activeSort,
            activeTasks: savedViewDefinitionFilters.activeTasks,
            priorityValues: savedViewDefinitionFilters.priorityValues,
            estimateMinMinutes: savedViewDefinitionFilters.estimateMinMinutes,
            estimateMaxMinutes: savedViewDefinitionFilters.estimateMaxMinutes,
            dueWithinDays: savedViewDefinitionFilters.dueWithinDays,
          }}
          savedViews={savedViews}
          activeLayout={activeLayout}
          projectOptions={projects}
          goalOptions={goals.map((g) => ({ id: g.id, title: g.title }))}
          feedback={resolvedSavedViewFeedback}
        />
        <Card className="ega-glass rounded-[1.35rem]">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl">Pinned tasks</CardTitle>
                <CardDescription>Pin important tasks from the queue to stay focused on what matters.</CardDescription>
              </div>
              <span className="ega-glass-pill flex h-10 w-10 items-center justify-center rounded-full text-[var(--signal-live)]">
                <Pin className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-1">
            {focusQueue.length > 0 ? (
              focusQueue.slice(0, 5).map((task) => (
                <div key={task.id} className="ega-glass-soft flex items-center justify-between gap-3 rounded-[1rem] px-3 py-3 transition-precise hover:border-[rgba(23,123,82,0.16)] hover:bg-[rgba(255,255,255,0.7)]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--foreground)]">{task.title}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                      #{task.focus_rank} · {task.projects?.name ?? "No project"}
                    </p>
                  </div>
                  <FocusPinToggleForm action={unpinTaskAction} taskId={task.id} returnTo={returnPath} isPinned compact />
                </div>
              ))
            ) : (
              <EmptyState icon={Pin} title="No pinned tasks yet" description="Pin tasks from the queue to build a deliberate focus order." className="min-h-40 justify-center" />
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
