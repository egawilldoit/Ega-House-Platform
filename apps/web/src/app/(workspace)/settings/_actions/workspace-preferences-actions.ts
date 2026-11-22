"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";

/** Workspace defaults: launch page, default task layout and task open mode. */
export async function updateWorkspacePreferencesAction(formData: FormData) {
  const result = await updateWebUserPreferences({
    launchPage: formData.get("launchPage"),
    taskLayout: formData.get("taskLayout"),
    taskOpenMode: formData.get("taskOpenMode"),
  });

  revalidatePath("/", "layout");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback("preferences", "success", "Workspace preferences saved.");
}
