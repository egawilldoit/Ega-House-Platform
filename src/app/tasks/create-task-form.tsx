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
  const availableGoalCount = goals.length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="returnTo" value={state.values.returnTo} />
      <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
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
              className="h-10"
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
                  <div className="input-instrument flex h-10 items-center px-3.5 text-sm text-[color:var(--muted-foreground)]">
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
                  className="input-instrument h-10 text-sm"
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
                className="input-instrument h-10 text-sm"
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

      <div className="rounded-[1.1rem] border border-[var(--border)] bg-white p-4">
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
                className="input-instrument h-10 text-sm"
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
                className="glass-label text-etch"
              >
                Priority
              </label>
              <select
                id="priority"
                name="priority"
                defaultValue={state.values.priority}
                className="input-instrument h-10 text-sm"
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
              className="glass-label text-etch"
            >
              Description (optional)
            </label>
            <Textarea
              id="description"
              name="description"
              placeholder="Capture scope, constraints, and delivery notes."
              defaultValue={state.values.description}
              className="min-h-24"
            />
          </div>
        </div>
      </div>

      {state.error ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {state.error}
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
