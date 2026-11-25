"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import {
  createTaskAction,
  type CreateTaskFormState,
} from "@/app/(workspace)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SCHEDULE_DURATION_PRESETS,
  addMinutesToLocalDateTime,
  buildQuickScheduleBlock,
  durationMinutesBetween,
  formatDurationChipLabel,
} from "@/lib/calendar-schedule-draft";
import type { CreateCalendarDefaults } from "@/lib/services/create-options-service";
import {
  TASK_PRIORITY_VALUES,
  TASK_TITLE_LENGTH_ERROR,
  TASK_TITLE_MAX,
  formatTaskToken,
} from "@/lib/task-domain";
import { cn } from "@/lib/utils";

type QuickTaskSheetProject = {
  id: string;
  name: string;
};

type QuickTaskSheetGoal = {
  id: string;
  title: string;
  project_id: string;
};

export type QuickTaskSheetPanelProps = {
  projects: QuickTaskSheetProject[];
  /** Retained for the unified create shell; goals are not required by the lean composer. */
  goals?: QuickTaskSheetGoal[];
  activeTab?: "single" | "multi";
  onTabChange?: (mode: "single" | "multi") => void;
  onSuccess: (mode: "single" | "multi", skippedCount: number) => void;
  hideHeader?: boolean;
  initialCommand?: string;
  onCommandChange?: (command: string) => void;
  selectedProjectId?: string;
  onProjectIdChange?: (projectId: string) => void;
  /** Column the "Add task here" action was opened from, if any. */
  selectedStatus?: string;
  /** Owner's Google Calendar connection & default sync preferences. */
  calendarDefaults?: CreateCalendarDefaults;
};

const DEFAULT_RETURN_TO = "/tasks";

const FIELD_LABEL = "form-label";

/**
 * Primary submit for the lean quick capture.
 *
 * It must use the canonical Button system: the previous legacy variables
 * resolved to the same near-black for both the surface and the label, which
 * rendered the primary action as an unreadable black rectangle.
 */
function QuickTaskSubmitButton({
  label,
  pending,
  disabled = false,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending || disabled}
      className="h-9 shrink-0 px-4 disabled:bg-[var(--ega-surface-muted)] disabled:text-[color:var(--ega-text-secondary)] disabled:opacity-100"
    >
      {pending ? "Creating\u2026" : label}
    </Button>
  );
}

function initialValues(defaultProjectId: string): CreateTaskFormState["values"] {
  return {
    title: "",
    projectId: defaultProjectId,
    goalId: "",
    description: "",
    blockedReason: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    recurrenceRule: "",
    recurrenceTimezone: "",
    scheduledStartAt: "",
    scheduledEndAt: "",
    calendarSyncEnabled: "",
    calendarReminderMinutes: "10",
    workedTimeStartedAt: "",
    workedTimeEndedAt: "",
    returnTo: DEFAULT_RETURN_TO,
  };
}

/**
 * One-line task capture with an optional details row.
 *
 * The title is the only required input; project, due date and priority live in
 * a quiet disclosure so the common case stays a single keystroke-and-Enter
 * action. The composer never parses commands or stages multiple drafts; the
 * drawer owns richer editing after creation.
 */
