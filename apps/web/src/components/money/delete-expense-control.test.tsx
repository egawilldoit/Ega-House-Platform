// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteExpenseControl } from "./delete-expense-control";

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
  document.body.innerHTML = "";
});

async function click(element: Element | null) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function openAndConfirm() {
  await click(document.body.querySelector('[data-testid="expense-delete-1"]'));
  expect(document.body.textContent).toContain("Weekly shop");
  await click(
    document.body.querySelector('[data-testid="expense-delete-1-confirm"]'),
  );
}

describe("DeleteExpenseControl", () => {
  it("confirms before deleting and reconciles the list on success", async () => {
    const deleteExpense = vi.fn(async () => ({
      ok: true as const,
      alreadyDeleted: false,
    }));
    const onDeleted = vi.fn();

    await act(async () => {
      root.render(
        <DeleteExpenseControl
          ownerKey="owner-a"
          expenseId="expense-1"
          expenseLabel="Weekly shop"
          deleteExpense={deleteExpense}
          onDeleted={onDeleted}
          dataTestId="expense-delete-1"
        />,
      );
    });

    // Cancel path never calls the transport.
    await click(document.body.querySelector('[data-testid="expense-delete-1"]'));
    await click(
      document.body.querySelector('[data-testid="expense-delete-1-cancel"]'),
    );
    expect(deleteExpense).not.toHaveBeenCalled();

    await openAndConfirm();
    expect(deleteExpense).toHaveBeenCalledTimes(1);
    expect(deleteExpense).toHaveBeenCalledWith("expense-1");
    expect(onDeleted).toHaveBeenCalledWith("expense-1", false);
  });

  it("treats alreadyDeleted as successful reconciliation", async () => {
    const deleteExpense = vi.fn(async () => ({
      ok: true as const,
      alreadyDeleted: true,
    }));
    const onDeleted = vi.fn();
    await act(async () => {
      root.render(
        <DeleteExpenseControl
          ownerKey="owner-a"
          expenseId="expense-1"
          expenseLabel="Weekly shop"
          deleteExpense={deleteExpense}
          onDeleted={onDeleted}
          dataTestId="expense-delete-1"
        />,
      );
    });
    await openAndConfirm();
    expect(onDeleted).toHaveBeenCalledWith("expense-1", true);
  });

  it("keeps the dialog open with a retryable error on failure", async () => {
    const deleteExpense = vi.fn(async () => ({
      ok: false as const,
      error: "Unable to delete right now.",
    }));
    const onDeleted = vi.fn();
    await act(async () => {
      root.render(
        <DeleteExpenseControl
          ownerKey="owner-a"
          expenseId="expense-1"
          expenseLabel="Weekly shop"
          deleteExpense={deleteExpense}
          onDeleted={onDeleted}
          dataTestId="expense-delete-1"
        />,
      );
    });
    await openAndConfirm();
    expect(document.body.textContent).toContain("Unable to delete right now.");
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
