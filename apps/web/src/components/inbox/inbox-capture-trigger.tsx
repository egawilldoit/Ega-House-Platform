"use client";

import { Inbox } from "lucide-react";

import { useWorkspaceDrawer } from "@/components/layout/workspace-drawer-context";
import { INBOX_CAPTURE_EVENT } from "@/lib/workspace-events";

/**
 * Trigger for the single shell-level Inbox Capture controller.
 *
 * When rendered inside the mobile navigation drawer it closes the drawer first
 * (deterministically, before opening the global sheet) so two aria-modal layers
 * are never active at once.
 */
export function InboxCaptureTrigger() {
  const drawer = useWorkspaceDrawer();

  function openCapture() {
    drawer?.closeDrawer({ restoreFocus: false });
    window.dispatchEvent(new CustomEvent(INBOX_CAPTURE_EVENT));
  }

  return (
    <button
      type="button"
      className="sidebar-link workspace-capture-trigger"
      aria-label="Capture to Inbox"
      title="Capture to Inbox"
      aria-haspopup="dialog"
      data-testid="inbox-quick-capture-trigger"
      onClick={openCapture}
    >
      <span className="sidebar-link-icon" aria-hidden="true">
        <Inbox />
      </span>
      <span className="workspace-nav-label">Capture</span>
    </button>
  );
}
