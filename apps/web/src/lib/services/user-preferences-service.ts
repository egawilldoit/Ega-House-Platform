import { cache } from "react";

import {
  createAuthenticatedActor,
  getUserPreferences,
  updateUserPreferences,
} from "@ega/application";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@ega/domain/preferences";

import { getRequestUserPreferencesRepository } from "@/lib/request-user-preferences";
import { getCurrentUser } from "@/lib/services/auth-service";

/**
 * Canonical web seam for durable workspace preferences (EGA-798).
 *
 * Owns every authenticated web read/write of `user_preferences` so routes and
 * components never query the table directly and no second preferences owner
 * exists. The read is request-memoized and keyed by verified identity.
 *
 * Failure behaviour: reads degrade to the documented defaults (System theme,
 * neutral accent, comfortable density, Home launch, List layout, side panel) so
 * an unavailable preferences store never blocks the workspace. Writes return an
 * actionable message instead of a success-shaped value.
 */

export type UserPreferencesState = Readonly<{
  preferences: UserPreferences;
  errorMessage: string | null;
}>;

const LOAD_FAILURE = "Unable to load preferences right now.";
const SAVE_FAILURE = "Unable to save preferences right now.";

const loadUserPreferencesState = cache(async (): Promise<UserPreferencesState> => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { preferences: DEFAULT_USER_PREFERENCES, errorMessage: null };
    }

    const repository = await getRequestUserPreferencesRepository();
    const result = await getUserPreferences(createAuthenticatedActor(user.id), repository);
    if (!result.ok) {
      return { preferences: DEFAULT_USER_PREFERENCES, errorMessage: result.errorMessage };
    }

    return { preferences: result.data, errorMessage: null };
  } catch {
    return { preferences: DEFAULT_USER_PREFERENCES, errorMessage: LOAD_FAILURE };
  }
});

/** Effective preferences for the current owner (defaults when anonymous). */
export async function getWebUserPreferences(): Promise<UserPreferences> {
  return (await loadUserPreferencesState()).preferences;
}

/**
 * Preferences plus a load error for settings surfaces. The error is non-fatal:
 * the defaults are still rendered so the form remains usable.
 */
export async function getWebUserPreferencesState(): Promise<UserPreferencesState> {
  return loadUserPreferencesState();
}

/**
 * Persist a validated patch for the current owner.
 *
 * Returns the effective preferences after the write (or the previous ones on
 * failure) plus an error message. Identity comes from the verified session;
 * callers cannot supply an owner id.
 */
export async function updateWebUserPreferences(
  input: unknown,
): Promise<UserPreferencesState> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return {
        preferences: DEFAULT_USER_PREFERENCES,
        errorMessage: "Sign in to save workspace preferences.",
      };
    }

    const repository = await getRequestUserPreferencesRepository();
    const result = await updateUserPreferences(
      createAuthenticatedActor(user.id),
      repository,
      input,
    );

    if (!result.ok) {
      return {
        preferences: (await loadUserPreferencesState()).preferences,
        errorMessage: result.errorMessage,
      };
    }

    return { preferences: result.data, errorMessage: null };
  } catch {
    return {
      preferences: (await loadUserPreferencesState().catch(() => null))?.preferences
        ?? DEFAULT_USER_PREFERENCES,
      errorMessage: SAVE_FAILURE,
    };
  }
}
