"use server";

import { applyApprovedOperatorProposalData, approveOperatorProposalData } from "@/lib/services/operator-proposal-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { redirectWithWorkspaceFeedback, revalidateWorkspaceFor } from "@/lib/workspace/workspace-navigation";

function getTodayReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (returnTo.startsWith("/today")) return returnTo;
  return "/today";
}

export async function approveOperatorProposalAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const proposalId = String(formData.get("proposalId") ?? "").trim();
  if (!proposalId) redirectWithWorkspaceFeedback(returnPath, { errorMessage: "Proposal is required." });

  const result = await approveOperatorProposalData({ proposalId });
  if (result.errorMessage) redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });

  // Refresh to canonical server state after explicit approval — no Today mutations yet (nothing changes before approval)
  revalidateWorkspaceFor("today", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, { successMessage: "Proposal approved. Ready to apply to Today." });
}

export async function applyApprovedOperatorProposalAction(formData: FormData) {
  const returnPath = getTodayReturnPath(formData.get("returnTo"));
  const proposalId = String(formData.get("proposalId") ?? "").trim();
  if (!proposalId) redirectWithWorkspaceFeedback(returnPath, { errorMessage: "Proposal is required." });

  // Partial explicit: allow comma-separated taskIds from form; when absent, applies all proposed tasks
  const rawTaskIds = formData.get("taskIds");
  let taskIds: string[] | undefined;
  if (typeof rawTaskIds === "string" && rawTaskIds.trim()) {
    try {
      const parsed = JSON.parse(rawTaskIds);
      if (Array.isArray(parsed)) taskIds = parsed.map((v) => String(v).trim()).filter(Boolean);
      else taskIds = rawTaskIds.split(",").map((v) => v.trim()).filter(Boolean);
    } catch {
      taskIds = rawTaskIds.split(",").map((v) => v.trim()).filter(Boolean);
    }
  } else if (rawTaskIds && Array.isArray(rawTaskIds)) {
    taskIds = (rawTaskIds as unknown[]).map((v) => String(v).trim()).filter(Boolean);
  }

  const result = await applyApprovedOperatorProposalData({ proposalId, taskIds });
  if (result.errorMessage) redirectWithWorkspaceFeedback(returnPath, { errorMessage: result.errorMessage });

  // Explicit refresh to canonical server state after apply — Hono/mobile does equivalent via snapshot refetch
  revalidateWorkspaceFor("today", { returnTo: returnPath });

  const proposal = result.data as unknown as { result?: { appliedTaskIds: string[]; skippedTaskIds: Array<{ id: string }>; failedTaskIds: Array<{ id: string }> } };
  const appliedCount = proposal.result?.appliedTaskIds.length ?? 0;
  const skippedCount = proposal.result?.skippedTaskIds.length ?? 0;
  const failedCount = proposal.result?.failedTaskIds.length ?? 0;

  let message = `Applied ${appliedCount} task${appliedCount === 1 ? "" : "s"} to Today.`;
  if (skippedCount > 0 || failedCount > 0) {
    message += ` Skipped ${skippedCount}, failed ${failedCount}.`;
  }

  redirectWithWorkspaceFeedback(returnPath, { successMessage: message });
}

// Helper for clients that need to refresh snapshot after apply (mobile fetches /api/operator + /api/today)
export async function refreshOperatorSnapshotAfterApply() {
  // Server-side helper: fetch canonical snapshot to prove refresh works — used in tests
  const snapshot = await getOperatorSnapshotData();
  return snapshot;
}
