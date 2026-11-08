import { describe, expect, it } from "vitest";

import { validateExpenseFormValues } from "./expense-form-validation";

const VALID = {
  amountInput: "22.50",
  occurredAtInput: "2026-11-08T10:00",
  category: "groceries",
  needVsWant: "need",
  merchant: "Souk",
  note: "Weekly shop",
  paymentMethod: "cash",
};

describe("validateExpenseFormValues", () => {
  it("accepts a valid form and converts 22.50 MAD to 2250 centimes", () => {
    const result = validateExpenseFormValues(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.amountMinor).toBe(2250);
      expect(result.value.category).toBe("groceries");
      expect(result.value.merchant).toBe("Souk");
    }
  });

  it("rejects invalid, negative and over-precise amounts", () => {
    for (const amountInput of ["", "-3", "0", "1.234", "abc"]) {
      const result = validateExpenseFormValues({ ...VALID, amountInput });
      expect(result.ok, amountInput || "(empty)").toBe(false);
      if (!result.ok) expect(result.fieldErrors.amountInput).toBeTruthy();
    }
  });

  it("rejects unknown category, need/want and payment method", () => {
    expect(
      validateExpenseFormValues({ ...VALID, category: "yacht" }).ok,
    ).toBe(false);
    expect(
      validateExpenseFormValues({ ...VALID, needVsWant: "maybe" }).ok,
    ).toBe(false);
    expect(
      validateExpenseFormValues({ ...VALID, paymentMethod: " IOU " }).ok,
    ).toBe(false);
  });

  it("rejects missing or unparseable date/time", () => {
    expect(
      validateExpenseFormValues({ ...VALID, occurredAtInput: "" }).ok,
    ).toBe(false);
    expect(
      validateExpenseFormValues({ ...VALID, occurredAtInput: "not-a-date" }).ok,
    ).toBe(false);
  });

  it("normalises blank optionals to null and enforces length bounds", () => {
    const blanked = validateExpenseFormValues({
      ...VALID,
      merchant: "   ",
      note: "",
      paymentMethod: "",
    });
    expect(blanked.ok).toBe(true);
    if (blanked.ok) {
      expect(blanked.value.merchant).toBeNull();
      expect(blanked.value.note).toBeNull();
      expect(blanked.value.paymentMethod).toBeNull();
    }
    expect(
      validateExpenseFormValues({ ...VALID, note: "n".repeat(501) }).ok,
    ).toBe(false);
    expect(
      validateExpenseFormValues({ ...VALID, merchant: "m".repeat(121) }).ok,
    ).toBe(false);
  });
});
