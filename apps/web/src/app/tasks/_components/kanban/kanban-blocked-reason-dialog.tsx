"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";

/**
 * Small modal for the one board transition that needs extra input: Blocked.
 *
 * It is owned by the board so a drag, a keyboard drop and the tap "Move" menu
 * share the exact same reason prompt. Focus is trapped by Radix and returned to
 * the control that started the move on close.
 */
export function KanbanBlockedReasonDialog({
  open,
  taskTitle,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  taskTitle: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[var(--ega-overlay)] backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-surface)] p-5 shadow-[var(--ega-shadow-lg)] focus:outline-none"
          aria-describedby="kanban-blocked-reason-description"
        >
          <DialogPrimitive.Title className="text-sm font-semibold text-[color:var(--ega-text)]">
            Block {taskTitle ? `“${taskTitle}”` : "this task"}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="kanban-blocked-reason-description"
            className="mt-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
          >
            A blocked reason is required so the task explains what is stopping it.
          </DialogPrimitive.Description>

          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const normalized = reason.trim();
              if (!normalized) return;
              setReason("");
              onSubmit(normalized);
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="form-label">Blocked reason</span>
              <textarea
                ref={inputRef}
                required
                minLength={2}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="input-instrument min-h-16 w-full resize-y px-2 py-2 text-sm"
                placeholder="What is blocking this?"
              />
            </label>

            {error ? (
              <p className="feedback-block feedback-block-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-instrument btn-instrument-muted h-8 px-3 text-sm"
                disabled={pending}
                onClick={() => {
                  setReason("");
                  onCancel();
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-instrument h-8 px-3 text-sm"
                disabled={pending || reason.trim().length < 2}
              >
                {pending ? "Saving…" : "Save Blocked"}
              </button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
