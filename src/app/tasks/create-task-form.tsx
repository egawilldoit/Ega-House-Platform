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

import { type CreateTaskFormState, createTaskAction } from "./actions";

type CreateTaskFormProps = {
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string; project_id: string }>;
  projectId?: string;
  returnTo?: string;
};

export function buildCreateTaskFormInitialState({
  projects,
  projectId,
  returnTo = "/tasks",
}: Pick<CreateTaskFormProps, "projects" | "projectId" | "returnTo">) {
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
}: CreateTaskFormProps) {
  const { initialState, isProjectScoped } = buildCreateTaskFormInitialState({
    projects,
    projectId,
    returnTo,
  });

  const [state, formAction, isPending] = useActionState(
    createTaskAction,
    initialState,
  );
  const [selectedStatus, setSelectedStatus] = useState(state.values.status);
  const [timeZoneOffsetMinutes, setTimeZoneOffsetMinutes] = useState("");
  const availableGoalCount = goals.length;

  useEffect(() => {
    setSelectedStatus(state.values.status);
  }, [state.values.status]);

  useEffect(() => {
    setTimeZoneOffsetMinutes(String(new Date().getTimezoneOffset()));
  }, []);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="returnTo" value={state.values.returnTo} />
      <input
        type="hidden"
        name="workedTimeTimezoneOffsetMinutes"
        value={timeZoneOffsetMinutes}
      />
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
