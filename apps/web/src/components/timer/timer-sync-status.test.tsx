// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setOnline(true);
  setHidden(false);
  now = 10_000;
  routerRefresh.mockReset();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("TimerSyncStatus", () => {
  it("shows the offline banner while the browser reports no connection", () => {
    setOnline(false);
    act(() => root.render(<TimerSyncStatus />));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Offline - showing the last synced timer state.");
    expect(text).toContain("Reconnecting will refresh it automatically.");
  });

  it("refreshes once when the browser reconnects and clears the banner", () => {
    setOnline(false);
    act(() => root.render(<TimerSyncStatus />));

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Offline - showing");
  });

  it("refreshes when the tab becomes visible again", () => {
    act(() => root.render(<TimerSyncStatus />));

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(routerRefresh).not.toHaveBeenCalled();

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the window regains focus", () => {
    act(() => root.render(<TimerSyncStatus />));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("dedupes a reconnect burst to at most one refresh per second", () => {
    act(() => root.render(<TimerSyncStatus />));

    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);

    now = 10_999;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);

    now = 11_000;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes the Today surface on reconnect and on the next visibility transition", () => {
    setOnline(false);
    act(() => root.render(<TimerSyncStatus />));

    // Reconnect after being offline.
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);

    // A later tab re-entry outside the dedupe window must refresh again so the
    // server-rendered Active Timer panel picks up another device's change.
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(1);

    now = 11_001;
    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(routerRefresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh focus/visibility events while offline", () => {
    setOnline(false);
    act(() => root.render(<TimerSyncStatus />));

    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(routerRefresh).not.toHaveBeenCalled();
  });
});