export function QuickTaskSheetPanel({
  projects,
  onSuccess,
  hideHeader = false,
  initialCommand,
  onCommandChange,
  selectedProjectId,
  onProjectIdChange,
  calendarDefaults,
}: QuickTaskSheetPanelProps) {
  const defaultProjectId = selectedProjectId || projects[0]?.id || "";
  const defaultSyncOnSchedule = calendarDefaults
    ? calendarDefaults.connected && calendarDefaults.scheduledTaskSyncEnabled
    : false;
  const defaultReminderMinutes = String(
    calendarDefaults?.defaultReminderMinutes ?? 10,
  );

  const [title, setTitle] = useState(initialCommand ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledStartAt, setScheduledStartAt] = useState("");
  const [scheduledEndAt, setScheduledEndAt] = useState("");
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number>(60);
  const [calendarSyncEnabled, setCalendarSyncEnabled] = useState(defaultSyncOnSchedule);
  const [calendarSyncTouched, setCalendarSyncTouched] = useState(false);
  const [calendarReminderMinutes, setCalendarReminderMinutes] = useState(
    defaultReminderMinutes,
  );

  const initialState: CreateTaskFormState = {
    error: null,
    success: null,
    values: initialValues(defaultProjectId),
  };
  const [state, formAction, pending] = useActionState(
    createTaskAction,
    initialState,
  );

  const titleTooLong = title.length > TASK_TITLE_MAX;
  const hasSchedule = Boolean(scheduledStartAt || scheduledEndAt);
  const activeDuration = durationMinutesBetween(scheduledStartAt, scheduledEndAt);

  useEffect(() => {
    const focusId = window.requestAnimationFrame(() => {
      document.getElementById("quick-task-command")?.focus();
    });
    return () => window.cancelAnimationFrame(focusId);
  }, []);

  // The unified shell may load project and calendar options after mount.
  const [previousDefaultProjectId, setPreviousDefaultProjectId] =
    useState(defaultProjectId);
  if (defaultProjectId !== previousDefaultProjectId) {
    setPreviousDefaultProjectId(defaultProjectId);
    if (!projectId && defaultProjectId) {
      setProjectId(defaultProjectId);
    }
  }

  const [previousCalendarDefaults, setPreviousCalendarDefaults] =
    useState(calendarDefaults);
  if (calendarDefaults !== previousCalendarDefaults) {
    setPreviousCalendarDefaults(calendarDefaults);
    if (calendarDefaults && !calendarSyncTouched) {
      setCalendarSyncEnabled(
        calendarDefaults.connected && calendarDefaults.scheduledTaskSyncEnabled,
      );
      setCalendarReminderMinutes(String(calendarDefaults.defaultReminderMinutes));
    }
  }

  useEffect(() => {
    if (state.success) {
      onSuccess("single", 0);
    }
  }, [onSuccess, state.success]);

  // A failed submit restores the server's sanitized values without dropping a
  // detail the user already chose.
  const [previousState, setPreviousState] = useState(state);
  if (state !== previousState) {
    setPreviousState(state);
    setPriority(state.values.priority);
    setDueDate(state.values.dueDate);
    setProjectId(state.values.projectId);
    if (state.values.scheduledStartAt || state.values.scheduledEndAt) {
      setScheduledStartAt(state.values.scheduledStartAt);
      setScheduledEndAt(state.values.scheduledEndAt);
      setScheduleOpen(true);
    }
    if (state.values.calendarSyncEnabled) {
      setCalendarSyncEnabled(state.values.calendarSyncEnabled === "on");
    }
    if (state.values.calendarReminderMinutes) {
      setCalendarReminderMinutes(state.values.calendarReminderMinutes);
    }
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    onCommandChange?.(value);
  }

  function handleProjectChange(value: string) {
    setProjectId(value);
    onProjectIdChange?.(value);
  }

  function applyQuickDay(dayOffset: 0 | 1) {
    const block = buildQuickScheduleBlock(dayOffset, selectedDurationMinutes);
    setScheduledStartAt(block.start);
    setScheduledEndAt(block.end);
    setScheduleOpen(true);
    if (!calendarSyncTouched && (calendarDefaults?.connected ?? true)) {
      setCalendarSyncEnabled(true);
    }
  }

  function handleStartChange(nextStart: string) {
    setScheduledStartAt(nextStart);
    if (nextStart) {
      const span = activeDuration ?? selectedDurationMinutes;
      const computedEnd = addMinutesToLocalDateTime(nextStart, span);
      if (computedEnd) setScheduledEndAt(computedEnd);
      if (!calendarSyncTouched && (calendarDefaults?.connected ?? true)) {
        setCalendarSyncEnabled(true);
      }
    }
  }

  function handleDurationSelect(minutes: number) {
    setSelectedDurationMinutes(minutes);
    if (scheduledStartAt) {
      const computedEnd = addMinutesToLocalDateTime(scheduledStartAt, minutes);
      if (computedEnd) setScheduledEndAt(computedEnd);
      return;
    }
    const block = buildQuickScheduleBlock(0, minutes);
    setScheduledStartAt(block.start);
    setScheduledEndAt(block.end);
    setScheduleOpen(true);
    if (!calendarSyncTouched && (calendarDefaults?.connected ?? true)) {
      setCalendarSyncEnabled(true);
    }
  }

  function clearSchedule() {
    setScheduledStartAt("");
    setScheduledEndAt("");
    setScheduleOpen(false);
  }

  return (
    <>
      {!hideHeader ? (
        <div className="border-b border-[var(--ega-border)] px-5 py-4 sm:px-6">
          <DialogPrimitive.Title
            id="quick-task-sheet-title"
            className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]"
          >
            New task
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="quick-task-sheet-description"
            className="text-xs text-[color:var(--ega-text-secondary)]"
          >
            Capture the next action. Add details only when they matter.
          </DialogPrimitive.Description>
        </div>
      ) : null}

      <form
        action={formAction}
        className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4 sm:px-6"
        aria-label="Quick task capture form"
      >
        <input type="hidden" name="returnTo" value={DEFAULT_RETURN_TO} />
        <input type="hidden" name="goalId" value="" />
        <input type="hidden" name="estimateMinutes" value="" />
        <input type="hidden" name="description" value="" />
        <input type="hidden" name="blockedReason" value="" />
        <input type="hidden" name="status" value="todo" />

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="quick-task-command" className="sr-only">
              Task title
            </label>
            <Input
              id="quick-task-command"
              name="title"
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
              placeholder="Ship the auth fix"
              autoComplete="off"
              required
              aria-describedby="quick-task-title-count quick-task-title-error"
              aria-invalid={titleTooLong}
              className="h-11 w-full text-[length:var(--text-body-lg)]"
            />
            <p
              id="quick-task-title-count"
              className="mt-1 text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
              aria-live="polite"
            >
              {title.length}/{TASK_TITLE_MAX}
            </p>
            {titleTooLong ? (
              <p
                id="quick-task-title-error"
                role="alert"
                className="mt-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
              >
                {TASK_TITLE_LENGTH_ERROR}
              </p>
            ) : null}
          </div>
          <QuickTaskSubmitButton
            label="Create task"
            pending={pending}
            disabled={!title.trim() || titleTooLong}
          />
        </div>

        <div className="flex flex-col gap-2.5 border-t border-[var(--ega-divider)] pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 pr-1 text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text-secondary)]">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Schedule
            </span>
            <button
              type="button"
              onClick={() => applyQuickDay(0)}
              data-testid="quick-schedule-today"
              className="rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] px-2.5 py-1 text-xs font-medium text-[color:var(--ega-text)] transition-colors hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyQuickDay(1)}
              data-testid="quick-schedule-tomorrow"
              className="rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] px-2.5 py-1 text-xs font-medium text-[color:var(--ega-text)] transition-colors hover:bg-[var(--ega-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
            >
              Tomorrow
            </button>
            {!scheduleOpen && !hasSchedule ? (
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                data-testid="quick-schedule-custom"
                className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[color:var(--ega-text-secondary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
              >
                Pick time
              </button>
            ) : (
              <button
                type="button"
                onClick={clearSchedule}
                data-testid="quick-schedule-clear"
                className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[color:var(--ega-text-secondary)] transition-colors hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Clear
              </button>
            )}
          </div>

          {scheduleOpen || hasSchedule ? (
            <div className="flex flex-col gap-2.5">
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
                      data-testid={`quick-duration-${minutes}`}
                      className={cn(
                        "rounded-[var(--radius-sm)] border px-2 py-0.5 text-xs tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ega-focus-outline)]",
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

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="quick-task-scheduled-start" className={FIELD_LABEL}>
                    Start
                  </label>
                  <input
                    id="quick-task-scheduled-start"
                    name="scheduledStartAt"
                    type="datetime-local"
                    value={scheduledStartAt}
                    onChange={(event) => handleStartChange(event.target.value)}
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-xs tabular-nums text-[color:var(--ega-text)]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="quick-task-scheduled-end" className={FIELD_LABEL}>
                    End
                  </label>
                  <input
                    id="quick-task-scheduled-end"
                    name="scheduledEndAt"
                    type="datetime-local"
                    value={scheduledEndAt}
                    onChange={(event) => setScheduledEndAt(event.target.value)}
                    className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-xs tabular-nums text-[color:var(--ega-text)]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[color:var(--ega-text)]">
                  <input
                    id="quick-task-calendar-sync"
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

                {calendarSyncEnabled ? (
                  <label className="inline-flex items-center gap-1.5 text-xs text-[color:var(--ega-text-secondary)]">
                    <span>Reminder</span>
                    <input
                      id="quick-task-calendar-reminder"
                      name="calendarReminderMinutes"
                      type="number"
                      min={0}
                      step={5}
                      value={calendarReminderMinutes}
                      onChange={(event) =>
                        setCalendarReminderMinutes(event.target.value)
                      }
                      className="h-8 w-16 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs tabular-nums text-[color:var(--ega-text)]"
                    />
                    <span>min before</span>
                  </label>
                ) : (
                  <input
                    type="hidden"
                    name="calendarReminderMinutes"
                    value={calendarReminderMinutes}
                  />
                )}
              </div>

              {calendarSyncEnabled && scheduledStartAt && scheduledEndAt ? (
                <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
                  Publishes to Google Calendar automatically when you create this task.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <input type="hidden" name="scheduledStartAt" value="" />
              <input type="hidden" name="scheduledEndAt" value="" />
              <input
                type="hidden"
                name="calendarReminderMinutes"
                value={calendarReminderMinutes}
              />
            </>
          )}
        </div>

        <details
          className="group rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)]"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ega-focus-outline)]">
            <span>Details</span>
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="grid grid-cols-1 gap-3 border-t border-[var(--ega-divider)] px-3 py-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-project" className={FIELD_LABEL}>
                Project
              </label>
              <select
                id="quick-task-project"
                name="projectId"
                value={projectId}
                onChange={(event) => handleProjectChange(event.target.value)}
                className="input-instrument h-9 w-full px-2 text-sm"
                required
              >
                {projects.length === 0 ? <option value="">No project</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-priority" className={FIELD_LABEL}>
                Priority
              </label>
              <select
                id="quick-task-priority"
                name="priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                className="input-instrument h-9 w-full px-2 text-sm"
              >
                {TASK_PRIORITY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {formatTaskToken(value)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="quick-task-due-date" className={FIELD_LABEL}>
                Due
              </label>
              <input
                id="quick-task-due-date"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-2 text-sm text-[color:var(--ega-text)]"
              />
            </div>
          </div>
        </details>

        {state.error ? (
          <p role="alert" className="feedback-block feedback-block-error">
            {state.error}
          </p>
        ) : null}

        {projects.length === 0 ? (
          <p role="status" className="feedback-block feedback-block-warn">
            Create a project before adding a task.
          </p>
        ) : null}
      </form>
    </>
  );
}
