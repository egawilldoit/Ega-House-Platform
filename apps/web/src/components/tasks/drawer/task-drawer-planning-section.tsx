"use client";

import { useState } from "react";
import { CalendarClock, Repeat } from "lucide-react";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { TaskReminderPanel } from "@/components/tasks/task-reminder-panel";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";
import { TASK_STATUS_VALUES, formatTaskToken } from "@/lib/task-domain";
import type { TaskDrawerPlanning } from "@/lib/services/task-drawer-planning-service";
import type { TaskReminderRecord } from "@/lib/services/task-service";

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

function toLocalDateTimeInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Project, schedule, recurrence and reminder editing for the canonical task
 * drawer.
 *
 * This is a full-form patch because those fields carry side effects that the
 * one-field `updateTaskFieldAction` path deliberately does not accept. Hidden
 * inputs carry every value the validator requires so saving planning never
 * clears an unrelated field.
 */
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
  const [projectId, setProjectId] = useState(planning.projectId ?? "");
  const [goalId, setGoalId] = useState(planning.goalId ?? "");
  const [statusValue, setStatusValue] = useState(status);
  const [blockedReasonValue, setBlockedReasonValue] = useState(
    blockedReason ?? "",
  );

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
      <h2
        id={`planning-${taskId}`}
        className="text-[length:var(--text-meta)] font-semibold text-[color:var(--ega-text-secondary)]"
      >
        Planning
      </h2>

      <form action={updateInlineAction} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="priority" value={priority} />
        <input type="hidden" name="dueDate" value={dueDate ?? ""} />
        <input
          type="hidden"
          name="estimateMinutes"
          value={estimateMinutes === null ? "" : String(estimateMinutes)}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Scheduled start
            </span>
            <input
              name="scheduledStartAt"
              type="datetime-local"
              defaultValue={toLocalDateTimeInputValue(planning.scheduledStartAt)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            />
          </label>

          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Scheduled end
            <input
              name="scheduledEndAt"
              type="datetime-local"
              defaultValue={toLocalDateTimeInputValue(planning.scheduledEndAt)}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
            />
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

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
            <input
              type="checkbox"
              name="calendarSyncEnabled"
              defaultChecked={planning.calendarSyncEnabled}
              className="h-4 w-4"
            />
            Sync to calendar
          </label>
          <label className="flex flex-col gap-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            Reminder
            <span className="flex items-center gap-1">
              <input
                name="calendarReminderMinutes"
                type="number"
                min={0}
                step={5}
                defaultValue={planning.calendarReminderMinutes}
                className="h-8 w-20 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-1.5 text-xs text-[color:var(--ega-text)]"
              />
              <span>minutes before</span>
            </span>
          </label>
          <PendingSubmitButton
            type="submit"
            variant="secondary"
            size="sm"
            className="ml-auto h-8 px-2 text-xs"
            pendingLabel="Saving…"
          >
            Save planning
          </PendingSubmitButton>
        </div>
      </form>

      {createReminderAction && cancelReminderAction ? (
        <div className="mt-3">
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
