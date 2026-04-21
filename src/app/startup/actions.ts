"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { planStartupTasksForToday } from "@/lib/services/startup-planner-service";

function getStartupReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (returnTo.startsWith("/startup") || returnTo.startsWith("/today")) {
    return returnTo;
  }
  return "/startup";
}

function revalidateStartupSurfaces(returnPath: string) {
  revalidatePath("/startup");
  revalidatePath(returnPath);
  revalidatePath("/today");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  revalidatePath("/timer");
  revalidatePath("/review");
}

function redirectWithStartupFeedback(
  returnPath: string,
  options: { actionError?: string; actionSuccess?: string },
): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  if (options.actionError) {
    target.searchParams.set("actionError", options.actionError);
  }
  if (options.actionSuccess) {
    target.searchParams.set("actionSuccess", options.actionSuccess);
  }
  redirect(`${target.pathname}${target.search}`);
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
    redirectWithStartupFeedback(returnPath, { actionError: result.errorMessage });
  }

  revalidateStartupSurfaces(returnPath);
  redirectWithStartupFeedback(returnPath, { actionSuccess: "Task added to Today." });
}

export async function addStartupShortlistToTodayAction(formData: FormData) {
  const returnPath = getStartupReturnPath(formData.get("returnTo"));
  const taskIds = parseTaskIds(formData.get("taskIds"));
  const result = await planStartupTasksForToday(taskIds);

  if (result.errorMessage) {
    redirectWithStartupFeedback(returnPath, { actionError: result.errorMessage });
  }

  const successMessage =
    result.addedCount === 1
      ? "1 startup task added to Today."
      : `${result.addedCount} startup tasks added to Today.`;

  revalidateStartupSurfaces(returnPath);
  redirectWithStartupFeedback(returnPath, { actionSuccess: successMessage });
}
