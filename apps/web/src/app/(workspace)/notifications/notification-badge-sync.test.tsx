// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBadgeSync } from "./notification-badge-sync";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, "setAppBadge");
  Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, "clearAppBadge");
});

describe("NotificationBadgeSync", () => {
  it("sets the app badge from the canonical unread count where supported", async () => {
    const setAppBadge = vi.fn(async () => {});
    Object.assign(window.navigator, { setAppBadge });
    await act(async () => {
      root.render(<NotificationBadgeSync unreadCount={3} />);
    });
    expect(setAppBadge).toHaveBeenCalledWith(3);
  });

  it("clears the badge at zero and never crashes without the API", async () => {
    const clearAppBadge = vi.fn(async () => {});
    Object.assign(window.navigator, { clearAppBadge });
    await act(async () => {
      root.render(<NotificationBadgeSync unreadCount={0} />);
    });
    expect(clearAppBadge).toHaveBeenCalledTimes(1);

    // Re-render without any badge API must be a safe no-op.
    Reflect.deleteProperty(window.navigator as unknown as Record<string, unknown>, "clearAppBadge");
    await act(async () => {
      root.render(<NotificationBadgeSync unreadCount={2} />);
    });
  });
});
