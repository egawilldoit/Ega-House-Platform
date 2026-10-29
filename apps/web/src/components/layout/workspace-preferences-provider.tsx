"use client";

import { createContext, useContext, type ReactNode } from "react";

import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import { WorkspaceThemeController } from "./workspace-theme-controller";

/**
 * Server-owned preferences for the current request, exposed to the smallest
 * necessary client boundaries (the top-bar theme control and the task drawer
 * default).
 *
 * This is a read-only mirror of the durable row that the root layout already
 * fetched. It holds no independent writable state, so the DB/service remains
 * the single owner and there is nothing to leak across an account switch.
 */
const WorkspacePreferencesContext = createContext<UserPreferences>(DEFAULT_USER_PREFERENCES);

export function WorkspacePreferencesProvider({
  value,
  children,
}: {
  value: UserPreferences;
  children: ReactNode;
}) {
  return (
    <WorkspacePreferencesContext.Provider value={value}>
      <WorkspaceThemeController preference={value.theme} />
      {children}
    </WorkspacePreferencesContext.Provider>
  );
}

export function useWorkspacePreferences(): UserPreferences {
  return useContext(WorkspacePreferencesContext);
}
