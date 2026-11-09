// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickExpenseSheet } from "./quick-expense-sheet";
import type { QuickExpenseSubmitInput, QuickExpenseSubmitResult } from "./quick-expense-sheet";
import type { ExpenseDto } from "@ega/contracts/expenses";

const EXPENSE = {
  id: "00000000-0000-4000-8000-000000000001",
  occurredAt: "2026-11-08T10:00:00.000Z",
  amountMinor: 2200,
  currency: "MAD",
  category: "coffee",
  note: null,
  merchant: null,
  needVsWant: "want",
  paymentMethod: null,
  idempotencyKey: "key",
} as unknown as ExpenseDto;

function okSubmit() {
  return vi.fn(
    async (_input: QuickExpenseSubmitInput): Promise<QuickExpenseSubmitResult> => ({
      ok: true as const,
      expense: EXPENSE,
      replayed: false,
    }),
  );
}

function failSubmit() {
  return vi.fn(
    async (_input: QuickExpenseSubmitInput): Promise<QuickExpenseSubmitResult> => ({
      ok: false as const,
      error: "Network down",
    }),
  );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderSheet(
  submitExpense: (input: QuickExpenseSubmitInput) => Promise<QuickExpenseSubmitResult>,
) {
  await act(async () => {
    root.render(<QuickExpenseSheet ownerKey="owner-1" submitExpense={submitExpense} />);
  });
  const trigger = container.querySelector<HTMLButtonElement>(
    'button:not([aria-label="Close quick expense"])',
  );
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function amountInput() {
  return document.querySelector<HTMLInputElement>("#quick-expense-amount")!;
}

describe("QuickExpenseSheet", () => {
  it("saves 22 MAD Coffee once and rotates the key for the next purchase", async () => {
    const submitExpense = okSubmit();
    await renderSheet(submitExpense);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(amountInput(), "22");
      amountInput().dispatchEvent(new Event("input", { bubbles: true }));
      amountInput().dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(submitExpense).toHaveBeenCalledTimes(1);
    const first = submitExpense.mock.calls[0]![0] as QuickExpenseSubmitInput;
    expect(first.amountMinor).toBe(2200);
    expect(first.category).toBe("coffee");
    expect(document.body.textContent).toContain("Expense saved.");

    // A second purchase gets a different key.
    const another = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Another purchase"),
    );
    await act(async () => {
      another?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(amountInput(), "22");
      amountInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submitExpense).toHaveBeenCalledTimes(2);
    const second = submitExpense.mock.calls[1]![0] as QuickExpenseSubmitInput;
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.amountMinor).toBe(2200);
  });

  it("keeps inputs and the same key on failure so a retry cannot duplicate", async () => {
    const submitExpense = failSubmit();
    await renderSheet(submitExpense);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(amountInput(), "22,50");
      amountInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("Network down");
    expect(amountInput().value).toBe("22,50");

    const first = submitExpense.mock.calls[0]![0] as QuickExpenseSubmitInput;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submitExpense).toHaveBeenCalledTimes(2);
    const retried = submitExpense.mock.calls[1]![0] as QuickExpenseSubmitInput;
    expect(retried.idempotencyKey).toBe(first.idempotencyKey);
    expect(retried.amountMinor).toBe(2250);
  });

  it("rejects invalid amounts inline without calling submit", async () => {
    const submitExpense = okSubmit();
    await renderSheet(submitExpense);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(amountInput(), "-5");
      amountInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = document.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(submitExpense).not.toHaveBeenCalled();
    expect(document.querySelector("#quick-expense-amount-error")?.textContent).toBeTruthy();
  });
});
