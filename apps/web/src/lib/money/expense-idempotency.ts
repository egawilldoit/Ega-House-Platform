/**
 * Stable idempotency keys for expense creation (PO-06B, Team B).
 *
 * Contract with the backend (`POST /api/expenses`): one logical purchase owns
 * exactly one key. The key must be generated once per logical purchase,
 * retained across timeout/retry (including double-click), and rotated only
 * for a genuinely new purchase — never per attempt. The server replays the
 * same row for a repeated key+payload and rejects a reused key with a
 * different payload (409), so key stability is a correctness property, not an
 * optimisation.
 */

export const EXPENSE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function createExpenseIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `expense-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/**
 * Guard for a key received from elsewhere (restored draft, test fixture).
 * Mirrors the domain rule: required, no control characters, bounded length.
 */
export function isExpenseIdempotencyKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > EXPENSE_IDEMPOTENCY_KEY_MAX_LENGTH) {
    return false;
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  return true;
}
