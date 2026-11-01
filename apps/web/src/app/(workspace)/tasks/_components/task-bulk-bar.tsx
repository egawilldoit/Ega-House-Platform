"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { useUndoToast } from "@/components/ui/use-undo-toast";
import type { BulkTaskResult } from "@/lib/services/task-bulk-service";
import { TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, formatTaskToken } from "@/lib/task-domain";

export type TaskBulkActions = {
  bulkFieldAction: (input: {
    taskIds: string[];
    field: string;
    value: string;
    returnTo?: string;
  }) => Promise<BulkTaskResult>;
  bulkArchiveAction: (input: {
    taskIds: string[];
    archived: boolean;
    returnTo?: string;
  }) => Promise<BulkTaskResult>;
  undoAction: (operationId: string) => Promise<"success" | "conflict" | "failure">;
};

type TaskBulkBarProps = {
  selectedIds: string[];
  returnTo: string;
  projectOptions: Array<{ id: string; name: string }>;
  anyArchived: boolean;
  actions: TaskBulkActions;
  onClear: () => void;
};

function summarize(result: BulkTaskResult) {
  const failed = result.results.filter((entry) => entry.outcome !== "applied").length;
  const base =
    result.applied === 1 ? "1 task updated." : `${result.applied} tasks updated.`;
  return failed > 0 ? `${base} ${failed} could not be updated.` : base;
}

/**
 * Bulk toolbar for the explicit, visible selection.
 *
 * Every operation reports per-item outcomes; a partial success is never shown as
 * a whole-batch success. Undo is offered only when the server wrote receipts for
 * every applied item, and the toast reports the server's real undo outcome.
 */
export function TaskBulkBar({
  selectedIds,
  returnTo,
  projectOptions,
  anyArchived,
  actions,
  onClear,
}: TaskBulkBarProps) {
  const router = useRouter();
  const { showUndo } = useUndoToast();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState("in_progress");
  const [priority, setPriority] = useState("medium");
  const [projectId, setProjectId] = useState(projectOptions[0]?.id ?? "");

  const run = (operation: () => Promise<BulkTaskResult>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await operation();
      setMessage(result.errorMessage ?? summarize(result));
      if (result.applied > 0) {
        router.refresh();
        if (result.undoable && result.operationId) {
          const operationId = result.operationId;
          showUndo({
            message: summarize(result),
            undo: () => actions.undoAction(operationId),
          });
        }
      }
    });
  };

  const disabled = isPending || selectedIds.length === 0;

  return (
    <div
      role="region"
      aria-label="Bulk task actions"
      className="flex flex-wrap items-center gap-2 border-b border-[var(--ega-divider)] bg-[var(--ega-surface-subtle)] px-[18px] py-2"
    >
      <span role="status" className="text-[length:var(--text-meta)] font-medium text-[color:var(--ega-text)]">
        {selectedIds.length} selected
      </span>

      <label className="flex items-center gap-1 text-[length:var(--text-meta)]">
        <span className="sr-only">Set status for selected tasks</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="input-instrument h-7 px-1 text-[length:var(--text-meta)]"
          aria-label="Status to apply"
        >
          {TASK_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {formatTaskToken(value)}
            </option>
          ))}
        </select>
        <PendingSubmitButton
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          pendingLabel="Applying..."
          onClick={() => run(() => actions.bulkFieldAction({ taskIds: selectedIds, field: "status", value: status, returnTo }))}
        >
          Set status
        </PendingSubmitButton>
      </label>

      <label className="flex items-center gap-1 text-[length:var(--text-meta)]">
        <span className="sr-only">Set priority for selected tasks</span>
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="input-instrument h-7 px-1 text-[length:var(--text-meta)]"
          aria-label="Priority to apply"
        >
          {TASK_PRIORITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {formatTaskToken(value)}
            </option>
          ))}
        </select>
        <PendingSubmitButton
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled}
          pendingLabel="Applying..."
          onClick={() =>
            run(() => actions.bulkFieldAction({ taskIds: selectedIds, field: "priority", value: priority, returnTo }))
          }
        >
          Set priority
        </PendingSubmitButton>
      </label>

      {projectOptions.length > 0 ? (
        <label className="flex items-center gap-1 text-[length:var(--text-meta)]">
          <span className="sr-only">Move selected tasks to project</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="input-instrument h-7 max-w-[12rem] px-1 text-[length:var(--text-meta)]"
            aria-label="Project to apply"
          >
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <PendingSubmitButton
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || !projectId}
            pendingLabel="Moving..."
            onClick={() =>
              run(() => actions.bulkFieldAction({ taskIds: selectedIds, field: "project", value: projectId, returnTo }))
            }
          >
            Move
          </PendingSubmitButton>
        </label>
      ) : null}

      <PendingSubmitButton
        type="button"
        size="sm"
        variant={anyArchived ? "secondary" : "danger"}
        disabled={disabled}
        pendingLabel="Applying..."
        onClick={() =>
          run(() => actions.bulkArchiveAction({ taskIds: selectedIds, archived: !anyArchived, returnTo }))
        }
      >
        {anyArchived ? "Restore" : "Archive"}
      </PendingSubmitButton>

      <button
        type="button"
        onClick={onClear}
        className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)] underline-offset-2 hover:underline"
      >
        Clear
      </button>

      {message ? (
        <span role="status" className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
          {message}
        </span>
      ) : null}
    </div>
  );
}
