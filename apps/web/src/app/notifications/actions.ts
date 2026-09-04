"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  markAllWebNotificationsRead,
  markWebNotificationOpened,
  markWebNotificationRead,
} from "@/lib/services/notification-service";
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
