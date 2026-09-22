"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Clock3, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnalyticsDrilldown, type DrilldownData } from "./analytics-drilldown-context";
import { formatDurationLabel } from "@/lib/task-session";
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
    <div className="rounded-[var(--radius-lg)] border border-ega-border bg-ega-surface p-3">
      <Link
        href={`/tasks#task-${session.taskId}`}
        className="text-[length:var(--text-body)] font-medium text-ega-text hover:underline"
      >
        {session.taskTitle}
      </Link>

      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[length:var(--text-meta)] text-ega-text-secondary sm:grid-cols-3">
        <div className="flex gap-1.5">
          <dt className="text-ega-text-tertiary">Start</dt>
          <dd className="tabular-nums">{formatTimestamp(session.startedAt)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ega-text-tertiary">End</dt>
          <dd className="tabular-nums">
            {session.endedAt ? formatTimestamp(session.endedAt) : "Still running"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ega-text-tertiary">Duration</dt>
          <dd className="tabular-nums">{formatDurationLabel(session.durationSeconds)}</dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[length:var(--text-meta)] text-ega-text-tertiary">
        {session.projectName ? (
          <Link
            href={`/tasks?project=${session.projectId}`}
            className="hover:text-ega-text hover:underline"
          >
            Project: {session.projectName}
          </Link>
        ) : null}
        {session.goalTitle ? (
          <Link
            href={`/tasks?goal=${session.goalId}`}
            className="hover:text-ega-text hover:underline"
          >
            Goal: {session.goalTitle}
          </Link>
        ) : null}
        <Link
          href={`/tasks#task-${session.taskId}`}
          className="hover:text-ega-text hover:underline"
        >
          View task
        </Link>
      </div>
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
      <SheetContent closeLabel="Close session details"
        aria-labelledby="analytics-drilldown-title"
        className={`bg-ega-bg! backdrop-blur-none! ${className ?? ""}`}
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-ega-divider px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SheetTitle
                  id="analytics-drilldown-title"
                  className="font-sans! text-[length:var(--text-panel-title)]! tracking-[var(--tracking-tight)]! text-ega-text!"
                >
                  {drawerTitle(drilldown)}
                </SheetTitle>
                <SheetDescription className="mt-1">{drawerDescription(drilldown)}</SheetDescription>
              </div>
              <SheetClose>
                <Button variant="ghost" size="sm" aria-label="Close drilldown">
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            {visibleSessions.length === 0 ? (
              <EmptyState
                icon={Clock3}
                title="No sessions found"
                description="No tracked sessions belong to this selection."
              />
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
                    className="w-full rounded-[var(--radius-lg)] border border-dashed border-ega-border-strong bg-ega-surface-subtle py-3 text-center text-[length:var(--text-meta-lg)] font-medium text-ega-text-secondary transition-colors hover:bg-ega-surface-hover hover:text-ega-text"
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
