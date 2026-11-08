// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExpenseCreateForm } from "./expense-create-form";
import type { ExpenseCreateSubmitResult } from "./expense-create-form";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillValidForm() {
  setInputValue(
    container.querySelector<HTMLInputElement>("#expense-create-amount")!,
    "22.50",
  );
  setInputValue(
    container.querySelector<HTMLInputElement>("#expense-create-occurred-at")!,
    "2026-11-08T10:00",
  );
  setSelectValue(
    container.querySelector<HTMLSelectElement>("#expense-create-category")!,
    "groceries",
  );
  setSelectValue(
    container.querySelector<HTMLSelectElement>("#expense-create-need")!,
    "need",
  );
}

async function submitForm() {
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
}

describe("ExpenseCreateForm", () => {
  it("ignores an old owner's response without releasing the new owner's pending submit", async () => {
    const responses: Array<(value: ExpenseCreateSubmitResult) => void> = [];
    const submitExpense = vi.fn(() => new Promise<ExpenseCreateSubmitResult>((resolve) => responses.push(resolve)));
    const onCreated = vi.fn();
    const renderOwner = async (ownerKey: string) => {
      await act(async () => root.render(<ExpenseCreateForm ownerKey={ownerKey} submitExpense={submitExpense} onCreated={onCreated} />));
    };
    await renderOwner("owner-a");
    await act(async () => fillValidForm());
    await submitForm();
    await renderOwner("owner-b");
    await act(async () => fillValidForm());
    await submitForm();
    await act(async () => responses[0]({ ok: true, expense: { id: "owner-a-expense" } as never, replayed: false }));
    expect(onCreated).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
    await submitForm();
    expect(submitExpense).toHaveBeenCalledTimes(2);
    await act(async () => responses[1]({ ok: true, expense: { id: "owner-b-expense" } as never, replayed: false }));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it.each(["failure", "rejection", "unmount"])("ignores a stale %s response even after returning to the original owner", async (outcome) => {
    let resolve!: (value: ExpenseCreateSubmitResult) => void;
    let reject!: (reason: Error) => void;
    const submitExpense = vi.fn(() => new Promise<ExpenseCreateSubmitResult>((done, fail) => {
      resolve = done;
      reject = fail;
    }));
    const onCreated = vi.fn();
    const renderOwner = async (ownerKey: string) => {
      await act(async () => root.render(<ExpenseCreateForm ownerKey={ownerKey} submitExpense={submitExpense} onCreated={onCreated} />));
    };
    await renderOwner("owner-a");
    await act(async () => fillValidForm());
    await submitForm();
    await renderOwner("owner-b");
    await renderOwner("owner-a");
    if (outcome === "unmount") await act(async () => root.render(null));
    await act(async () => {
      if (outcome === "rejection") reject(new Error("old owner transport error"));
      else if (outcome === "failure") resolve({ ok: false, error: "old owner failure" });
      else resolve({ ok: true, expense: { id: "old-owner-row" } as never, replayed: false });
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/old owner failure|Unable to save/);
  });

  it("blocks double submit and reuses one idempotency key across the attempts", async () => {
    const seenKeys: string[] = [];
    let resolveSubmit!: (value: ExpenseCreateSubmitResult) => void;
    const submitExpense = vi.fn(
      (input: { idempotencyKey: string }) =>
        new Promise<ExpenseCreateSubmitResult>((resolve) => {
          seenKeys.push(input.idempotencyKey);
          resolveSubmit = resolve;
        }),
    );
    const onCreated = vi.fn();

    await act(async () => {
      root.render(
        <ExpenseCreateForm
          ownerKey="owner-a"
          submitExpense={submitExpense}
          onCreated={onCreated}
        />,
      );
    });
    fillValidForm();

    // Two rapid submits while the first is still pending.
    await act(async () => {
      container.querySelector("form")!.requestSubmit();
      container.querySelector("form")!.requestSubmit();
    });
    expect(submitExpense).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubmit({
        ok: true,
        expense: { id: "expense-1" } as never,
        replayed: false,
      });
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Expense saved successfully",
    );
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="expense-create-submit"]')?.disabled,
    ).toBe(true);
    expect(seenKeys).toHaveLength(1);
  });

  it("keeps the same key for timeout-then-retry and rotates only for a new purchase", async () => {
    const seenKeys: string[] = [];
    const submitExpense = vi.fn(async (input: { idempotencyKey: string }) => {
      seenKeys.push(input.idempotencyKey);
      if (seenKeys.length === 1) {
        return { ok: false, error: "Network timeout. Retry safely." } as const;
      }
      return { ok: true, expense: { id: "expense-1" } as never, replayed: true } as const;
    });

    await act(async () => {
      root.render(
        <ExpenseCreateForm ownerKey="owner-a" submitExpense={submitExpense} />,
      );
    });
    fillValidForm();

    await submitForm();
    expect(document.body.textContent).toContain("Network timeout");
    // The failed draft is preserved for retry.
    expect(
      container.querySelector<HTMLInputElement>("#expense-create-amount")!.value,
    ).toBe("22.50");

    await submitForm();
    expect(submitExpense).toHaveBeenCalledTimes(2);
    expect(new Set(seenKeys).size).toBe(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "already saved",
    );

    // A genuinely new purchase rotates the key.
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "New purchase",
      )!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    fillValidForm();
    await submitForm();
    expect(new Set(seenKeys).size).toBe(2);
  });

  it("clears the draft on owner switch so rows never leak between accounts", async () => {
    const submitExpense = vi.fn(async () => ({ ok: false, error: "nope" }) as const);
    await act(async () => {
      root.render(
        <ExpenseCreateForm ownerKey="owner-a" submitExpense={submitExpense} />,
      );
    });
    setInputValue(
      container.querySelector<HTMLInputElement>("#expense-create-amount")!,
      "22.50",
    );
    expect(
      container.querySelector<HTMLInputElement>("#expense-create-amount")!.value,
    ).toBe("22.50");

    await act(async () => {
      root.render(
        <ExpenseCreateForm ownerKey="owner-b" submitExpense={submitExpense} />,
      );
    });
    expect(
      container.querySelector<HTMLInputElement>("#expense-create-amount")!.value,
    ).toBe("");
  });

  it("shows field errors and never calls submit for invalid amounts", async () => {
    const submitExpense = vi.fn();
    await act(async () => {
      root.render(
        <ExpenseCreateForm ownerKey="owner-a" submitExpense={submitExpense} />,
      );
    });
    setInputValue(
      container.querySelector<HTMLInputElement>("#expense-create-amount")!,
      "1.234",
    );
    await submitForm();
    expect(submitExpense).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/two decimals|highlighted/);
  });
});
