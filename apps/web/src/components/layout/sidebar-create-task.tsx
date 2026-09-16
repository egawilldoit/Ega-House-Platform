"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";
import { useWorkspaceDrawer } from "./workspace-drawer-context";

/**
 * Direct "Create task" entry point for the workspace navigation.
 *
 * It dispatches the canonical `QUICK_TASK_EVENT` so the single `QuickTaskSheet`
 * the shell owns opens. It must never mount a second task form or own
 * task-creation state; Capture (raw Inbox input) stays a separate action.
 *
 * Inside the mobile drawer it closes the drawer first so the drawer and the
 * global sheet are never both modal at once.
 */
export function SidebarCreateTaskButton() {
  const drawer = useWorkspaceDrawer();

  function openCreateTask() {
    drawer?.closeDrawer({ restoreFocus: false });
    window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT));
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="workspace-create-task-trigger mx-2.5 h-auto min-h-12 w-[calc(100%-1.25rem)] items-center justify-start gap-3 px-3 py-2.5 text-left"
      aria-label="Create task"
      title="Create task"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+Shift+N Meta+Shift+N"
      data-testid="sidebar-create-task"
      onClick={openCreateTask}
    >
      <span className="workspace-create-task-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-md border">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="workspace-create-task-copy flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-5 tracking-normal">Create task</span>
          <span className="mt-0.5 block text-xs leading-4 text-[var(--workspace-muted)]">
            Single or batch
          </span>
        </span>
        <kbd className="workspace-create-task-shortcut shrink-0" aria-hidden="true">
          Ctrl/⌘ ⇧ N
        </kbd>
      </span>
    </Button>
  );
}
