import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GOAL_HEALTH_VALUES, getGoalHealthLabel, toGoalHealthOrNull } from "@/lib/goal-health";

type InlineGoalHealthFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  goalId: string;
  returnTo: string;
  defaultHealth: string | null;
  error?: string | null;
};

export function InlineGoalHealthForm({
  action,
  goalId,
  returnTo,
  defaultHealth,
  error,
}: InlineGoalHealthFormProps) {
  const currentHealth = toGoalHealthOrNull(defaultHealth);

  return (
    <details className="w-full sm:w-auto" open={Boolean(error)}>
      <summary className="filter-pill list-none cursor-pointer">
        <span>Health: {currentHealth ? getGoalHealthLabel(currentHealth) : "Not set"}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </summary>

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="goalId" value={goalId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <label className="flex flex-col gap-1.5">
          <span className="glass-label">Update health</span>
          <select
            name="health"
            defaultValue={defaultHealth ?? ""}
            className="input-instrument h-8 min-w-36 px-2.5 text-[length:var(--text-meta-lg)]"
          >
            <option value="">Not set</option>
            {GOAL_HEALTH_VALUES.map((healthValue) => (
              <option key={healthValue} value={healthValue}>
                {getGoalHealthLabel(healthValue)}
              </option>
            ))}
          </select>
        </label>

        <Button size="sm" type="submit" variant="secondary">
          Save health
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
