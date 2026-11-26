// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { MoneyPeriodPanel } from "./money-period-panel";
import type {
  MoneyCashDto,
  MoneyOpeningDto,
  MoneyPeriodDto,
} from "@ega/contracts/money";

let container: HTMLDivElement;
let root: Root;

const PERIOD: MoneyPeriodDto = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startDate: "2026-11-01",
  endDate: "2026-11-20",
  currency: "MAD",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-20",
  lifecycle: "superseded",
  initialization: "uninitialized",
  openingMovementId: null,
  dayStartSetupCompleted: false,
  provenance: { opening: null, createdFrom: "web", continuedFrom: null },
  settings: {},
  version: 3,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
};

const UNKNOWN_OPENING: MoneyOpeningDto = {
  status: "unknown",
  amountMinor: null,
  currency: "MAD",
  reason: "Opening cash is unknown.",
};

const CASH: MoneyCashDto = {
  available: false,
  currency: "MAD",
  reason: "opening_balance_unknown",
  cutoffDate: "2026-11-20",
};

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

const updateAction = vi.fn(async (_formData: FormData) => ({
  ok: true as const,
  error: null,
}));

function render(props: {
  period?: MoneyPeriodDto | null;
  opening?: MoneyOpeningDto;
}) {
  return act(async () => {
    root.render(
      <MoneyPeriodPanel
        localToday="2026-11-24"
        timezone="Africa/Casablanca"
        period={props.period === undefined ? PERIOD : props.period}
        opening={props.opening ?? UNKNOWN_OPENING}
        cash={CASH}
        history={[]}
        legacyReviewRequired={false}
        selectedPeriodId={PERIOD.id}
        createAction={vi.fn()}
        updateAction={updateAction}
        rebaseAction={vi.fn()}
        initialSetupIncomplete={false}
      />,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  updateAction.mockClear();
  refresh.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("MoneyPeriodPanel ended period guidance", () => {
  it("explains that a later routine entry continues from the period end", async () => {
    await render({ period: { ...PERIOD, lifecycle: "ended" } });
    expect(container.textContent).toContain(
      "a later routine entry continues the calendar from this period's end",
    );
    expect(container.textContent).toContain("leaves it ended");
  });
});

describe("MoneyPeriodPanel superseded opening initialization", () => {
  it("records only the missing opening and never an active-date change", async () => {
    await render({});
    expect(container.textContent).toContain("Initialize the historical opening");
    expect(container.textContent).not.toContain("Period settings");

    const amount = container.querySelector<HTMLInputElement>(
      "#historical-opening-amount",
    )!;
    await act(async () => setInputValue(amount, "250.00"));
    await submit();

    expect(updateAction).toHaveBeenCalledTimes(1);
    const formData = updateAction.mock.calls[0]![0] as FormData;
    expect(formData.get("periodId")).toBe(PERIOD.id);
    expect(formData.get("version")).toBe("3");
    expect(formData.get("openingMode")).toBe("known");
    expect(formData.get("openingAmount")).toBe("250.00");
    expect(formData.get("openingCutoffDate")).toBe(PERIOD.startDate);
    expect(formData.get("activeDate")).toBeNull();
    expect(formData.get("settings")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not offer initialization when the superseded opening is already known", async () => {
    await render({
      opening: {
        status: "known",
        amountMinor: 25_000,
        currency: "MAD",
        bookingDate: PERIOD.startDate,
        version: 1,
        openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    });
    expect(container.textContent).not.toContain("Initialize the historical opening");
    expect(container.textContent).toContain("superseded but not finalized");
  });
});
