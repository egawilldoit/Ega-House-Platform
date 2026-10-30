import type { AreaRecord } from "@ega/application";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type ProjectAreaFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  projectId: string;
  currentAreaId: string | null;
  areas: AreaRecord[];
  returnTo: string;
  error?: string | null;
  compact?: boolean;
};

/**
 * Assign one optional Area to a project. A native select keeps the full
 * keyboard/touch contract with no custom listbox or second state owner.
 */
export function ProjectAreaForm({
  action,
  projectId,
  currentAreaId,
  areas,
  returnTo,
  error,
  compact = false,
}: ProjectAreaFormProps) {
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className="flex flex-col gap-1.5">
        <span className="glass-label">Area</span>
        <select
          name="areaId"
          defaultValue={currentAreaId ?? ""}
          className="input-instrument h-8 w-full px-2.5 text-[length:var(--text-meta-lg)]"
        >
          <option value="">No area</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </label>

      <PendingSubmitButton
        size="sm"
        type="submit"
        variant="secondary"
        className={compact ? "self-start" : undefined}
        pendingLabel="Saving…"
      >
        Save area
      </PendingSubmitButton>

      {error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
