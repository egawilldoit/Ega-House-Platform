"use client";

import Link from "next/link";
import { Inbox, Plus, Timer } from "lucide-react";

import { INBOX_CAPTURE_EVENT, QUICK_TASK_EVENT } from "@/lib/workspace-events";

/**
 * Reuses the shell's canonical quick flows: the single mounted QuickTaskSheet
 * and InboxQuickCapture (GlobalQuickActionControllers) listen for these
 * events. Nothing new is created here, and no duplicate sheet is mounted.
 *
 * The shortcut hints mirror the canonical bindings in
 * `components/layout/workspace-keyboard-shortcuts.tsx` /
 * `lib/keyboard-shortcuts.ts` (Ctrl/Cmd+Shift+N, +Shift+I, +Shift+T).
 */
export function HomeQuickActions() {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Quick actions">
      <button
        type="button"
        className="btn-instrument btn-instrument-muted flex h-11 items-center gap-2 px-4 text-sm"
        data-testid="home-create-task"
        onClick={() => window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create Task
        <kbd className="ml-3 font-sans text-[length:var(--text-micro)] font-medium text-[color:var(--ega-text-tertiary)]">
          ⌘⇧N
        </kbd>
      </button>

      <button
        type="button"
        className="btn-instrument btn-instrument-muted flex h-11 items-center gap-2 px-4 text-sm"
        data-testid="home-capture"
        onClick={() => window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT))}
      >
        <Inbox className="h-4 w-4" aria-hidden="true" />
        Add to Backlog
        <kbd className="ml-3 font-sans text-[length:var(--text-micro)] font-medium text-[color:var(--ega-text-tertiary)]">
          ⌘⇧I
        </kbd>
      </button>

      <Link
        href="/timer"
        className="btn-instrument btn-instrument-muted flex h-11 items-center gap-2 px-4 text-sm"
        data-testid="home-start-timer"
      >
        <Timer className="h-4 w-4" aria-hidden="true" />
        Timer
        <kbd className="ml-3 font-sans text-[length:var(--text-micro)] font-medium text-[color:var(--ega-text-tertiary)]">
          ⌘⇧T
        </kbd>
      </Link>
    </div>
  );
}
