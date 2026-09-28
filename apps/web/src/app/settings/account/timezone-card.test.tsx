import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateAccountTimezoneAction = vi.fn();

vi.mock("@/app/settings/account/actions", () => ({
  updateAccountTimezoneAction: (formData: FormData) =>
    updateAccountTimezoneAction(formData),
}));

import { TimezoneCard } from "./timezone-card";

let container: HTMLDivElement;
let root: Root;
let restoreIntl: (() => void) | null = null;

function mockDeviceTimezone(zone: string | undefined) {
  const Original = Intl.DateTimeFormat;
  // Plain function so it works whether called with or without `new`.
  const MockDateTimeFormat = function () {
    return {
      resolvedOptions: () => ({ timeZone: zone }),
      format: () => "",
    };
  };
  Object.defineProperty(Intl, "DateTimeFormat", {
    value: MockDateTimeFormat,
    configurable: true,
    writable: true,
  });
  restoreIntl = () => {
    Object.defineProperty(Intl, "DateTimeFormat", {
      value: Original,
      configurable: true,
      writable: true,
    });
  };
}



describe("TimezoneCard", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    updateAccountTimezoneAction.mockReset();
  });

  afterEach(() => {
    root?.unmount();
    container.remove();
    restoreIntl?.();
    restoreIntl = null;
    vi.restoreAllMocks();
  });

  it("initializes a missing account timezone from the detected device zone", async () => {
    mockDeviceTimezone("Asia/Tokyo");
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard
          timezone="UTC"
          persistedTimezone={null}
          fallback="missing_timezone"
        />,
      );
    });

    expect(updateAccountTimezoneAction).toHaveBeenCalledTimes(1);
    const formData = updateAccountTimezoneAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("timezone")).toBe("Asia/Tokyo");
    expect(String(formData.get("feedback"))).toContain("Asia/Tokyo");
  });

  it("keeps the explicit UTC fallback when device detection fails", async () => {
    mockDeviceTimezone(undefined);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard
          timezone="UTC"
          persistedTimezone={null}
          fallback="missing_timezone"
        />,
      );
    });

    expect(updateAccountTimezoneAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("could not detect a valid timezone");
    expect(container.textContent).toContain("UTC");
  });

  it("does not auto-initialize when a timezone is already persisted", async () => {
    mockDeviceTimezone("Asia/Tokyo");
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard
          timezone="Africa/Casablanca"
          persistedTimezone="Africa/Casablanca"
          fallback="none"
        />,
      );
    });

    expect(updateAccountTimezoneAction).not.toHaveBeenCalled();
  });

  it("offers Use device timezone only when the device zone differs", async () => {
    mockDeviceTimezone("Asia/Tokyo");
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard timezone="UTC" persistedTimezone="UTC" fallback="none" />
      );
    });

    expect(container.textContent).toContain("Use device timezone (Asia/Tokyo)");
  });

  it("hides Use device timezone when device and account zones match", async () => {
    mockDeviceTimezone("Africa/Casablanca");
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard
          timezone="Africa/Casablanca"
          persistedTimezone="Africa/Casablanca"
          fallback="none"
        />,
      );
    });

    expect(container.textContent).not.toContain("Use device timezone");
  });

  it("submits a manually entered IANA timezone", async () => {
    mockDeviceTimezone("Africa/Casablanca");
    root = createRoot(container);
    await act(async () => {
      root.render(
        <TimezoneCard
          timezone="Africa/Casablanca"
          persistedTimezone="Africa/Casablanca"
          fallback="none"
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[name="timezone"]',
    ) as HTMLInputElement;
    const manualForm = input.closest("form") as HTMLFormElement;
    input.value = "America/New_York";
    await act(async () => {
      manualForm.requestSubmit();
    });

    expect(updateAccountTimezoneAction).toHaveBeenCalledTimes(1);
    const formData = updateAccountTimezoneAction.mock.calls[0]?.[0] as FormData;
    expect(formData.get("timezone")).toBe("America/New_York");
  });
});
