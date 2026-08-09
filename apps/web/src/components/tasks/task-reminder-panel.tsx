import React from "react";
import { CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TaskReminderRecord } from "@/lib/services/task-service";

type TaskReminderPanelProps = {
  taskId: string;
  reminders: TaskReminderRecord[];
  returnTo: string;
  createAction: (formData: FormData) => void | Promise<void>;
  cancelAction: (formData: FormData) => void | Promise<void>;
  compact?: boolean;
};

function formatReminderDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function TaskReminderPanel({
  taskId,
  reminders,
  returnTo,
  createAction,
  cancelAction,
  compact = false,
}: TaskReminderPanelProps) {
  const pendingReminders = reminders
    .filter((reminder) => reminder.status === "pending")
    .sort((first, second) => first.remind_at.localeCompare(second.remind_at));
  const currentPendingReminder = pendingReminders[0] ?? null;
  const latestCancelledReminder =
    reminders.find((reminder) => reminder.status === "cancelled") ?? null;

  return (
    <section className="ega-glass-soft rounded-[1rem] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="ega-glass-pill flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--signal-live)]">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="glass-label text-etch">Email reminder</p>
            <p className="truncate text-sm font-medium text-[color:var(--foreground)]">
              {currentPendingReminder
                ? formatReminderDateTime(currentPendingReminder.remind_at)
                : "No pending reminder"}
            </p>
          </div>
        </div>
        {currentPendingReminder ? <Badge tone="info">Pending</Badge> : null}
      </div>

      {latestCancelledReminder ? (
        <p className="mt-2 text-xs leading-5 text-[color:var(--muted-foreground)]">
          Last cancelled {formatReminderDateTime(latestCancelledReminder.updated_at)}
        </p>
      ) : null}

      <div className={compact ? "mt-3 space-y-2" : "mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"}>
        <form action={createAction} className="flex min-w-0 flex-wrap items-end gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="channel" value="email" />
          <input type="hidden" name="status" value="pending" />
          <label className="min-w-48 flex-1 space-y-1">
            <span className="glass-label text-etch">Send at</span>
            <input
              name="remindAt"
              type="datetime-local"
              required
              className="ega-glass-input min-h-10 w-full rounded-xl border px-3 py-0 text-sm text-[color:var(--foreground)] ring-offset-background focus:outline-none focus:ring-2 focus:ring-[rgba(23,123,82,0.22)]"
            />
          </label>
          <Button type="submit" size="sm" variant="muted">
            Create
          </Button>
        </form>

        {currentPendingReminder ? (
          <form action={cancelAction} className={compact ? "" : "self-end"}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="reminderId" value={currentPendingReminder.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="status" value="cancelled" />
            <Button type="submit" size="sm" variant="danger" className="w-full justify-center">
              Cancel
            </Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
