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
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="form-label">
          Title
        </label>
        <Input
          id="title"
          name="title"
          required
          placeholder="Follow up on onboarding insight"
          defaultValue={state.values.title}
          className="h-9"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="type" className="form-label">
            Type
          </label>
          <select
            id="type"
            name="type"
            defaultValue={state.values.type || DEFAULT_IDEA_NOTE_TYPE}
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
          <label htmlFor="projectId" className="form-label">
            Project
          </label>
          <select
            id="projectId"
            name="projectId"
            defaultValue={state.values.projectId}
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
          <label htmlFor="priority" className="form-label">
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={state.values.priority}
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
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="form-label">
          Body (optional)
        </label>
        <Textarea
          id="body"
          name="body"
          placeholder="Add context, links, or next thoughts."
          defaultValue={state.values.body}
          className="min-h-24"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tagsInput" className="form-label">
          Tags
        </label>
        <Input
          id="tagsInput"
          name="tagsInput"
          placeholder="ops, product, follow-up"
          defaultValue={state.values.tagsInput}
          className="h-9"
        />
        <p className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
          Separate tags with commas.
        </p>
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

      <Button
        type="submit"
        size="lg"
        disabled={isPending}
        className="w-full justify-center gap-2 sm:w-auto"
      >
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
        {isPending ? "Capturing..." : "Capture idea"}
      </Button>
    </form>
  );
}
