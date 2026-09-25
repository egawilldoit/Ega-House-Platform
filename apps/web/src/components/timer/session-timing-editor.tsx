"use client";

import { useEffect, useMemo, useRef, useState, useActionState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Clock3, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import type { UpdateSessionTimingFormState } from "@/app/timer/actions";
import { formatDurationLabel } from "@/lib/task-session";
import {
  getTimerCorrectionPreview,
  shiftLocalTimeValue,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "@/lib/timer-correction";

import { Button } from "../ui/button";
import { PendingSubmitButton } from "../ui/pending-submit-button";

type UpdateSessionTimingAction = (
  state: UpdateSessionTimingFormState,
  formData: FormData,
) => Promise<UpdateSessionTimingFormState>;

type SessionTimingEditorProps = {
  sessionId: string;
  taskTitle: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  returnTo: string;
  action: UpdateSessionTimingAction;
};

const END_TIME_NUDGES = [
  { offset: -30, label: "-30 min" },
  { offset: -15, label: "-15 min" },
  { offset: 15, label: "+15 min" },
  { offset: 30, label: "+30 min" },
];

function EditorCard({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--ega-border)] bg-[var(--ega-surface-subtle)] p-4">
      <p className="glass-label">{label}</p>
      {children}
    </section>
  );
}

