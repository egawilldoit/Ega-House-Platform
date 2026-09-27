/**
 * Home greeting/date composition (EGA-661 integration seam).
 *
 * Greeting and date derive ONLY from the canonical Time Context: the Operator
 * snapshot already resolved the owner's persisted IANA timezone and local date
 * through `resolveTimeContext`. This module never reads the runtime/server
 * timezone, never infers a browser/device zone, and renders deterministic
 * labels via pinned `Intl` calls with an explicit `timeZone`.
 *
 * EGA-661 binding point: `apps/web/src/lib/services/time-context-service.ts` will
 * own authenticated web Time Context reads/writes. If it later exposes greeting
 * helpers, Home should adopt them here without changing this module's output
 * contract: `{ greeting, dateLine, fullDateLine, subtitle }`.
 */

const GREETING_MORNING = "Good morning";
const GREETING_AFTERNOON = "Good afternoon";
const GREETING_EVENING = "Good evening";

const HOME_SUBTITLE = "Let's make progress today.";

export type HomeGreeting = {
  greeting: string;
  /** Small-caps eyebrow line, e.g. "TUE, SEP 24, 2024". */
  dateLine: string;
  /** Long-form local date, e.g. "Sunday, September 27". */
  fullDateLine: string;
  subtitle: string;
};

function getLocalHour(timezone: string, now: Date): number {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
    // Intl can return "24" for midnight in some engines.
    return Number.isFinite(hour) ? hour % 24 : 12;
  } catch {
    return 12;
  }
}

function buildGreeting(hour: number): string {
  if (hour < 12) return GREETING_MORNING;
  if (hour < 18) return GREETING_AFTERNOON;
  return GREETING_EVENING;
}

function formatDateLine(date: string, timezone: string): string {
  // "TUE, SEP 24, 2024" — pinned parts so no locale reorders them.
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(`${date}T12:00:00.000Z`));
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
  }).format(new Date(`${date}T12:00:00.000Z`));
  const day = Number(date.slice(8, 10));
  const year = date.slice(0, 4);
  return `${weekday.toUpperCase()}, ${month.toUpperCase()} ${day}, ${year}`;
}

function formatFullDateLine(date: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

/**
 * Compose the Home header lines from canonical date + timezone + identity.
 *
 * @param date     canonical local date (YYYY-MM-DD) from the Operator snapshot
 * @param timezone canonical IANA timezone from the Operator snapshot
 * @param name     server-derived display identity (email handle when no name)
 * @param now      optional clock for deterministic tests
 */
export function buildHomeGreeting(input: {
  date: string;
  timezone: string;
  name: string;
  now?: Date;
}): HomeGreeting {
  const { date, timezone, name } = input;
  const now = input.now ?? new Date();
  const hour = getLocalHour(timezone, now);
  const trimmedName = input.name.trim();

  return {
    greeting: `${buildGreeting(hour)}, ${trimmedName}`,
    dateLine: formatDateLine(date, timezone),
    fullDateLine: formatFullDateLine(date, timezone),
    subtitle: HOME_SUBTITLE,
  };
}
