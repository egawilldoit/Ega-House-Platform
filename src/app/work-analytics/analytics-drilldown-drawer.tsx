"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { useAnalyticsDrilldown, type DrilldownData } from "./analytics-drilldown-context";
import { formatDurationLabel } from "@/lib/task-session";
import Link from "next/link";
import type { ExecutionEvidenceSessionRow } from "@/lib/services/execution-evidence-service";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function computeDurationSeconds(session: ExecutionEvidenceSessionRow): number {
  const start = new Date(session.started_at).getTime();
  const end = session.ended_at
    ? new Date(session.ended_at).getTime()
    : Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}

function getTaskTitle(session: ExecutionEvidenceSessionRow): string {
  return session.tasks?.title ?? "Untitled task";
}

function getTaskId(session: ExecutionEvidenceSessionRow): string {
  return session.tasks?.id ?? session.task_id;
}

function getProjectName(session: ExecutionEvidenceSessionRow): string | null {
  return session.tasks?.projects?.name ?? null;
}

function getGoalTitle(session: ExecutionEvidenceSessionRow): string | null {
  return session.tasks?.goals?.title ?? null;
}

function getProjectId(session: ExecutionEvidenceSessionRow): string | null {
  return session.tasks?.projects?.id ?? session.tasks?.project_id ?? null;
}

function getGoalId(session: ExecutionEvidenceSessionRow): string | null {
  return session.tasks?.goals?.id ?? null;
}

function drawerTitle(data: DrilldownData): string {
  switch (data.type) {
    case "date":
      return `Sessions on ${data.label}`;
    case "project":
      return `Sessions for project: ${data.label}`;
    case "goal":
      return `Sessions for goal: ${data.label}`;
    case "task":
      return `Sessions for task: ${data.label}`;
    default:
      return "Session details";
  }
}

function drawerDescription(data: DrilldownData): string {
  const count = data.sessions.length;
  const totalSeconds = data.sessions.reduce(
    (sum, s) => sum + computeDurationSeconds(s),
    0,
  );
  return `${count} session${count !== 1 ? "s" : ""} · ${formatDurationLabel(totalSeconds)} total`;
}

type SessionRowProps = {
  session: ExecutionEvidenceSessionRow;
};

function SessionRow({ session }: SessionRowProps) {
  const taskTitle = getTaskTitle(session);
  const taskId = getTaskId(session);
  const projectName = getProjectName(session);
  const goalTitle = getGoalTitle(session);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 transition-colors hover:bg-[var(--accent-subtle)]">
      <div className="mb-2">
        <Link
          href={`/tasks/${taskId}`}
          className="font-medium text-[color:var(--foreground)] hover:text-[var(--signal-live)] hover:underline"
        >
          {taskTitle}
        </Link>
      </div>

      <div className="mb-2 space-y-1 text-sm text-[color:var(--muted-foreground)]">
        <div className="flex items-center gap-2">
          <span className="font-medium">Start:</span>
          <span>{formatTimestamp(session.started_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">End:</span>
          <span>
            {session.ended_at
              ? formatTimestamp(session.ended_at)
              : "Still running"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">Duration:</span>
          <span>{formatDurationLabel(computeDurationSeconds(session))}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
        {projectName && (
          <Link
            href={`/tasks/projects/${getProjectId(session)}`}
            className="hover:text-[var(--signal-live)] hover:underline"
          >
            📁 {projectName}
          </Link>
        )}
        {goalTitle && (
          <Link
            href={`/tasks/goals/${getGoalId(session)}`}
            className="hover:text-[var(--signal-live)] hover:underline"
          >
            🎯 {goalTitle}
          </Link>
        )}
        <Link
          href={`/tasks/${taskId}`}
          className="hover:text-[var(--signal-live)] hover:underline"
        >
          🔗 View task
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-muted)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
      No sessions found for this selection.
    </div>
  );
}

type AnalyticsDrilldownDrawerProps = {
  /** Optional className for the sheet content */
  className?: string;
};

export function AnalyticsDrilldownDrawer({
  className,
}: AnalyticsDrilldownDrawerProps) {
  const { drilldown, closeDrilldown } = useAnalyticsDrilldown();

  if (!drilldown) {
    return null;
  }

  return (
    <Sheet open={!!drilldown} onOpenChange={(open) => !open && closeDrilldown()}>
      <SheetContent className={className}>
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[var(--border)] px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle>{drawerTitle(drilldown)}</SheetTitle>
                <SheetDescription className="mt-1">
                  {drawerDescription(drilldown)}
                </SheetDescription>
              </div>
              <SheetClose>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[color:var(--muted-foreground)] hover:bg-[var(--accent-subtle)] hover:text-[color:var(--foreground)]"
                  aria-label="Close drilldown"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </SheetClose>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {drilldown.sessions.length === 0 ? (
              <EmptyState />
            ) : (
              drilldown.sessions.map((session, idx) => (
                <SessionRow
                  key={`${session.task_id}-${session.started_at}-${idx}`}
                  session={session}
                />
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
