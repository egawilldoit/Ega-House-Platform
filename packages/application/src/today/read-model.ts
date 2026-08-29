import { getLocalDayWindow } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { resolveTimeContext, type TimeContextRepository } from "../shared/time-context";
import type { TodayReadPort } from "./ports";
import { buildTodayPlan, type TodayPlan } from "./plan";

export async function getTodayPlan(
  actor: AuthenticatedActor,
  port: TodayReadPort,
  timeContextRepository: TimeContextRepository,
  input: Readonly<{ date?: unknown; now?: Date; timezone?: unknown }> = {},
): Promise<ApplicationResult<TodayPlan>> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Today date is invalid.");
  }
  const rawDate = String(input.date ?? "").trim();
  const requestedTimezone =
    typeof input.timezone === "string" ? input.timezone.trim() : null;

  const timeContextResult = await resolveTimeContext(actor, timeContextRepository, {
    requestedTimezone: requestedTimezone ?? undefined,
    now,
  });
  if (!timeContextResult.ok) {
    return applicationFailure("Unable to load Today right now.");
  }

  let today: string;
  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return applicationFailure("Today date is invalid.");
    }
    today = rawDate;
  } else {
    today = timeContextResult.data.localDate;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return applicationFailure("Today date is invalid.");
  }

  const nowIso = now.toISOString();
  let windowStartIso: string;
  let windowEndIso: string;
  try {
    const effective = timeContextResult.data.timezone;
    const dayWindow = getLocalDayWindow(effective, today);
    windowStartIso = dayWindow.startUtcIso;
    windowEndIso = dayWindow.endUtcIso;
  } catch {
    return applicationFailure("Today date is invalid.");
  }

  const [selectedResult, pinnedResult, inProgressResult, timerResult] = await Promise.all([
    port.listSelectedTasks(actor, { today, windowStartIso, windowEndIso }),
    port.listPinnedSuggestions(actor, { limit: 80 }),
    port.listInProgressSuggestions(actor, { limit: 80 }),
    port.getTodayTimerSnapshot(actor, { nowIso, windowStartIso }),
  ]);

  if (!selectedResult.ok) return applicationFailure("Unable to load Today right now.");
  if (!pinnedResult.ok || !inProgressResult.ok) {
    return applicationFailure("Unable to load Today suggestions right now.");
  }

  const timerSnapshot = timerResult.ok
    ? timerResult.value
    : { activeTimer: null, trackedTodaySeconds: 0 };

  return applicationSuccess(
    buildTodayPlan({
      today,
      selectedRows: selectedResult.value,
      pinnedRows: pinnedResult.value,
      inProgressRows: inProgressResult.value,
      activeTimer: timerSnapshot.activeTimer,
      trackedTodaySeconds: timerSnapshot.trackedTodaySeconds,
    }),
  );
}
