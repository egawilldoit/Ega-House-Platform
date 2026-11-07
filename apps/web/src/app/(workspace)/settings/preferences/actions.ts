"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateWebUserPreferences } from "@/lib/services/user-preferences-service";

const PREFERENCES_PATH = "/settings/preferences";

function redirectWithFeedback(type: "success" | "error", message: string): never {
  const params = new URLSearchParams({ [type]: message });
  redirect(`${PREFERENCES_PATH}?${params.toString()}`);
}

/**
 * Durable workspace defaults: launch page, default task layout and how task
 * detail opens. Only layouts with an implemented web view are accepted; the
 * application layer rejects anything else.
 */
export async function updateWorkspacePreferencesAction(formData: FormData) {
  const result = await updateWebUserPreferences({
    launchPage: formData.get("launchPage"),
    taskLayout: formData.get("taskLayout"),
    taskOpenMode: formData.get("taskOpenMode"),
  });

  revalidatePath("/", "layout");

  if (result.errorMessage) {
    redirectWithFeedback("error", result.errorMessage);
  }

  redirectWithFeedback("success", "Workspace preferences saved.");
}

export async function updatePersonalOperationsAction(
  _state: { message: string; ok: boolean },
  formData: FormData,
): Promise<{ message: string; ok: boolean }> {
  let personalOperations: unknown;
  try {
    const raw = formData.get("schedule");
    if (typeof raw !== "string" || raw.length > 20000) throw new Error();
    personalOperations = JSON.parse(raw);
  } catch {
    return { ok: false, message: "The schedule could not be read. Please check your entries and try again." };
  }
  const result = await updateWebUserPreferences({ personalOperations });
  if (result.errorMessage) return { ok: false, message: result.errorMessage };
  revalidatePath("/", "layout");
  return { ok: true, message: "Personal schedule saved." };
}
