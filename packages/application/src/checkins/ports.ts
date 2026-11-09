import type {
  DailyCheckin,
  DailyCheckinPatch,
} from "@ega/domain/checkins";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence port for the canonical daily check-in store. Every operation
 * takes the verified actor; implementations must filter by the owner id in
 * addition to request-scoped RLS. There is at most one row per
 * (owner, local_date).
 */

export type DailyCheckinRepository = {
  get(actor: AuthenticatedActor, localDate: string): Promise<RepositoryResult<DailyCheckin | null>>;
  /** Bounded inclusive local-date range, ascending. Used for advisory counts. */
  listBetween(
    actor: AuthenticatedActor,
    startLocalDate: string,
    endLocalDate: string,
  ): Promise<RepositoryResult<DailyCheckin[]>>;
  /** Insert or replace the single owner/date row. */
  save(actor: AuthenticatedActor, record: DailyCheckin): Promise<RepositoryResult<DailyCheckin>>;
};

export type SaveDailyCheckinInput = Readonly<{
  localDate: string;
  timezone: string;
  patch: DailyCheckinPatch;
}>;

export type SaveDailyCheckinResult = Readonly<{
  checkin: DailyCheckin;
  /** Non-blocking advisory when this week has more than two overtime evenings. */
  overtimeAdvisory: string | null;
}>;
