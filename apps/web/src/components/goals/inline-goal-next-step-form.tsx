import { ChevronDown } from "lucide-react";

import { GOAL_NEXT_STEP_MAX_LENGTH } from "@/lib/goal-next-step";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

type InlineGoalNextStepFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  goalId: string;
  returnTo: string;
  defaultNextStep: string | null;
  error?: string | null;
};

export function InlineGoalNextStepForm({
  action,
  goalId,
  returnTo,
  defaultNextStep,
  error,
}: InlineGoalNextStepFormProps) {
  return (
    <details className="w-full sm:w-auto" open={Boolean(error)}>
      <summary className="filter-pill list-none cursor-pointer">
        <span>{defaultNextStep?.trim() ? "Next step: set" : "Next step: not set"}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </summary>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="glass-label">Update next step</span>
          <Input
            name="next_step"
            maxLength={GOAL_NEXT_STEP_MAX_LENGTH}
            defaultValue={defaultNextStep ?? ""}
            placeholder="Set the immediate next move for this goal."
            className="h-8 text-[length:var(--text-meta-lg)]"
          />
        </label>

        <Button size="sm" type="submit" variant="secondary">
          Save next step
        </Button>

        {error ? (
          <p role="alert" className="feedback-block feedback-block-error w-full">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
