"use client";

import { createContext, useContext } from "react";

export type WorkspaceDrawerControls = {
  closeDrawer: (options?: { restoreFocus?: boolean }) => void;
};

export const WorkspaceDrawerContext = createContext<WorkspaceDrawerControls | null>(null);

/**
 * Optional controls for triggers rendered inside the mobile navigation drawer.
 * Returns null on desktop (no enclosing drawer), so triggers can be shared
 * between desktop and mobile without prop drilling.
 */
export function useWorkspaceDrawer() {
  return useContext(WorkspaceDrawerContext);
}
