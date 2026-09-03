"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import type { IdeaNote, IdeaNoteProjectOption } from "@/lib/services/idea-note-service";

import {
  convertIdeaNoteAction,
  type ConvertIdeaNoteFormState,
} from "./actions";

type ConvertIdeaNoteFormProps = {
  note: IdeaNote;
  projectOptions: IdeaNoteProjectOption[];
};

const initialState: ConvertIdeaNoteFormState = {
  error: null,
};

export function ConvertIdeaNoteForm({ note, projectOptions }: ConvertIdeaNoteFormProps) {
  const [state, formAction] = useActionState(convertIdeaNoteAction, initialState);

  return (
    <details className="mt-3 rounded-xl border border-[rgba(15,23,42,0.08)] bg-white/70 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
        <ArrowRight className="h-4 w-4 text-[color:var(--accent)]" aria-hidden="true" />
        Convert to task
      </summary>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="id" value={note.id} />
        <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
          Choose a project to create a task from this idea. The Inbox item will remain linked as converted.
        </p>
        <div className="space-y-2">
          <label htmlFor={`idea-${note.id}-conversion-project`} className="glass-label text-etch">
            Project
          </label>
          <select
            id={`idea-${note.id}-conversion-project`}
            name="projectId"
            required
            defaultValue={note.project_id ?? ""}
            className="ega-glass-input h-10 w-full rounded-xl px-3 text-sm"
          >
            <option value="">Choose a project</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {projectOptions.length === 0 ? (
          <p className="text-sm text-signal-warning" role="status">
            Create a project before converting an idea into a task.
          </p>
        ) : null}

        {state.error ? (
          <p className="text-sm text-signal-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <PendingSubmitButton
          type="submit"
          size="sm"
          className="gap-2 rounded-xl"
          disabled={projectOptions.length === 0}
          pendingLabel="Converting..."
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
          Create task
        </PendingSubmitButton>
      </form>
    </details>
  );
}
