"use client";

import { useActionState } from "react";
import { Archive, RotateCcw } from "lucide-react";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

import {
  archiveIdeaNoteAction,
  restoreIdeaNoteAction,
  type IdeaNoteArchiveFormState,
} from "./actions";

type IdeaNoteArchiveControlsProps = {
  noteId: string;
  mode: "archive" | "restore";
};

const initialState: IdeaNoteArchiveFormState = {
  error: null,
  success: null,
};

export function IdeaNoteArchiveControls({ noteId, mode }: IdeaNoteArchiveControlsProps) {
  const action = mode === "archive" ? archiveIdeaNoteAction : restoreIdeaNoteAction;
  const [state, formAction] = useActionState(action, initialState);
  const Icon = mode === "archive" ? Archive : RotateCcw;

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={noteId} />
      <PendingSubmitButton
        type="submit"
        size="sm"
        variant={mode === "archive" ? "muted" : "default"}
        className="gap-2 rounded-xl"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {mode === "archive" ? "Archive" : "Restore"}
      </PendingSubmitButton>
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
    </form>
  );
}
