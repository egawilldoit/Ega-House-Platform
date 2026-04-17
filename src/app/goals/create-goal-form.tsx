"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_STATUS_VALUES, formatTaskToken } from "@/lib/task-domain";

import { type CreateGoalFormState, createGoalAction } from "./actions";

type CreateGoalFormProps = {
  projects: Array<{ id: string; name: string }>;
};

export function CreateGoalForm({ projects }: CreateGoalFormProps) {
  const initialState: CreateGoalFormState = {
    error: null,
    values: {
      title: "",
      projectId: projects[0]?.id ?? "",
      description: "",
      status: "draft",
      slug: "",
    },
  };

  const [state, formAction, isPending] = useActionState(
    createGoalAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="title" className="glass-label text-etch">
          Goal title
        </label>
        <Input
          id="title"
          name="title"
          required
          placeholder="Ship shared timer flow"
          defaultValue={state.values.title}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="projectId" className="glass-label text-etch">
          Project
        </label>
        <select
          id="projectId"
          name="projectId"
          required
          defaultValue={state.values.projectId}
          className="input-instrument h-10 text-sm"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="status" className="glass-label text-etch">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={state.values.status}
            className="input-instrument h-10 text-sm"
          >
            {GOAL_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {formatTaskToken(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="slug" className="glass-label text-etch">
            Slug (optional)
          </label>
          <Input
            id="slug"
            name="slug"
            placeholder="timer-mvp"
            defaultValue={state.values.slug}
            className="h-10"
          />
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
          defaultValue={state.values.description}
          placeholder="Outcome-focused detail for this goal."
          className="min-h-28"
        />
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending || projects.length === 0}>
        {isPending ? "Creating goal..." : "Create goal"}
      </Button>
    </form>
  );
}
