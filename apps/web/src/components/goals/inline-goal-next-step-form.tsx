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
    <form action={action} className="space-y-3">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white/80 p-3">
        <label className="min-w-0 flex-1 space-y-2">
          <span className="glass-label text-etch">Next step</span>
          <Input
            name="next_step"
            maxLength={GOAL_NEXT_STEP_MAX_LENGTH}
            defaultValue={defaultNextStep ?? ""}
            placeholder="Set the immediate next move for this goal."
            className="h-9"
          />
        </label>

        <Button size="sm" type="submit" variant="muted">
          Save
        </Button>
      </div>

      {error ? <p className="feedback-block feedback-block-error">{error}</p> : null}
    </form>
  );
}
