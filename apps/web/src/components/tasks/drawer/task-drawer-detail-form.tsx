"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EMPTY_TASK_FIELD_DRAFT_STATE } from "@/lib/task-field-draft";
import type { TaskDrawerDetail } from "@/lib/services/task-service";

type FieldDraftAction = (
  state: typeof EMPTY_TASK_FIELD_DRAFT_STATE,
  formData: FormData,
) => Promise<typeof EMPTY_TASK_FIELD_DRAFT_STATE>;

type TaskDrawerDetailFormProps = {
  task: TaskDrawerDetail;
  action: FieldDraftAction;
  /** Called with true while a title or description draft differs from the saved row. */
  onDirtyChange?: (dirty: boolean) => void;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").trim();
}

function fieldFormData(taskId: string, field: string, value: string) {
  const formData = new FormData();
  formData.set("taskId", taskId);
  formData.set("field", field);
  formData.set("value", value);
  return formData;
}

/**
 * Title and description editors for the task drawer.
 *
 * Drafts are `null` until the user types, so a server refresh (including the
 * realtime refresh mounted by the page) updates the shown value while an active
 * draft is left untouched. Both save through the canonical single-field patch,
 * which reads the current row server-side instead of trusting hidden fields.
 */
export function TaskDrawerDetailForm({
  task,
  action,
  onDirtyChange,
}: TaskDrawerDetailFormProps) {
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<"title" | "description" | null>(null);
  const [, startTransition] = useTransition();
  const titleSubmittingRef = useRef(false);
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();

  const title = titleDraft ?? task.title;
  const description = descriptionDraft ?? task.description ?? "";
  const titleIsEmpty = normalize(title) === "";
  const titleChanged = normalize(title) !== normalize(task.title);
  const descriptionChanged = normalize(description) !== normalize(task.description);

  function reportDirty(next: { title: boolean; description: boolean }) {
    onDirtyChange?.(next.title || next.description);
  }

  async function saveTitle() {
    if (titleSubmittingRef.current || !titleChanged || titleIsEmpty) return;
    titleSubmittingRef.current = true;
    setPendingField("title");
    setTitleError(null);
    try {
      const result = await action(
        EMPTY_TASK_FIELD_DRAFT_STATE,
        fieldFormData(task.id, "title", title),
      );
      if (result.errorMessage) {
        setTitleError(result.errorMessage);
        return;
      }
      setTitleDraft(null);
      reportDirty({ title: false, description: descriptionChanged });
      startTransition(() => router.refresh());
    } finally {
      titleSubmittingRef.current = false;
      setPendingField(null);
    }
  }

  async function saveDescription() {
    if (!descriptionChanged) return;
    setPendingField("description");
    setDescriptionError(null);
    try {
      const result = await action(
        EMPTY_TASK_FIELD_DRAFT_STATE,
        fieldFormData(task.id, "description", description),
      );
      if (result.errorMessage) {
        setDescriptionError(result.errorMessage);
        return;
      }
      setDescriptionDraft(null);
      reportDirty({ title: titleChanged, description: false });
      startTransition(() => router.refresh());
    } finally {
      setPendingField(null);
    }
  }

  function updateTitle(next: string) {
    setTitleDraft(next);
    setTitleError(null);
    reportDirty({ title: normalize(next) !== normalize(task.title), description: descriptionChanged });
  }

  function updateDescription(next: string) {
    setDescriptionDraft(next);
    setDescriptionError(null);
    reportDirty({ title: titleChanged, description: normalize(next) !== normalize(task.description) });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void saveTitle();
        }}
      >
        <label
          htmlFor={titleId}
          className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]"
        >
          Title
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(event) => updateTitle(event.target.value)}
          onBlur={() => {
            if (titleChanged && !titleIsEmpty) void saveTitle();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveTitle();
            }
            if (event.key === "Escape") {
              setTitleDraft(null);
              setTitleError(null);
              reportDirty({ title: false, description: descriptionChanged });
            }
          }}
          aria-invalid={titleIsEmpty || Boolean(titleError)}
          aria-describedby={titleError ? `${titleId}-error` : undefined}
          maxLength={256}
          className="input-instrument min-h-9 w-full px-2 py-1 text-sm"
        />
        {titleIsEmpty ? (
          <p className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]">
            A title is required.
          </p>
        ) : null}
        {titleError ? (
          <p
            id={`${titleId}-error`}
            role="alert"
            className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
          >
            {titleError}
          </p>
        ) : null}
        {titleChanged && !titleIsEmpty ? (
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={pendingField === "title"}
            >
              {pendingField === "title" ? "Saving…" : "Save title"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setTitleDraft(null);
                setTitleError(null);
                reportDirty({ title: false, description: descriptionChanged });
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </form>

      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDescription();
        }}
      >
        <label
          htmlFor={descriptionId}
          className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]"
        >
          Description
        </label>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => updateDescription(event.target.value)}
          rows={6}
          placeholder="Add context, links or acceptance notes. Plain text only."
          aria-describedby={descriptionError ? `${descriptionId}-error` : undefined}
          className="input-instrument min-h-32 w-full resize-y px-2 py-2 text-sm normal-case tracking-normal"
        />
        {descriptionError ? (
          <p
            id={`${descriptionId}-error`}
            role="alert"
            className="text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
          >
            {descriptionError}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!descriptionChanged || pendingField === "description"}
          >
            {pendingField === "description" ? "Saving…" : "Save description"}
          </Button>
          {descriptionChanged ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDescriptionDraft(null);
                setDescriptionError(null);
                reportDirty({ title: titleChanged, description: false });
              }}
            >
              Cancel
            </Button>
          ) : (
            <span className="text-[length:var(--text-meta)] text-[color:var(--ega-text-tertiary)]">
              Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
