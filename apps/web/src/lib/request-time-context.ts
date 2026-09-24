import { cache } from "react";

import type {
  AuthenticatedActor,
  RepositoryResult,
  TimeContextRepository,
} from "@ega/application";
import { SupabaseTimeContextRepository } from "@ega/data-access";

import { createClient } from "@/lib/supabase/server";

/**
 * Memoizes `getTimezone` for the lifetime of one request while delegating writes.
 *
 * The stored timezone is a single row per owner, but the Operator snapshot,
 * health snapshot, friction radar and shell metrics each resolve it separately
 * when a page composes them. Sharing this repository collapses those reads into
 * one query. The cache is held by the repository instance, which is itself
 * request-scoped, so no timezone is reused across requests.
 */
class RequestMemoTimeContextRepository implements TimeContextRepository {
  private readonly pending = new Map<string, Promise<RepositoryResult<string | null>>>();

  constructor(private readonly inner: TimeContextRepository) {}

  getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>> {
    const key = actor.userId;
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }

    const request = this.inner.getTimezone(actor);
    this.pending.set(key, request);
    return request;
  }

  async setTimezone(
    actor: AuthenticatedActor,
    timezone: string,
  ): Promise<RepositoryResult<string>> {
    const result = await this.inner.setTimezone(actor, timezone);
    if (result.ok) {
      this.pending.delete(actor.userId);
    }
    return result;
  }
}

/**
 * Request-scoped time-context repository for web read paths.
 *
 * Only read paths use this. Callers that inject their own Supabase client (tests
 * and dependency injection) keep constructing their own repository so injected
 * behavior is unchanged.
 */
export const getRequestTimeContextRepository = cache(
  async (): Promise<TimeContextRepository> => {
    const supabase = await createClient();
    return new RequestMemoTimeContextRepository(
      new SupabaseTimeContextRepository(
        supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
      ),
    );
  },
);

export { RequestMemoTimeContextRepository };
