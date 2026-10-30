"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  disconnectGoogleCalendar,
  updateCalendarIntegrationDefaults,
} from "@/lib/services/calendar-settings-service";
import { setWebTimezone } from "@/lib/services/time-context-service";

function redirectWithSettingsFeedback(type: "success" | "error", message: string): never {
  const params = new URLSearchParams({ [type]: message });
  redirect(`/settings/account?${params.toString()}`);
}

export async function disconnectGoogleCalendarAction() {
  const result = await disconnectGoogleCalendar();

  revalidatePath("/settings/account");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("error", result.errorMessage);
  }

  redirectWithSettingsFeedback("success", "Google Calendar disconnected.");
}

export async function updateCalendarDefaultsAction(formData: FormData) {
  const result = await updateCalendarIntegrationDefaults({
    scheduledTaskSyncEnabled: formData.get("scheduledTaskSyncEnabled"),
    defaultReminderMinutes: formData.get("defaultReminderMinutes"),
  });

  revalidatePath("/settings/account");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("error", result.errorMessage);
  }

  redirectWithSettingsFeedback("success", "Calendar defaults updated.");
}

export async function updateAccountTimezoneAction(formData: FormData) {
  const timezone = String(formData.get("timezone") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();

  const result = await setWebTimezone(timezone);

  revalidatePath("/settings/account");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("error", result.errorMessage);
  }

  redirectWithSettingsFeedback(
    "success",
    feedback || `Timezone updated to ${timezone}.`,
  );
}
