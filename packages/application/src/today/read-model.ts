import type { AuthenticatedActor } from "../auth/actor";
import { toLocalIsoDate } from "../shared/duration";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TodayReadPort } from "./ports";
import { buildTodayPlan, type TodayPlan } from "./plan";

export async function getTodayPlan(
  actor: AuthenticatedActor,
  port: TodayReadPort,
  input: Readonly<{ date?: unknown; now?: Date }> = {},
): Promise<ApplicationResult<TodayPlan>> {
  const now = input.now ?? new Date();
  const rawDate = String(input.date ?? "").trim();
  const today = rawDate || toLocalIsoDate(now);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return applicationFailure("Today date is invalid.");
  }

  const nowIso = now.toISOString();
  const dayWindowStart = new Date(`${today}T00:00:00`);
  const windowStartIso = (() => {
    const dayStart = new Date(dayWindowStart);
    if (Number.isNaN(dayStart.valueOf())) return nowIso;
    dayStart.setHours(0, 0, 0, 0);
    return dayStart.toISOString();
  })();

  const [selectedResult, pinnedResult, inProgressResult, timerResult] = await Promise.all([
    port.listSelectedTasks(actor, { today }),
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
