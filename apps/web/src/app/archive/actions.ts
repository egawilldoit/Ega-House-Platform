"use server";

import { createAuthenticatedActor, unarchiveGoal, unarchiveProject } from "@ega/application";
import { SupabaseGoalsRepository, SupabaseProjectsRepository } from "@ega/data-access";
import { isArchiveTab } from "@ega/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { unarchiveTask } from "@/lib/services/task-service";
import { createClient } from "@/lib/supabase/server";
import { revalidateWorkspaceFor } from "@/lib/workspace/workspace-navigation";

const ARCHIVE_PATH_PATTERN = /^\/archive(?:[?#].*)?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only same-page archive URLs are acceptable redirect targets. */
function getArchiveReturnPath(rawReturnTo: unknown): string {
  const value = String(rawReturnTo ?? "").trim();
  return ARCHIVE_PATH_PATTERN.test(value) ? value : "/archive";
}

function redirectWithArchiveFeedback(
  returnPath: string,
  feedback: { error?: string; notice?: string },
): never {
  const target = new URL(returnPath, "https://archive.invalid");
  target.searchParams.delete("archiveError");
  target.searchParams.delete("archiveNotice");

  if (feedback.error) {
    target.searchParams.set("archiveError", feedback.error.slice(0, 180));
  }
  if (feedback.notice) {
    target.searchParams.set("archiveNotice", feedback.notice);
  }

  redirect(`${target.pathname}${target.search}`);
}

/**
 * Restore one archived task, goal or project.
 *
 * Restore is a single-row operation by design: children keep their own
 * `archived_at`, so an independently archived child is never resurrected by
 * restoring its parent. Ownership is enforced by the request-scoped client
 * (RLS) plus the services' owner filters; the submitted id only seeds intent.
 *
 * There is deliberately no permanent-delete action here. The owner-approved
 * retention/cascade policy is a recorded open decision, so no new destructive
 * path is exposed by the archive centre.
 */
export async function restoreArchivedEntityAction(formData: FormData) {
  const returnPath = getArchiveReturnPath(formData.get("returnTo"));
  const entity = String(formData.get("entity") ?? "").trim();
  const entityId = String(formData.get("id") ?? "").trim();

  if (!isArchiveTab(entity)) {
    redirectWithArchiveFeedback(returnPath, {
      error: "Archive restore request is invalid.",
    });
  }

  if (!UUID_PATTERN.test(entityId)) {
    redirectWithArchiveFeedback(returnPath, {
      error: "Choose a valid archived item to restore.",
    });
  }

  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);

  if (entity === "tasks") {
    const { errorMessage } = await unarchiveTask(entityId);
    if (errorMessage) {
      redirectWithArchiveFeedback(returnPath, { error: errorMessage });
    }
    revalidateWorkspaceFor("task", { returnTo: returnPath });
  } else if (entity === "goals") {
    const result = await unarchiveGoal(actor, new SupabaseGoalsRepository(supabase), {
      goalId: entityId,
    });
    if (!result.ok) {
      redirectWithArchiveFeedback(returnPath, { error: result.errorMessage });
    }
    for (const path of ["/goals", "/dashboard", "/tasks", "/tasks/projects", "/today"]) {
      revalidatePath(path);
    }
  } else {
    const result = await unarchiveProject(actor, new SupabaseProjectsRepository(supabase), {
      projectId: entityId,
    });
    if (!result.ok) {
      redirectWithArchiveFeedback(returnPath, { error: result.errorMessage });
    }
    for (const path of ["/tasks/projects", "/tasks", "/goals", "/dashboard", "/today"]) {
      revalidatePath(path);
    }
  }

  revalidatePath("/archive");
  redirectWithArchiveFeedback(returnPath, { notice: "restored" });
}
