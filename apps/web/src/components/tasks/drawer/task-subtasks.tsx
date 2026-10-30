"use client";

import { useState } from "react";

import type { SubtaskDto } from "@ega/contracts";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { getSubtaskProgress } from "@ega/domain";

type SubtaskAction = (formData: FormData) => void | Promise<void>;

type TaskSubtasksProps = {
  taskId: string;
  returnTo: string;
  subtasks: SubtaskDto[];
  actions: {
    addAction: SubtaskAction;
    toggleAction: SubtaskAction;
    renameAction: SubtaskAction;
    deleteAction: SubtaskAction;
    moveAction: SubtaskAction;
    promoteAction: SubtaskAction;
  };
};

/**
 * Checklist inside the task drawer.
 *
 * Items are not tasks: no timer/reminder/recurrence fields exist here, and
 * completing every item never completes the parent. Ordering ships as explicit
 * Move up/down controls (a non-drag path), with dense positions maintained by
 * the service; drag can reuse the same ordering service later.
 */
export function TaskSubtasks({ taskId, returnTo, subtasks, actions }: TaskSubtasksProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const progress = getSubtaskProgress(subtasks);

  return (
    <section className="mt-5 border-t border-[var(--ega-divider)] pt-4" aria-label="Subtasks">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[length:var(--text-meta)] font-semibold uppercase tracking-[0.08em] text-[color:var(--ega-text-secondary)]">
          Subtasks
        </h3>
        <span
          className="text-[length:var(--text-meta)] tabular-nums text-[color:var(--ega-text-tertiary)]"
          aria-label={`${progress.done} of ${progress.total} subtasks done`}
        >
          ☑ {progress.label}
        </span>
      </div>

      {progress.total > 0 ? (
        <ProgressBar
          value={progress.done}
          max={progress.total}
          label={`Subtask progress ${progress.label}`}
          className="mt-2"
        />
      ) : null}

      {progress.total === 0 ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          No subtasks yet. Add the first checklist item below.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {subtasks.map((subtask, index) => (
            <li key={subtask.id} className="flex items-start gap-2 text-sm">
              <form action={actions.toggleAction} className="pt-0.5">
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="subtaskId" value={subtask.id} />
                <input type="hidden" name="done" value={subtask.done ? "false" : "true"} />
                <button
                  type="submit"
                  aria-label={subtask.done ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
                  aria-pressed={subtask.done}
                  className="flex h-4 w-4 items-center justify-center rounded-[var(--radius-xs)] border border-[var(--ega-border-strong)] text-[10px] leading-none"
                >
                  {subtask.done ? "✓" : ""}
                </button>
              </form>

              <div className="min-w-0 flex-1">
                {renamingId === subtask.id ? (
                  <form action={actions.renameAction} className="flex items-center gap-1">
                    <input type="hidden" name="taskId" value={taskId} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="subtaskId" value={subtask.id} />
                    <input
                      name="title"
                      defaultValue={subtask.title}
                      autoFocus
                      maxLength={256}
                      aria-label={`Rename ${subtask.title}`}
                      className="input-instrument h-7 w-full px-2 text-xs"
                    />
                    <PendingSubmitButton type="submit" size="sm" variant="secondary" pendingLabel="Saving…">
                      Save
                    </PendingSubmitButton>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRenamingId(subtask.id)}
                    className={`text-left ${subtask.done ? "text-[color:var(--ega-text-tertiary)] line-through" : "text-[color:var(--ega-text)]"} hover:underline`}
                  >
                    {subtask.title}
                  </button>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <form action={actions.moveAction}>
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="subtaskId" value={subtask.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    type="submit"
                    disabled={index === 0}
                    aria-label={`Move ${subtask.title} up`}
                    className="px-1 text-[length:var(--text-meta)] disabled:opacity-40"
                  >
                    ↑
                  </button>
                </form>
                <form action={actions.moveAction}>
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="subtaskId" value={subtask.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    disabled={index === subtasks.length - 1}
                    aria-label={`Move ${subtask.title} down`}
                    className="px-1 text-[length:var(--text-meta)] disabled:opacity-40"
                  >
                    ↓
                  </button>
                </form>
                <form action={actions.promoteAction}>
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="subtaskId" value={subtask.id} />
                  <button
                    type="submit"
                    aria-label={`Promote ${subtask.title} to a task`}
                    className="px-1 text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]"
                  >
                    ↗
                  </button>
                </form>
                <form action={actions.deleteAction}>
                  <input type="hidden" name="taskId" value={taskId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="subtaskId" value={subtask.id} />
                  <button
                    type="submit"
                    aria-label={`Delete ${subtask.title}`}
                    className="px-1 text-[length:var(--text-meta)] text-[color:var(--status-overdue)]"
                  >
                    ×
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={actions.addAction} className="mt-3 flex items-center gap-1">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input
          name="title"
          required
          maxLength={256}
          placeholder="Add a subtask and press Enter"
          aria-label="New subtask title"
          className="input-instrument h-8 w-full px-2 text-sm"
        />
        <PendingSubmitButton type="submit" size="sm" variant="secondary" pendingLabel="Adding…">
          Add
        </PendingSubmitButton>
      </form>
    </section>
  );
}
