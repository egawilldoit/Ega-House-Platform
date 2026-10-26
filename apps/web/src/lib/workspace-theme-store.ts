"use client";

import {
  WORKSPACE_THEME_STORAGE_KEY,
  parseWorkspaceThemePreference,
  resolveWorkspaceTheme,
  type WorkspaceThemePreference,
} from "@/lib/theme-preference";

/**
 * Browser-owned theme state for the authenticated workspace.
 *
 * This module intentionally has one mutable store and no React import so the
 * preference, persistence, and OS-listener rules can be tested independently
 * of component rendering. The hook in `hooks/workspace-theme` only binds it to
 * `useSyncExternalStore`.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let initialized = false;
let listenersAttached = false;
let preference: WorkspaceThemePreference = "system";
let mediaQuery: MediaQueryList | null = null;

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredPreference(): WorkspaceThemePreference {
  const storage = getStorage();
  if (!storage) return "system";

  try {
    return parseWorkspaceThemePreference(storage.getItem(WORKSPACE_THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function paintDocumentTheme() {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.setAttribute(
    "data-theme",
    resolveWorkspaceTheme(preference, getSystemPrefersDark()),
  );
  root.setAttribute("data-theme-preference", preference);
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function onSystemThemeChange() {
  if (preference !== "system") return;
  paintDocumentTheme();
  notify();
}

function onStorageChange(event: StorageEvent) {
  if (event.key !== null && event.key !== WORKSPACE_THEME_STORAGE_KEY) return;

  preference = event.newValue
    ? parseWorkspaceThemePreference(event.newValue)
    : "system";
  paintDocumentTheme();
  notify();
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  preference = readStoredPreference();
  paintDocumentTheme();
}

function attachListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  if (typeof window.matchMedia === "function") {
    try {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", onSystemThemeChange);
      } else {
        mediaQuery.addListener?.(onSystemThemeChange);
      }
    } catch {
      mediaQuery = null;
    }
  }

  window.addEventListener("storage", onStorageChange);
}

function detachListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  if (mediaQuery) {
    if (typeof mediaQuery.removeEventListener === "function") {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
    } else {
      mediaQuery.removeListener?.(onSystemThemeChange);
    }
  }
  mediaQuery = null;
  window.removeEventListener("storage", onStorageChange);
}

export function subscribeWorkspaceTheme(listener: Listener) {
  ensureInitialized();
  listeners.add(listener);
  attachListeners();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachListeners();
  };
}

export function getWorkspaceThemeSnapshot(): WorkspaceThemePreference {
  ensureInitialized();
  return preference;
}

export function getWorkspaceThemeServerSnapshot(): WorkspaceThemePreference {
  return "system";
}

/**
 * Applies a preference immediately, persists it when storage is available,
 * and updates every subscribed control in this tab. Storage failures degrade
 * to an in-memory preference for the current session rather than blocking the
 * theme change.
 */
export function setWorkspaceThemePreference(next: WorkspaceThemePreference) {
  ensureInitialized();
  preference = next;

  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(WORKSPACE_THEME_STORAGE_KEY, next);
    } catch {
      // In-memory preference still applies.
    }
  }

  paintDocumentTheme();
  notify();
}
