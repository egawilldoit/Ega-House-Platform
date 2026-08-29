import {
  FRICTION_NEGLECTED_GOAL_WINDOW_DAYS,
  getLocalDateInTimezone,
  getLocalDayWindow,
  getRollingLocalWindow,
  getWeekWindow,
  isValidIANATimeZone,
  type LocalDayWindow,
  type LocalWeekWindow,
  type TimeContextFallback,
} from "@ega/domain";
import type { ExecutionEvidenceWindow } from "./execution-evidence";

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

function normalizeRequestedTimezone(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw : null;
}

export async function resolveTimeContext(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
  input: Readonly<{ requestedTimezone?: unknown; now?: Date }> = {},
): Promise<ApplicationResult<ResolvedTimeContext>> {
  const requestedRaw = normalizeRequestedTimezone(input.requestedTimezone);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }

  let effective: string;
  let fallback: TimeContextFallback;
  let requested: string | null;

  if (requestedRaw !== null) {
    if (isValidIANATimeZone(requestedRaw)) {
      effective = requestedRaw;
      fallback = "none";
      requested = requestedRaw;
    } else {
      effective = "UTC";
      fallback = "invalid_timezone";
      requested = requestedRaw;
    }
  } else {
    const storedResult = await repository.getTimezone(actor);
    if (!storedResult.ok) {
      return applicationFailure("Unable to load time context right now.");
    }
    const stored = storedResult.value ? String(storedResult.value).trim() : null;
    if (stored && isValidIANATimeZone(stored)) {
      effective = stored;
      fallback = "none";
      requested = null;
    } else if (stored) {
      effective = "UTC";
      fallback = "invalid_timezone";
      requested = stored;
    } else {
      effective = "UTC";
      fallback = "missing_timezone";
      requested = null;
    }
  }

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

export async function resolveFrictionEvidenceWindow(
  actor: AuthenticatedActor,
  repository: TimeContextRepository,
  input: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<ExecutionEvidenceWindow>> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }
  const timeCtx = await resolveTimeContext(actor, repository, { now });
  if (!timeCtx.ok) {
    return applicationFailure(timeCtx.errorMessage);
  }
  try {
    const window = getRollingLocalWindow(
      timeCtx.data.timezone,
      now,
      FRICTION_NEGLECTED_GOAL_WINDOW_DAYS,
    );
    return applicationSuccess({ startIso: window.startIso, endIso: window.endIso });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve neglected window.";
    return applicationFailure(message);
  }
}
