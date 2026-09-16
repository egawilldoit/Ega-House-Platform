"use client";

import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
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
    <Button
      className="workspace-capture-trigger mx-2.5 mt-2 h-auto w-[calc(100%-1.25rem)] items-center justify-start gap-2.5 rounded-none border border-[var(--workspace-citrus)] bg-[var(--workspace-citrus)] px-3 py-2.5 text-left text-[var(--workspace-black)] shadow-none hover:bg-[#ffe566]"
      aria-label="Capture to Inbox"
      title="Capture to Inbox"
      data-testid="inbox-quick-capture-trigger"
      onClick={openCapture}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
        <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="workspace-capture-trigger-copy min-w-0">
        <span className="block text-sm font-semibold leading-5 tracking-normal">Capture</span>
        <span className="mt-0.5 block text-xs font-semibold leading-4 text-black/65">
          Idea, task, reminder, or note.
        </span>
      </span>
    </Button>
  );
}
