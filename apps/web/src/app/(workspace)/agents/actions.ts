"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createAgentActor,
  revokeAgentCredential,
  setAgentActorArchived,
  updateAgentActor,
} from "@/lib/services/agent-registry-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Only own agent routes (or the registry root) are valid return targets. */
function safeReturnTo(formData: FormData): string {
  const value = text(formData, "returnTo");
  if (value === "/agents") return value;
  if (/^\/agents\/[0-9a-f-]{36}$/i.test(value)) return value;
  return "/agents";
}

function withFeedback(path: string, key: "notice" | "error", message: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(message)}`;
}

export async function createAgentAction(formData: FormData): Promise<never> {
  const result = await createAgentActor({
    displayName: formData.get("displayName"),
    kind: formData.get("kind"),
    role: formData.get("role"),
    avatarColor: formData.get("avatarColor"),
  });

  if (!result.ok) {
    redirect(withFeedback("/agents", "error", result.errorMessage));
  }

  revalidatePath("/agents");
  redirect(withFeedback(`/agents/${result.agentId}`, "notice", "Agent registered."));
}

export async function updateAgentAction(formData: FormData): Promise<never> {
  const agentId = text(formData, "agentId");
  const returnTo = safeReturnTo(formData);
  const result = await updateAgentActor(agentId, {
    displayName: formData.get("displayName"),
    kind: formData.get("kind"),
    role: formData.get("role"),
    avatarColor: formData.get("avatarColor"),
  });

  if (!result.ok) {
    redirect(withFeedback(returnTo, "error", result.errorMessage));
  }

  revalidatePath("/agents");
  revalidatePath(returnTo);
  redirect(withFeedback(returnTo, "notice", "Agent profile updated."));
}

export async function setAgentArchivedAction(formData: FormData): Promise<never> {
  const agentId = text(formData, "agentId");
  const returnTo = safeReturnTo(formData);
  const archived = text(formData, "archived") === "true";
  const result = await setAgentActorArchived(agentId, archived);

  if (!result.ok) {
    redirect(withFeedback(returnTo, "error", result.errorMessage ?? "Unable to update the agent."));
  }

  revalidatePath("/agents");
  revalidatePath(returnTo);
  const message = archived
    ? `Agent archived and ${result.revokedCredentials} active credential${
        result.revokedCredentials === 1 ? "" : "s"
      } revoked.`
    : "Agent reactivated.";
  redirect(withFeedback(returnTo, "notice", message));
}

export async function revokeCredentialAction(formData: FormData): Promise<never> {
  const credentialId = text(formData, "credentialId");
  const returnTo = safeReturnTo(formData);
  const result = await revokeAgentCredential(credentialId);

  if (!result.ok) {
    redirect(withFeedback(returnTo, "error", result.errorMessage ?? "Unable to revoke the credential."));
  }

  revalidatePath("/agents");
  revalidatePath(returnTo);
  redirect(withFeedback(returnTo, "notice", "Credential revoked. It cannot authenticate again."));
}
