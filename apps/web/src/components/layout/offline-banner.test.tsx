// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineBanner } from "./offline-banner";

let container: HTMLDivElement;
let root: Root;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  setOnline(true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("renders nothing while the browser reports a connection", () => {
    act(() => root.render(<OfflineBanner />));
    expect(document.body.textContent).not.toContain("You are offline");
  });

  it("appears on the offline event and clears on reconnect", () => {
    act(() => root.render(<OfflineBanner />));

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(document.body.textContent).toContain("You are offline");

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(document.body.textContent).not.toContain("You are offline");
  });

  it("never promises that an offline save will be kept", () => {
    setOnline(false);
    act(() => root.render(<OfflineBanner />));
    const text = document.body.textContent ?? "";
    expect(text).toContain("cannot be saved");
    expect(text).not.toMatch(/saved locally|will sync|queued/i);
  });
});
