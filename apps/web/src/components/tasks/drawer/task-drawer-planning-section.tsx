"use client";

import { useState } from "react";
import { CalendarClock, Repeat, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import {
  SCHEDULE_DURATION_PRESETS,
  addMinutesToLocalDateTime,
  buildQuickScheduleBlock,
  durationMinutesBetween,
  formatDurationChipLabel,
  toLocalDateTimeInputValue,
} from "@/lib/calendar-schedule-draft";
import { useDisplayTimezone } from "@/lib/hooks/use-display-timezone";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";
import { TASK_STATUS_VALUES, formatTaskToken } from "@/lib/task-domain";
import type { TaskDrawerPlanning } from "@/lib/services/task-drawer-planning-service";
import type { TaskReminderRecord } from "@/lib/services/task-service";
import { cn } from "@/lib/utils";

type TaskFieldAction = (formData: FormData) => void | Promise<void>;

type TaskDrawerPlanningSectionProps = {
  taskId: string;
  status: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
  planning: TaskDrawerPlanning;
  projectOptions: Array<{ id: string; name: string }>;
  returnTo: string;
  updateInlineAction: TaskFieldAction;
  createReminderAction?: TaskFieldAction;
  cancelReminderAction?: TaskFieldAction;
  reminders?: TaskReminderRecord[];
};

export function TaskDrawerPlanningSection({
  taskId,
  status,
  priority,
  dueDate,
  estimateMinutes,
  blockedReason,
  planning,
  projectOptions,
  returnTo,
  updateInlineAction,
  createReminderAction,
  cancelReminderAction,
  reminders = planning.reminders,
}: TaskDrawerPlanningSectionProps) {
  const accountTimeZone = useDisplayTimezone();
  const [projectId, setProjectId] = useState(planning.projectId ?? "");
  const [goalId, setGoalId] = useState(planning.goalId ?? "");
  const [statusValue, setStatusValue] = useState(status);
  const [blockedReasonValue, setBlockedReasonValue] = useState(
    blockedReason ?? "",
  );
  const [scheduledStartAt, setScheduledStartAt] = useState(() =>
    toLocalDateTimeInputValue(planning.scheduledStartAt, accountTimeZone),
  );
  const [scheduledEndAt, setScheduledEndAt] = useState(() =>
    toLocalDateTimeInputValue(planning.scheduledEndAt, accountTimeZone),
  );
  const [scheduleEdited, setScheduleEdited] = useState(false);
  const [previousTimeZone, setPreviousTimeZone] = useState(accountTimeZone);
  if (accountTimeZone !== previousTimeZone) {
    setPreviousTimeZone(accountTimeZone);
    if (!scheduleEdited) {
      setScheduledStartAt(
        toLocalDateTimeInputValue(planning.scheduledStartAt, accountTimeZone),
      );
      setScheduledEndAt(
        toLocalDateTimeInputValue(planning.scheduledEndAt, accountTimeZone),
      );
    }
  }
  const [calendarSyncEnabled, setCalendarSyncEnabled] = useState(
    planning.calendarSyncEnabled,
  );
  const [calendarSyncTouched, setCalendarSyncTouched] = useState(false);

  const defaultDurationMinutes =
    estimateMinutes && estimateMinutes >= 15 ? estimateMinutes : 60;
  const activeDuration = durationMinutesBetween(scheduledStartAt, scheduledEndAt);
  const hasCompleteBlock = Boolean(scheduledStartAt && scheduledEndAt);

  function applyQuickDay(dayOffset: 0 | 1) {
    const block = buildQuickScheduleBlock(
      dayOffset,
      activeDuration ?? defaultDurationMinutes,
      new Date(),
      accountTimeZone,
    );
    setScheduleEdited(true);
    setScheduledStartAt(block.start);
    setScheduledEndAt(block.end);
    if (!calendarSyncTouched) {
      setCalendarSyncEnabled(true);
    }
  }

  function handleStartChange(nextStart: string) {
    setScheduleEdited(true);
    setScheduledStartAt(nextStart);
    if (nextStart) {
      const span = activeDuration ?? defaultDurationMinutes;
      const nextEnd = addMinutesToLocalDateTime(nextStart, span);
      if (nextEnd) setScheduledEndAt(nextEnd);
      if (!calendarSyncTouched) {
        setCalendarSyncEnabled(true);
      }
    }
  }

  function handleDurationSelect(minutes: number) {
    setScheduleEdited(true);
    if (scheduledStartAt) {
      const nextEnd = addMinutesToLocalDateTime(scheduledStartAt, minutes);
      if (nextEnd) setScheduledEndAt(nextEnd);
      return;
    }
    const block = buildQuickScheduleBlock(0, minutes, new Date(), accountTimeZone);
    setScheduledStartAt(block.start);
    setScheduledEndAt(block.end);
    if (!calendarSyncTouched) {
      setCalendarSyncEnabled(true);
    }
  }

  function clearSchedule() {
    setScheduleEdited(true);
    setScheduledStartAt("");
    setScheduledEndAt("");
  }

  // A goal belongs to one project. Changing project clears the selection so the
  // server never rejects an otherwise valid planning update; the user can then
  // pick a goal from the newly selected project's options.
  const projectGoals = planning.goalOptions.filter(
    (goal) => goal.projectId === projectId,
  );
  const currentGoal =
    planning.goalId && projectId === (planning.projectId ?? "")
      ? { id: planning.goalId, title: planning.goalName ?? "Current goal" }
      : null;
  const goalChoices =
    currentGoal && !projectGoals.some((goal) => goal.id === currentGoal.id)
      ? [currentGoal, ...projectGoals]
      : projectGoals;
  const statusValues: string[] = [...TASK_STATUS_VALUES];
  if (statusValue && !statusValues.includes(statusValue)) {
    statusValues.unshift(statusValue);
  }

  return (
    <section
      className="mt-5 border-t border-[var(--ega-divider)] pt-3"
      aria-labelledby={`planning-${taskId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`planning-${taskId}`}
          className="text-[length:var(--text-meta)] font-semibold text-[color:var(--ega-text-secondary)]"
        >
          Schedule and planning
        </h2>
        <Badge
          tone={
            calendarSyncEnabled && hasCompleteBlock
              ? "active"
              : calendarSyncEnabled
                ? "warn"
                : "muted"
          }
        >
          {calendarSyncEnabled && hasCompleteBlock
            ? "Calendar sync on"
            : calendarSyncEnabled
              ? "Set time to sync"
              : "Calendar sync off"}
        </Badge>
      </div>

      <form action={updateInlineAction} className="mt-3 flex flex-col gap-4">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="priority" value={priority} />
        <input type="hidden" name="dueDate" value={dueDate ?? ""} />
        <input
          type="hidden"
          name="estimateMinutes"
          value={estimateMinutes === null ? "" : String(estimateMinutes)}
        />

        <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 pr-1 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Time block
            </span>
            <button
              type="button"
              onClick={() => applyQuickDay(0)}
              data-testid="drawer-schedule-today"
              className="rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 py-0.5 text-xs font-medium text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyQuickDay(1)}
              data-testid="drawer-schedule-tomorrow"
              className="rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 py-0.5 text-xs font-medium text-[color:var(--ega-text)] hover:bg-[var(--ega-surface-hover)]"
            >
              Tomorrow
            </button>
            {scheduledStartAt || scheduledEndAt ? (
              <button
                type="button"
                onClick={clearSchedule}
                data-testid="drawer-schedule-clear"
                className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-xs text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Scheduled start
              <input
                name="scheduledStartAt"
                type="datetime-local"
                value={scheduledStartAt}
                onChange={(event) => handleStartChange(event.target.value)}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs tabular-nums text-[color:var(--ega-text)]"
              />
            </label>

            <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Scheduled end
              <input
                name="scheduledEndAt"
                type="datetime-local"
                value={scheduledEndAt}
                onChange={(event) => setScheduledEndAt(event.target.value)}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs tabular-nums text-[color:var(--ega-text)]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Duration
            </span>
            {SCHEDULE_DURATION_PRESETS.map((minutes) => {
              const active = activeDuration === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => handleDurationSelect(minutes)}
                  aria-pressed={active}
                  data-testid={`drawer-duration-${minutes}`}
                  className={cn(
                    "rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs tabular-nums transition-colors",
                    active
                      ? "border-[var(--ega-ink)] bg-[var(--ega-ink)] font-medium text-[color:var(--ega-on-ink)]"
                      : "border-[var(--ega-border)] bg-[var(--ega-surface)] text-[color:var(--ega-text-secondary)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]",
                  )}
                >
                  {formatDurationChipLabel(minutes)}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ega-divider)] pt-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[color:var(--ega-text)]">
              <input
                type="checkbox"
                name="calendarSyncEnabled"
                checked={calendarSyncEnabled}
                onChange={(event) => {
                  setCalendarSyncTouched(true);
                  setCalendarSyncEnabled(event.target.checked);
                }}
                className="h-4 w-4"
              />
              Sync to Google Calendar
            </label>
            <label className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              <span>Reminder</span>
              <input
                name="calendarReminderMinutes"
                type="number"
                min={0}
                step={5}
                defaultValue={planning.calendarReminderMinutes}
                className="h-8 w-16 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs tabular-nums text-[color:var(--ega-text)]"
              />
              <span>min before</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Project
            <select
              name="projectId"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setGoalId("");
              }}
              required
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            >
              {planning.projectId === null ? (
                <option value="" disabled>
                  Choose a project
                </option>
              ) : null}
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Goal
            <select
              name="goalId"
              value={goalId}
              onChange={(event) => setGoalId(event.target.value)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            >
              <option value="">No goal</option>
              {goalChoices.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            <span className="flex items-center gap-1">
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              Repeat
            </span>
            <select
              name="recurrenceRule"
              defaultValue={planning.recurrenceRule ?? ""}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            >
              <option value="">{formatTaskRecurrenceRule(null)}</option>
              {TASK_RECURRENCE_RULE_VALUES.map((rule) => (
                <option key={rule} value={rule}>
                  {formatTaskRecurrenceRule(rule)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Status
            <select
              name="status"
              value={statusValue}
              onChange={(event) => setStatusValue(event.target.value)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            >
              {statusValues.map((value) => (
                <option key={value} value={value}>
                  {formatTaskToken(value)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {statusValue === "blocked" ? (
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Blocked reason
            <input
              name="blockedReason"
              value={blockedReasonValue}
              onChange={(event) => setBlockedReasonValue(event.target.value)}
              required
              placeholder="What is currently blocking this task?"
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            />
          </label>
        ) : (
          <input type="hidden" name="blockedReason" value="" />
        )}

        <div className="flex items-center justify-end">
          <PendingSubmitButton
            type="submit"
            variant="primary"
            size="sm"
            className="h-8 px-3 text-xs"
            pendingLabel="Saving…"
          >
            Save planning
          </PendingSubmitButton>
        </div>
      </form>

      {createReminderAction && cancelReminderAction ? (
        <div className="mt-4 border-t border-[var(--ega-divider)] pt-3">
          <TaskReminderPanel
            taskId={taskId}
            reminders={reminders}
            returnTo={returnTo}
            createAction={createReminderAction}
            cancelAction={cancelReminderAction}
            compact
          />
        </div>
      ) : null}
    </section>
  );
}
