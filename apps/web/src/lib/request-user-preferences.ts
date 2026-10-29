import { cache } from "react";

import type {
  AuthenticatedActor,
  RepositoryResult,
  UserPreferencesRepository,
} from "@ega/application";
import type { UserPreferences } from "@ega/domain/preferences";
import { SupabaseUserPreferencesRepository } from "@ega/data-access";

import { createClient } from "@/lib/supabase/server";

/**
 * Request-scoped preferences repository for web read paths.
 *
 * The root layout, the settings pages and the task pages each resolve the same
 * owner row in one request. The memo is held by this request-scoped repository
 * instance, keyed by the verified actor, so one owner's preferences are never
 * reused for another request or account.
 */
class RequestMemoUserPreferencesRepository implements UserPreferencesRepository {
  private readonly pending = new Map<string, Promise<RepositoryResult<UserPreferences | null>>>();

  constructor(private readonly inner: UserPreferencesRepository) {}

  get(actor: AuthenticatedActor): Promise<RepositoryResult<UserPreferences | null>> {
    const key = actor.userId;
    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = this.inner.get(actor);
    this.pending.set(key, request);
    return request;
  }

  async save(
    actor: AuthenticatedActor,
    preferences: UserPreferences,
  ): Promise<RepositoryResult<UserPreferences>> {
    const result = await this.inner.save(actor, preferences);
    if (result.ok) this.pending.delete(actor.userId);
    return result;
  }
}

export const getRequestUserPreferencesRepository = cache(
  async (): Promise<UserPreferencesRepository> => {
    const supabase = await createClient();
    return new RequestMemoUserPreferencesRepository(
      new SupabaseUserPreferencesRepository(
        supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
      ),
    );
  },
);

export { RequestMemoUserPreferencesRepository };
