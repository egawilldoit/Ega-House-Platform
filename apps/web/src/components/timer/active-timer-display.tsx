import Link from "next/link";

import { LiveDuration } from "@/components/timer/live-duration";
import { TimerStopForm } from "@/components/timer/timer-stop-form";
import { Badge } from "@/components/ui/badge";
import { formatDisplayDateTime, formatDisplayDuration } from "@/lib/presentation-format";
import { formatTaskToken, getTaskStatusTone } from "@/lib/task-domain";
import type { Tables } from "@/lib/supabase/database.types";

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

/**
 * The active session, dominant on the Timer surface.
 *
 * Elapsed time stays in the isolated `LiveDuration` leaf so the one-second tick
 * never re-renders this tree.
 */
export function ActiveTimerDisplay({
  session,
  taskContextHref,
  hasSessionConflict = false,
  totalTrackedDurationSeconds,
}: ActiveTimerDisplayProps) {
  return (
    <div className="active-timer-card flex flex-col gap-5" data-testid="active-timer-display">
      <div className="active-timer-display-grid">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="active">Running now</Badge>
            <Badge tone={getTaskStatusTone(session.tasks?.status ?? "todo")}>
              {formatTaskToken(session.tasks?.status ?? "todo")}
            </Badge>
            <Badge tone="muted">{formatTaskToken(session.tasks?.priority ?? "medium")}</Badge>
          </div>

          <div>
            <p className="text-[length:var(--text-section)] font-semibold tracking-[var(--tracking-tight)] text-[color:var(--ega-text)]">
              {session.tasks?.title ?? "Untitled task"}
            </p>
            <p className="mt-1 text-[length:var(--text-meta-lg)] text-[color:var(--ega-text-secondary)]">
              {session.tasks?.projects?.name ?? "Unknown project"}
              {session.tasks?.goals?.title ? ` · ${session.tasks.goals.title}` : ""}
            </p>
          </div>

          {session.tasks?.description ? (
            <p className="max-w-[70ch] text-[length:var(--text-body)] leading-[var(--leading-relaxed)] text-[color:var(--ega-text-secondary)]">
              {session.tasks.description}
            </p>
          ) : null}

          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                Started
              </dt>
              <dd className="tabular-nums text-[length:var(--text-body)] font-medium">
                {formatDisplayDateTime(session.started_at)}
              </dd>
            </div>
            {typeof totalTrackedDurationSeconds === "number" ? (
              <div>
                <dt className="text-[length:var(--text-meta)] text-[color:var(--ega-text-secondary)]">
                  Tracked total
                </dt>
                <dd className="tabular-nums text-[length:var(--text-body)] font-medium">
                  {formatDisplayDuration(totalTrackedDurationSeconds)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <LiveDuration startedAt={session.started_at} label="Elapsed" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ega-divider)] pt-4">
        <TimerStopForm
          sessionId={session.id}
          returnTo="/timer"
          disabled={hasSessionConflict}
          size="lg"
        >
          Stop session
        </TimerStopForm>
        {taskContextHref ? (
          <Link
            href={taskContextHref}
            className="btn-instrument btn-instrument-muted flex h-9 items-center px-3.5 text-sm"
          >
            Open task
          </Link>
        ) : null}
      </div>
    </div>
  );
}
