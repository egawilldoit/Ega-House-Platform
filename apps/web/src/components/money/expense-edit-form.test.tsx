// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpenseDto } from "@ega/contracts/expenses";

import { ExpenseEditForm, type ExpenseEditFormProps, type ExpenseEditSubmitResult } from "./expense-edit-form";

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
  it.each(["2026-11-08T10:00:37.123Z", "2026-11-01T06:30:37.123Z"])("preserves the exact occurrence instant %s when editing another field", async (occurredAt) => {
    const expense = { ...BASE_EXPENSE, occurredAt };
    const submitUpdate = vi.fn<ExpenseEditFormProps["submitUpdate"]>(async () => ({ ok: true as const, expense }));
    await act(async () => root.render(<ExpenseEditForm ownerKey="owner-a" expense={expense} submitUpdate={submitUpdate} fetchLatest={vi.fn()} />));
    await act(async () => setAmount("30.00"));
    await save();
    expect(submitUpdate.mock.calls[0]?.[1]).not.toHaveProperty("occurredAt");
  });

  it("ignores a pending save after changing expense", async () => {
    let resolve!: (value: ExpenseEditSubmitResult) => void;
    const submitUpdate = vi.fn(() => new Promise<ExpenseEditSubmitResult>((done) => { resolve = done; }));
    const onUpdated = vi.fn();
    const renderExpense = async (expense: ExpenseDto) => {
      await act(async () => root.render(<ExpenseEditForm ownerKey="owner-a" expense={expense} submitUpdate={submitUpdate} fetchLatest={vi.fn()} onUpdated={onUpdated} />));
    };
    await renderExpense(BASE_EXPENSE);
    await save();
    await renderExpense({ ...BASE_EXPENSE, id: "other-expense" });
    await act(async () => resolve({ ok: true, expense: { ...BASE_EXPENSE, version: 4 } }));
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("does not adopt a refresh version from a previous draft", async () => {
    let resolve!: (value: { ok: true; expense: ExpenseDto }) => void;
    const fetchLatest = vi.fn(() => new Promise<{ ok: true; expense: ExpenseDto }>((done) => { resolve = done; }));
    const submitUpdate = vi.fn<ExpenseEditFormProps["submitUpdate"]>()
      .mockResolvedValueOnce({ ok: false, code: "CONFLICT", error: "Stale version." })
      .mockResolvedValue({ ok: true, expense: BASE_EXPENSE });
    const renderOwner = async (ownerKey: string) => {
      await act(async () => root.render(<ExpenseEditForm ownerKey={ownerKey} expense={BASE_EXPENSE} submitUpdate={submitUpdate} fetchLatest={fetchLatest} />));
    };
    await renderOwner("owner-a");
    await save();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Refresh"))!.click();
    });
    await renderOwner("owner-b");
    await act(async () => resolve({ ok: true, expense: { ...BASE_EXPENSE, version: 99 } }));
    await save();
    expect(submitUpdate.mock.calls[1]?.[1].version).toBe(BASE_EXPENSE.version);
    expect(document.body.textContent).not.toContain("Loaded the latest saved version");
  });

  it("sends an explicitly changed occurrence time", async () => {
    const submitUpdate = vi.fn<ExpenseEditFormProps["submitUpdate"]>(async () => ({ ok: true, expense: BASE_EXPENSE }));
    await act(async () => root.render(<ExpenseEditForm ownerKey="owner-a" expense={BASE_EXPENSE} submitUpdate={submitUpdate} fetchLatest={vi.fn()} />));
    await act(async () => {
      const input = container.querySelector<HTMLInputElement>(`#expense-edit-occurred-${BASE_EXPENSE.id}`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2026-11-09T12:34");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await save();
    expect(submitUpdate.mock.calls[0]?.[1].occurredAt).toBe(new Date("2026-11-09T12:34").toISOString());
  });

  it("preserves the draft on version conflict and retries only after explicit refresh", async () => {
    const submittedVersions: number[] = [];
    const submitUpdate = vi.fn(async (_id: string, patch: { version: number }) => {
      submittedVersions.push(patch.version);
      if (patch.version === 3 || patch.version === 4) {
        return { ok: false, code: "CONFLICT", error: "Stale version." } as const;
      }
      return { ok: true, expense: { ...BASE_EXPENSE, version: 6 } } as const;
    });
    const fetchLatest = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        expense: { ...BASE_EXPENSE, version: 4 },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        expense: { ...BASE_EXPENSE, version: 5 },
      });
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

    // A guessed next version must not bypass reading the latest server row.
    await save();
    expect(submitUpdate).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector<HTMLButtonElement>(
      `[data-testid="expense-edit-save-${BASE_EXPENSE.id}"]`,
    )?.disabled).toBe(true);

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
    expect(amountInput().value).toBe("30.00");
    expect(document.body.querySelector<HTMLButtonElement>(
      `[data-testid="expense-edit-save-${BASE_EXPENSE.id}"]`,
    )?.disabled).toBe(true);
    await save();
    expect(submittedVersions).toEqual([3, 4]);

    // The second conflict invalidates version 4 too; a new refresh is required.
    await act(async () => {
      document.body
        .querySelector(`[data-testid="expense-edit-refresh-${BASE_EXPENSE.id}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await save();
    expect(submittedVersions).toEqual([3, 4, 5]);
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and blocks saving when latest-version refresh rejects", async () => {
    const submitUpdate = vi.fn(async () => ({
      ok: false as const,
      code: "CONFLICT",
      error: "Stale version.",
    }));
    const fetchLatest = vi.fn(async () => {
      throw new Error("request timed out");
    });
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

    setAmount("30.00");
    await save();
    await act(async () => {
      document.body
        .querySelector(`[data-testid="expense-edit-refresh-${BASE_EXPENSE.id}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Could not refresh the latest expense");
    expect(amountInput().value).toBe("30.00");
    expect(document.body.querySelector<HTMLButtonElement>(
      `[data-testid="expense-edit-save-${BASE_EXPENSE.id}"]`,
    )?.disabled).toBe(true);
    await save();
    expect(submitUpdate).toHaveBeenCalledTimes(1);
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
