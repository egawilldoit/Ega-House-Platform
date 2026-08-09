import Link from "next/link";

import { LiveDuration } from "@/components/timer/live-duration";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { Badge } from "@/components/ui/badge";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import { formatDurationLabel } from "@/lib/task-session";
import type { Tables } from "@/lib/supabase/database.types";
import { formatTimerDateTime } from "@/lib/timer-domain";

type ActiveTimerSession = Pick<Tables<"task_sessions">, "id" | "started_at" | "task_id"> & {
  tasks:
    | (Pick<
        Tables<"tasks">,
        "id" | "title" | "description" | "status" | "priority"
      > & {
        goals: Pick<Tables<"goals">, "title"> | null;
        projects: Pick<Tables<"projects">, "name" | "slug"> | null;
      })
    | null;
};

type ActiveTimerDisplayProps = {
  session: ActiveTimerSession;
  taskContextHref?: string | null;
  hasSessionConflict?: boolean;
  totalTrackedDurationSeconds?: number;
};

export function ActiveTimerDisplay({
  session,
  taskContextHref,
  hasSessionConflict = false,
  totalTrackedDurationSeconds,
}: ActiveTimerDisplayProps) {
  return (
    <div className="space-y-4 rounded-[1.1rem] border border-[var(--border)] bg-gradient-to-br from-[rgba(23,123,82,0.09)] via-white to-[color:var(--instrument-raised)] p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="signal-dot-live inline-flex h-2.5 w-2.5 rounded-full bg-[var(--signal-live)]" />
              <Badge tone="accent">Running now</Badge>
              <Badge tone={getTaskStatusTone(session.tasks?.status ?? "todo")}>
                {formatTaskToken(session.tasks?.status ?? "todo")}
              </Badge>
              <Badge>{formatTaskToken(session.tasks?.priority ?? "medium")}</Badge>
              {typeof totalTrackedDurationSeconds === "number" ? (
                <Badge>
                  Total tracked {formatDurationLabel(totalTrackedDurationSeconds)}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <p className="text-lg font-semibold text-[color:var(--foreground)]">
                {session.tasks?.title ?? "Untitled task"}
              </p>
              <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                {session.tasks?.projects?.name ?? "Unknown project"}
                {session.tasks?.goals?.title ? ` · ${session.tasks.goals.title}` : ""}
              </p>
            </div>
          </div>

          {session.tasks?.description ? (
            <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
              {session.tasks.description}
            </p>
          ) : (
            <p className="text-sm leading-7 text-[color:var(--muted-foreground)]">
              No additional task notes attached to this active session.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge>Started {formatTimerDateTime(session.started_at)}</Badge>
            {taskContextHref ? (
              <Link
                href={taskContextHref}
                className="btn-instrument btn-instrument-muted h-9 px-4 text-sm"
              >
                Open task in project workspace
              </Link>
            ) : null}
          </div>
        </div>

        <LiveDuration startedAt={session.started_at} />
      </div>

      <TimerStopForm
        sessionId={session.id}
        returnTo="/timer"
        disabled={hasSessionConflict}
      />
    </div>
  );
}
