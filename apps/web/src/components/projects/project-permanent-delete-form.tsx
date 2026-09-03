"use client";

import { Button } from "@/components/ui/button";

type ProjectPermanentDeleteFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  projectId: string;
  projectName: string;
  returnTo: string;
};

/**
 * Destructive delete affordance for archived projects. The browser
 * confirmation is an accidental-click safeguard only: the archived-only rule
 * and the linked task/goal checks live in `@ega/application` and run again
 * inside the server action.
 */
export function ProjectPermanentDeleteForm({
  action,
  projectId,
  projectName,
  returnTo,
}: ProjectPermanentDeleteFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Permanently delete "${projectName}"?\n\nThis cannot be undone.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="confirmDelete" value="true" />
      <Button type="submit" variant="danger" size="sm">
        Delete permanently
      </Button>
    </form>
  );
}
