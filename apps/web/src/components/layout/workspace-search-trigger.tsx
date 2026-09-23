"use client";

import { Search } from "lucide-react";

import { COMMAND_PALETTE_EVENT } from "@/lib/workspace-events";
import { useWorkspaceDrawer } from "./workspace-drawer-context";

/**
 * Sidebar search entry point.
 *
 * Dispatches the canonical CommandPalette event; it must never own search
 * state or mount a second search surface.
 *
 * When rendered inside the mobile navigation drawer it closes the drawer
 * first (deterministically, before the palette opens) so two aria-modal
 * layers are never active at once — the same contract as the Create task and
 * Capture triggers.
 */
export function WorkspaceSearchTrigger() {
  const drawer = useWorkspaceDrawer();

  return (
    <button
      type="button"
      className="workspace-search"
      aria-haspopup="dialog"
      aria-label="Search"
      title="Search"
      data-testid="workspace-search-trigger"
      onClick={() => {
        drawer?.closeDrawer({ restoreFocus: false });
        window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
      }}
    >
      <Search aria-hidden="true" />
      <span className="workspace-search-label">Search</span>
      <kbd aria-hidden="true">⌘K</kbd>
      <span className="sr-only">Search tasks, goals, and projects</span>
    </button>
  );
}
