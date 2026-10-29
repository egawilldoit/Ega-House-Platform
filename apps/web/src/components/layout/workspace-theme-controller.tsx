"use client";

import { useEffect } from "react";

import {
  applyWorkspaceThemeToDocument,
  watchSystemTheme,
} from "@/lib/theme-preference.client";
import type { WorkspaceThemePreference } from "@/lib/theme-preference";

/**
 * Keeps `<html data-theme>` coherent with the owner's preference after
 * hydration.
 *
 * The pre-paint script already resolved the initial value. This controller
 * exists for live OS changes while the preference is System and for the
 * post-save re-render. It has no storage of its own: the durable preference is
 * the server record, so an account switch cannot inherit another owner's theme.
 */
export function WorkspaceThemeController({
  preference,
}: {
  preference: WorkspaceThemePreference;
}) {
  useEffect(() => {
    applyWorkspaceThemeToDocument(preference);
    return watchSystemTheme(preference, () => applyWorkspaceThemeToDocument(preference));
  }, [preference]);

  return null;
}
