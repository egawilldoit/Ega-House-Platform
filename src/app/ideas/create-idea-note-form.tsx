"use client";

import { useActionState } from "react";
import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  createIdeaNoteAction,
  type CreateIdeaNoteFormState,
} from "./actions";

const initialState: CreateIdeaNoteFormState = {
  error: null,
  success: null,
  values: {
    title: "",
    body: "",
  },
};

export function CreateIdeaNoteForm() {
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
