"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";
import type { CalendarTaskFormDefaults } from "@/lib/services/calendar-settings-service";

import { type CreateTaskFormState, createTaskAction } from "./actions";

type CreateTaskFormProps = {
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string; project_id: string }>;
  projectId?: string;
  returnTo?: string;
  calendarDefaults?: CalendarTaskFormDefaults;
};

export function buildCreateTaskFormInitialState({
  projects,
  projectId,
  returnTo = "/tasks",
  calendarDefaults = {
    calendarSyncEnabled: false,
    calendarReminderMinutes: 10,
  },
}: Pick<CreateTaskFormProps, "projects" | "projectId" | "returnTo" | "calendarDefaults">) {
  const selectedProjectId = projectId ?? projects[0]?.id ?? "";

  return {
    isProjectScoped: Boolean(projectId),
    initialState: {
      error: null,
      values: {
        title: "",
        projectId: selectedProjectId,
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
        calendarSyncEnabled: calendarDefaults.calendarSyncEnabled ? "on" : "",
        calendarReminderMinutes: String(calendarDefaults.calendarReminderMinutes),
        workedTimeStartedAt: "",
        workedTimeEndedAt: "",
        returnTo,
      },
    } satisfies CreateTaskFormState,
  };
}

export function CreateTaskForm({
  projects,
  goals,
  projectId,
  returnTo = "/tasks",
  calendarDefaults,
}: CreateTaskFormProps) {
  const { initialState, isProjectScoped } = buildCreateTaskFormInitialState({
    projects,
    projectId,
    returnTo,
    calendarDefaults,
  });

  const [state, formAction, isPending] = useActionState(
    createTaskAction,
    initialState,
  );
  const [selectedStatus, setSelectedStatus] = useState(state.values.status);
  const [timeZoneOffsetMinutes, setTimeZoneOffsetMinutes] = useState("");
  const [recurrenceTimezone, setRecurrenceTimezone] = useState(
    state.values.recurrenceTimezone,
  );
  const availableGoalCount = goals.length;

  useEffect(() => {
    setSelectedStatus(state.values.status);
  }, [state.values.status]);

  useEffect(() => {
    setTimeZoneOffsetMinutes(String(new Date().getTimezoneOffset()));
    setRecurrenceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="returnTo" value={state.values.returnTo} />
      <input
        type="hidden"
        name="workedTimeTimezoneOffsetMinutes"
        value={timeZoneOffsetMinutes}
      />
      <input
        type="hidden"
        name="scheduleTimezoneOffsetMinutes"
        value={timeZoneOffsetMinutes}
      />
      <input type="hidden" name="recurrenceTimezone" value={recurrenceTimezone} />
      <div className="ega-glass-soft rounded-[1.1rem] p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="glass-label text-etch">Task Definition</p>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              Set the title and attach the task to the right execution context.
            </p>
          </div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
            {availableGoalCount} goal{availableGoalCount === 1 ? "" : "s"} available
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="title" className="glass-label text-etch">
              Title
            </label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Ship timer session recovery"
              defaultValue={state.values.title}
              className="ega-glass-input h-10 rounded-xl"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="projectId"
                className="glass-label text-etch"
              >
                Project
              </label>
              {isProjectScoped ? (
                <>
                  <input type="hidden" name="projectId" value={state.values.projectId} />
                  <div className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3.5 py-2 text-sm text-[color:var(--muted-foreground)] ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]">
                    {projects.find((project) => project.id === state.values.projectId)?.name ??
                      "Selected project"}
                  </div>
                </>
              ) : (
                <select
                  id="projectId"
                  name="projectId"
                  defaultValue={state.values.projectId}
                  required
                  className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="goalId" className="glass-label text-etch">
                Goal (optional)
              </label>
              <select
                id="goalId"
                name="goalId"
                defaultValue={state.values.goalId}
                className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="">No goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="ega-glass-soft rounded-[1.1rem] p-4">
        <div className="mb-4">
          <p className="glass-label text-etch">Execution Defaults</p>
          <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
            Choose the initial state and any setup notes before the task enters the queue.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="status" className="glass-label text-etch">
                Initial status
              </label>
              <select
                id="status"
                name="status"
                defaultValue={state.values.status}
                onChange={(event) => setSelectedStatus(event.target.value)}
                className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                {TASK_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {formatTaskToken(status)}
                  </option>
                ))}
              </select>
            </div>

            {selectedStatus === "blocked" ? (
              <div className="space-y-2 sm:col-span-2">
                <label htmlFor="blockedReason" className="glass-label text-etch">
                  Blocked reason
                </label>
                <Textarea
                  id="blockedReason"
                  name="blockedReason"
                  placeholder="What is currently blocking this task?"
                  defaultValue={state.values.blockedReason}
                  className="ega-glass-input min-h-20 rounded-xl"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="dueDate" className="glass-label text-etch">
                Due date (optional)
              </label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={state.values.dueDate}
                className="ega-glass-input h-10 rounded-xl"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="priority"
                className="glass-label text-etch"
              >
                Priority
              </label>
              <select
                id="priority"
                name="priority"
                defaultValue={state.values.priority}
                className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                {TASK_PRIORITY_VALUES.map((priority) => (
                  <option key={priority} value={priority}>
                    {formatTaskToken(priority)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="estimateMinutes" className="glass-label text-etch">
                Estimate (minutes)
              </label>
              <Input
                id="estimateMinutes"
                name="estimateMinutes"
                type="number"
                min="0"
                step="15"
                inputMode="numeric"
                placeholder="90"
                defaultValue={state.values.estimateMinutes}
                className="ega-glass-input h-10 rounded-xl"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="recurrenceRule" className="glass-label text-etch">
                Repeat
              </label>
              <select
                id="recurrenceRule"
                name="recurrenceRule"
                defaultValue={state.values.recurrenceRule}
                className="ega-glass-input flex h-10 w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="">Does not repeat</option>
                {TASK_RECURRENCE_RULE_VALUES.map((rule) => (
                  <option key={rule} value={rule}>
                    {formatTaskRecurrenceRule(rule)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3 sm:col-span-2">
              <div>
                <p className="glass-label text-etch">Schedule block (optional)</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="scheduledStartAt" className="glass-label text-etch">
                    From
                  </label>
                  <Input
                    id="scheduledStartAt"
                    name="scheduledStartAt"
                    type="datetime-local"
                    defaultValue={state.values.scheduledStartAt}
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="scheduledEndAt" className="glass-label text-etch">
                    To
                  </label>
                  <Input
                    id="scheduledEndAt"
                    name="scheduledEndAt"
                    type="datetime-local"
                    defaultValue={state.values.scheduledEndAt}
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <label className="flex items-start gap-3 rounded-xl border border-[rgba(15,23,42,0.08)] p-3">
                  <input
                    type="checkbox"
                    name="calendarSyncEnabled"
                    defaultChecked={state.values.calendarSyncEnabled === "on"}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="glass-label text-etch">Sync to Calendar</span>
                    <span className="mt-1 block text-xs text-[color:var(--muted-foreground)]">
                      Uses account default only when this task has a schedule block.
                    </span>
                  </span>
                </label>
                <div className="space-y-2">
                  <label htmlFor="calendarReminderMinutes" className="glass-label text-etch">
                    Reminder
                  </label>
                  <Input
                    id="calendarReminderMinutes"
                    name="calendarReminderMinutes"
                    type="number"
                    min="0"
                    max="10080"
                    step="5"
                    defaultValue={state.values.calendarReminderMinutes}
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 sm:col-span-2">
              <div>
                <p className="glass-label text-etch">Already worked on this?</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="workedTimeStartedAt" className="glass-label text-etch">
                    From
                  </label>
                  <Input
                    id="workedTimeStartedAt"
                    name="workedTimeStartedAt"
                    type="datetime-local"
                    defaultValue={state.values.workedTimeStartedAt}
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="workedTimeEndedAt" className="glass-label text-etch">
                    To
                  </label>
                  <Input
                    id="workedTimeEndedAt"
                    name="workedTimeEndedAt"
                    type="datetime-local"
                    defaultValue={state.values.workedTimeEndedAt}
                    className="ega-glass-input h-10 rounded-xl"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="description"
              className="glass-label text-etch"
            >
              Description (optional)
            </label>
            <Textarea
              id="description"
              name="description"
              placeholder="Capture scope, constraints, and delivery notes."
              defaultValue={state.values.description}
              className="ega-glass-input min-h-24 rounded-xl"
            />
          </div>
        </div>
      </div>

      {state.error ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="feedback-block feedback-block-success">
          {state.success}
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={isPending || projects.length === 0}
        className="w-full sm:w-auto"
      >
        {isPending ? "Initializing..." : "Initialize task"}
      </Button>
    </form>
  );
}
