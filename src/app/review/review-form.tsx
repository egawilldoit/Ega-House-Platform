"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { type SaveReviewFormState, saveReviewAction } from "./actions";

type ReviewFormProps = {
  defaultWeekOf: string;
};

export function ReviewForm({ defaultWeekOf }: ReviewFormProps) {
  const initialState: SaveReviewFormState = {
    error: null,
    saved: false,
    values: {
      reflection: "",
      weekOf: defaultWeekOf,
    },
  };

  const [state, formAction, isPending] = useActionState(
    saveReviewAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="weekOf" className="glass-label text-etch">
          Week date
        </label>
        <Input
          id="weekOf"
          type="date"
          name="weekOf"
          required
          defaultValue={state.values.weekOf}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="reflection"
          className="glass-label text-etch"
        >
          Reflection
        </label>
        <Textarea
          id="reflection"
          name="reflection"
          required
          minLength={20}
          placeholder="What worked, what failed, and what you will change next week."
          defaultValue={state.values.reflection}
          className="min-h-44"
        />
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p className="feedback-block feedback-block-success">
          Review saved.
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save review"}
      </Button>
    </form>
  );
}
