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
    <details className="rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[color:var(--ega-surface)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[length:var(--text-meta-lg)] font-medium text-[color:var(--ega-text)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ega-text)]">
        <ArrowRight className="h-4 w-4 text-[color:var(--ega-text-secondary)]" aria-hidden="true" />
        Convert to task
      </summary>
      <form
        action={formAction}
        className="flex flex-col gap-3 border-t border-[var(--ega-divider)] px-3 py-3"
      >
        <input type="hidden" name="id" value={note.id} />
        <p className="text-[length:var(--text-meta-lg)] leading-[var(--leading-snug)] text-[color:var(--ega-text-secondary)]">
          Choose a project to create a task from this idea. The Inbox item will remain linked as converted.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`idea-${note.id}-conversion-project`} className="glass-label">
            Project
          </label>
          <select
            id={`idea-${note.id}-conversion-project`}
            name="projectId"
            required
            defaultValue={note.project_id ?? ""}
            className="input-instrument h-9 w-full px-2.5 text-[length:var(--text-meta-lg)]"
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
          <p className="feedback-block feedback-block-warn" role="status">
            Create a project before converting an idea into a task.
          </p>
        ) : null}

        {state.error ? (
          <p className="feedback-block feedback-block-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <PendingSubmitButton
          type="submit"
          size="sm"
          className="gap-2 self-start"
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
