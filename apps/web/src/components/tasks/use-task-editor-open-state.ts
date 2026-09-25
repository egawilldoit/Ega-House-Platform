"use client";

import { useEffect, useState } from "react";

type TaskEditorOpenStateArgs = {
  taskId: string;
  error?: string | null;
  /** Controlled open state from the row/title surface; unmanaged when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Canonical Edit-task-modal open state shared by every row surface.
 *
 * A failed save redirects back with an error for this exact task; the modal for
 * that task then stays open (initial render and later error transitions) until
 * the user dismisses it. The row-surface owner calls this and forwards the
 * result into `TaskCardActions`/`EditTaskModal` so a separate title trigger
 * drives the same modal instead of mounting a second editor.
 */
export function useTaskEditorOpenState({
  taskId,
  error = null,
  open: openOverride,
  onOpenChange: onOpenChangeOverride,
}: TaskEditorOpenStateArgs) {
  const [manualOpen, setManualOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const open = openOverride ?? (manualOpen || (Boolean(error) && error !== dismissedError));

  const handleOpenChange = (nextOpen: boolean) => {
    if (onOpenChangeOverride) {
      onOpenChangeOverride(nextOpen);
      return;
    }
    setManualOpen(nextOpen);
    if (!nextOpen) setDismissedError(error);
  };

  useEffect(() => {
    if (!open || !error) return;
    document.getElementById(`task-update-error-${taskId}`)?.focus();
  }, [open, error, taskId]);

  return { open, handleOpenChange } as const;
}
