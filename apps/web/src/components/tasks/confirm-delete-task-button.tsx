"use client";

import { useState, type RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { Button } from "@/components/ui/button";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";

type ConfirmDeleteTaskButtonProps = {
  taskTitle: string;
  formRef: RefObject<HTMLFormElement | null>;
  pendingLabel?: string;
  triggerLabel?: string;
  dataTestId?: string;
  className?: string;
};

export function ConfirmDeleteTaskButton({
  taskTitle,
  formRef,
  pendingLabel = "Deleting…",
  triggerLabel = "Delete task",
  dataTestId,
  className,
}: ConfirmDeleteTaskButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <PendingSubmitButton
          type="button"
          size="sm"
          variant="danger"
          pendingLabel={pendingLabel}
          data-testid={dataTestId}
          className={className}
        >
          {triggerLabel}
        </PendingSubmitButton>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[95] bg-[rgba(17,17,15,0.58)] transition-opacity" />
        <DialogPrimitive.Content
          aria-label={`Delete task ${taskTitle}`}
          className="fixed left-1/2 top-1/2 z-[96] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] p-5 shadow-[0_28px_80px_rgba(17,17,15,0.3)] outline-none"
        >
          <DialogPrimitive.Title className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            Delete task
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-sm leading-5 text-[color:var(--ega-text-secondary)]">
            Delete &quot;{taskTitle}&quot; permanently? This is blocked if the task has timer
            history and cannot be undone.
          </DialogPrimitive.Description>

          <div className="mt-4 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                size="sm"
                variant="muted"
                data-testid={dataTestId ? `${dataTestId}-cancel` : undefined}
              >
                Cancel
              </Button>
            </DialogPrimitive.Close>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-label={`Delete ${taskTitle}`}
              data-testid={dataTestId ? `${dataTestId}-confirm` : undefined}
              onClick={() => {
                setOpen(false);
                formRef.current?.requestSubmit();
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
