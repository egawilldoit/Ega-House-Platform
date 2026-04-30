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
    <details className="mt-4 rounded-xl border border-[rgba(15,23,42,0.08)] bg-white/70 p-3">
      <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
        Edit
      </summary>
      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={note.id} />

        <div className="space-y-2">
          <label htmlFor={`idea-${note.id}-title`} className="glass-label text-etch">
            Title
          </label>
          <Input
            id={`idea-${note.id}-title`}
            name="title"
            required
            defaultValue={note.title}
            className="ega-glass-input h-10 rounded-xl"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-2">
            <label htmlFor={`idea-${note.id}-type`} className="glass-label text-etch">
              Type
            </label>
            <select
              id={`idea-${note.id}-type`}
              name="type"
              defaultValue={note.type || DEFAULT_IDEA_NOTE_TYPE}
              className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
            >
              {IDEA_NOTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatTaskToken(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor={`idea-${note.id}-project`} className="glass-label text-etch">
              Project
            </label>
            <select
              id={`idea-${note.id}-project`}
              name="projectId"
              defaultValue={note.project_id ?? ""}
              className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
            >
              <option value="">No project</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor={`idea-${note.id}-priority`} className="glass-label text-etch">
              Priority
            </label>
            <select
              id={`idea-${note.id}-priority`}
              name="priority"
              defaultValue={note.priority ?? ""}
              className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
            >
              <option value="">No priority</option>
              {IDEA_NOTE_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {formatTaskToken(priority)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor={`idea-${note.id}-status`} className="glass-label text-etch">
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
              className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
            >
              {MANUAL_IDEA_NOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatTaskToken(status)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor={`idea-${note.id}-body`} className="glass-label text-etch">
            Body
          </label>
          <Textarea
            id={`idea-${note.id}-body`}
            name="body"
            defaultValue={note.body ?? ""}
            className="ega-glass-input min-h-24 rounded-xl"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor={`idea-${note.id}-tags`} className="glass-label text-etch">
            Tags
          </label>
          <Input
            id={`idea-${note.id}-tags`}
            name="tagsInput"
            defaultValue={note.tags.join(", ")}
            className="ega-glass-input h-10 rounded-xl"
          />
        </div>

        {state.error ? (
          <p className="text-sm text-signal-error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.success ? (
          <p className="text-sm text-signal-live" role="status">
            {state.success}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <PendingSubmitButton type="submit" size="sm" className="gap-2 rounded-xl">
            <Save className="h-4 w-4" aria-hidden="true" />
            Save
          </PendingSubmitButton>
          <Button type="reset" variant="muted" size="sm" className="rounded-xl">
            Reset
          </Button>
        </div>
      </form>
    </details>
  );
}
