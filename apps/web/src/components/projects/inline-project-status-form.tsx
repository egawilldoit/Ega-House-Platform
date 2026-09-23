import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
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
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className="flex flex-col gap-1.5">
        <span className="glass-label">Status</span>
        <select
          name="status"
          defaultValue={defaultStatus}
          className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
        >
          {PROJECT_STATUS_VALUES.filter((statusValue) => statusValue !== "archived").map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {formatTaskToken(statusValue)}
            </option>
          ))}
        </select>
      </label>

      <PendingSubmitButton
        size="sm"
        type="submit"
        variant="secondary"
        className="self-start"
        pendingLabel="Saving…"
      >
        Save status
      </PendingSubmitButton>

      {error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
