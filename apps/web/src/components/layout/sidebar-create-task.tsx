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
      className="workspace-create-task-trigger mx-2.5 h-auto w-[calc(100%-1.25rem)] items-center justify-start gap-2.5 px-3 py-2.5 text-left"
      aria-label="Create task"
      title="Create task"
      data-testid="sidebar-create-task"
      onClick={openCreateTask}
    >
      <span className="workspace-create-task-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/25">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="workspace-create-task-copy min-w-0">
        <span className="block text-sm font-semibold leading-5 tracking-normal">Create task</span>
        <span className="mt-0.5 block text-xs font-semibold leading-4 opacity-70">
          Structured task in the current workspace.
        </span>
      </span>
    </Button>
  );
}
