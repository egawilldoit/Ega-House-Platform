import { redirect } from "next/navigation";

import type { SettingsTabKey } from "@/app/(workspace)/settings/_components/settings-tabs";

export function redirectWithSettingsFeedback(
  tab: SettingsTabKey,
  type: "success" | "error",
  message: string,
): never {
  const params = new URLSearchParams({ tab, [type]: message });
  redirect(`/settings?${params.toString()}`);
}
