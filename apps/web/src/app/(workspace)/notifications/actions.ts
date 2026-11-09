"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  markAllWebNotificationsRead,
  markWebNotificationOpened,
  markWebNotificationRead,
  updateWebNotificationPreferences,
  updateWebNotificationSettings,
} from "@/lib/services/notification-service";
import { isNotificationType } from "@ega/contracts";
import { getNotificationTargetHref } from "@/lib/notification-target";

function notificationIdFrom(formData: FormData) {
  return String(formData.get("notificationId") ?? "").trim();
}

function feedbackRedirect(key: "error" | "notice", message: string) {
  const params = new URLSearchParams({ [key]: message });
  return `/notifications?${params.toString()}`;
}

export async function markNotificationReadAction(formData: FormData): Promise<never> {
  const notificationId = notificationIdFrom(formData);
  if (!notificationId) {
    redirect(feedbackRedirect("error", "Notification id is required."));
  }

  const result = await markWebNotificationRead(notificationId);
  if (result.errorMessage) {
    redirect(feedbackRedirect("error", result.errorMessage));
  }

  revalidatePath("/notifications");
  redirect(feedbackRedirect("notice", "Notification marked read."));
}

export async function openNotificationAction(formData: FormData): Promise<never> {
  const notificationId = notificationIdFrom(formData);
  if (!notificationId) {
    redirect(feedbackRedirect("error", "Notification id is required."));
  }

  const result = await markWebNotificationOpened(notificationId);
  if (result.errorMessage || !result.data) {
    redirect(feedbackRedirect("error", result.errorMessage ?? "Notification not found."));
  }

  revalidatePath("/notifications");
  redirect(getNotificationTargetHref(result.data.target));
}

/**
 * Mark a bounded set of notifications read.
 *
 * Each id goes through the same owner-scoped service call, so a foreign or
 * missing id cannot be updated; the loop is intentionally small (the inbox page
 * size) and per-item failures are reported instead of being hidden.
 */
export async function markNotificationsReadAction(formData: FormData): Promise<never> {
  const notificationIds = Array.from(
    new Set(
      formData
        .getAll("notificationIds")
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 50);

  if (notificationIds.length === 0) {
    redirect(feedbackRedirect("error", "Select at least one notification."));
  }

  let updated = 0;
  let failed = 0;
  for (const notificationId of notificationIds) {
    const result = await markWebNotificationRead(notificationId);
    if (result.errorMessage) failed += 1;
    else updated += 1;
  }

  revalidatePath("/notifications");

  if (failed > 0) {
    redirect(
      feedbackRedirect(
        "error",
        `${updated} marked read, ${failed} could not be updated. Refresh and try again.`,
      ),
    );
  }

  redirect(
    feedbackRedirect(
      "notice",
      updated === 1 ? "Notification marked read." : `${updated} notifications marked read.`,
    ),
  );
}

export async function saveNotificationPreferenceAction(formData: FormData): Promise<never> {
  const notificationType = String(formData.get("notificationType") ?? "").trim();
  if (!isNotificationType(notificationType)) {
    redirect(feedbackRedirect("error", "Unsupported notification type."));
  }
  const result = await updateWebNotificationPreferences({
    notificationType,
    pushEnabled: formData.get("pushEnabled") === "on",
    emailEnabled: formData.get("emailEnabled") === "on",
  });
  if (result.errorMessage) {
    redirect(feedbackRedirect("error", result.errorMessage));
  }
  revalidatePath("/notifications");
  redirect(feedbackRedirect("notice", "Notification preferences saved."));
}

export async function saveNotificationSettingsAction(formData: FormData): Promise<never> {
  const result = await updateWebNotificationSettings({
    quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
    quietHoursStart: String(formData.get("quietHoursStart") ?? "").trim() || undefined,
    quietHoursEnd: String(formData.get("quietHoursEnd") ?? "").trim() || undefined,
  });
  if (result.errorMessage) {
    redirect(feedbackRedirect("error", result.errorMessage));
  }
  revalidatePath("/notifications");
  redirect(feedbackRedirect("notice", "Notification settings saved."));
}

export async function markAllNotificationsReadAction(formData: FormData): Promise<never> {
  void formData;
  const result = await markAllWebNotificationsRead();
  if (result.errorMessage) {
    redirect(feedbackRedirect("error", result.errorMessage));
  }

  revalidatePath("/notifications");
  redirect(
    feedbackRedirect(
      "notice",
      result.data?.updatedCount ? "All notifications marked read." : "No unread notifications.",
    ),
  );
}
