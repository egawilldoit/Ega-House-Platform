import {
  getLocalDateInTimezone,
  getLocalDayWindow,
  getWeekWindow,
  isValidIANATimeZone,
  type LocalDayWindow,
  type LocalWeekWindow,
  type TimeContextFallback,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult, type RepositoryResult } from "../shared/result";

export type TimeContextRepository = {
  getTimezone(actor: AuthenticatedActor): Promise<RepositoryResult<string | null>>;
  setTimezone(actor: AuthenticatedActor, timezone: string): Promise<RepositoryResult<string>>;
};

export type ResolvedTimeContext = Readonly<{
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  localDate: string;
  dayWindow: LocalDayWindow;
  weekWindow: LocalWeekWindow;
}>;

export type EffectiveTimeContext = Readonly<{
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
}>;

export async function resolveEffectiveTimezone(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
  requestedTimezone: unknown,
): Promise<ApplicationResult<EffectiveTimeContext>> {
  const rawRequested = typeof requestedTimezone === "string" ? requestedTimezone.trim() : "";
  if (rawRequested) {
    if (isValidIANATimeZone(rawRequested)) {
      return applicationSuccess({ timezone: rawRequested, requestedTimezone: rawRequested, fallback: "none" });
    }
    return applicationSuccess({ timezone: "UTC", requestedTimezone: rawRequested, fallback: "invalid_timezone" });
  }

  const storedResult = await repository.getTimezone(actor);
  if (!storedResult.ok) {
    return applicationFailure("Unable to load time context right now.");
  }
  const stored = storedResult.value ? String(storedResult.value).trim() : null;
  if (stored && isValidIANATimeZone(stored)) {
    return applicationSuccess({ timezone: stored, requestedTimezone: null, fallback: "none" });
  }
  if (stored) {
    return applicationSuccess({ timezone: "UTC", requestedTimezone: stored, fallback: "invalid_timezone" });
  }
  return applicationSuccess({ timezone: "UTC", requestedTimezone: null, fallback: "missing_timezone" });
}

export async function resolveTimeContext(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
  input: Readonly<{ requestedTimezone?: unknown; now?: Date }> = {},
): Promise<ApplicationResult<ResolvedTimeContext>> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }

  const effectiveResult = await resolveEffectiveTimezone(actor, repository, input.requestedTimezone);
  if (!effectiveResult.ok) {
    return applicationFailure(effectiveResult.errorMessage);
  }
  const { timezone: effective, requestedTimezone: requested, fallback } = effectiveResult.data;

  let localDate: string;
  try {
    localDate = getLocalDateInTimezone(now, effective);
  } catch {
    return applicationFailure("Unable to resolve local date right now.");
  }

  let dayWindowRaw: LocalDayWindow;
  let weekWindowRaw: LocalWeekWindow;
  try {
    dayWindowRaw = getLocalDayWindow(effective, localDate);
    weekWindowRaw = getWeekWindow(effective, localDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve time window.";
    return applicationFailure(message);
  }

  const dayWindow: LocalDayWindow = {
    ...dayWindowRaw,
    timezone: effective,
    requestedTimezone: requested,
    fallback,
  };
  const weekWindow: LocalWeekWindow = {
    ...weekWindowRaw,
    timezone: effective,
    requestedTimezone: requested,
    fallback,
  };

  return applicationSuccess({
    timezone: effective,
    requestedTimezone: requested,
    fallback,
    localDate,
    dayWindow,
    weekWindow,
  });
}

export async function setTimeContextTimezone(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
  input: Readonly<{ timezone: unknown }>,
): Promise<ApplicationResult<string>> {
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : String(input.timezone ?? "").trim();
  if (!isValidIANATimeZone(timezone)) {
    return applicationFailure("Timezone is invalid.");
  }
  const result = await repository.setTimezone(actor, timezone);
  if (!result.ok) {
    return applicationFailure("Unable to save timezone right now.");
  }
  return applicationSuccess(result.value);
}

export async function getTimeContextTimezone(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
): Promise<ApplicationResult<string | null>> {
  const result = await repository.getTimezone(actor);
  if (!result.ok) {
    return applicationFailure("Unable to load time context right now.");
  }
  return applicationSuccess(result.value);
}

export function resolveHistoricalTimeContext(
  input: Readonly<{ timezone?: unknown; date?: unknown }>,
): ApplicationResult<Readonly<{ dayWindow: LocalDayWindow; weekWindow: LocalWeekWindow }>> {
  const dateStr = String(input.date ?? "").trim();
  const tzRaw = input.timezone === undefined || input.timezone === null ? "UTC" : String(input.timezone).trim();
  try {
    const dayWindow = getLocalDayWindow(tzRaw || null, dateStr);
    const weekWindow = getWeekWindow(tzRaw || null, dateStr);
    return applicationSuccess({ dayWindow, weekWindow });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid time context input.";
    if (message.includes("Invalid date")) {
      return applicationFailure("Date is invalid. Expected YYYY-MM-DD.");
    }
    return applicationFailure(message);
  }
}
