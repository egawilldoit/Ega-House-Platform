import { redirect } from "next/navigation";

import { getLaunchPagePath } from "@ega/domain/preferences";

import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebUserPreferences } from "@/lib/services/user-preferences-service";

import { HomePage } from "./home/home-page";

export default async function Page() {
  const [user, preferences] = await Promise.all([
    getCurrentUser(),
    getWebUserPreferences(),
  ]);

  if (user) {
    redirect(getLaunchPagePath(preferences.launchPage));
  }

  return <HomePage />;
}
