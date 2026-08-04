import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceNavigationDrawer } from "./sidebar-mobile-drawer";

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
      <WorkspaceNavigationDrawer>
        <a href="/dashboard">Dashboard</a>
      </WorkspaceNavigationDrawer>,
    );
  });
}

function getButton(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("WorkspaceNavigationDrawer", () => {
  it("opens with correct ARIA state, moves focus inside, and restores focus on Escape", async () => {
    await renderDrawer();

    const trigger = getButton("Open workspace navigation");
    trigger.focus();
    await click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[role="dialog"][aria-label="Workspace navigation"]'),
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    const link = container.querySelector<HTMLAnchorElement>('a[href="/dashboard"]');
    expect(link).not.toBeNull();
    expect(document.activeElement).toBe(link);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(
      container.querySelector('[role="dialog"][aria-label="Workspace navigation"]'),
    ).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the backdrop and from navigation", async () => {
    await renderDrawer();

    const trigger = getButton("Open workspace navigation");
    await click(trigger);
    await click(getButton("Close workspace navigation"));
    expect(
      container.querySelector('[role="dialog"][aria-label="Workspace navigation"]'),
    ).toBeNull();

    await click(trigger);
    const link = container.querySelector<HTMLAnchorElement>('a[href="/dashboard"]');
    expect(link).not.toBeNull();
    await click(link as HTMLAnchorElement);
    expect(
      container.querySelector('[role="dialog"][aria-label="Workspace navigation"]'),
    ).toBeNull();
  });
});
