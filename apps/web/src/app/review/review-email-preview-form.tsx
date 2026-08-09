"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { sendReviewPreviewAction, type SendReviewPreviewState } from "./actions";

type ReviewEmailPreviewFormProps = {
  reviewId: string | null;
};

export function ReviewEmailPreviewForm({ reviewId }: ReviewEmailPreviewFormProps) {
  const initialState: SendReviewPreviewState = {
    error: null,
    sent: false,
    messageId: null,
  };
  const [state, formAction, isPending] = useActionState(
    sendReviewPreviewAction,
    initialState,
  );
  const canSend = Boolean(reviewId);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reviewId" value={reviewId ?? ""} />
      <Button type="submit" disabled={!canSend || isPending} className="w-full sm:w-auto">
        {isPending ? "Sending preview..." : "Send preview email"}
      </Button>

      {!canSend ? (
        <p className="feedback-block feedback-block-error">
          Save this weekly review before sending a preview email.
        </p>
      ) : null}

      {state.error ? (
        <p role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </p>
      ) : null}

      {state.sent ? (
        <p className="feedback-block feedback-block-success">
          Preview email sent{state.messageId ? ` (${state.messageId})` : ""}. Official weekly send state was not changed.
        </p>
      ) : null}
    </form>
  );
}
