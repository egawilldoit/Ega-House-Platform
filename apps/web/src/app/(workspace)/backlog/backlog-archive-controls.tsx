"use client";

import { useActionState } from "react";
import { Archive, RotateCcw } from "lucide-react";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import {
  archiveBacklogItemAction,
  restoreBacklogItemAction,
  type BacklogArchiveFormState,
} from "./actions";

type BacklogArchiveControlsProps = {
  noteId: string;
  mode: "archive" | "restore";
};

const initialState: BacklogArchiveFormState = {
  error: null,
  success: null,
};

export function BacklogArchiveControls({ noteId, mode }: BacklogArchiveControlsProps) {
  const action = mode === "archive" ? archiveBacklogItemAction : restoreBacklogItemAction;
  const [state, formAction] = useActionState(action, initialState);
  const Icon = mode === "archive" ? Archive : RotateCcw;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={noteId} />
      <PendingSubmitButton
        type="submit"
        size="sm"
        variant={mode === "archive" ? "muted" : "default"}
        className="gap-2"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {mode === "archive" ? "Archive" : "Restore"}
      </PendingSubmitButton>
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
    </form>
  );
}
