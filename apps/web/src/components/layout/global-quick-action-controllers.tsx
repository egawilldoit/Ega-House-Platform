"use client";

import { InboxCaptureSheet } from "@/components/inbox/inbox-capture-sheet";
import { QuickTaskSheet } from "@/components/tasks/quick-task-sheet";

type GlobalQuickActionControllersProps = {
  projects?: { id: string; name: string }[];
  goals?: { id: string; title: string; project_id: string }[];
};

/**
 * The single shell-level owner of the global quick-action overlays.
 *
 * Mount exactly once per workspace shell. It holds the only INBOX_CAPTURE_EVENT
 * and QUICK_TASK_EVENT controllers/listeners. Navigation surfaces (desktop
 * sidebar, mobile drawer, Home quick actions, keyboard shortcuts) must only
 * dispatch events; they must never mount another sheet/controller.
 */
export function GlobalQuickActionControllers({
  projects = [],
  goals = [],
}: GlobalQuickActionControllersProps) {
  return (
    <>
      <InboxCaptureSheet />
      <QuickTaskSheet projects={projects} goals={goals} showTrigger={false} />
    </>
  );
}
