"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
  isTaskCompletedStatus,
} from "@/lib/task-domain";
import {
  TASK_RECURRENCE_RULE_VALUES,
  formatTaskRecurrenceRule,
} from "@/lib/task-recurrence";

type InlineTaskUpdateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  unarchiveAction?: (formData: FormData) => void | Promise<void>;
  taskId: string;
  taskTitle: string;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  defaultBlockedReason: string | null;
  defaultRecurrenceRule?: string | null;
  archivedAt?: string | null;
  error?: string | null;
  overflowActions?: ReactNode;
};

export function InlineTaskUpdateForm({
  action,
  deleteAction,
  archiveAction,
  unarchiveAction,
  taskId,
  taskTitle,
  returnTo,
  defaultStatus,
  defaultPriority,
  defaultDueDate,
  defaultEstimateMinutes,
  defaultBlockedReason,
  defaultRecurrenceRule,
  archivedAt,
  error,
  overflowActions,
}: InlineTaskUpdateFormProps) {
  const [selectedStatus, setSelectedStatus] = useState(defaultStatus);
  const [recurrenceTimezone, setRecurrenceTimezone] = useState("UTC");
  const updateFormId = `task-update-${taskId}`;
  const isArchived = Boolean(archivedAt);
  const isCompleted = isTaskCompletedStatus(defaultStatus);

  useEffect(() => {
    setSelectedStatus(defaultStatus);
  }, [defaultStatus]);

  useEffect(() => {
    setRecurrenceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  return (
    <div className="space-y-3">
      <form id={updateFormId} action={action} className="space-y-3">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="recurrenceTimezone" value={recurrenceTimezone} />

        <div className="ega-glass-soft grid gap-3 rounded-[1rem] p-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-2">
            <span className="glass-label text-etch">
              Status
            </span>
            <select
              name="status"
              defaultValue={defaultStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="ega-glass-input min-h-10 w-full rounded-xl border px-3 text-sm text-[color:var(--foreground)] ring-offset-background focus:outline-none focus:ring-2 focus:ring-[rgba(23,123,82,0.22)]"
            >
              {TASK_STATUS_VALUES.map((statusValue) => (
                <option key={statusValue} value={statusValue}>
                  {formatTaskToken(statusValue)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="glass-label text-etch">
              Due date
            </span>
            <Input
              name="dueDate"
              type="date"
              defaultValue={defaultDueDate ?? ""}
              className="ega-glass-input min-h-10 w-full rounded-xl px-3 py-0 text-sm"
            />
          </label>

          <label className="space-y-2">
            <span className="glass-label text-etch">
              Priority
            </span>
            <select
              name="priority"
              defaultValue={defaultPriority}
              className="ega-glass-input min-h-10 w-full rounded-xl border px-3 text-sm text-[color:var(--foreground)] ring-offset-background focus:outline-none focus:ring-2 focus:ring-[rgba(23,123,82,0.22)]"
            >
              {TASK_PRIORITY_VALUES.map((priorityValue) => (
                <option key={priorityValue} value={priorityValue}>
                  {formatTaskToken(priorityValue)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="glass-label text-etch">
              Estimate
            </span>
            <Input
              name="estimateMinutes"
              type="number"
              min="0"
              step="15"
              inputMode="numeric"
              defaultValue={defaultEstimateMinutes ?? ""}
              className="ega-glass-input min-h-10 w-full rounded-xl px-3 py-0 text-sm"
            />
          </label>

          <label className="space-y-2">
            <span className="glass-label text-etch">
              Repeat
            </span>
            <select
              name="recurrenceRule"
              defaultValue={defaultRecurrenceRule ?? ""}
              className="ega-glass-input min-h-10 w-full rounded-xl border px-3 text-sm text-[color:var(--foreground)] ring-offset-background focus:outline-none focus:ring-2 focus:ring-[rgba(23,123,82,0.22)]"
            >
              <option value="">Does not repeat</option>
              {TASK_RECURRENCE_RULE_VALUES.map((rule) => (
                <option key={rule} value={rule}>
                  {formatTaskRecurrenceRule(rule)}
                </option>
              ))}
            </select>
          </label>

          {selectedStatus === "blocked" ? (
            <label className="space-y-2 sm:col-span-2 xl:col-span-5">
              <span className="glass-label text-etch">
                Blocked reason
              </span>
              <Textarea
                name="blockedReason"
                defaultValue={defaultBlockedReason ?? ""}
                placeholder="What is currently blocking this task?"
                className="ega-glass-input min-h-20 w-full rounded-xl"
              />
            </label>
          ) : null}

        </div>
      </form>

      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {!isCompleted ? (
          <form action={action}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="status" value="done" />
            <input type="hidden" name="priority" value={defaultPriority} />
            <input type="hidden" name="dueDate" value={defaultDueDate ?? ""} />
            <input
              type="hidden"
              name="estimateMinutes"
              value={defaultEstimateMinutes !== null ? String(defaultEstimateMinutes) : ""}
            />
            <input type="hidden" name="blockedReason" value="" />
            <PendingSubmitButton size="sm" type="submit" variant="muted" pendingLabel="Marking done...">
              Mark done
            </PendingSubmitButton>
          </form>
        ) : null}

        {archiveAction && !isArchived ? (
          <form action={archiveAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button size="sm" type="submit" variant="danger">
              Archive
            </Button>
          </form>
        ) : null}

        {isArchived && unarchiveAction ? (
          <form action={unarchiveAction}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button size="sm" type="submit" variant="muted">
              Restore
            </Button>
          </form>
        ) : null}

        {!isArchived ? (
          <PendingSubmitButton size="sm" type="submit" form={updateFormId} pendingLabel="Saving...">
            Save
          </PendingSubmitButton>
        ) : null}

        <details className="action-overflow">
          <summary className="btn-instrument btn-instrument-muted flex h-8 cursor-pointer items-center px-3 text-xs">
            More
          </summary>
          <div className="action-overflow-menu">
            <div className="space-y-2">
              {overflowActions}
              <form
                action={deleteAction}
                onSubmit={(event) => {
                  if (
                    !window.confirm(
                      `Delete "${taskTitle}"? This is permanent and is blocked if the task has timer history.`,
                    )
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="taskId" value={taskId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="confirmDelete" value="true" />
                <Button size="sm" type="submit" variant="danger" className="w-full justify-center">
                  Delete task
                </Button>
              </form>
            </div>
          </div>
        </details>
      </div>

      {error ? (
        <p className="feedback-block feedback-block-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
