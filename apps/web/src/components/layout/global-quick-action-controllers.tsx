"use client";

import { UnifiedCreateSheet } from "@/components/create/unified-create-sheet";

type GlobalQuickActionControllersProps = {
  projects?: { id: string; name: string }[];
  goals?: { id: string; title: string; project_id: string }[];
};

/**
 * The single shell-level owner of the global quick-action overlays.
 *
 * Mount exactly once per workspace shell. It holds the unified creation
 * controller (handling both Task and Backlog creation modes). Navigation
 * surfaces (desktop sidebar, mobile drawer, Home quick actions, keyboard
 * shortcuts) must only dispatch events; they must never mount another sheet/controller.
 */
export function GlobalQuickActionControllers({
  projects = [],
  goals = [],
}: GlobalQuickActionControllersProps) {
  return <UnifiedCreateSheet projects={projects} goals={goals} />;
}
