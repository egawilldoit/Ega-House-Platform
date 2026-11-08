// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpenseDto } from "@ega/contracts/expenses";

import { ExpenseEditForm } from "./expense-edit-form";

let container: HTMLDivElement;
let root: Root;

const BASE_EXPENSE = {
  id: "11111111-1111-4111-8111-111111111111",
  occurredAt: "2026-11-08T10:00:00.000Z",
  amountMinor: 2250,
  currency: "MAD",
  category: "groceries",
  note: "Weekly shop",
  merchant: "Souk",
  needVsWant: "need",
  paymentMethod: "cash",
  idempotencyKey: "key-1",
  version: 3,
  deletedAt: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
} as unknown as ExpenseDto;

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

function amountInput(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>(
    `#expense-edit-amount-${BASE_EXPENSE.id}`,
  )!;
}

function setAmount(value: string) {
  const element = amountInput();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function save() {
  await act(async () => {
    container.querySelector("form")!.requestSubmit();
  });
}

describe("ExpenseEditForm", () => {
  it("preserves the draft on version conflict and retries only after explicit refresh", async () => {
    const submittedVersions: number[] = [];
    const submitUpdate = vi.fn(async (_id: string, patch: { version: number }) => {
      submittedVersions.push(patch.version);
      if (patch.version === 3) {
        return { ok: false, code: "CONFLICT", error: "Stale version." } as const;
      }
      return { ok: true, expense: { ...BASE_EXPENSE, version: 5 } } as const;
    });
    const fetchLatest = vi.fn(async () => ({
      ok: true as const,
      expense: { ...BASE_EXPENSE, version: 4 },
    }));
    const onUpdated = vi.fn();

    await act(async () => {
      root.render(
        <ExpenseEditForm
          ownerKey="owner-a"
          expense={BASE_EXPENSE}
          submitUpdate={submitUpdate}
          fetchLatest={fetchLatest}
          onUpdated={onUpdated}
        />,
      );
    });

    setAmount("30.00");
    await save();

    // Conflict: no overwrite, draft preserved, form still usable.
    expect(document.body.textContent).toMatch(/preserved|changed elsewhere/);
    expect(amountInput().value).toBe("30.00");
    expect(onUpdated).not.toHaveBeenCalled();

    // Deliberate reconciliation: explicit refresh, then explicit retry.
    await act(async () => {
      document.body
        .querySelector(`[data-testid="expense-edit-refresh-${BASE_EXPENSE.id}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(amountInput().value).toBe("30.00");

    await save();
    expect(submittedVersions).toEqual([3, 4]);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("sends the current version on a clean save", async () => {
    let sentVersion: number | null = null;
    const submitUpdate = vi.fn(async (_id: string, patch: { version: number }) => {
      sentVersion = patch.version;
      return {
        ok: true as const,
        expense: { ...BASE_EXPENSE, version: 4 },
      };
    });
    const fetchLatest = vi.fn();
    await act(async () => {
      root.render(
        <ExpenseEditForm
          ownerKey="owner-a"
          expense={BASE_EXPENSE}
          submitUpdate={submitUpdate}
          fetchLatest={fetchLatest}
        />,
      );
    });
    await save();
    expect(submitUpdate).toHaveBeenCalledTimes(1);
    expect(sentVersion).toBe(3);
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});
