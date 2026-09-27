"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import { isManualIdeaNoteStatus } from "@/lib/idea-note-domain";
import type { IdeaNote, IdeaNoteProjectOption } from "@/lib/services/idea-note-service";

import { updateBacklogItemAction, type UpdateBacklogItemFormState } from "./actions";

type BacklogItemFormProps = {
  note: IdeaNote;
  projectOptions: IdeaNoteProjectOption[];
};

const initialState: UpdateBacklogItemFormState = {
  error: null,
  success: null,
};

export function BacklogItemForm({ note, projectOptions }: BacklogItemFormProps) {
  const [state, formAction] = useActionState(updateBacklogItemAction, initialState);

  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)]">
      <summary className="cursor-pointer list-none px-3 py-2 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ega-text)]">
        Edit
      </summary>
      <form
        action={formAction}
        className="flex flex-col gap-4 border-t border-[var(--ega-divider)] px-3 py-3"
      >
        <input type="hidden" name="id" value={note.id} />
        <input type="hidden" name="type" value={note.type} />
        <input type="hidden" name="priority" value={note.priority ?? ""} />
        <input type="hidden" name="tagsInput" value={note.tags.join(", ")} />
        <input
          type="hidden"
          name="status"
          value={isManualIdeaNoteStatus(note.status) ? note.status : "inbox"}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`backlog-${note.id}-title`} className="form-label">
            Idea
          </label>
          <Input
            id={`backlog-${note.id}-title`}
            name="title"
            required
            defaultValue={note.title}
            className="h-9"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`backlog-${note.id}-project`} className="form-label">
            Project
          </label>
          <select
            id={`backlog-${note.id}-project`}
            name="projectId"
            defaultValue={note.project_id ?? ""}
            className="input-instrument h-9 w-full px-2.5 text-[length:var(--text-meta-lg)]"
          >
            <option value="">No project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`backlog-${note.id}-body`} className="form-label">
            Notes
          </label>
          <Textarea
            id={`backlog-${note.id}-body`}
            name="body"
            defaultValue={note.body ?? ""}
            placeholder="Add context, links, or next thoughts."
            className="min-h-24"
          />
        </div>

        {state.error ? (
          <p className="feedback-block feedback-block-error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.success ? (
          <p className="feedback-block" role="status">
            {state.success}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <PendingSubmitButton type="submit" size="sm" className="gap-2">
            <Save className="h-4 w-4" aria-hidden="true" />
            Save
          </PendingSubmitButton>
          <Button type="reset" variant="muted" size="sm">
            Reset
          </Button>
        </div>
      </form>
    </details>
  );
}