function SessionTimingEditorPanel({
  sessionId,
  taskTitle,
  projectName,
  startedAt,
  endedAt,
  returnTo,
  action,
  onClose,
}: {
  sessionId: string;
  taskTitle: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  returnTo: string;
  action: UpdateSessionTimingAction;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {
    errorMessage: null,
    successMessage: null,
    sessionId: null,
  } satisfies UpdateSessionTimingFormState);
  const initialDate = toLocalDateInputValue(startedAt);
  const initialStartTime = toLocalTimeInputValue(startedAt);
  const initialEndTime = toLocalTimeInputValue(endedAt);

  const [dateValue, setDateValue] = useState(initialDate);
  const [startTimeValue, setStartTimeValue] = useState(initialStartTime);
  const [endTimeValue, setEndTimeValue] = useState(initialEndTime);

  const preview = useMemo(
    () =>
      getTimerCorrectionPreview({
        date: dateValue,
        startTime: startTimeValue,
        endTime: endTimeValue,
      }),
    [dateValue, startTimeValue, endTimeValue],
  );

  const canSave = preview.errorMessage === null && preview.data !== null;

  useEffect(() => {
    if (!state.successMessage) return;
    // The server action has already revalidated /timer (plus the other
    // workspace surfaces). Refresh the current route so the row and totals
    // reflect the saved values, then close the dialog. The panel unmounts on
    // close, so this cannot re-fire after the save completes.
    router.refresh();
    onClose();
  }, [state.successMessage, router, onClose]);

  const errorId = `session-edit-error-${sessionId}`;
  const saveErrorId = `session-save-error-${sessionId}`;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ega-border)] px-5 pb-4 pt-5 sm:px-6">
        <div className="min-w-0 space-y-1.5">
          <DialogPrimitive.Title className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
            Edit session
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
            Adjust the recorded time for this work session.
          </DialogPrimitive.Description>
        </div>
        <DialogPrimitive.Close asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 rounded-full p-0"
            aria-label="Close edit session"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
        <EditorCard label="Task">
          <p className="min-w-0 break-words text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]">
            {taskTitle}
          </p>
          <p className="truncate text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
            {projectName}
          </p>
        </EditorCard>

        <EditorCard label="Date">
          <label htmlFor={`session-date-${sessionId}`} className="form-label">
            Date
          </label>
          <input
            id={`session-date-${sessionId}`}
            name="date"
            type="date"
            required
            value={dateValue}
            onChange={(event) => setDateValue(event.target.value)}
            className="input-instrument h-9 w-full text-sm"
          />
        </EditorCard>

        <EditorCard label="Time">
          <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`session-start-${sessionId}`} className="form-label">
                Start time
              </label>
              <input
                id={`session-start-${sessionId}`}
                name="startTime"
                type="time"
                required
                value={startTimeValue}
                onChange={(event) => setStartTimeValue(event.target.value)}
                className="input-instrument h-9 w-full text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`session-end-${sessionId}`} className="form-label">
                End time
              </label>
              <input
                id={`session-end-${sessionId}`}
                name="endTime"
                type="time"
                required
                value={endTimeValue}
                onChange={(event) => setEndTimeValue(event.target.value)}
                aria-describedby={
                  preview.errorMessage
                    ? errorId
                    : state.errorMessage
                      ? saveErrorId
                      : undefined
                }
                className="input-instrument h-9 w-full text-sm"
              />
            </div>
          </div>
        </EditorCard>

        <EditorCard label="Adjust end time">
          <div className="flex flex-wrap gap-2">
            {END_TIME_NUDGES.map((nudge) => (
              <button
                key={nudge.offset}
                type="button"
                onClick={() => setEndTimeValue(shiftLocalTimeValue(endTimeValue, nudge.offset))}
                aria-label={`${
                  nudge.offset < 0 ? "Move end time earlier" : "Move end time later"
                } by ${Math.abs(nudge.offset)} minutes`}
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--ega-border)] bg-[var(--ega-surface)] px-3 text-sm font-medium text-[color:var(--ega-text-secondary)] transition-[background-color,border-color,color] duration-[var(--duration-fast)] hover:bg-[var(--ega-surface-hover)] hover:text-[color:var(--ega-text)]"
              >
                {nudge.label}
              </button>
            ))}
          </div>
        </EditorCard>

        <EditorCard label="Duration">
          {preview.data ? (
            <p
              className="tabular-nums text-[length:var(--text-body-lg)] font-semibold text-[color:var(--ega-text)]"
              aria-live="polite"
            >
              {formatDurationLabel(preview.data.durationSeconds)}
            </p>
          ) : (
            <p id={errorId} role="alert" className="text-sm text-[var(--signal-error)]">
              {preview.errorMessage}
            </p>
          )}
        </EditorCard>
      </div>

      <div className="shrink-0 border-t border-[var(--ega-border)] px-5 py-4 sm:px-6">
        {state.errorMessage ? (
          <p
            id={saveErrorId}
            role="alert"
            tabIndex={-1}
            className="feedback-block feedback-block-error mb-3"
          >
            {state.errorMessage}
          </p>
        ) : null}
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="startedAt" value={preview.data?.startedAtIso ?? ""} />
        <input type="hidden" name="endedAt" value={preview.data?.endedAtIso ?? ""} />
        <div className="flex items-center justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button type="button" variant="muted" size="md" onClick={onClose}>
              Cancel
            </Button>
          </DialogPrimitive.Close>
          <PendingSubmitButton type="submit" size="md" disabled={!canSave} pendingLabel="Saving…">
            Save changes
          </PendingSubmitButton>
        </div>
      </div>
    </form>
  );
}

export function SessionTimingEditor({
  sessionId,
  taskTitle,
  projectName,
  startedAt,
  endedAt,
  returnTo,
  action,
}: SessionTimingEditorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="muted"
          size="sm"
          aria-label="Correct session timing"
          onClick={(event) => event.currentTarget.focus()}
          title="Correct session timing"
          className="h-7 w-7 !px-0 max-[761px]:h-10 max-[761px]:w-10"
        >
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-[rgba(17,17,15,0.58)] transition-opacity" />
        <DialogPrimitive.Content
          aria-label="Edit session"
          onCloseAutoFocus={(event) => {
            if (!triggerRef.current) return;
            event.preventDefault();
            triggerRef.current.focus();
          }}
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(50rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[45rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--ega-border)] bg-[var(--ega-surface)] shadow-[0_28px_80px_rgba(17,17,15,0.3)] outline-none"
        >
          {open ? (
            <SessionTimingEditorPanel
              sessionId={sessionId}
              taskTitle={taskTitle}
              projectName={projectName}
              startedAt={startedAt}
              endedAt={endedAt}
              returnTo={returnTo}
              action={action}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
