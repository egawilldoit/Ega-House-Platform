/**
 * Shared Money vocabulary (MONEY-01 → MONEY-14).
 *
 * This module freezes the shared names from
 * `docs/plans/money-mcp-shared-contract.md`. MONEY-02..05 extend it with the
 * ledger row/movement shapes they own; MONEY-06 owns obligations, so it only
 * depends on this vocabulary (`MoneyKind`, `MoneyPurpose`) and never defines a
 * second ledger or a competing movement contract.
 *
 * `amountMinor` is always a positive integer number of MAD centimes. Direction
 * and kind carry the sign: income is never stored as a negative expense.
 */

export const MONEY_KINDS = [
  "expense",
  "income",
  "opening",
  "savings_transfer",
  "reconciliation_adjustment",
] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

export const MONEY_DIRECTIONS = ["in", "out"] as const;
export type MoneyDirection = (typeof MONEY_DIRECTIONS)[number];

/**
 * Spending purpose is independent from need/want: a fixed subscription can
 * still be a want, and an emergency purchase can be flexible.
 */
export const MONEY_PURPOSES = ["fixed", "flexible", "emergency"] as const;
export type MoneyPurpose = (typeof MONEY_PURPOSES)[number];

export const MONEY_CURRENCY = "MAD" as const;
export type MoneyCurrency = typeof MONEY_CURRENCY;

export function isMoneyKind(value: unknown): value is MoneyKind {
  return (
    typeof value === "string" &&
    (MONEY_KINDS as readonly string[]).includes(value)
  );
}

export function isMoneyDirection(value: unknown): value is MoneyDirection {
  return (
    typeof value === "string" &&
    (MONEY_DIRECTIONS as readonly string[]).includes(value)
  );
}

export function isMoneyPurpose(value: unknown): value is MoneyPurpose {
  return (
    typeof value === "string" &&
    (MONEY_PURPOSES as readonly string[]).includes(value)
  );
}
