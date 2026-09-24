"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayStatus } from "@/lib/presentation-format";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
  isTaskCompletedStatus,
} from "@/lib/task-domain";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";

type InlineTaskUpdateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  taskId: string;
  taskTitle: string;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  defaultScheduledStartAt: string | null;
  defaultScheduledEndAt: string | null;
  defaultCalendarSyncEnabled: boolean;
  defaultCalendarReminderMinutes: number;
  defaultBlockedReason: string | null;
  defaultRecurrenceRule?: string | null;
  archivedAt?: string | null;
  error?: string | null;
  overflowActions?: ReactNode;
  stickyFooter?: boolean;
};

type TaskMarkDoneFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskId: string;
  returnTo: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultScheduledStartAt: string | null;
  defaultScheduledEndAt: string | null;
  defaultCalendarSyncEnabled: boolean;
  defaultCalendarReminderMinutes: number;
  defaultEstimateMinutes: number | null;
  taskTitle?: string;
  /** Icon-only submit for dense table/board rows; the title carries the aria-label. */
  compact?: boolean;
};

/**
 * Single canonical "mark done" submission. It forwards the task's scheduling
 * fields unchanged so completing a task never drops its schedule/calendar state.
 */
export function TaskMarkDoneForm({
  action,
  taskId,
  returnTo,
  defaultPriority,
  defaultDueDate,
  defaultScheduledStartAt,
  defaultScheduledEndAt,
  defaultCalendarSyncEnabled,
  defaultCalendarReminderMinutes,
  defaultEstimateMinutes,
  taskTitle,
  compact = false,
}: TaskMarkDoneFormProps) {
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);

  const scheduledStartAtDefaultValue = defaultScheduledStartAt
    ? defaultScheduledStartAt.slice(0, 16)
    : "";
  const scheduledEndAtDefaultValue = defaultScheduledEndAt
    ? defaultScheduledEndAt.slice(0, 16)
    : "";

  return (
    <form
      action={action}
      onSubmit={() => {
        if (timezoneOffsetRef.current) {
          timezoneOffsetRef.current.value = String(new Date().getTimezoneOffset());
        }
      }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="status" value="done" />
      <input type="hidden" name="priority" value={defaultPriority} />
      <input type="hidden" name="dueDate" value={defaultDueDate ?? ""} />
      <input type="hidden" name="scheduledStartAt" value={scheduledStartAtDefaultValue} />
      <input type="hidden" name="scheduledEndAt" value={scheduledEndAtDefaultValue} />
      {defaultCalendarSyncEnabled ? (
        <input type="hidden" name="calendarSyncEnabled" value="on" />
      ) : null}
      <input
        type="hidden"
        name="calendarReminderMinutes"
        value={defaultCalendarReminderMinutes}
      />
      <input
        ref={timezoneOffsetRef}
        type="hidden"
        name="scheduleTimezoneOffsetMinutes"
        defaultValue="0"
      />
      <input
        type="hidden"
        name="estimateMinutes"
        value={defaultEstimateMinutes !== null ? String(defaultEstimateMinutes) : ""}
      />
      <input type="hidden" name="blockedReason" value="" />
      <PendingSubmitButton
        size="sm"
        type="submit"
        variant="muted"
        aria-label={compact ? `Mark ${taskTitle ?? "task"} done` : undefined}
        className={compact ? "h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10" : "min-h-11 px-4"}
        pendingLabel="Marking done..."
      >
        {compact ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : "Mark done"}
      </PendingSubmitButton>
    </form>
  );
}

