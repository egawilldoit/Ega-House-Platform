import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceNavigationDrawer } from "./sidebar-mobile-drawer";

describe("workspace navigation drawer focus", () => {
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
    document.body.style.overflow = "";
  });

  async function renderDrawer() {
    await act(async () => {
      root.render(
        <>
          <button type="button" id="background-action">
            Background action
          </button>
          <WorkspaceNavigationDrawer>
            <button type="button" id="first-drawer-action">
              First action
            </button>
            <button type="button" id="last-drawer-action">
              Last action
            </button>
          </WorkspaceNavigationDrawer>
        </>,
      );
    });
  }

  function pressTab(target: EventTarget, shiftKey = false) {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      shiftKey,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("keeps forward and reverse keyboard focus inside the drawer", async () => {
    await renderDrawer();

    const first = container.querySelector<HTMLButtonElement>("#first-drawer-action");
    const last = container.querySelector<HTMLButtonElement>("#last-drawer-action");
    const close = container.querySelector<HTMLButtonElement>(".workspace-drawer-close");

    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(close).not.toBeNull();
    expect(document.activeElement).toBe(first);

    close?.focus();
    await act(async () => {
      expect(pressTab(close!).defaultPrevented).toBe(true);
    });
    expect(document.activeElement).toBe(first);

    first?.focus();
    await act(async () => {
      expect(pressTab(first!, true).defaultPrevented).toBe(true);
    });
    expect(document.activeElement).toBe(close);
  });

  it("returns stray keyboard focus to the drawer and restores focus when dismissed", async () => {
    await renderDrawer();

    const background = container.querySelector<HTMLButtonElement>("#background-action");
    const first = container.querySelector<HTMLButtonElement>("#first-drawer-action");
    const trigger = container.querySelector<HTMLButtonElement>(".workspace-nav-trigger");

    background?.focus();
    await act(async () => {
      expect(pressTab(background!).defaultPrevented).toBe(true);
    });
    expect(document.activeElement).toBe(first);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
