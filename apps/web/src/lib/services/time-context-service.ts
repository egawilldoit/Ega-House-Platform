import {
  createAuthenticatedActor,
  getTimeContextTimezone,
  resolveTimeContext,
  setTimeContextTimezone,
} from "@ega/application";
import type { TimeContextFallback } from "@ega/contracts";

import { getRequestTimeContextRepository } from "@/lib/request-time-context";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";

/**
 * Canonical web Time Context service seam.
 *
 * Owns every authenticated web read/write of the owner's persisted IANA
 * timezone (user_time_context) so pages never query the table directly and
 * no second timezone owner exists. Reads go through the request-memoized
 * repository; writes invalidate the memoized read for the request.
 *
 * Failure behavior: reads throw (surfaced as the page's error state); the
 * mutation helper returns an error message instead of throwing so settings
 * forms can render feedback without a try/catch redirect.
 */

export type WebTimeContext = Readonly<{
  /** Effective timezone actually used for day/time semantics (UTC when fallback). */
  timezone: string;
  /** Raw persisted IANA zone, or null when the owner has none stored. */
  persistedTimezone: string | null;
  fallback: TimeContextFallback;
  /** Canonical local date (YYYY-MM-DD) for the owner in the effective timezone. */
  localDate: string;
}>;

async function actorRepository() {
  const user = await requireAuthenticatedUser();
  const actor = createAuthenticatedActor(user.id);
  const repository = await getRequestTimeContextRepository();
  return { actor, repository };
}

/**
 * Resolve the owner's effective Time Context for the current request.
 * Throws when the context cannot be loaded (caller renders an error state).
 */
export async function getWebTimeContext(): Promise<WebTimeContext> {
  const { actor, repository } = await actorRepository();
  const [persistedResult, contextResult] = await Promise.all([
    getTimeContextTimezone(actor, repository),
    resolveTimeContext(actor, repository),
  ]);
  if (!contextResult.ok) {
    throw new Error(contextResult.errorMessage);
  }
  return {
    timezone: contextResult.data.timezone,
    persistedTimezone: persistedResult.ok ? persistedResult.data : null,
    fallback: contextResult.data.fallback,
    localDate: contextResult.data.localDate,
  };
}

/**
 * Persist the owner's IANA timezone. Returns an error message on failure
 * (invalid zone or persistence failure) instead of throwing.
 */
export async function setWebTimezone(
  timezone: string,
): Promise<{ errorMessage: string | null }> {
  try {
    const { actor, repository } = await actorRepository();
    const result = await setTimeContextTimezone(actor, repository, { timezone });
    return { errorMessage: result.ok ? null : result.errorMessage };
  } catch {
    return { errorMessage: "Unable to save timezone right now." };
  }
}
