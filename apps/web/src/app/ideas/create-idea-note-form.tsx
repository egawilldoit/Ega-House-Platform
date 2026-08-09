"use client";

import { useActionState } from "react";
import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_IDEA_NOTE_TYPE, IDEA_NOTE_PRIORITIES, IDEA_NOTE_TYPES } from "@/lib/idea-note-domain";
import { formatTaskToken } from "@/lib/task-domain";

import {
  createIdeaNoteAction,
  type CreateIdeaNoteFormState,
} from "./actions";

type CreateIdeaNoteFormProps = {
  projectOptions: Array<{
    id: string;
    name: string;
  }>;
};

const initialState: CreateIdeaNoteFormState = {
  error: null,
  success: null,
  values: {
    title: "",
    body: "",
    type: DEFAULT_IDEA_NOTE_TYPE,
    projectId: "",
    priority: "",
    tagsInput: "",
  },
};

export function CreateIdeaNoteForm({ projectOptions }: CreateIdeaNoteFormProps) {
  const [state, formAction, isPending] = useActionState(
    createIdeaNoteAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="title" className="glass-label text-etch">
          Title
        </label>
        <Input
          id="title"
          name="title"
          required
          placeholder="Follow up on onboarding insight"
          defaultValue={state.values.title}
          className="ega-glass-input h-10 rounded-xl"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="type" className="glass-label text-etch">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={state.values.type || DEFAULT_IDEA_NOTE_TYPE}
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
          <label htmlFor="projectId" className="glass-label text-etch">
            Project
          </label>
          <select
            id="projectId"
            name="projectId"
            defaultValue={state.values.projectId}
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
          <label htmlFor="priority" className="glass-label text-etch">
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={state.values.priority}
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
      </div>

      <div className="space-y-2">
        <label htmlFor="body" className="glass-label text-etch">
          Body (optional)
        </label>
        <Textarea
          id="body"
          name="body"
          placeholder="Add context, links, or next thoughts."
          defaultValue={state.values.body}
          className="ega-glass-input min-h-28 rounded-xl"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="tagsInput" className="glass-label text-etch">
          Tags
        </label>
        <Input
          id="tagsInput"
          name="tagsInput"
          placeholder="ops, product, follow-up"
          defaultValue={state.values.tagsInput}
          className="ega-glass-input h-10 rounded-xl"
        />
        <p className="text-xs text-[color:var(--muted-foreground)]">
          Separate tags with commas.
        </p>
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

      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        className="w-full justify-center gap-2 rounded-xl sm:w-auto"
      >
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        {isPending ? "Capturing..." : "Capture idea"}
      </Button>
    </form>
  );
}
