"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import {
  createAgentActor,
  revokeAgentCredential,
  setAgentActorArchived,
} from "@/lib/services/agent-registry-service";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createAgentAction(formData: FormData) {
  const result = await createAgentActor({
    displayName: formData.get("displayName"),
    kind: formData.get("kind"),
    role: formData.get("role"),
    avatarColor: formData.get("avatarColor"),
  });

  if (!result.ok) {
    redirectWithSettingsFeedback("integrations", "error", result.errorMessage);
  }

  revalidatePath("/", "layout");
  redirectWithSettingsFeedback("integrations", "success", "Agent registered.");
}

export async function setAgentArchivedAction(formData: FormData) {
  const archived = text(formData, "archived") === "true";
  const result = await setAgentActorArchived(text(formData, "agentId"), archived);

  if (!result.ok) {
    redirectWithSettingsFeedback(
      "integrations",
      "error",
      result.errorMessage ?? "Unable to update the agent.",
    );
  }

  revalidatePath("/", "layout");
  const message = archived
    ? `Agent archived and ${result.revokedCredentials} active credential${
        result.revokedCredentials === 1 ? "" : "s"
      } revoked.`
    : "Agent reactivated.";
  redirectWithSettingsFeedback("integrations", "success", message);
}

export async function revokeCredentialAction(formData: FormData) {
  const result = await revokeAgentCredential(text(formData, "credentialId"));

  if (!result.ok) {
    redirectWithSettingsFeedback(
      "integrations",
      "error",
      result.errorMessage ?? "Unable to revoke the credential.",
    );
  }

  revalidatePath("/", "layout");
  redirectWithSettingsFeedback(
    "integrations",
    "success",
    "Credential revoked. It cannot authenticate again.",
  );
}
