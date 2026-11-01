"use client";

import Link from "next/link";
import { Plus, Timer } from "lucide-react";

import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

/**
 * Simplified Home Quick Actions:
 * - "+ Create" opens the unified creation sheet (preselected to Task)
 * - "Timer" links to the timer view
 */
export function HomeQuickActions() {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Quick actions">
      <button
        type="button"
        className="btn-instrument btn-instrument-primary flex h-10 items-center gap-2 px-4 text-sm font-medium"
        data-testid="home-create-task"
        onClick={() => window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create
        <kbd className="ml-2 font-sans text-[length:var(--text-micro)] font-medium opacity-60">
          ⌘⇧N
        </kbd>
      </button>

      <Link
        href="/timer"
        className="btn-instrument btn-instrument-muted flex h-10 items-center gap-2 px-4 text-sm"
        data-testid="home-start-timer"
      >
        <Timer className="h-4 w-4" aria-hidden="true" />
        Timer
        <kbd className="ml-2 font-sans text-[length:var(--text-micro)] font-medium text-[color:var(--ega-text-tertiary)]">
          ⌘⇧T
        </kbd>
      </Link>
    </div>
  );
}
