import { describe, expect, it } from "vitest";

import {
  createExpenseIdempotencyKey,
  isExpenseIdempotencyKey,
} from "./expense-idempotency";

describe("expense idempotency keys", () => {
  it("generates distinct keys for distinct purchases", () => {
    const first = createExpenseIdempotencyKey();
    const second = createExpenseIdempotencyKey();
    expect(first).not.toBe("");
    expect(second).not.toBe("");
    expect(first).not.toBe(second);
  });

  it("accepts generated keys and rejects blank, oversized or control-char keys", () => {
    expect(isExpenseIdempotencyKey(createExpenseIdempotencyKey())).toBe(true);
    expect(isExpenseIdempotencyKey("")).toBe(false);
    expect(isExpenseIdempotencyKey("   ")).toBe(false);
    expect(isExpenseIdempotencyKey("a".repeat(129))).toBe(false);
    expect(isExpenseIdempotencyKey("key\nwith\nnewline")).toBe(false);
    expect(isExpenseIdempotencyKey(null)).toBe(false);
  });
});
