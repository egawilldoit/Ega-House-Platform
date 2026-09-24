"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_IDEA_NOTE_TYPE,
  IDEA_NOTE_PRIORITIES,
  IDEA_NOTE_TYPES,
  MANUAL_IDEA_NOTE_STATUSES,
} from "@/lib/idea-note-domain";
import type { IdeaNote, IdeaNoteProjectOption } from "@/lib/services/idea-note-service";
import { formatTaskToken } from "@/lib/task-domain";

import { updateIdeaNoteAction, type UpdateIdeaNoteFormState } from "./actions";

type EditIdeaNoteFormProps = {
  note: IdeaNote;
  projectOptions: IdeaNoteProjectOption[];
};

const initialState: UpdateIdeaNoteFormState = {
  error: null,
  success: null,
};

export function EditIdeaNoteForm({ note, projectOptions }: EditIdeaNoteFormProps) {
  const [state, formAction] = useActionState(updateIdeaNoteAction, initialState);

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

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`idea-${note.id}-title`} className="form-label">
            Title
          </label>
          <Input
            id={`idea-${note.id}-title`}
            name="title"
            required
            defaultValue={note.title}
            className="h-9"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`idea-${note.id}-type`} className="form-label">
              Type
            </label>
            <select
              id={`idea-${note.id}-type`}
              name="type"
              defaultValue={note.type || DEFAULT_IDEA_NOTE_TYPE}
              className="input-instrument h-9 w-full px-2.5 text-[length:var(--text-meta-lg)]"
            >
              {IDEA_NOTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatTaskToken(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`idea-${note.id}-project`} className="form-label">
              Project
            </label>
            <select
              id={`idea-${note.id}-project`}
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
            <label htmlFor={`idea-${note.id}-priority`} className="form-label">
              Priority
            </label>
            <select
              id={`idea-${note.id}-priority`}
              name="priority"
              defaultValue={note.priority ?? ""}
              className="input-instrument h-9 w-full px-2.5 text-[length:var(--text-meta-lg)]"
            >
              <option value="">No priority</option>
              {IDEA_NOTE_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {formatTaskToken(priority)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`idea-${note.id}-status`} className="form-label">
              Status
            </label>
            <select
              id={`idea-${note.id}-status`}
              name="status"
              defaultValue={
                (MANUAL_IDEA_NOTE_STATUSES as readonly string[]).includes(note.status)
                  ? note.status
                  : "inbox"
              }
              className="input-instrument h-9 w-full px-2.5 text-[length:var(--text-meta-lg)]"
            >
              {MANUAL_IDEA_NOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatTaskToken(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`idea-${note.id}-body`} className="form-label">
            Body
          </label>
          <Textarea
            id={`idea-${note.id}-body`}
            name="body"
            defaultValue={note.body ?? ""}
            className="min-h-24"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`idea-${note.id}-tags`} className="form-label">
            Tags
          </label>
          <Input
            id={`idea-${note.id}-tags`}
            name="tagsInput"
            defaultValue={note.tags.join(", ")}
            className="h-9"
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
