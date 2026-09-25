"use client";

import {
  type ReactNode,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Archive as ArchiveIcon, CalendarClock, Pencil, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import type { UpdateTaskEditorFormState } from "@/app/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
  isTaskCompletedStatus,
} from "@/lib/task-domain";
import { formatDisplayStatus } from "@/lib/presentation-format";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import { normalizeTaskScheduleInput } from "@/lib/task-schedule";
import { formatDisplayDateTime } from "@/lib/presentation-format";
import type { TaskReminderRecord } from "@/lib/services/task-service";
import { cn } from "@/lib/utils";

export type UpdateTaskEditorAction = (
  state: UpdateTaskEditorFormState,
  formData: FormData,
) => Promise<UpdateTaskEditorFormState>;

type SimpleTaskAction = (formData: FormData) => void | Promise<void>;

export type EditTaskModalProps = {
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
  projectName?: string | null;
  goalTitle?: string | null;
  defaultProjectId: string;
  defaultGoalId: string | null;
  projectOptions: Array<{ id: string; name: string }>;
  goalOptions: Array<{ id: string; title: string; projectId: string }>;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  defaultScheduledStartAt: string | null;
  defaultScheduledEndAt: string | null;
  defaultCalendarSyncEnabled: boolean;
  defaultCalendarReminderMinutes: number;
  defaultRecurrenceRule?: string | null;
  defaultBlockedReason?: string | null;
  archivedAt?: string | null;
  taskReminders?: TaskReminderRecord[];
  updateAction: UpdateTaskEditorAction;
  createReminderAction: SimpleTaskAction;
  updateReminderAction: SimpleTaskAction;
  cancelReminderAction: SimpleTaskAction;
  deleteAction: SimpleTaskAction;
  archiveAction?: SimpleTaskAction;
  unarchiveAction?: SimpleTaskAction;
  /** Secondary-controls slot (pin toggles and similar row-surface actions). */
  overflowActions?: ReactNode;
  /** Auto-focus target while a redirect-backed error is present for this task. */
  error?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Radix trigger content; defaults to the ••• "More options" control. */
  trigger?: ReactNode;
};
function EditorCard({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-4",
        className,
      )}
    >
      <h3 className="glass-label text-etch">{label}</h3>
      {children}
    </section>
  );
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function TaskReminderCard({
  taskId,
  reminders,
  returnTo,
  createAction,
  updateAction,
  cancelAction,
}: {
  taskId: string;
  reminders: TaskReminderRecord[];
  returnTo: string;
  createAction: SimpleTaskAction;
  updateAction: SimpleTaskAction;
  cancelAction: SimpleTaskAction;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const reminderTimezoneOffsetRef = useRef<HTMLInputElement>(null);
  const pendingReminders = reminders
    .filter((reminder) => reminder.status === "pending")
    .sort((first, second) => first.remind_at.localeCompare(second.remind_at));
  const currentPendingReminder = pendingReminders[0] ?? null;

  if (formOpen) {
    return (
      <form
        action={currentPendingReminder ? updateAction : createAction}
        className="space-y-3"
        onSubmit={() => {
          if (reminderTimezoneOffsetRef.current) {
            reminderTimezoneOffsetRef.current.value = String(new Date().getTimezoneOffset());
          }
        }}
      >
        <input type="hidden" name="taskId" value={taskId} />
        {currentPendingReminder ? (
          <input type="hidden" name="reminderId" value={currentPendingReminder.id} />
        ) : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          ref={reminderTimezoneOffsetRef}
          type="hidden"
          name="reminderTimezoneOffsetMinutes"
          defaultValue="0"
        />
        <input type="hidden" name="channel" value="email" />
        <input type="hidden" name="status" value="pending" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
              Channel
            </span>
            <p className="flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-3 text-sm text-[color:var(--ega-text)]">
              Email
            </p>
          </div>
          <label className="min-w-0 space-y-2">
            <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
              Remind at
            </span>
            <input
              name="remindAt"
              type="datetime-local"
              required
              step="60"
              defaultValue={
                currentPendingReminder ? toLocalDateTimeInputValue(currentPendingReminder.remind_at) : ""
              }
              className="min-h-11 w-full"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="muted"
            pendingLabel={currentPendingReminder ? "Updating…" : "Creating…"}
          >
            {currentPendingReminder ? "Update reminder" : "Save reminder"}
          </PendingSubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setFormOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (!currentPendingReminder) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[color:var(--ega-text-secondary)]">No reminder configured.</p>
        <Button
          type="button"
          size="sm"
          variant="muted"
          onClick={() => setFormOpen(true)}
          data-testid={`task-reminder-add-${taskId}`}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Add reminder
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[color:var(--ega-text)]">Email</span>
        <span
          className="text-sm tabular-nums text-[color:var(--ega-text-secondary)]"
          data-testid={`task-reminder-display-${taskId}`}
        >
          {formatDisplayDateTime(currentPendingReminder.remind_at)}
        </span>
        <Badge tone="info">Pending</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="muted"
          onClick={() => setFormOpen(true)}
          data-testid={`task-reminder-edit-${taskId}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Button>
        <form action={cancelAction}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="reminderId" value={currentPendingReminder.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="status" value="cancelled" />
          <PendingSubmitButton
            type="submit"
            size="sm"
            variant="muted"
            pendingLabel="Removing…"
            data-testid={`task-reminder-remove-${taskId}`}
          >
            Remove
          </PendingSubmitButton>
        </form>
      </div>
    </div>
  );
}

/**
 * Centered "Edit task" modal — the single canonical task editor for /tasks.
 *
 * Cards (overview, planning, reminder, secondary) sit over one main form that
 * submits the canonical inline task update fields; reminder, archive, and
 * delete keep their own independent forms (no nested forms). The panel is only
 * mounted while open, so reopening resets uncontrolled values and never leaks
 * one task's edits into the next. Save failures keep the modal open with the
 * edits preserved; success closes it after the row data has revalidated.
 */
export function EditTaskModal({
  open,
  onOpenChange,
  trigger,
  ...panelProps
}: EditTaskModalProps) {
  const triggerElementRef = useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogPrimitive.Trigger
          asChild
          onClick={(event) => {
            const element = event.currentTarget as HTMLElement;
            triggerElementRef.current = element;
            element.focus();
          }}
        >
          {trigger}
        </DialogPrimitive.Trigger>
      ) : null}

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[rgba(17,17,15,0.58)] transition-opacity" />
        <DialogPrimitive.Content
          aria-label={`Edit task ${panelProps.taskTitle}`}
          onCloseAutoFocus={(event) => {
            if (!triggerElementRef.current) return;
            event.preventDefault();
            triggerElementRef.current.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(50rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[53rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[0_28px_80px_rgba(17,17,15,0.3)] outline-none"
        >
          {open ? (
            <TaskEditorPanel
              {...panelProps}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
function TaskEditorPanel({
  taskId,
  taskTitle,
  taskDescription,
  projectName,
  defaultProjectId,
  defaultGoalId,
  projectOptions,
  goalOptions,
  returnTo,
  defaultStatus,
  defaultPriority,
  defaultDueDate,
  defaultEstimateMinutes,
  defaultScheduledStartAt,
  defaultScheduledEndAt,
  defaultCalendarSyncEnabled,
  defaultCalendarReminderMinutes,
  defaultRecurrenceRule,
  defaultBlockedReason,
  archivedAt,
  taskReminders = [],
  updateAction,
  createReminderAction,
  updateReminderAction,
  cancelReminderAction,
  deleteAction,
  archiveAction,
  unarchiveAction,
  overflowActions,
  error,
  onClose,
}: Omit<EditTaskModalProps, "open" | "onOpenChange" | "trigger"> & { onClose: () => void }) {
  const router = useRouter();
  const saveErrorRef = useRef<HTMLParagraphElement | null>(null);
  const [state, formAction, isPending] = useActionState<UpdateTaskEditorFormState, FormData>(
    updateAction,
    {
      errorMessage: null,
      successMessage: null,
      taskId: null,
    },
  );

  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId);
  const [selectedGoalId, setSelectedGoalId] = useState(defaultGoalId ?? "");
  const [selectedStatus, setSelectedStatus] = useState(defaultStatus);
  const [scheduledStartValue, setScheduledStartValue] = useState(
    defaultScheduledStartAt ? toLocalDateTimeInputValue(defaultScheduledStartAt) : "",
  );
  const [scheduledEndValue, setScheduledEndValue] = useState(
    defaultScheduledEndAt ? toLocalDateTimeInputValue(defaultScheduledEndAt) : "",
  );
  const [estimateValue, setEstimateValue] = useState(
    defaultEstimateMinutes !== null ? String(defaultEstimateMinutes) : "",
  );
  const timezoneOffsetRef = useRef<HTMLInputElement>(null);
  const recurrenceTimezoneRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.successMessage) {
      router.refresh();
      onClose();
    }
  }, [state.successMessage, router, onClose]);

  useEffect(() => {
    if (error) {
      saveErrorRef.current?.focus();
    }
  }, [error]);

  // The preview uses UTC-pinned local values only for the start/end ordering
  // check, which is offset-independent, so a fixed "0" offset is safe here.
  const schedulePreview = useMemo(
    () =>
      normalizeTaskScheduleInput({
        scheduledStartAt: scheduledStartValue,
        scheduledEndAt: scheduledEndValue,
        timezoneOffsetMinutes: "0",
      }),
    [scheduledStartValue, scheduledEndValue],
  );

  const estimatePreview = useMemo(() => normalizeTaskEstimateInput(estimateValue), [estimateValue]);

  const availableGoalOptions = useMemo(
    () => goalOptions.filter((goal) => goal.projectId === selectedProjectId),
    [goalOptions, selectedProjectId],
  );

  const isArchived = Boolean(archivedAt);
  const isCompleted = isTaskCompletedStatus(defaultStatus);
  const canArchive = !isArchived && isCompleted && Boolean(archiveAction);
  const inlineValidationError = schedulePreview.error ?? estimatePreview.error;
  const canSave = !isArchived && inlineValidationError === null;
  const formId = `task-editor-form-${taskId}`;
  const inlineErrorId = `task-editor-inline-error-${taskId}`;
  const saveErrorId = `task-editor-save-error-${taskId}`;
  const descriptionId = `task-editor-description-${taskId}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ega-border)] px-5 pb-4 pt-5 sm:px-6">
                <div className="min-w-0 space-y-1.5">
                  <DialogPrimitive.Title className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
                    Edit task
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description
                    id={descriptionId}
                    className="min-w-0 truncate text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]"
                  >
                    {taskTitle}
                    {projectName ? (
                      <>
                        {" · "}
                        {projectName}
                      </>
                    ) : null}
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 shrink-0 rounded-full p-0"
                    aria-label="Close task editor"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DialogPrimitive.Close>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
                <form
                  id={formId}
                  action={formAction}
                  className="space-y-4"
                  onSubmit={() => {
                    // Same submit-time synchronization as TaskMarkDoneForm: the
                    // visitor's UTC offset and IANA timezone are captured when
                    // the form is submitted, never on render.
                    if (timezoneOffsetRef.current) {
                      timezoneOffsetRef.current.value = String(new Date().getTimezoneOffset());
                    }
                    if (recurrenceTimezoneRef.current) {
                      recurrenceTimezoneRef.current.value =
                        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                    }
                  }}
                >
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input
                    ref={recurrenceTimezoneRef}
                    type="hidden"
                    name="recurrenceTimezone"
                    defaultValue="UTC"
                  />
                  <input
                    ref={timezoneOffsetRef}
                    type="hidden"
                    name="scheduleTimezoneOffsetMinutes"
                    defaultValue="0"
                  />

                  <EditorCard label="Task overview">
                    <div className="space-y-3">
                      <label className="min-w-0 space-y-2">
                        <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                          Title
                        </span>
                        <Input
                          name="title"
                          required
                          defaultValue={taskTitle}
                          className="min-h-11 w-full"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="min-w-0 space-y-2">
                          <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                            Project
                          </span>
                          <select
                            name="projectId"
                            required
                            value={selectedProjectId}
                            onChange={(event) => {
                              const nextProjectId = event.target.value;
                              setSelectedProjectId(nextProjectId);
                              if (
                                selectedGoalId &&
                                !goalOptions.some(
                                  (goal) =>
                                    goal.id === selectedGoalId &&
                                    goal.projectId === nextProjectId,
                                )
                              ) {
                                setSelectedGoalId("");
                              }
                            }}
                            className="input-instrument min-h-11 w-full px-3 text-sm"
                          >
                            {projectOptions.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="min-w-0 space-y-2">
                          <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                            Goal
                          </span>
                          <select
                            name="goalId"
                            value={selectedGoalId}
                            onChange={(event) => setSelectedGoalId(event.target.value)}
                            className="input-instrument min-h-11 w-full px-3 text-sm"
                          >
                            <option value="">No goal</option>
                            {availableGoalOptions.map((goal) => (
                              <option key={goal.id} value={goal.id}>
                                {goal.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="min-w-0 space-y-2">
                        <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                          Description
                        </span>
                        <Textarea
                          name="description"
                          defaultValue={taskDescription ?? ""}
                          placeholder="Add useful context for this task"
                          className="min-h-24 w-full"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
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
                      </div>

                      {selectedStatus === "blocked" ? (
                        <label className="min-w-0 space-y-2">
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
                  </EditorCard>

                  <EditorCard label="Planning">
                    <div className="grid gap-3 sm:grid-cols-2">
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
                          value={estimateValue}
                          onChange={(event) => setEstimateValue(event.target.value)}
                          aria-describedby={
                            estimatePreview.error ? inlineErrorId : undefined
                          }
                          className="min-h-11 w-full"
                        />
                      </label>

                      <label className="min-w-0 space-y-2 sm:col-span-2">
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

                      <label className="min-w-0 space-y-2">
                        <span className="block text-xs font-medium text-[color:var(--ega-text-secondary)]">
                          Scheduled from
                        </span>
                        <Input
                          name="scheduledStartAt"
                          type="datetime-local"
                          value={scheduledStartValue}
                          onChange={(event) => setScheduledStartValue(event.target.value)}
                          aria-describedby={
                            schedulePreview.error ? inlineErrorId : undefined
                          }
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
                          value={scheduledEndValue}
                          onChange={(event) => setScheduledEndValue(event.target.value)}
                          aria-describedby={
                            schedulePreview.error ? inlineErrorId : undefined
                          }
                          className="min-h-11 w-full"
                        />
                      </label>

                      {inlineValidationError ? (
                        <p
                          id={inlineErrorId}
                          role="alert"
                          className="text-sm text-[var(--signal-error)] sm:col-span-2"
                        >
                          {inlineValidationError}
                        </p>
                      ) : null}
                    </div>
                  </EditorCard>

                  <EditorCard label="Advanced">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-start gap-3 sm:col-span-2">
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
                          htmlFor={`task-editor-reminder-${taskId}`}
                          className="block text-xs font-medium text-[color:var(--ega-text-secondary)]"
                        >
                          Calendar reminder
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            id={`task-editor-reminder-${taskId}`}
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
                  </EditorCard>
                </form>

                {overflowActions ? (
                  <EditorCard label="Quick actions">
                    <div>{overflowActions}</div>
                  </EditorCard>
                ) : null}

                <EditorCard label="Reminder">
                  <TaskReminderCard
                    taskId={taskId}
                    reminders={taskReminders}
                    returnTo={returnTo}
                    createAction={createReminderAction}
                    updateAction={updateReminderAction}
                    cancelAction={cancelReminderAction}
                  />
                </EditorCard>

                {canArchive && archiveAction ? (
                  <EditorCard label="Archive">
                    <p className="text-sm leading-5 text-[color:var(--ega-text-secondary)]">
                      Move this completed task out of Current while preserving its history.
                    </p>
                    <div>
                      <form action={archiveAction}>
                        <input type="hidden" name="taskId" value={taskId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <PendingSubmitButton
                          type="submit"
                          size="sm"
                          variant="muted"
                          pendingLabel="Archiving…"
                          data-testid={`task-editor-archive-${taskId}`}
                        >
                          <ArchiveIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          Archive task
                        </PendingSubmitButton>
                      </form>
                    </div>
                  </EditorCard>
                ) : null}

                {isArchived && unarchiveAction ? (
                  <EditorCard label="Archived task">
                    <p className="text-sm leading-5 text-[color:var(--ega-text-secondary)]">
                      This task is archived. Restoring returns it to Current while keeping its
                      completed history.
                    </p>
                    <div>
                      <form action={unarchiveAction}>
                        <input type="hidden" name="taskId" value={taskId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <Button size="sm" type="submit" variant="muted">
                          Restore
                        </Button>
                      </form>
                    </div>
                  </EditorCard>
                ) : null}

                <EditorCard
                  label="Danger zone"
                  className="border-[var(--status-overdue-border)]"
                >
                  <p className="text-sm leading-5 text-[color:var(--ega-text-secondary)]">
                    Delete &quot;{taskTitle}&quot; permanently. This is blocked if the task has
                    timer history and cannot be undone.
                  </p>
                  <div>
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
                      <PendingSubmitButton
                        type="submit"
                        size="sm"
                        variant="danger"
                        pendingLabel="Deleting…"
                        data-testid={`task-editor-delete-${taskId}`}
                      >
                        Delete task
                      </PendingSubmitButton>
                    </form>
                  </div>
                </EditorCard>
              </div>

              <div className="shrink-0 border-t border-[var(--ega-border)] px-5 py-4 sm:px-6">
                {state.errorMessage || error ? (
                  <p
                    ref={saveErrorRef}
                    id={state.errorMessage ? saveErrorId : `task-update-error-${taskId}`}
                    role="alert"
                    tabIndex={-1}
                    className="feedback-block feedback-block-error mb-3"
                  >
                    {state.errorMessage ?? error}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <DialogPrimitive.Close asChild>
                    <Button type="button" variant="muted" size="md">
                      Cancel
                    </Button>
                  </DialogPrimitive.Close>
                  {isArchived ? null : (
                    <PendingSubmitButton
                      type="submit"
                      form={formId}
                      size="md"
                      disabled={!canSave || isPending}
                      pendingLabel="Saving…"
                      data-testid={`task-editor-save-${taskId}`}
                    >
                      {isPending ? "Saving…" : "Save changes"}
                    </PendingSubmitButton>
                  )}
                </div>
              </div>
    </div>
  );
}
