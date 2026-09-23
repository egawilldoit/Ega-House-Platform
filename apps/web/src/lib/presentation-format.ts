/**
 * Central display-formatting policy for the authenticated web workspace.
 *
 * One module owns how numbers, durations, dates and statuses are rendered so
 * two screens cannot disagree about the same value. Presentation only: stored
 * values, domain tokens, URL params and API payloads are never transformed here.
 *
 * Determinism: every formatter pins `en-US` and an explicit `timeZone`, so the
 * server render and the client hydration produce identical strings.
 */

const DISPLAY_LOCALE = "en-US";

/**
 * Timestamps are rendered in UTC, matching what the deployed app has always
 * shown (server rendering in UTC). Pinning it explicitly removes the previous
 * server-local/client-local divergence instead of leaving it to chance.
 */
const DISPLAY_TIME_ZONE = "UTC";

export const DISPLAY_EMPTY = "—";

/** Unicode minus sign, so negative values never look like hyphens. */
const MINUS = "\u2212";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLocaleText(value: string) {
  return value.replace(/^-/, MINUS);
}

/* ── Percentages ──────────────────────────────────────────────────────── */

export type DisplayPercentOptions = {
  /** Prefix non-zero positives with "+" and use a true minus for negatives. */
  signed?: boolean;
  /** Defaults to 1. */
  maximumFractionDigits?: number;
};

/**
 * Percent with at most one decimal place by default.
 *
 * 38.45697329376855 -> "38.5%"
 * -38.45697329376855 -> "−38.5%"
 * 18 (signed)       -> "+18%"
 * 0                 -> "0%"
 * null              -> "—"
 */
