"use client";

import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  formatTaskToken,
} from "@/lib/task-domain";

type InlineTaskUpdateFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  taskId: string;
  taskTitle: string;
  returnTo: string;
  defaultStatus: string;
  defaultPriority: string;
  defaultDueDate: string | null;
  defaultEstimateMinutes: number | null;
  defaultBlockedReason: string | null;
  error?: string | null;
  overflowActions?: ReactNode;
};

export function InlineTaskUpdateForm({
  action,
  deleteAction,
  taskId,
  taskTitle,
  returnTo,
  defaultStatus,
  defaultPriority,
  defaultDueDate,
  defaultEstimateMinutes,
  defaultBlockedReason,
  error,
  overflowActions,
}: InlineTaskUpdateFormProps) {
  const [selectedStatus, setSelectedStatus] = useState(defaultStatus);
  const updateFormId = `task-update-${taskId}`;

  useEffect(() => {
    setSelectedStatus(defaultStatus);
  }, [defaultStatus]);

  return (
    <div className="space-y-3">
      <form id={updateFormId} action={action} className="space-y-3">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="returnTo" value={returnTo} />

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white/80 p-2.5">
          <label className="space-y-2">
            <span className="glass-label text-etch">
              Status
            </span>
            <select
              name="status"
              defaultValue={defaultStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              className="input-instrument min-h-9 min-w-28 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
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
              className="min-h-9 min-w-36 px-3 py-0 text-sm"
            />
          </label>

          <label className="space-y-2">
            <span className="glass-label text-etch">
              Priority
            </span>
            <select
              name="priority"
              defaultValue={defaultPriority}
              className="input-instrument min-h-9 min-w-24 px-3 py-0 text-[10px] uppercase tracking-[0.14em]"
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
              className="min-h-9 min-w-28 px-3 py-0 text-sm"
            />
          </label>

          {selectedStatus === "blocked" ? (
            <label className="w-full space-y-2">
              <span className="glass-label text-etch">
                Blocked reason
              </span>
              <Textarea
                name="blockedReason"
                defaultValue={defaultBlockedReason ?? ""}
                placeholder="What is currently blocking this task?"
                className="min-h-20 w-full"
              />
            </label>
          ) : null}

        </div>
      </form>

      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        {defaultStatus !== "done" ? (
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
            <Button size="sm" type="submit" variant="muted">
              Mark done
            </Button>
          </form>
        ) : null}

        <Button size="sm" type="submit" form={updateFormId}>
          Save
        </Button>

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
