"use client";

import Link from "next/link";
import { Inbox, Plus, Timer } from "lucide-react";

import { INBOX_CAPTURE_EVENT, QUICK_TASK_EVENT } from "@/lib/workspace-events";

/**
 * Reuses the shell's canonical quick flows: the mounted QuickTaskSheet and
 * InboxQuickCapture listen for these events. Nothing new is created here.
 */
export function HomeQuickActions() {
  return (
    <div className="home-quick-actions flex flex-wrap items-center gap-2" aria-label="Quick actions">
      <button
        type="button"
        className="btn-instrument btn-instrument-muted flex h-9 items-center gap-2 px-3 text-sm"
        data-testid="home-create-task"
        onClick={() => window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create task
      </button>

      <button
        type="button"
        className="btn-instrument btn-instrument-muted flex h-9 items-center gap-2 px-3 text-sm"
        data-testid="home-capture"
        onClick={() => window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT))}
      >
        <Inbox className="h-4 w-4" aria-hidden="true" />
        Capture
      </button>

      <Link
        href="/timer"
        className="btn-instrument flex h-9 items-center gap-2 px-3 text-sm"
        data-testid="home-start-timer"
      >
        <Timer className="h-4 w-4" aria-hidden="true" />
        Start timer
      </Link>
    </div>
  );
}
