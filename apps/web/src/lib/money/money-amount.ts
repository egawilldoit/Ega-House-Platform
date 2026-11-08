/**
 * Integer-safe MAD amount parsing and formatting (PO-06B, Team B).
 *
 * The ledger stores positive integer centimes; no floating-point value may
 * reach persistence. Parsing is string-based (`major * 100 + minor`) so
 * `22.50 MAD` becomes exactly `2250`. Formatting derives from integer
 * division/remainder for the same reason.
 */

export const MAD_CURRENCY_LABEL = "MAD" as const;

/** PostgreSQL int4 bounds shared with `@ega/domain` expenses. */
export const MAD_AMOUNT_MINOR_MIN = 1;
export const MAD_AMOUNT_MINOR_MAX = 2_147_483_647;

export type MadAmountParseResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Parse an amount-first MAD input into integer centimes.
 *
 * Accepts digits with an optional single `.` or `,` decimal separator and up
 * to two fraction digits (e.g. `22`, `22.5`, `22.50`, `22,50`). Plain spaces
 * are tolerated as thousand separators (`1 250.00`). Rejects empty,
 * negative, zero, over-precise (`22.555`), non-numeric and out-of-range
 * input. Never uses floating-point arithmetic.
 */
export function parseMadAmountToMinor(raw: unknown): MadAmountParseResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter an amount in MAD." };
  }
  const compact = raw.replace(/\s+/g, "").replace(",", ".").trim();
  if (!compact) {
    return { ok: false, error: "Enter an amount in MAD." };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(compact)) {
    if (/^-\d/.test(compact) || compact.startsWith("+")) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
    if (/^\d+\.\d{3,}$/.test(compact)) {
      return { ok: false, error: "Amount supports at most two decimals." };
    }
    return { ok: false, error: "Enter a valid amount, e.g. 22.50." };
  }
  const [majorPart, fractionPart = ""] = compact.split(".");
  const major = Number(majorPart);
  const minor = fractionPart ? Number(fractionPart.padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
    return { ok: false, error: "Enter a valid amount, e.g. 22.50." };
  }
  const value = major * 100 + minor;
  if (value < MAD_AMOUNT_MINOR_MIN) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  if (value > MAD_AMOUNT_MINOR_MAX) {
    return { ok: false, error: "Amount is too large." };
  }
  return { ok: true, value };
}

/** Format integer centimes as `22.50 MAD` without floating point. */
export function formatMinorToMad(amountMinor: number): string {
  const major = Math.trunc(amountMinor / 100);
  const minor = Math.abs(amountMinor % 100);
  return `${major}.${String(minor).padStart(2, "0")} ${MAD_CURRENCY_LABEL}`;
}

/** Format integer centimes as a bare input value (`22.50`). */
export function formatMinorToMadInput(amountMinor: number): string {
  const major = Math.trunc(amountMinor / 100);
  const minor = Math.abs(amountMinor % 100);
  return `${major}.${String(minor).padStart(2, "0")}`;
}
