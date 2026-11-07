"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { verifyJobSearchReferenceTask } from "@/lib/services/job-search-reference-service";
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

  // The reference is patched only when the owner touched it. A stale tab that
  // saves the schedule must not erase a reference set concurrently elsewhere.
  const referenceDirty = formData.get("jobSearchReferenceDirty") === "true";
  let jobSearchReference: { kind: "task"; id: string } | null = null;
  if (referenceDirty) {
    const rawReference = formData.get("jobSearchReference");
    if (typeof rawReference !== "string") {
      return { ok: false, message: "The job-search reference could not be read." };
    }
    if (rawReference !== "") {
      const match = /^task:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(rawReference);
      if (!match?.[1]) {
        return { ok: false, message: "Choose a valid task for job search." };
      }
      jobSearchReference = { kind: "task", id: match[1] };
      const verification = await verifyJobSearchReferenceTask({ taskId: jobSearchReference.id });
      if (!verification.ok) {
        return { ok: false, message: verification.errorMessage ?? "That task is not available in your workspace." };
      }
    }
  }

  const patch: {
    personalOperations: unknown;
    jobSearchReference?: { kind: "task"; id: string } | null;
  } = { personalOperations };
  if (referenceDirty) patch.jobSearchReference = jobSearchReference;

  const result = await updateWebUserPreferences(patch);
  if (result.errorMessage) return { ok: false, message: result.errorMessage };
  revalidatePath("/", "layout");
  return { ok: true, message: "Personal schedule saved." };
}
