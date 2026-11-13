// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { MoneyDayClosePanel } from "./money-day-close-panel";
import type { MoneyDayCloseDto, MoneyPeriodDto } from "@ega/contracts/money";

let container: HTMLDivElement;
let root: Root;

const PERIOD: MoneyPeriodDto = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  currency: "MAD",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-29",
  lifecycle: "tracking",
  initialization: "initialized",
  openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provenance: { opening: null, createdFrom: "web" },
  settings: {},
  version: 3,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-29T00:00:00.000Z",
};

const CLOSE: MoneyDayCloseDto = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  periodId: PERIOD.id,
  closeDate: "2026-11-29",
  status: "closed",
  note: "Closed with chicken",
  operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  closeFingerprint: "a".repeat(64),
  expectedPeriodVersion: 3,
  periodVersionAfter: 4,
  activeDateAfter: "2026-11-30",
  lifecycleAfter: "tracking",
  isFinalDay: false,
  algorithmVersion: "safe-flexible-start-of-day-v1",
  policyVersionId: null,
  policyVersion: null,
  baselineVersion: 1,
  includedMovementIds: [],
  snapshot: {
    currency: "MAD",
    expenseTotalMinor: 1_100,
    dailyIncludedSpendMinor: 1_100,
    flexibleExpenseTotalMinor: 1_100,
    fixedExpenseTotalMinor: 0,
    emergencyExpenseTotalMinor: 0,
    categoryTotals: { coffee: 1_100 },
    recordedCashMinor: 48_900,
    recordedCashBasis: "recorded",
    dayStartBaseline: {
      date: "2026-11-29",
      version: 1,
      availability: "available",
      policyVersionId: null,
      cashMinor: 50_000,
      commitmentsMinor: 0,
      savingsTargetMinor: 0,
      savingsFundedMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
    },
    dailyReference: {
      available: true,
      algorithm: "safe-flexible-start-of-day-v1",
      daysRemaining: 2,
      safePoolMinor: 50_000,
      referenceMinor: 25_000,
      dailyRemainingMinor: 23_900,
    },
    reserves: {
      recordedCashMinor: 48_900,
      unpaidCommitmentsMinor: 0,
      savingsTargetMinor: 0,
      fundedSavingsMinor: 0,
      unfundedSavingsMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
      remainingEmergencyMinor: 0,
      safeFlexibleMinor: 50_000,
    },
  },
  createdAt: "2026-11-29T20:00:00.000Z",
};

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

describe("MoneyDayClosePanel", () => {
  it("keeps each final purchase identity across a retry so the close can recover", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: "Final purchase 1: conflict. The day was not closed.",
      })
      .mockResolvedValueOnce({ ok: true as const, error: null });
    await act(async () => {
      root.render(
        <MoneyDayClosePanel
          period={PERIOD}
          dayClose={null}
          lastClose={null}
          recentCloses={[]}
          dayClosesUnavailable={false}
          action={action}
        />,
      );
    });

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add final purchase"),
    )!;
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const amount = container.querySelector<HTMLInputElement>(
      'input[aria-label="Final purchase 1 amount"]',
    )!;
    await act(async () => {
      setInputValue(amount, "11.00");
    });

    await submit();
    expect(action).toHaveBeenCalledTimes(1);
    const first = action.mock.calls[0]![0] as FormData;
    expect(first.get("final:0:amount")).toBe("11.00");
    expect(first.get("final:0:category")).toBe("groceries");
    const firstKey = first.get("final:0:idempotencyKey");
    expect(firstKey).toBeTruthy();
    expect(first.get("date")).toBe("2026-11-29");
    expect(first.get("version")).toBe("3");
    expect(container.textContent).toContain("The day was not closed");

    await submit();
    expect(action).toHaveBeenCalledTimes(2);
    const second = action.mock.calls[1]![0] as FormData;
    expect(second.get("final:0:idempotencyKey")).toBe(firstKey);
    expect(second.get("operationId")).toBe(first.get("operationId"));
  });

  it("shows retained evidence beside restated totals when a closed day changed", async () => {
    await act(async () => {
      root.render(
        <MoneyDayClosePanel
          period={{ ...PERIOD, activeDate: "2026-11-30", version: 4 }}
          dayClose={null}
          lastClose={{
            close: CLOSE,
            comparison: {
              available: true,
              changed: true,
              changedFields: ["expenseTotal", "recordedCash"],
              restated: {
                complete: true,
                expenseTotalMinor: 2_100,
                dailyIncludedSpendMinor: 2_100,
                flexibleExpenseTotalMinor: 2_100,
                fixedExpenseTotalMinor: 0,
                emergencyExpenseTotalMinor: 0,
                categoryTotals: { coffee: 1_100, eating_out: 1_000 },
                recordedCashMinor: 47_900,
              },
            },
          }}
          recentCloses={[CLOSE]}
          dayClosesUnavailable={false}
          action={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Changed since close");
    expect(container.textContent).toContain("Day spending (original)");
    expect(container.textContent).toContain("Day spending (restated)");
    expect(container.textContent).toContain("Active date advanced to 2026-11-30");
  });

  it("does not offer a routine close for an ended period", async () => {
    await act(async () => {
      root.render(
        <MoneyDayClosePanel
          period={{ ...PERIOD, activeDate: "2026-11-30", lifecycle: "ended", version: 4 }}
          dayClose={null}
          lastClose={null}
          recentCloses={[]}
          dayClosesUnavailable={false}
          action={vi.fn()}
        />,
      );
    });
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("requires rollover");
  });
});
