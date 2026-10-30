"use client";

import { useCallback } from "react";
import { useToastQueue, type ToastActionResult } from "@/components/ui/toast-provider";

export type UndoToastInput = {
  message: string;
  /**
   * Performs the inverse and reports what the server actually did. The result is
   * required: a fire-and-forget callback cannot prove the inverse committed, and
   * the queue never infers success.
   */
  undo: () => Promise<ToastActionResult> | ToastActionResult;
  durationMs?: number;
};

/**
 * Show an undo toast whose action reports the real outcome.
 *
 * This hook is presentation only: exactly-once delivery of the inverse belongs
 * to the server receipt that owns the mutation (EGA-786). It does disable
 * duplicate clicks while the inverse is in flight so a double tap cannot send
 * two undos.
 */
export function useUndoToast() {
  const { show } = useToastQueue();

  const showUndo = useCallback(
    (input: UndoToastInput) =>
      show({
        message: input.message,
        durationMs: input.durationMs,
        action: { label: "Undo", run: input.undo },
      }),
    [show],
  );

  return { showUndo };
}
