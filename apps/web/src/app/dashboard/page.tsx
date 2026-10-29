import { redirect } from "next/navigation";

import { getLaunchPagePath } from "@ega/domain/preferences";

import { getWebUserPreferences } from "@/lib/services/user-preferences-service";

export const metadata = {
  title: "Dashboard",
  description: "Compatibility redirect to the configured workspace launch page.",
};

/**
 * Compatibility alias kept for old links and the sign-in form.
 *
 * The destination is the owner's durable `launchPage` preference, so a
 * configured Today or Tasks start is not lost by landing on the legacy path.
 */
export default async function DashboardPage() {
  const preferences = await getWebUserPreferences();
  redirect(getLaunchPagePath(preferences.launchPage));
}
