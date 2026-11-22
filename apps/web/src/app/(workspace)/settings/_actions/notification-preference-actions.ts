"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import { isNotificationType } from "@ega/contracts";
import {
  updateWebNotificationPreferences,
  updateWebNotificationSettings,
} from "@/lib/services/notification-service";

export async function saveNotificationPreferenceAction(formData: FormData) {
  const notificationType = String(formData.get("notificationType") ?? "").trim();
  if (!isNotificationType(notificationType)) {
    redirectWithSettingsFeedback("preferences", "error", "Unsupported notification type.");
  }
  const result = await updateWebNotificationPreferences({
    notificationType,
    pushEnabled: formData.get("pushEnabled") === "on",
    emailEnabled: formData.get("emailEnabled") === "on",
  });
  if (result.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", result.errorMessage);
  }
  revalidatePath("/", "layout");
  redirectWithSettingsFeedback("preferences", "success", "Notification preferences saved.");
}

export async function saveNotificationSettingsAction(formData: FormData) {
  const result = await updateWebNotificationSettings({
    quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
    quietHoursStart: String(formData.get("quietHoursStart") ?? "").trim() || undefined,
    quietHoursEnd: String(formData.get("quietHoursEnd") ?? "").trim() || undefined,
  });
  if (result.errorMessage) {
    redirectWithSettingsFeedback("preferences", "error", result.errorMessage);
  }
  revalidatePath("/", "layout");
  redirectWithSettingsFeedback("preferences", "success", "Notification settings saved.");
}
