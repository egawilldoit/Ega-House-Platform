"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { AgentTokenScopes } from "@/lib/contracts/agent";
import type { IssueCredentialState } from "@/lib/agent-credential-issue-state";
import {
  createAgentActor,
  issueAgentCredential,
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

function readScopes(formData: FormData): AgentTokenScopes {
  const tasks: NonNullable<AgentTokenScopes["tasks"]> = {};
  if (formData.get("tasks.read") === "on") tasks.read = true;
  if (formData.get("tasks.create") === "on") tasks.create = true;
  if (formData.get("tasks.updateAny") === "on") tasks.updateAny = true;
  if (formData.get("tasks.archive") === "on") tasks.archive = true;
  if (formData.get("tasks.bulk") === "on") tasks.bulk = true;
  if (formData.get("tasks.comment") === "on") tasks.comment = true;

  return {
    ...(Object.keys(tasks).length > 0 ? { tasks } : {}),
    ...(formData.get("projects.read") === "on" ? { projects: { read: true } } : {}),
    ...(formData.get("goals.read") === "on" ? { goals: { read: true } } : {}),
  };
}

/**
 * Issues one credential and returns the raw token to the client once. The token
 * is never placed in a URL or persisted anywhere except its HMAC hash.
 */
export async function issueCredentialAction(
  previous: IssueCredentialState,
  formData: FormData,
): Promise<IssueCredentialState> {
  const agentId = text(formData, "agentId");
  const result = await issueAgentCredential({
    agentId,
    name: formData.get("name"),
    scopes: readScopes(formData),
  });

  if (!result.ok) {
    return {
      status: "error",
      token: null,
      tokenPrefix: null,
      errorMessage: result.errorMessage,
      attempt: previous.attempt + 1,
    };
  }

  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  return {
    status: "success",
    token: result.token,
    tokenPrefix: result.tokenPrefix,
    errorMessage: null,
    attempt: previous.attempt + 1,
  };
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
