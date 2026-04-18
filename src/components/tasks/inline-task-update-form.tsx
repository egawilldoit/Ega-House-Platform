import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";

type InlineTaskUpdateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskId: string;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  error?: string | null;
};

export function InlineTaskUpdateForm({
  action,
  taskId,
  returnTo,
  defaultStatus,
  defaultPriority,
  defaultDueDate,
  defaultEstimateMinutes,
  error,
}: InlineTaskUpdateFormProps) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white/80 p-2.5">
        <label className="space-y-2">
          <span className="glass-label text-etch">
            Status
          </span>
          <select
            name="status"
            defaultValue={defaultStatus}
            className="input-instrument min-h-9 min-w-28 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            {TASK_STATUS_VALUES.map((statusValue) => (
              <option key={statusValue} value={statusValue}>
                {formatTaskToken(statusValue)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="glass-label text-etch">
            Due date
          </span>
          <Input
            name="dueDate"
            type="date"
            defaultValue={defaultDueDate ?? ""}
            className="min-h-9 min-w-36 px-3 py-0 text-sm"
          />
        </label>

        <label className="space-y-2">
          <span className="glass-label text-etch">
            Priority
          </span>
          <select
            name="priority"
            defaultValue={defaultPriority}
            className="input-instrument min-h-9 min-w-24 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
          >
            {TASK_PRIORITY_VALUES.map((priorityValue) => (
              <option key={priorityValue} value={priorityValue}>
                {formatTaskToken(priorityValue)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="glass-label text-etch">
            Estimate
          </span>
          <Input
            name="estimateMinutes"
            type="number"
            min="0"
            step="15"
            inputMode="numeric"
            defaultValue={defaultEstimateMinutes ?? ""}
            className="min-h-9 min-w-28 px-3 py-0 text-sm"
          />
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