export function InlineTaskUpdateForm({
  action,
  deleteAction,
  archiveAction,
  unarchiveAction,
  taskId,
  taskTitle,
  returnTo,
  defaultStatus,
  defaultPriority,
  defaultDueDate,
  defaultEstimateMinutes,
  defaultScheduledStartAt,
  defaultScheduledEndAt,
  defaultCalendarSyncEnabled,
  defaultCalendarReminderMinutes,
  defaultBlockedReason,
  defaultRecurrenceRule,
  archivedAt,
  error,
  overflowActions,
  stickyFooter = false,
}: InlineTaskUpdateFormProps) {
  const [selectedStatus, setSelectedStatus] = useState(defaultStatus);
  const [timezoneOffsetMinutes, setTimezoneOffsetMinutes] = useState("0");
  const [recurrenceTimezone, setRecurrenceTimezone] = useState("UTC");
  const updateFormId = `task-update-${taskId}`;
  const isArchived = Boolean(archivedAt);
  const isCompleted = isTaskCompletedStatus(defaultStatus);

  useEffect(() => {
    setSelectedStatus(defaultStatus);
  }, [defaultStatus]);

  useEffect(() => {
    setRecurrenceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setTimezoneOffsetMinutes(String(new Date().getTimezoneOffset()));
  }, []);

  const scheduledStartAtDefaultValue = defaultScheduledStartAt
    ? defaultScheduledStartAt.slice(0, 16)
    : "";
  const scheduledEndAtDefaultValue = defaultScheduledEndAt
    ? defaultScheduledEndAt.slice(0, 16)
    : "";

  return (
    <div className="@container space-y-4">
      <form id={updateFormId} action={action} className="space-y-5">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="recurrenceTimezone" value={recurrenceTimezone} />
        <input
          type="hidden"
          name="scheduleTimezoneOffsetMinutes"
          value={timezoneOffsetMinutes}
        />

        <section className="space-y-3">
          <p className="glass-label text-etch">Task</p>
          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Status
              </span>
              <select
                name="status"
                defaultValue={defaultStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="input-instrument min-h-11 w-full px-3 text-sm"
              >
                {TASK_STATUS_VALUES.map((statusValue) => (
                  <option key={statusValue} value={statusValue}>
                    {formatDisplayStatus(statusValue)}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Priority
              </span>
              <select
                name="priority"
                defaultValue={defaultPriority}
                className="input-instrument min-h-11 w-full px-3 text-sm"
              >
                {TASK_PRIORITY_VALUES.map((priorityValue) => (
                  <option key={priorityValue} value={priorityValue}>
                    {formatTaskToken(priorityValue)}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Due date
              </span>
              <Input
                name="dueDate"
                type="date"
                defaultValue={defaultDueDate ?? ""}
                className="min-h-11 w-full"
              />
            </label>

            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Estimate (minutes)
              </span>
              <Input
                name="estimateMinutes"
                type="number"
                min="0"
                step="15"
                inputMode="numeric"
                defaultValue={defaultEstimateMinutes ?? ""}
                className="min-h-11 w-full"
              />
            </label>

            <label className="min-w-0 space-y-2 @lg:col-span-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Repeat
              </span>
              <select
                name="recurrenceRule"
                defaultValue={defaultRecurrenceRule ?? ""}
                className="input-instrument min-h-11 w-full px-3 text-sm"
              >
                <option value="">Does not repeat</option>
                {TASK_RECURRENCE_RULE_VALUES.map((rule) => (
                  <option key={rule} value={rule}>
                    {formatTaskRecurrenceRule(rule)}
                  </option>
                ))}
              </select>
            </label>

            {selectedStatus === "blocked" ? (
              <label className="min-w-0 space-y-2 @lg:col-span-2">
                <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                  Blocked reason
                </span>
                <Textarea
                  name="blockedReason"
                  defaultValue={defaultBlockedReason ?? ""}
                  placeholder="What is currently blocking this task?"
                  className="min-h-20 w-full"
                />
              </label>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <p className="glass-label text-etch">Schedule</p>
          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Scheduled from
              </span>
              <Input
                name="scheduledStartAt"
                type="datetime-local"
                defaultValue={scheduledStartAtDefaultValue}
                className="min-h-11 w-full"
              />
            </label>

            <label className="min-w-0 space-y-2">
              <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                Scheduled to
              </span>
              <Input
                name="scheduledEndAt"
                type="datetime-local"
                defaultValue={scheduledEndAtDefaultValue}
                className="min-h-11 w-full"
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <p className="glass-label text-etch">Calendar</p>
          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
            <label className="flex items-start gap-3 @lg:col-span-2">
              <input
                type="checkbox"
                name="calendarSyncEnabled"
                defaultChecked={defaultCalendarSyncEnabled}
                className="mt-0.5 h-4 w-4 accent-[var(--ega-ink)]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[color:var(--ega-text)]">
                  Sync to Calendar
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-[color:var(--ega-text-secondary)]">
                  Applies when this task has a schedule block.
                </span>
              </span>
            </label>

            <div className="min-w-0 space-y-2">
              <label
                htmlFor={`task-update-reminder-${taskId}`}
                className="block text-xs font-medium text-[color:var(--ega-text-secondary)]"
              >
                Calendar reminder
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`task-update-reminder-${taskId}`}
                  name="calendarReminderMinutes"
                  type="number"
                  min="0"
                  max="10080"
                  step="5"
                  inputMode="numeric"
                  defaultValue={defaultCalendarReminderMinutes}
                  className="min-h-11 w-28"
                />
                <span className="text-sm text-[color:var(--ega-text-secondary)]">
                  minutes before
                </span>
              </div>
            </div>
          </div>
        </section>
      </form>

      <div
        className={
          stickyFooter
            ? "sticky bottom-0 z-10 -mx-5 border-t border-[var(--ega-border)] bg-[var(--ega-surface)] px-5 py-3 sm:-mx-6 sm:px-6"
            : "border-t border-[var(--ega-border)] pt-3"
        }
      >
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!isCompleted ? (
            <TaskMarkDoneForm
              action={action}
              taskId={taskId}
              returnTo={returnTo}
              defaultPriority={defaultPriority}
              defaultDueDate={defaultDueDate}
              defaultScheduledStartAt={defaultScheduledStartAt}
              defaultScheduledEndAt={defaultScheduledEndAt}
              defaultCalendarSyncEnabled={defaultCalendarSyncEnabled}
              defaultCalendarReminderMinutes={defaultCalendarReminderMinutes}
              defaultEstimateMinutes={defaultEstimateMinutes}
            />
          ) : null}

          {!isArchived ? (
            <PendingSubmitButton
              size="sm"
              type="submit"
              form={updateFormId}
              className="min-h-11 px-4"
              pendingLabel="Saving..."
            >
              Save changes
            </PendingSubmitButton>
          ) : null}

          {isArchived && unarchiveAction ? (
            <form action={unarchiveAction}>
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button size="sm" type="submit" variant="muted" className="min-h-11 px-4">
                Restore
              </Button>
            </form>
          ) : null}

          <details className="action-overflow">
            <summary className="btn-instrument btn-instrument-muted flex min-h-11 cursor-pointer items-center px-3 text-xs">
              More
            </summary>
            <div className="action-overflow-menu">
              <div className="space-y-2">
                {archiveAction && !isArchived ? (
                  <form action={archiveAction}>
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button
                      size="sm"
                      type="submit"
                      variant="danger"
                      className="min-h-11 w-full justify-center"
                    >
                      Archive
                    </Button>
                  </form>
                ) : null}
                {overflowActions}
                <form
                  action={deleteAction}
                  onSubmit={(event) => {
                    if (
                      !window.confirm(
                        `Delete "${taskTitle}"? This is permanent and is blocked if the task has timer history.`,
                      )
                    ) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="confirmDelete" value="true" />
                  <Button
                    size="sm"
                    type="submit"
                    variant="danger"
                    className="min-h-11 w-full justify-center"
                  >
                    Delete task
                  </Button>
                </form>
              </div>
            </div>
          </details>
        </div>
      </div>

      {error ? (
        <p
          id={`task-update-error-${taskId}`}
          role="alert"
          tabIndex={-1}
          className="feedback-block feedback-block-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
