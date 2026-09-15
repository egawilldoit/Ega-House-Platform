"use client";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logout-actions", () => ({
  signOutAction: vi.fn(),
}));

import { SidebarLogout } from "./sidebar-logout";

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
});

describe("SidebarLogout", () => {
  it("wraps its text in the shared collapsed-state label and keeps an accessible name", async () => {
    await act(async () => root.render(<SidebarLogout />));

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toBe("Logout");
    expect(button?.getAttribute("title")).toBe("Logout");
    expect(button?.querySelector(".sidebar-link-icon[aria-hidden='true']")).not.toBeNull();
    expect(button?.querySelector(".workspace-nav-label")?.textContent).toBe("Logout");
  });
});
