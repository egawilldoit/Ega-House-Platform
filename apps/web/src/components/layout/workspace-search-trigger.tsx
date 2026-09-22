"use client";

import { Search } from "lucide-react";

import { COMMAND_PALETTE_EVENT } from "@/lib/workspace-events";

/**
 * Sidebar search entry point.
 *
 * Dispatches the canonical CommandPalette event; it must never own search
 * state or mount a second search surface.
 */
export function WorkspaceSearchTrigger() {
  return (
    <button
      type="button"
      className="workspace-search"
      aria-haspopup="dialog"
      title="Search"
      data-testid="workspace-search-trigger"
      onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT))}
    >
      <Search aria-hidden="true" />
      <span className="workspace-search-label">Search</span>
      <kbd aria-hidden="true">⌘K</kbd>
      <span className="sr-only">Search tasks, goals, and projects</span>
    </button>
  );
}
