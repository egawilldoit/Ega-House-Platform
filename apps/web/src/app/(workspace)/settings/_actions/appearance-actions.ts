"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";

/**
 * Durable appearance update. Accent and density are retired: the workspace has
 * one accessible ink palette and one comfortable density. Light/Dark/System and
 * reduced motion remain owner preferences.
 */
export async function updateAppearancePreferencesAction(formData: FormData) {
  const result = await updateWebUserPreferences({
    theme: formData.get("theme"),
    reducedMotion: formData.get("reducedMotion") === "on",
  });

  revalidatePath("/", "layout");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback("preferences", "success", "Appearance preferences saved.");
}

/**
 * Single-field theme update used by the top-bar control.
 *
 * Returns the error to the caller so the compact control can explain a failed
 * write inline instead of navigating away from the current page.
 */
export async function updateThemePreferenceAction(
  theme: string,
): Promise<{ errorMessage: string | null }> {
  const result = await updateWebUserPreferences({ theme });

  revalidatePath("/", "layout");

  return { errorMessage: result.errorMessage };
}
