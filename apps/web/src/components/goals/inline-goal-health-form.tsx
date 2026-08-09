import { Button } from "@/components/ui/button";
import { GOAL_HEALTH_VALUES, getGoalHealthLabel } from "@/lib/goal-health";

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
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white/80 p-3">
        <label className="space-y-2">
          <span className="glass-label text-etch">Health</span>
          <select
            name="health"
            defaultValue={defaultHealth ?? ""}
            className="input-instrument min-h-9 min-w-36 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            <option value="">Not set</option>
            {GOAL_HEALTH_VALUES.map((healthValue) => (
              <option key={healthValue} value={healthValue}>
                {getGoalHealthLabel(healthValue)}
              </option>
            ))}
          </select>
        </label>

        <Button size="sm" type="submit" variant="muted">
          Save
        </Button>
      </div>

      {error ? <p className="feedback-block feedback-block-error">{error}</p> : null}
    </form>
  );
}
