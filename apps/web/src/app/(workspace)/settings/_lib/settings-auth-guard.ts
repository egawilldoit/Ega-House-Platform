import { redirect } from "next/navigation";

import { getCurrentUser, isAuthServiceError } from "@/lib/services/auth-service";

/** Login destination that keeps the requested settings page as the return path. */
export function redirectToSettingsLogin(pathname: string): never {
  redirect(`/login?next=${encodeURIComponent(pathname)}`);
}

/**
 * Page-level guard for settings routes.
 *
 * Verifies the request identity before a page launches protected reads so a
 * signed-out request never reaches a service that throws `AuthServiceError`.
 */
export async function requireSettingsPageUser(pathname: string) {
  const user = await getCurrentUser();

  if (!user) {
    redirectToSettingsLogin(pathname);
  }

  return user;
}

/**
 * Converts only the known unauthenticated service failure into the login
 * redirect. Unrelated service failures and Next.js redirect control flow are
 * re-thrown unchanged so they stay visible instead of becoming a login loop.
 */
export function rethrowSettingsLoadError(
  error: unknown,
  pathname: string,
): never {
  if (isAuthServiceError(error)) {
    redirectToSettingsLogin(pathname);
  }

  throw error;
}