export function formatDisplayPercent(
  value: number | null | undefined,
  options: DisplayPercentOptions = {},
): string {
  if (!isFiniteNumber(value)) return DISPLAY_EMPTY;

  const { signed = false, maximumFractionDigits = 1 } = options;
  const rounded = Number(value.toFixed(maximumFractionDigits));
  const formatted = new Intl.NumberFormat(DISPLAY_LOCALE, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(Math.abs(rounded));

  if (rounded === 0) return `${formatted}%`;
  if (rounded < 0) return `${MINUS}${formatted}%`;
  return signed ? `+${formatted}%` : `${formatted}%`;
}

/** Ratio (0.5) or already-percent (50) input, rendered through one policy. */
export function formatDisplayRatioPercent(
  ratio: number | null | undefined,
  options: DisplayPercentOptions = {},
): string {
  if (!isFiniteNumber(ratio)) return DISPLAY_EMPTY;
  return formatDisplayPercent(ratio * 100, options);
}

/** Whole-number count with grouping; null/undefined render as an em dash. */
export function formatDisplayCount(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DISPLAY_EMPTY;
  return new Intl.NumberFormat(DISPLAY_LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/** Compact multiplier such as "2.3×" for actual-vs-estimate comparisons. */
export function formatDisplayMultiple(
  value: number | null | undefined,
  maximumFractionDigits = 1,
): string {
  if (!isFiniteNumber(value)) return DISPLAY_EMPTY;
  return `${new Intl.NumberFormat(DISPLAY_LOCALE, {
    maximumFractionDigits,
  }).format(value)}×`;
}

/* ── Durations ────────────────────────────────────────────────────────── */

export type DurationPrecision = "minute" | "second";

/**
 * Durations are rendered at one of two semantic levels.
 *
 * - "minute" (dashboards, KPI strips, totals): seconds are noise.
 *     83h 10m 0s -> "83h 10m"
 *     11h 0m 0s  -> "11h"
 *     45m 0s     -> "45m"
 *     0          -> "0m"
 * - "second" (individual session rows): seconds stay meaningful.
 *     1h 20m 23s -> "1h 20m 23s"
 *
 * Stored durations are untouched; only the label changes.
 */
export function formatDisplayDuration(
  seconds: number | null | undefined,
  precision: DurationPrecision = "minute",
): string {
  if (!isFiniteNumber(seconds)) return DISPLAY_EMPTY;

  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (precision === "second") {
    if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/** Minute-based estimate labels keep the existing short product convention. */
export function formatDisplayEstimate(minutes: number | null | undefined): string {
  if (!isFiniteNumber(minutes)) return DISPLAY_EMPTY;
  const safe = Math.max(0, Math.round(minutes));
  if (safe === 0) return "0m";
  if (safe < 60) return `${safe}m`;
  const hours = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/* ── Dates ────────────────────────────────────────────────────────────── */

export type DateDisplayStyle = "compact" | "detail" | "analytics";

const DATE_STYLES: Record<DateDisplayStyle, Intl.DateTimeFormatOptions> = {
  compact: { month: "short", day: "numeric" },
  detail: { month: "short", day: "numeric", year: "numeric" },
  analytics: { month: "short", day: "numeric" },
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date label with a single policy.
 *
 * - "compact"   -> "Sep 20"
 * - "detail"    -> "Sep 20, 2026"
 * - "analytics" -> "Sep 16"
 *
 * Date-only values (`YYYY-MM-DD`, e.g. task due dates) are interpreted as UTC
 * midnight and rendered from their UTC parts, so they can never shift a day.
 */
export function formatDisplayDate(
  value: string | null | undefined,
  style: DateDisplayStyle = "compact",
): string {
  if (!value) return DISPLAY_EMPTY;

  const iso = DATE_ONLY_PATTERN.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return DISPLAY_EMPTY;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    ...DATE_STYLES[style],
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export type DisplayTimeOptions = {
  /** "short" -> "3:52 PM"; "24h" -> "15:52". */
  clock?: "short" | "24h";
};

export function formatDisplayTime(
  value: string | null | undefined,
  options: DisplayTimeOptions = {},
): string {
  if (!value) return DISPLAY_EMPTY;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return DISPLAY_EMPTY;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    hour: options.clock === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: options.clock !== "24h",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/**
 * Compact date + time for dense evidence rows: "Sep 22, 3:52 PM".
 */
export function formatDisplayDateTime(
  value: string | null | undefined,
  options: DisplayTimeOptions = {},
): string {
  if (!value) return DISPLAY_EMPTY;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return DISPLAY_EMPTY;

  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    hour: options.clock === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: options.clock !== "24h",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/** A time range for one session: "3:52 PM – 5:55 PM". */
export function formatDisplayTimeRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  options: DisplayTimeOptions = {},
): string {
  const start = formatDisplayTime(startIso, options);
  if (start === DISPLAY_EMPTY) return DISPLAY_EMPTY;
  if (!endIso) return start;
  const end = formatDisplayTime(endIso, options);
  if (end === DISPLAY_EMPTY) return start;
  return `${start} – ${end}`;
}

/* ── Status labels ────────────────────────────────────────────────────── */

/**
 * Keyed by the separator-normalized token (lowercase, `-`/`_` collapsed to a
 * single space) so `in_progress`, `in-progress` and `In Progress` all resolve to
 * one label instead of falling through to the generic humanizer.
 */
const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  "to do": "To do",
  "in progress": "In progress",
  done: "Done",
  completed: "Completed",
  blocked: "Blocked",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  active: "Active",
  archived: "Archived",
  draft: "Draft",
  paused: "Paused",
  "on track": "On Track",
  "at risk": "At Risk",
  "off track": "Off Track",
};

function normalizeStatusKey(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Canonical display label for a status token.
 *
 * Domain values (`todo`, `in_progress`, `done`, `blocked`) are unchanged; only
 * the label is normalized so the UI never mixes "Todo" with "To do".
 */
export function formatDisplayStatus(value: string | null | undefined): string {
  if (!value) return DISPLAY_EMPTY;

  const normalized = normalizeStatusKey(value);
  const known = STATUS_LABELS[normalized];
  if (known) return known;

  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Sentence-case token for free-form enum values (priority, health, …). */
export function formatDisplayToken(value: string | null | undefined): string {
  if (!value) return DISPLAY_EMPTY;

  const normalized = normalizeStatusKey(value);
  const known = STATUS_LABELS[normalized];
  if (known) return known;

  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Signed duration delta for comparison rows: "+5h 12m" / "−1h". */
export function formatDisplayDurationDelta(
  seconds: number | null | undefined,
  precision: DurationPrecision = "minute",
): string {
  if (!isFiniteNumber(seconds)) return DISPLAY_EMPTY;
  if (Math.abs(seconds) < 1) return "no change";

  const magnitude = formatDisplayDuration(Math.abs(seconds), precision);
  return seconds > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`;
}

/** Applies the display minus sign to any already-formatted signed string. */
export { normalizeLocaleText };
