import { zonedWallTimeToUtcIso } from "@ega/domain/time-context";

/**
 * Convert an owner-entered `datetime-local` wall time into the financial
 * instant and booking date.
 *
 * The timezone must come from verified server state (the target Money period,
 * otherwise the owner's stored time context). A browser timezone is never an
 * authoritative financial input. Invalid and non-existent local times (DST
 * gaps) are rejected by the canonical timezone utility instead of being
 * silently shifted; an ambiguous fall-back wall time uses the utility's
 * deterministic offset resolution rather than a browser guess.
 */
/**
 * One date authority for Money writes.
 *
 * A configured tracking Money period owns the financial calendar: its stored
 * IANA timezone interprets an entered wall time, including a wall date after the
 * current window (automatic continuation copies the same timezone to the
 * successor). The owner's general time context is only the fallback when no
 * Money period exists yet. Mixing the two authorities would let the browser
 * page and the database derive different booking days.
 */
export function moneyWriteTimezone(input: Readonly<{
  trackingPeriodTimezone: string | null;
  ownerTimezone: string;
}>): string {
  const periodTimezone = input.trackingPeriodTimezone?.trim();
  return periodTimezone ? periodTimezone : input.ownerTimezone;
}

export function moneyWallTimeToOccurredAt(input: Readonly<{
  wallTime: string;
  timezone: string;
}>):
  | { ok: true; occurredAt: string; bookingDate: string }
  | { ok: false; error: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(
    input.wallTime.trim(),
  );
  if (!match) {
    return { ok: false, error: "Enter a valid local date and time." };
  }
  const date = match[1]!;
  const time = `${match[2]}${match[3] ? `:${match[3]}` : ""}`;
  try {
    return {
      ok: true,
      occurredAt: zonedWallTimeToUtcIso({
        timezone: input.timezone,
        date,
        time,
      }),
      bookingDate: date,
    };
  } catch {
    return {
      ok: false,
      error:
        "That local time does not exist in the Money timezone. Choose another time.",
    };
  }
}
