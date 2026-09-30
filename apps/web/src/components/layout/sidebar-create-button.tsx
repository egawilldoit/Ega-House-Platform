"use client";

import { Plus } from "lucide-react";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";
import { useWorkspaceDrawer } from "./workspace-drawer-context";

/**
 * Unified canonical "+ Create" entry point for workspace navigation.
 *
 * It dispatches the canonical QUICK_TASK_EVENT so the shell's UnifiedCreateSheet
 * opens (preselected to Task mode). Inside the sheet, users can toggle
 * between Task and Backlog with text preserved.
 *
 * Inside the mobile drawer it closes the drawer first so the drawer and the
 * global creation sheet are never both modal at once.
 */
export function SidebarCreateButton() {
  const drawer = useWorkspaceDrawer();

  function openCreate() {
    drawer?.closeDrawer({ restoreFocus: false });
    window.dispatchEvent(new CustomEvent(QUICK_TASK_EVENT));
  }

  return (
    <button
      type="button"
      className="workspace-create-task-trigger"
      aria-label="Create"
      title="Create"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+Shift+N Meta+Shift+N"
      data-testid="sidebar-create-button"
      data-sidebar-create="true"
      onClick={openCreate}
    >
      <Plus aria-hidden="true" />
      <span className="workspace-nav-label">Create</span>
      <kbd className="ml-auto shrink-0 text-[10px] font-medium text-white/60" aria-hidden="true">
        ⇧⌘N
      </kbd>
    </button>
  );
}

export const SidebarCreateTaskButton = SidebarCreateButton;
