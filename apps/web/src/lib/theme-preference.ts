/**
 * Workspace theme preference — pure parsing and resolution.
 *
 * The authenticated workspace offers three choices:
 *   - `system` (default): follow the operating system and live OS changes.
 *   - `light` / `dark`: an explicit choice that overrides the OS.
 *
 * This module deliberately has no browser imports so server components and
 * tests can share the exact same rules as the client controller.
 */

export const WORKSPACE_THEME_STORAGE_KEY = "ega-workspace-theme";

export const WORKSPACE_THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type WorkspaceThemePreference = (typeof WORKSPACE_THEME_PREFERENCES)[number];

export type WorkspaceResolvedTheme = "light" | "dark";

export function isWorkspaceThemePreference(
  value: unknown,
): value is WorkspaceThemePreference {
  return (
    typeof value === "string" &&
    (WORKSPACE_THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/** Missing, invalid, or unreadable values fall back to System. */
export function parseWorkspaceThemePreference(
  value: string | null | undefined,
): WorkspaceThemePreference {
  return isWorkspaceThemePreference(value) ? value : "system";
}

export function resolveWorkspaceTheme(
  preference: WorkspaceThemePreference,
  prefersDark: boolean,
): WorkspaceResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

/**
 * Runs before first paint from the root layout.
 *
 * It must stay dependency-free and defensive: storage can be unavailable in
 * private or embedded contexts, and `matchMedia` can be absent in old test
 * environments. Failure still leaves a deterministic System default.
 */
export const WORKSPACE_THEME_INIT_SCRIPT = `(function(){try{var key="${WORKSPACE_THEME_STORAGE_KEY}";var stored=null;try{stored=window.localStorage.getItem(key)}catch(error){stored=null}var preference=stored==="light"||stored==="dark"?stored:"system";var dark=false;try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(error){dark=false}var resolved=preference==="dark"||(preference==="system"&&dark)?"dark":"light";var root=document.documentElement;root.setAttribute("data-theme",resolved);root.setAttribute("data-theme-preference",preference)}catch(error){}})();`;
