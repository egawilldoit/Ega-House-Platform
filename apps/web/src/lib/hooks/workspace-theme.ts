"use client";

import { useSyncExternalStore } from "react";

import type { WorkspaceThemePreference } from "@/lib/theme-preference";
import {
  getWorkspaceThemeServerSnapshot,
  getWorkspaceThemeSnapshot,
  subscribeWorkspaceTheme,
} from "@/lib/workspace-theme-store";

export { setWorkspaceThemePreference } from "@/lib/workspace-theme-store";

export function useWorkspaceThemePreference(): WorkspaceThemePreference {
  return useSyncExternalStore(
    subscribeWorkspaceTheme,
    getWorkspaceThemeSnapshot,
    getWorkspaceThemeServerSnapshot,
  );
}

/**
 * Headless subscriber used by the root layout. Keeping the controller mounted
 * means an open workspace follows OS changes even when the top-bar control is
 * not visible (for example inside a route loading boundary).
 */
export function WorkspaceThemeController() {
  useWorkspaceThemePreference();
  return null;
}
