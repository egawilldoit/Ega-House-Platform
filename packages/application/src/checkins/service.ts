import {
  mergeDailyCheckinPatch,
  parseDailyCheckinIdentity,
  parseDailyCheckinPatch,
  validateDailyCheckinRecord,
  type DailyCheckin,
} from "@ega/domain/checkins";
import { getWeekWindow } from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryFailure,
} from "../shared/result";
import type {
  DailyCheckinRepository,
  SaveDailyCheckinInput,
  SaveDailyCheckinResult,
} from "./ports";

/** Warn/track threshold: more than two overtime evenings in a week. */
export const OVERTIME_ADVISORY_WEEKLY_THRESHOLD = 2;

const SAVE_FAILURE = "The check-in could not be saved right now. Your entries are still here.";

function failureFor(
  code: RepositoryFailure["code"] | undefined,
): ApplicationResult<never> {
  if (code === "forbidden") {
    return applicationFailure("That check-in is not available to you.", "forbidden");
  }
  return applicationFailure(SAVE_FAILURE, "unknown");
}

/**
 * Daily check-in use cases. Partial saves merge onto the existing record so
 * concurrent clients editing different fields do not erase each other; the
 * merged record is validated before persistence, so a save can never store
 * overtime without a reason or report success after a failed write.
 */
export function createDailyCheckinService(repository: DailyCheckinRepository) {
  return {
    async getDailyCheckin(
      actor: AuthenticatedActor,
      localDate: string,
      timezone: string = "UTC",
    ): Promise<ApplicationResult<DailyCheckin | null>> {
      const identity = parseDailyCheckinIdentity({ localDate, timezone });
      if (!identity.ok) {
        return applicationFailure(identity.message, "validation");
      }
      const result = await repository.get(actor, localDate);
      if (!result.ok) return failureFor(result.error.code);
      return applicationSuccess(result.value);
    },

    async saveDailyCheckin(
      actor: AuthenticatedActor,
      input: SaveDailyCheckinInput,
    ): Promise<ApplicationResult<SaveDailyCheckinResult>> {
      const identity = parseDailyCheckinIdentity(input);
      if (!identity.ok) {
        return applicationFailure(identity.message, "validation");
      }

      const parsed = parseDailyCheckinPatch(input.patch);
      if (!parsed.ok) {
        return applicationFailure(parsed.message, "validation");
      }
      if (Object.keys(parsed.value).length === 0) {
        return applicationFailure("Nothing to save. Change a field first.", "validation");
      }

      const existingResult = await repository.get(actor, identity.localDate);
      if (!existingResult.ok) return failureFor(existingResult.error.code);
      const existing = existingResult.value;

      const nowIso = new Date().toISOString();
      const merged = mergeDailyCheckinPatch(existing, parsed.value, identity, nowIso);
      const validation = validateDailyCheckinRecord(merged);
      if (!validation.ok) {
        return applicationFailure(validation.message, "validation");
      }

      const savedResult = await repository.save(actor, merged);
      if (!savedResult.ok) return failureFor(savedResult.error.code);

      const overtimeAdvisory = await overtimeAdvisoryForWeek(
        repository,
        actor,
        identity.localDate,
        identity.timezone,
      );
      return applicationSuccess({ checkin: savedResult.value, overtimeAdvisory });
    },
  };
}

async function overtimeAdvisoryForWeek(
  repository: DailyCheckinRepository,
  actor: AuthenticatedActor,
  localDate: string,
  timezone: string,
): Promise<string | null> {
  let weekStart: string;
  let weekEnd: string;
  try {
    const window = getWeekWindow(timezone, localDate);
    weekStart = window.weekStart;
    weekEnd = window.weekEnd;
  } catch {
    return null;
  }
  const listed = await repository.listBetween(actor, weekStart, weekEnd);
  if (!listed.ok) return null;
  const overtimeEvenings = listed.value.filter(
    (entry) => entry.overtimeMinutes !== null && entry.overtimeMinutes > 0,
  ).length;
  if (overtimeEvenings <= OVERTIME_ADVISORY_WEEKLY_THRESHOLD) return null;
  return `This week already has ${overtimeEvenings} overtime evenings. Consider protecting a real evening off.`;
}
