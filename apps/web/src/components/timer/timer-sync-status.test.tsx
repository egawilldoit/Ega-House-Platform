// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconcileTimerSurface = vi.hoisted(() => vi.fn());

vi.mock("@/lib/timer/reconcile-action", () => ({ reconcileTimerSurface }));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({
      href,
      children,
    }: {
      href: string;
      children: React.ReactNode;
    }) => React.createElement("a", { href }, children),
  };
});

import { TimerSyncStatus } from "./timer-sync-status";

let container: HTMLDivElement;
let root: Root;
let hidden = false;
let now = 10_000;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

function setHidden(value: boolean) {
  hidden = value;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fire(action: () => void) {
  await act(async () => {
    action();
  });
  await settle();
}

function mount(ownerUserId: string | null = "owner-a", surface: "timer" | "today" = "timer") {
  act(() => {
    root.render(<TimerSyncStatus surface={surface} ownerUserId={ownerUserId} />);
  });
}

function text() {
  return document.body.textContent ?? "";
}

function retryButton() {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Retry",
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setOnline(true);
  setHidden(false);
  now = 10_000;
  reconcileTimerSurface.mockReset();
  reconcileTimerSurface.mockResolvedValue({
    ok: true,
    syncedAt: "2026-11-07T12:00:00.000Z",
    activeSessionId: null,
  });
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TimerSyncStatus", () => {
  it("shows an offline banner while the browser reports no connection and never calls the action", async () => {
    setOnline(false);
    mount();

    expect(text()).toContain("Offline - showing the last synced timer state.");
    expect(document.querySelector('[role="status"]')).not.toBeNull();

    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).not.toHaveBeenCalled();
  });

  it("only claims synced after a verified success and clears the reconnect banner", async () => {
    setOnline(false);
    mount();
    expect(text()).toContain("Offline - showing");

    setOnline(true);
    reconcileTimerSurface.mockResolvedValue({
      ok: true,
      syncedAt: "2026-11-07T12:00:00.000Z",
      activeSessionId: "session-1",
    });
    await fire(() => window.dispatchEvent(new Event("online")));

    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Offline - showing");
    expect(text()).not.toContain("Could not confirm");
  });

  it("shows a stale alert with a Retry button when the backend cannot confirm, never a false synced state", async () => {
    reconcileTimerSurface.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Could not confirm the timer state with the server. Showing the last synced state.",
    });

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Could not confirm the timer state");
    expect(retryButton()?.getAttribute("type")).toBe("button");
    // No confirmed timestamp exists yet, so no "last confirmed" claim is made.
    expect(text()).not.toContain("Last confirmed sync:");
  });

  it("Retry bypasses the dedupe window, re-runs the action, and clears to synced", async () => {
    reconcileTimerSurface.mockResolvedValueOnce({
      ok: false,
      reason: "unavailable",
      message: "Could not confirm the timer state with the server. Showing the last synced state.",
    });

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);

    reconcileTimerSurface.mockResolvedValueOnce({
      ok: true,
      syncedAt: "2026-11-07T12:05:00.000Z",
      activeSessionId: "session-1",
    });
    // Same wall-clock instant: Retry must not be swallowed by the 1s dedupe.
    await fire(() => retryButton()?.click());

    expect(reconcileTimerSurface).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(retryButton()).toBeUndefined();
  });

  it("times out to a stale state with Retry after ten seconds", async () => {
    vi.useFakeTimers();
    const pending = deferred<never>();
    reconcileTimerSurface.mockReturnValue(pending.promise);

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Checking the timer with the server");

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(text()).toContain("Timer sync timed out. Showing the last synced state.");
    expect(retryButton()).toBeDefined();
  });

  it("shows the unauthenticated banner with a surface-specific sign-in link", async () => {
    reconcileTimerSurface.mockResolvedValue({
      ok: false,
      reason: "unauthenticated",
      message: "Your session expired. Sign in again to sync the timer.",
    });

    mount("owner-a", "today");
    await fire(() => window.dispatchEvent(new Event("focus")));

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    const link = document.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/login?next=/today");
  });

  it("dedupes automatic focus/visibility/online bursts to one attempt per second", async () => {
    mount();

    await fire(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);

    now = 10_999;
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);

    now = 11_000;
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(2);
  });

  it("keeps one request in flight even across an explicit Retry", async () => {
    const first = deferred<never>();
    reconcileTimerSurface.mockReturnValueOnce(first.promise);

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));
    // No Retry is rendered while checking; a forced call cannot start a second
    // request while the first is still in flight.
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);

    first.resolve({
      ok: true,
      syncedAt: "2026-11-07T12:00:00.000Z",
      activeSessionId: null,
    } as never);
    await settle();
  });

  it("ignores a late response after unmount", async () => {
    const pending = deferred<{
      ok: false;
      reason: "unavailable";
      message: string;
    }>();
    reconcileTimerSurface.mockReturnValue(pending.promise);

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));
    act(() => root.unmount());

    pending.resolve({
      ok: false,
      reason: "unavailable",
      message: "late failure",
    });
    await settle();

    expect(container.textContent).toBe("");
  });

  it("ignores a superseded response after an owner change and resets its message", async () => {
    const pending = deferred<{
      ok: false;
      reason: "unavailable";
      message: string;
    }>();
    reconcileTimerSurface.mockReturnValue(pending.promise);

    mount("owner-a");
    await fire(() => window.dispatchEvent(new Event("focus")));
    expect(text()).toContain("Checking the timer with the server");

    // Account switch: the new server render owns the state from here.
    act(() => {
      root.render(<TimerSyncStatus surface="timer" ownerUserId="owner-b" />);
    });
    expect(text()).not.toContain("Checking the timer with the server");

    pending.resolve({
      ok: false,
      reason: "unavailable",
      message: "late failure for the previous owner",
    });
    await settle();

    expect(text()).not.toContain("late failure for the previous owner");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders polite status roles while checking and a real button for Retry", async () => {
    const pending = deferred<never>();
    reconcileTimerSurface.mockReturnValue(pending.promise);

    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));

    const status = document.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(text()).toContain("Checking the timer with the server");

    pending.resolve({
      ok: false,
      reason: "unavailable",
      message: "unavailable",
    } as never);
    await settle();

    const alert = document.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    const button = retryButton();
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.textContent).toBe("Retry");
  });

  it("reconciles the Today surface through the same verified action", async () => {
    mount("owner-a", "today");
    await fire(() => window.dispatchEvent(new Event("online")));

    expect(reconcileTimerSurface).toHaveBeenCalledWith("today");
  });

  it("never issues a fetch or mutation of its own", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();
    await fire(() => window.dispatchEvent(new Event("focus")));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reconcileTimerSurface).toHaveBeenCalledTimes(1);
  });
});
