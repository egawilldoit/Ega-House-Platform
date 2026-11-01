"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_HEALTH_VALUES, getGoalHealthLabel } from "@/lib/goal-health";
import { GOAL_NEXT_STEP_MAX_LENGTH } from "@/lib/goal-next-step";
import { formatDisplayStatus } from "@/lib/presentation-format";
import { GOAL_STATUS_VALUES } from "@/lib/task-domain";

import { type CreateGoalFormState, createGoalAction } from "./actions";

type CreateGoalFormProps = {
  projects: Array<{ id: string; name: string }>;
};

const FIELD_LABEL_CLASS =
  "text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]";

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
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="title" className={FIELD_LABEL_CLASS}>
            Goal title
          </label>
          <Input
            id="title"
            name="title"
            required
            placeholder="Ship shared timer flow"
            defaultValue={state.values.title}
            className="h-8 text-[length:var(--text-meta-lg)]"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="projectId" className={FIELD_LABEL_CLASS}>
            Project
          </label>
          <select
            id="projectId"
            name="projectId"
            required
            defaultValue={state.values.projectId}
            className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="slug" className={FIELD_LABEL_CLASS}>
            Slug (optional)
          </label>
          <Input
            id="slug"
            name="slug"
            placeholder="timer-mvp"
            defaultValue={state.values.slug}
            className="h-8 text-[length:var(--text-meta-lg)]"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="status" className={FIELD_LABEL_CLASS}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={state.values.status}
            className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
          >
            {GOAL_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {formatDisplayStatus(status)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="health" className={FIELD_LABEL_CLASS}>
            Health
          </label>
          <select
            id="health"
            name="health"
            defaultValue={state.values.health}
            className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
          >
            <option value="">Not set</option>
            {GOAL_HEALTH_VALUES.map((healthValue) => (
              <option key={healthValue} value={healthValue}>
                {getGoalHealthLabel(healthValue)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="next_step" className={FIELD_LABEL_CLASS}>
            Next step (optional)
          </label>
          <Input
            id="next_step"
            name="next_step"
            defaultValue={state.values.nextStep}
            maxLength={GOAL_NEXT_STEP_MAX_LENGTH}
            placeholder="Ship first deploy-ready timer run."
            className="h-8 text-[length:var(--text-meta-lg)]"
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <label htmlFor="description" className={FIELD_LABEL_CLASS}>
            Description (optional)
          </label>
          <Textarea
            id="description"
            name="description"
            defaultValue={state.values.description}
            placeholder="Outcome-focused detail for this goal."
            className="text-[length:var(--text-meta-lg)]"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button
          type="submit"
          disabled={isPending || projects.length === 0}
          className="w-full sm:w-auto"
        >
          {isPending ? "Creating goal..." : "Create goal"}
        </Button>
      </div>
    </form>
  );
}
