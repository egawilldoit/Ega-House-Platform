"use server";

import { planStartupTasksForToday } from "@/lib/services/startup-planner-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

function getStartupReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (returnTo.startsWith("/startup") || returnTo.startsWith("/today")) {
    return returnTo;
  }
  return "/startup";
}

function parseTaskIds(rawTaskIds: unknown) {
  return String(rawTaskIds ?? "")
    .split(",")
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

export async function addStartupTaskToTodayAction(formData: FormData) {
  const returnPath = getStartupReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const result = await planStartupTasksForToday([taskId]);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  revalidateWorkspaceFor("startup", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, { successMessage: "Task added to Today." });
}

export async function addStartupShortlistToTodayAction(formData: FormData) {
  const returnPath = getStartupReturnPath(formData.get("returnTo"));
  const taskIds = parseTaskIds(formData.get("taskIds"));
  const result = await planStartupTasksForToday(taskIds);

  if (result.errorMessage) {
    redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });
  }

  const successMessage =
    result.addedCount === 1
      ? "1 startup task added to Today."
      : `${result.addedCount} startup tasks added to Today.`;

  revalidateWorkspaceFor("startup", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, { successMessage });
}
