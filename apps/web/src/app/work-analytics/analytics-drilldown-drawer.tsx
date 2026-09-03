"use client";

import { useState, useRef, useEffect } from "react";
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
import type { DrilldownSessionDTO } from "@/lib/services/work-analytics-service";

const DISPLAY_CAP = 50;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
    (sum, s) => sum + s.durationSeconds,
    0,
  );
  return `${count} session${count !== 1 ? "s" : ""} · ${formatDurationLabel(totalSeconds)} total`;
}

type SessionRowProps = {
  session: DrilldownSessionDTO;
};

function SessionRow({ session }: SessionRowProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 transition-colors hover:bg-[var(--accent-subtle)]">
      <div className="mb-2">
        <Link
          href={`/tasks/${session.taskId}`}
          className="font-medium text-[color:var(--foreground)] hover:text-[var(--signal-live)] hover:underline"
        >
          {session.taskTitle}
        </Link>
      </div>

      <div className="mb-2 space-y-1 text-sm text-[color:var(--muted-foreground)]">
        <div className="flex items-center gap-2">
          <span className="font-medium">Start:</span>
          <span>{formatTimestamp(session.startedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">End:</span>
          <span>
            {session.endedAt
              ? formatTimestamp(session.endedAt)
              : "Still running"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-medium">Duration:</span>
          <span>{formatDurationLabel(session.durationSeconds)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
        {session.projectName && (
          <Link
            href={`/tasks/projects/${session.projectId}`}
            className="hover:text-[var(--signal-live)] hover:underline"
          >
            📁 {session.projectName}
          </Link>
        )}
        {session.goalTitle && (
          <Link
            href={`/tasks/goals/${session.goalId}`}
            className="hover:text-[var(--signal-live)] hover:underline"
          >
            🎯 {session.goalTitle}
          </Link>
        )}
        <Link
          href={`/tasks/${session.taskId}`}
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
  const [showAll, setShowAll] = useState(false);
  const prevKeyRef = useRef<string | null>(null);

  // Reset showAll when drilldown changes to a different bucket
  const currentKey = drilldown
    ? `${drilldown.type}-${drilldown.label}`
    : null;

  useEffect(() => {
    if (currentKey !== prevKeyRef.current) {
      prevKeyRef.current = currentKey;
      setShowAll(false);
    }
  }, [currentKey]);

  if (!drilldown) {
    return null;
  }

  const totalCount = drilldown.sessions.length;
  const visibleSessions = showAll
    ? drilldown.sessions
    : drilldown.sessions.slice(0, DISPLAY_CAP);
  const hiddenCount = totalCount - DISPLAY_CAP;

  return (
    <Sheet open={!!drilldown} onOpenChange={(open) => !open && closeDrilldown()}>
      <SheetContent aria-labelledby="analytics-drilldown-title" className={className}>
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-[var(--border)] px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle id="analytics-drilldown-title">{drawerTitle(drilldown)}</SheetTitle>
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
            {visibleSessions.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {visibleSessions.map((session, idx) => (
                  <SessionRow
                    key={`${session.taskId}-${session.startedAt}-${idx}`}
                    session={session}
                  />
                ))}
                {!showAll && hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="w-full rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-muted)] py-3 text-center text-sm font-medium text-[color:var(--muted-foreground)] hover:bg-[var(--accent-subtle)] hover:text-[color:var(--foreground)] transition-colors"
                  >
                    Show {hiddenCount} more
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
