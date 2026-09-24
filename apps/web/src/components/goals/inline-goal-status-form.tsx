import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDisplayStatus } from "@/lib/presentation-format";
import { GOAL_STATUS_VALUES } from "@/lib/task-domain";

type InlineGoalStatusFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  goalId: string;
  returnTo: string;
  defaultStatus: string;
  error?: string | null;
  /**
   * Renders only the form so a parent disclosure can own the "Edit goal"
   * affordance; standalone rendering keeps its own disclosure.
   */
  embedded?: boolean;
};

export function InlineGoalStatusForm({
  action,
  goalId,
  returnTo,
  defaultStatus,
  error,
  embedded = false,
}: InlineGoalStatusFormProps) {
  const form = (
    <form
      action={action}
      className={embedded ? "flex flex-wrap items-end gap-2" : "mt-3 flex flex-wrap items-end gap-2"}
    >
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className="flex flex-col gap-1.5">
        <span className="glass-label">Update status</span>
        <select
          name="status"
          defaultValue={defaultStatus}
          className="input-instrument h-8 min-w-32 px-2.5 text-[length:var(--text-meta-lg)]"
        >
          {GOAL_STATUS_VALUES.map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {formatDisplayStatus(statusValue)}
            </option>
          ))}
        </select>
      </label>

      <Button size="sm" type="submit" variant="secondary">
        Save status
      </Button>

      {error ? (
        <p role="alert" className="feedback-block feedback-block-error w-full">
          {error}
        </p>
      ) : null}
    </form>
  );

  if (embedded) return form;

  return (
    <details className="w-full sm:w-auto" open={Boolean(error)}>
      <summary className="filter-pill list-none cursor-pointer">
        <span>Status: {formatDisplayStatus(defaultStatus)}</span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </summary>
      {form}
    </details>
  );
}
