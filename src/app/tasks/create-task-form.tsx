"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";

import { type CreateTaskFormState, createTaskAction } from "./actions";

type CreateTaskFormProps = {
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string; project_id: string }>;
  projectId?: string;
  returnTo?: string;
};

export function CreateTaskForm({
  projects,
  goals,
  projectId,
  returnTo = "/tasks",
}: CreateTaskFormProps) {
  const selectedProjectId = projectId ?? projects[0]?.id ?? "";
  const isProjectScoped = Boolean(projectId);

  const initialState: CreateTaskFormState = {
    error: null,
    values: {
      title: "",
      projectId: selectedProjectId,
      goalId: "",
      description: "",
      status: "todo",
      priority: "medium",
      returnTo,
    },
  };

  const [state, formAction, isPending] = useActionState(
    createTaskAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="returnTo" value={state.values.returnTo} />
      <div className="space-y-2">
        <label htmlFor="title" className="text-xs font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">
          Title
        </label>
        <Input
          id="title"
          name="title"
          required
          placeholder="Ship timer session recovery"
          defaultValue={state.values.title}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="projectId"
            className="glass-label text-etch mb-1.5"
          >
            Project
          </label>
          {isProjectScoped ? (
            <>
              <input type="hidden" name="projectId" value={state.values.projectId} />
              <div className="flex h-9 items-center input-instrument px-3.5 text-sm" style={{ color: "var(--muted-foreground)" }}>
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
              className="input-instrument h-8 text-xs"
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
          <label htmlFor="goalId" className="text-xs font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">
            Goal (optional)
          </label>
          <select
            id="goalId"
            name="goalId"
            defaultValue={state.values.goalId}
            className="h-9 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 text-sm text-white outline-none transition hover:border-[var(--border-strong)] focus:border-[var(--accent-green-border)] focus:ring-2 focus:ring-[var(--accent-green)] focus:ring-opacity-15"
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="status" className="text-xs font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">
            Initial status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={state.values.status}
            className="h-9 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 text-sm text-white outline-none transition hover:border-[var(--border-strong)] focus:border-[var(--accent-green-border)] focus:ring-2 focus:ring-[var(--accent-green)] focus:ring-opacity-15"
          >
            {TASK_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {formatTaskToken(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="priority"
            className="glass-label text-etch mb-1.5"
          >
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={state.values.priority}
            className="h-9 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 text-sm text-white outline-none transition hover:border-[var(--border-strong)] focus:border-[var(--accent-green-border)] focus:ring-2 focus:ring-[var(--accent-green)] focus:ring-opacity-15"
          >
            {TASK_PRIORITY_VALUES.map((priority) => (
              <option key={priority} value={priority}>
                {formatTaskToken(priority)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="description"
          className="glass-label text-etch mb-1.5"
        >
          Description (optional)
        </label>
        <Textarea
          id="description"
          name="description"
          placeholder="Capture scope, constraints, and delivery notes."
          defaultValue={state.values.description}
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          className="rounded-sm px-4 py-3 text-xs"
          style={{ border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "var(--signal-error)" }}
        >
          {state.error}
        </div>
      ) : null}

      <Button type="submit" disabled={isPending || projects.length === 0}>
        {isPending ? "Creating task..." : "Create task"}
      </Button>
    </form>
  );
}
