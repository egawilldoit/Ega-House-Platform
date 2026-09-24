"use client";

import { Plus } from "lucide-react";

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
    <button
      type="button"
      className="workspace-create-task-trigger"
      aria-label="Create task"
      title="Create task"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+Shift+N Meta+Shift+N"
      data-testid="sidebar-create-task"
      onClick={openCreateTask}
    >
      <Plus aria-hidden="true" />
      <span className="workspace-nav-label">Create task</span>
      <kbd className="ml-auto shrink-0 text-[10px] font-medium text-white/60" aria-hidden="true">
        ⇧⌘N
      </kbd>
    </button>
  );
}
