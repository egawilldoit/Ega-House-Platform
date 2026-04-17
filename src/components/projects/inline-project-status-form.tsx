import { Button } from "@/components/ui/button";
import {
  PROJECT_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";

type InlineProjectStatusFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  projectId: string;
  returnTo: string;
  defaultStatus: string;
  error?: string | null;
};

export function InlineProjectStatusForm({
  action,
  projectId,
  returnTo,
  defaultStatus,
  error,
}: InlineProjectStatusFormProps) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white/80 p-3">
        <label className="space-y-2">
          <span className="glass-label text-etch">
            Status
          </span>
          <select
            name="status"
            defaultValue={defaultStatus}
            className="input-instrument min-h-9 min-w-32 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            {PROJECT_STATUS_VALUES.map((statusValue) => (
              <option key={statusValue} value={statusValue}>
                {formatTaskToken(statusValue)}
              </option>
            ))}
          </select>
        </label>

        <Button size="sm" type="submit" variant="muted">
          Save
        </Button>
      </div>

      {error ? (
        <p className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
