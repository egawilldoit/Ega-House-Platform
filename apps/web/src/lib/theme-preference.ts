/**
 * Workspace theme preference — pure parsing and resolution.
 *
 * The authenticated workspace offers three choices:
 *   - `system` (default): follow the operating system and live OS changes.
 *   - `light` / `dark`: an explicit choice that overrides the OS.
 *
 * The durable owner record lives in `user_preferences`; this module only turns
 * the resolved value into the `<html data-theme>` attribute. It deliberately has
 * no browser imports so server components and tests share the exact same rules
 * as the client controller, and no browser storage is read: switching accounts
 * can never inherit the previous owner's theme.
 */

import {
  isUserTheme,
  USER_THEME_VALUES,
  type UserTheme,
} from "@ega/domain/preferences";

/** `<html>` attribute carrying the owner's preference for the pre-paint script. */
export const WORKSPACE_THEME_ATTRIBUTE = "data-theme-preference";

export const WORKSPACE_THEME_PREFERENCES = USER_THEME_VALUES;

export type WorkspaceThemePreference = UserTheme;

export type WorkspaceResolvedTheme = "light" | "dark";

export function isWorkspaceThemePreference(
  value: unknown,
): value is WorkspaceThemePreference {
  return isUserTheme(value);
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
 * The server already resolved an explicit Light/Dark choice into
 * `data-theme-preference`. System reads the OS preference here, before the
 * body paints, so a dark desktop never shows a light frame. It must stay
 * dependency-free and defensive: `matchMedia` can be absent in old or embedded
 * environments, and failure still leaves the server-rendered theme in place.
 */
export const WORKSPACE_THEME_INIT_SCRIPT = `(function(){try{var root=document.documentElement;var preference=root.getAttribute("${WORKSPACE_THEME_ATTRIBUTE}");if(preference!=="light"&&preference!=="dark"){preference="system"}var dark=false;try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(error){dark=false}root.setAttribute("data-theme",preference==="dark"||(preference==="system"&&dark)?"dark":"light")}catch(error){}})();`;
