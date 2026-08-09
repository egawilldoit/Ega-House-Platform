"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { type SaveReviewFormState, saveReviewAction } from "./actions";
import { type ReviewFormValues } from "./review-form-state";

type ReviewFormProps = {
  defaultValues: ReviewFormValues;
};

export function ReviewForm({ defaultValues }: ReviewFormProps) {
  const initialState: SaveReviewFormState = {
    error: null,
    saved: false,
    saveMode: null,
    values: defaultValues,
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
        <label htmlFor="summary" className="glass-label text-etch">
          Summary
        </label>
        <Textarea
          id="summary"
          name="summary"
          required
          minLength={20}
          placeholder="Summarize the week, what changed, and the overall outcome."
          defaultValue={state.values.summary}
          className="min-h-36"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="wins" className="glass-label text-etch">
            Wins
          </label>
          <Textarea
            id="wins"
            name="wins"
            placeholder="Key progress, shipped work, or positive outcomes."
            defaultValue={state.values.wins}
            className="min-h-32"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="blockers" className="glass-label text-etch">
            Blockers
          </label>
          <Textarea
            id="blockers"
            name="blockers"
            placeholder="What slowed the week down or still needs resolution."
            defaultValue={state.values.blockers}
            className="min-h-32"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="next_steps" className="glass-label text-etch">
          Next steps
        </label>
        <Textarea
          id="next_steps"
          name="next_steps"
          placeholder="What should happen next in the coming week."
          defaultValue={state.values.nextSteps}
          className="min-h-32"
        />
      </div>

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p className="feedback-block feedback-block-success">
          {state.saveMode === "created"
            ? "Weekly review created. You can keep editing this week and save again."
            : "Weekly review updated. You can keep editing this week and save again."}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving..." : "Save review"}
      </Button>
    </form>
  );
}
