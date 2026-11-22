"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import { parseWorkTargetsForm } from "@/app/(workspace)/settings/_lib/work-targets";
import {
  getWebUserPreferencesState,
  updateWebUserPreferences,
} from "@/lib/services/user-preferences-service";

/**
 * Lean daily/weekly work-target update.
 *
 * Reads the current owner row first so the retired guidance blocks and the
 * job-search reference are carried through unchanged. The application layer
 * still validates the complete schedule before any write.
 */
export async function updateWorkTargetsAction(formData: FormData) {
  const state = await getWebUserPreferencesState();
  if (state.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", state.errorMessage);
  }

  const parsed = parseWorkTargetsForm(formData);
  if (!parsed.ok) {
    redirectWithSettingsFeedback("preferences", "error", parsed.message);
  }

  const current = state.preferences.personalOperations;
  const result = await updateWebUserPreferences({
    personalOperations: {
      paused: parsed.paused,
      targets: parsed.targets,
      guidance: current.guidance,
    },
  });

  revalidatePath("/", "layout");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback("preferences", "success", "Work targets saved.");
}
