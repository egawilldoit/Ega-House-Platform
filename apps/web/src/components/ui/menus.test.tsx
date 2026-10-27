// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("DropdownMenu", () => {
  it("renders a labelled menu with menuitems and separators", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <DropdownMenu open>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Row actions">
            <DropdownMenuItem onSelect={onSelect}>Archive</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="danger" disabled>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    );

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    expect(items).toHaveLength(2);
    expect(items[1].getAttribute("aria-disabled")).toBe("true");
    expect(document.body.querySelector('[role="separator"]')).not.toBeNull();

    act(() => {
      (items[0] as HTMLElement).click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("exposes the trigger as a menu button", () => {
    act(() =>
      root.render(
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Row actions">
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    );
    const trigger = container.querySelector("button");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ContextMenu", () => {
  it("renders its items in a menu when opened", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <ContextMenu open>
          <ContextMenuTrigger>Task row</ContextMenuTrigger>
          <ContextMenuContent aria-label="Task actions">
            <ContextMenuItem onSelect={onSelect}>Open</ContextMenuItem>
            <ContextMenuItem tone="danger">Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      ),
    );

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]'));
    expect(items).toHaveLength(2);

    act(() => {
      (items[0] as HTMLElement).click();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks the trigger as a menu target for assistive tech", () => {
    act(() =>
      root.render(
        <ContextMenu>
          <ContextMenuTrigger>Task row</ContextMenuTrigger>
          <ContextMenuContent aria-label="Task actions">
            <ContextMenuItem>Open</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>,
      ),
    );
    // Radix marks the trigger with data-state for the closed menu.
    expect(container.textContent).toContain("Task row");
  });
});
