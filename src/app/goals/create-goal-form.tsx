"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_HEALTH_VALUES, getGoalHealthLabel } from "@/lib/goal-health";
import { GOAL_NEXT_STEP_MAX_LENGTH } from "@/lib/goal-next-step";
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
      nextStep: "",
      health: "",
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
      <div className="rounded-[1.1rem] border border-[var(--border)] bg-[color:var(--instrument)] p-4">
        <div className="mb-4">
          <p className="glass-label text-etch">Goal Setup</p>
          <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
            Define the outcome, attach it to a project, and set its initial delivery posture.
          </p>
        </div>

        <div className="space-y-4">
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
              <label htmlFor="health" className="glass-label text-etch">
                Health
              </label>
              <select
                id="health"
                name="health"
                defaultValue={state.values.health}
                className="input-instrument h-10 text-sm"
              >
                <option value="">Not set</option>
                {GOAL_HEALTH_VALUES.map((healthValue) => (
                  <option key={healthValue} value={healthValue}>
                    {getGoalHealthLabel(healthValue)}
                  </option>
                ))}
              </select>
            </div>
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

          <div className="space-y-2">
            <label htmlFor="description" className="glass-label text-etch">
              Description (optional)
            </label>
            <Textarea
              id="description"
              name="description"
              defaultValue={state.values.description}
              placeholder="Outcome-focused detail for this goal."
              className="min-h-24"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="next_step" className="glass-label text-etch">
              Next step (optional)
            </label>
            <Input
              id="next_step"
              name="next_step"
              defaultValue={state.values.nextStep}
              maxLength={GOAL_NEXT_STEP_MAX_LENGTH}
              placeholder="Ship first deploy-ready timer run."
              className="h-10"
            />
          </div>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isPending || projects.length === 0}
        className="w-full sm:w-auto"
      >
        {isPending ? "Creating goal..." : "Create goal"}
      </Button>
    </form>
  );
}
