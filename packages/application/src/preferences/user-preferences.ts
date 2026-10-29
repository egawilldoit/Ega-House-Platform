import {
  DEFAULT_USER_PREFERENCES,
  normalizeUserPreferences,
  parseUserPreferencesPatch,
  type UserPreferences,
} from "@ega/domain/preferences";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryResult,
} from "../shared/result";

/**
 * Owner-scoped durable workspace preferences (EGA-798).
 *
 * Policy: the repository stores one row per authenticated owner; the
 * application layer validates submitted values and merges a patch over the
 * current row. Reads fall back to the documented defaults when the owner has
 * no row, so pre-existing accounts keep today's behaviour.
 */

export type UserPreferencesRepository = {
  get(actor: AuthenticatedActor): Promise<RepositoryResult<UserPreferences | null>>;
  save(
    actor: AuthenticatedActor,
    preferences: UserPreferences,
  ): Promise<RepositoryResult<UserPreferences>>;
};

const LOAD_FAILURE = "Unable to load preferences right now.";
const SAVE_FAILURE = "Unable to save preferences right now.";

export async function getUserPreferences(
  actor: AuthenticatedActor,
  repository: UserPreferencesRepository,
): Promise<ApplicationResult<UserPreferences>> {
  const result = await repository.get(actor);
  if (!result.ok) {
    return applicationFailure(LOAD_FAILURE, result.error.code);
  }
  return applicationSuccess(
    result.value === null ? DEFAULT_USER_PREFERENCES : normalizeUserPreferences(result.value),
  );
}

/**
 * Applies a validated patch over the owner's current preferences.
 *
 * The actor is supplied by the caller from verified identity; no owner id is
 * accepted from the submitted payload. A rejected enum returns a validation
 * result without touching persistence.
 */
export async function updateUserPreferences(
  actor: AuthenticatedActor,
  repository: UserPreferencesRepository,
  input: unknown,
): Promise<ApplicationResult<UserPreferences>> {
  const patch = parseUserPreferencesPatch(input);
  if (!patch.ok) {
    return applicationFailure(patch.message, "validation");
  }

  const current = await getUserPreferences(actor, repository);
  if (!current.ok) {
    return current;
  }

  const next = normalizeUserPreferences({ ...current.data, ...patch.value });
  const saved = await repository.save(actor, next);
  if (!saved.ok) {
    return applicationFailure(SAVE_FAILURE, saved.error.code);
  }

  return applicationSuccess(normalizeUserPreferences(saved.value));
}
