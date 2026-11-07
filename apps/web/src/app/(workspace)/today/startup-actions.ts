"use server";

import {
  buildStartupErrorReturnPath,
  formatMorningStartupSavedMessage,
  normalizeOutcomeTaskIds,
  parseStartupRetryIds,
} from "@/lib/morning-startup";
import { startMorningOutcomes } from "@/lib/services/morning-startup-service";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

const GENERIC_SAVE_ERROR =
  "Morning startup could not be saved right now. Try again from Today.";

/**
 * Only Today and Home are valid post-action destinations. Anything else falls
 * back to Today so a tampered `returnTo` cannot become an open redirect.
 */
function getStartupReturnPath(rawReturnTo: unknown): "/today" | "/home" {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (
    returnTo === "/home" ||
    returnTo.startsWith("/home?") ||
    returnTo.startsWith("/home#")
  ) {
    return "/home";
  }
  return "/today";
}

export async function startMorningOutcomesAction(formData: FormData) {
  const returnPath = getStartupReturnPath(formData.get("returnTo"));
  const submittedTaskIds = formData.getAll("taskIds");
  const normalized = normalizeOutcomeTaskIds(submittedTaskIds);

  // Preserve the retryable selection on every error path. The parser caps and
  // sanitises, and the page only pre-checks ids that are actually rendered.
  const retryPath = buildStartupErrorReturnPath(
    returnPath,
    parseStartupRetryIds(submittedTaskIds),
  );

  if (!normalized.ok) {
    revalidateWorkspaceFor("today", { returnTo: returnPath });
    redirectWithWorkspaceFeedback(retryPath, { errorMessage: normalized.errorMessage });
  }

  const user = await getCurrentUser();
  if (!user) {
    revalidateWorkspaceFor("today", { returnTo: returnPath });
    redirectWithWorkspaceFeedback(retryPath, {
      errorMessage: "Sign in to start your day.",
    });
  }

  const localDate = (await getWebTimeContext().catch(() => null))?.localDate ?? null;

  const result = await startMorningOutcomes({
    taskIds: normalized.taskIds,
    localDate: localDate ?? undefined,
  }).catch(() => ({ errorMessage: GENERIC_SAVE_ERROR, appliedCount: 0 }));

  if (result.errorMessage) {
    // Unknown partial state: refresh Today before every error redirect so any
    // outcomes that were already applied are visible on return.
    revalidateWorkspaceFor("today", { returnTo: returnPath });
    // Error feedback only. A failed action must never also report success.
    redirectWithWorkspaceFeedback(retryPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: formatMorningStartupSavedMessage(result.appliedCount),
  });
}
