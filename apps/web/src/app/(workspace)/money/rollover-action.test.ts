import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rollover: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@ega/application", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ega/application")>()),
  rolloverMoneyPeriod: mocks.rollover,
}));
vi.mock("@/lib/services/auth-service", () => ({ getCurrentUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/services/time-context-service", () => ({ getWebTimeContext: async () => ({ persistedTimezone: "Africa/Casablanca" }) }));

import { rolloverMoneyPeriodAction } from "./actions";

function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ periodId: "11111111-1111-4111-8111-111111111111", version: "3", operationId: "22222222-2222-4222-8222-222222222222", startDate: "2027-01-02", endDate: "2027-01-31", openingMode: "carry_forward" })) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.rollover.mockReset().mockResolvedValue({ ok: true, data: {} });
  mocks.revalidate.mockReset();
});

test("forwards selected dates, gap choice and policy amounts", async () => {
  const data = form();
  data.set("allowUncoveredDays", "true");
  data.set("savingsTarget", "0");
  data.set("emergencyTarget", "12.50");
  expect(await rolloverMoneyPeriodAction(data)).toEqual({ ok: true, error: null });
  expect(mocks.rollover).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ startDate: "2027-01-02", endDate: "2027-01-31", allowUncoveredDays: true, settingsOverrides: { savingsTargetMinor: 0, emergencyTargetMinor: 1250 } }), expect.anything(), expect.anything());
  expect(mocks.revalidate).toHaveBeenCalledWith("/money");
});

test("blank targets preserve copied policy; invalid amounts prevent rollover", async () => {
  const data = form();
  data.set("savingsTarget", "");
  expect(await rolloverMoneyPeriodAction(data)).toEqual({ ok: true, error: null });
  expect(mocks.rollover.mock.calls[0][2]).toEqual(expect.objectContaining({ allowUncoveredDays: false, settingsOverrides: {} }));
  mocks.rollover.mockClear();
  data.set("savingsTarget", "invalid");
  expect(await rolloverMoneyPeriodAction(data)).toEqual({ ok: false, error: "Enter a valid savings target in MAD." });
  expect(mocks.rollover).not.toHaveBeenCalled();
});


test("forwards the acceptance note for a savings difference", async () => {
  const data = form();
  data.set("acceptClosingDifferenceNote", "Savings transfer was delayed");
  expect(await rolloverMoneyPeriodAction(data)).toEqual({ ok: true, error: null });
  expect(mocks.rollover).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ acceptClosingDifferenceNote: "Savings transfer was delayed", acceptUnverifiedDaysNote: null }), expect.anything(), expect.anything());
});

test("forwards the retained unverified-days acknowledgment", async () => {
  const data = form();
  data.set("acceptUnverifiedDaysNote", "Reviewed Nov 21-22 as unverified");
  expect(await rolloverMoneyPeriodAction(data)).toEqual({ ok: true, error: null });
  expect(mocks.rollover).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.objectContaining({
      acceptUnverifiedDaysNote: "Reviewed Nov 21-22 as unverified",
    }),
    expect.anything(),
    expect.anything(),
  );
});
