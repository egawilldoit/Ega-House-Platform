// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { BudgetPlanForm } from "./budget-plan-form";
import type { SaveBudgetPlanActionInput } from "../actions";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit() {
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("BudgetPlanForm", () => {
  it("accepts the formatted zero it displays and saves it as deliberate zero", async () => {
    const action = vi.fn(async (input: SaveBudgetPlanActionInput) => ({
      ok: true as const,
      plan: {
        id: "plan-1",
        periodId: "period-1",
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        currency: "MAD" as const,
        allocations: input.allocations,
        savingsTargetMinor: input.savingsTargetMinor ?? null,
        emergencyTargetMinor: input.emergencyTargetMinor ?? null,
        coffeeWeeklySpendLimitMinor: input.coffeeWeeklySpendLimitMinor ?? null,
        coffeeWeeklyVisitLimit: input.coffeeWeeklyVisitLimit ?? null,
        version: input.version + 1,
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
    }));

    await act(async () => {
      root.render(
        <BudgetPlanForm
          plan={{
            id: "plan-1",
            periodId: "period-1",
            periodStartDate: "2026-11-09",
            periodEndDate: "2026-11-30",
            currency: "MAD",
            allocations: { coffee: 0, groceries: 12_000 },
            savingsTargetMinor: 0,
            emergencyTargetMinor: null,
            coffeeWeeklySpendLimitMinor: 0,
            coffeeWeeklyVisitLimit: 0,
            version: 1,
            createdAt: "2026-11-09T00:00:00.000Z",
            updatedAt: "2026-11-09T00:00:00.000Z",
          }}
          periodStartDate="2026-11-09"
          periodEndDate="2026-11-30"
          action={action}
        />,
      );
    });

    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const input = action.mock.calls[0]![0];
    expect(input.allocations.coffee).toBe(0);
    expect(input.allocations.groceries).toBe(12_000);
    expect(input.savingsTargetMinor).toBe(0);
    expect(input.coffeeWeeklySpendLimitMinor).toBe(0);
    expect(input.coffeeWeeklyVisitLimit).toBe(0);
  });

  it("keeps an empty field distinct from an entered zero", async () => {
    const action = vi.fn(async (input: SaveBudgetPlanActionInput) => ({
      ok: true as const,
      plan: {
        id: "plan-1",
        periodId: "period-1",
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        currency: "MAD" as const,
        allocations: input.allocations,
        savingsTargetMinor: input.savingsTargetMinor ?? null,
        emergencyTargetMinor: input.emergencyTargetMinor ?? null,
        coffeeWeeklySpendLimitMinor: input.coffeeWeeklySpendLimitMinor ?? null,
        coffeeWeeklyVisitLimit: input.coffeeWeeklyVisitLimit ?? null,
        version: 1,
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
    }));

    await act(async () => {
      root.render(
        <BudgetPlanForm
          plan={null}
          periodStartDate="2026-11-09"
          periodEndDate="2026-11-30"
          action={action}
        />,
      );
    });

    setInputValue(
      container.querySelector<HTMLInputElement>("#allocation-groceries")!,
      "0.00",
    );
    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const input = action.mock.calls[0]![0];
    expect(input.allocations).toEqual({ groceries: 0 });
    expect(input.savingsTargetMinor).toBeNull();
  });

  it("blocks saving stale amounts when an external refresh changes the plan version", async () => {
    const action = vi.fn();
    const plan = {
      id: "plan-1",
      periodId: "period-1",
      periodStartDate: "2026-11-09",
      periodEndDate: "2026-11-30",
      currency: "MAD" as const,
      allocations: { coffee: 1_000 },
      savingsTargetMinor: null,
      emergencyTargetMinor: null,
      coffeeWeeklySpendLimitMinor: null,
      coffeeWeeklyVisitLimit: null,
      version: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
      updatedAt: "2026-11-09T00:00:00.000Z",
    };
    await act(async () => {
      root.render(
        <BudgetPlanForm
          plan={plan}
          periodStartDate="2026-11-09"
          periodEndDate="2026-11-30"
          action={action}
        />,
      );
    });
    await act(async () => {
      root.render(
        <BudgetPlanForm
          plan={{ ...plan, version: 2, allocations: { coffee: 2_000 } }}
          periodStartDate="2026-11-09"
          periodEndDate="2026-11-30"
          action={action}
        />,
      );
    });
    expect(container.textContent).toContain("changed in another tab");
    const button = container.querySelector("button")! as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await submit();
    expect(action).not.toHaveBeenCalled();
  });
});
