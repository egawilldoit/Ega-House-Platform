"use server";

import { normalizeOutcomeTaskIds } from "@/lib/morning-startup";
import { startMorningOutcomes } from "@/lib/services/morning-startup-service";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

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
  const normalized = normalizeOutcomeTaskIds(formData.getAll("taskIds"));

  if (!normalized.ok) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: normalized.errorMessage });
  }

  const user = await getCurrentUser();
  if (!user) {
    redirectWithWorkspaceFeedback(returnPath, {
      errorMessage: "Sign in to start your day.",
    });
  }

  const localDate = (await getWebTimeContext().catch(() => null))?.localDate ?? null;

  const result = await startMorningOutcomes({
    taskIds: normalized.taskIds,
    localDate: localDate ?? undefined,
  });

  if (result.errorMessage) {
    // Error feedback only. A failed action must never also report success.
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    successMessage: `Morning startup saved: ${result.appliedCount} outcomes for today.`,
  });
}
