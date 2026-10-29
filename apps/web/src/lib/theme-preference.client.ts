"use client";

import {
  WORKSPACE_THEME_ATTRIBUTE,
  resolveWorkspaceTheme,
  type WorkspaceThemePreference,
} from "@/lib/theme-preference";

/** OS colour-scheme request, defensive against missing/blocked APIs. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Applies a preference to `<html>` for the authenticated workspace.
 *
 * Explicit Light/Dark is written directly; System resolves the OS request at
 * the moment of the call. The durable record is the server row, so this never
 * writes browser storage.
 */
export function applyWorkspaceThemeToDocument(preference: WorkspaceThemePreference) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute(WORKSPACE_THEME_ATTRIBUTE, preference);
  root.setAttribute("data-theme", resolveWorkspaceTheme(preference, systemPrefersDark()));
}

/**
 * Calls `onChange` for live OS colour-scheme changes.
 *
 * Returns a no-op cleanup when the preference is not System or the environment
 * cannot observe the media query.
 */
export function watchSystemTheme(
  preference: WorkspaceThemePreference,
  onChange: () => void,
): () => void {
  if (preference !== "system" || typeof window === "undefined") return () => {};
  if (typeof window.matchMedia !== "function") return () => {};

  let query: MediaQueryList;
  try {
    query = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }

  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }

  query.addListener?.(onChange);
  return () => query.removeListener?.(onChange);
}
