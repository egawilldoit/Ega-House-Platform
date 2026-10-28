"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";

const APPEARANCE_PATH = "/settings/appearance";

function redirectWithFeedback(type: "success" | "error", message: string): never {
  const params = new URLSearchParams({ [type]: message });
  redirect(`${APPEARANCE_PATH}?${params.toString()}`);
}

/**
 * Durable appearance update (theme, accent, density, reduced motion).
 *
 * Values are validated by the application layer; an unsupported enum returns a
 * redirect with an error instead of a success-shaped result. The root layout
 * attributes are refreshed for the next request.
 */
export async function updateAppearancePreferencesAction(formData: FormData) {
  const result = await updateWebUserPreferences({
    theme: formData.get("theme"),
    accent: formData.get("accent"),
    density: formData.get("density"),
    reducedMotion: formData.get("reducedMotion") === "on",
  });

  revalidatePath("/", "layout");

  if (result.errorMessage) {
    redirectWithFeedback("error", result.errorMessage);
  }

  redirectWithFeedback("success", "Appearance preferences saved.");
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
