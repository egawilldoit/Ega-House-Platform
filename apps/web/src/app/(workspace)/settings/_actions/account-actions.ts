"use server";

import { revalidatePath } from "next/cache";

import { redirectWithSettingsFeedback } from "@/app/(workspace)/settings/_actions/settings-feedback";
import {
  disconnectGoogleCalendar,
  updateCalendarIntegrationDefaults,
} from "@/lib/services/calendar-settings-service";
import { setWebTimezone } from "@/lib/services/time-context-service";

export async function disconnectGoogleCalendarAction() {
  const result = await disconnectGoogleCalendar();

  revalidatePath("/", "layout");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("integrations", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback("integrations", "success", "Google Calendar disconnected.");
}

export async function updateCalendarDefaultsAction(formData: FormData) {
  const result = await updateCalendarIntegrationDefaults({
    scheduledTaskSyncEnabled: formData.get("scheduledTaskSyncEnabled"),
    defaultReminderMinutes: formData.get("defaultReminderMinutes"),
  });

  revalidatePath("/", "layout");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("integrations", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback("integrations", "success", "Calendar defaults updated.");
}

export async function updateAccountTimezoneAction(formData: FormData) {
  const timezone = String(formData.get("timezone") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();

  const result = await setWebTimezone(timezone);

  revalidatePath("/", "layout");
  revalidatePath("/tasks");

  if (result.errorMessage) {
    redirectWithSettingsFeedback("account", "error", result.errorMessage);
  }

  redirectWithSettingsFeedback(
    "account",
    "success",
    feedback || `Timezone updated to ${timezone}.`,
  );
}
