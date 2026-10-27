// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDrawer } from "./task-drawer";

const TASK = { id: "t1", title: "Ship the drawer", status: "in_progress" };

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

function render(overrides: Partial<Parameters<typeof TaskDrawer>[0]> = {}) {
  const onClose = vi.fn();
  const onModeChange = vi.fn();
  act(() =>
    root.render(
      <TaskDrawer
        task={TASK}
        mode="panel"
        onClose={onClose}
        onModeChange={onModeChange}
        {...overrides}
      >
        <p>Properties</p>
      </TaskDrawer>,
    ),
  );
  return { onClose, onModeChange };
}

describe("TaskDrawer", () => {
  it("renders the task as the dialog title with its content", () => {
    render();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Ship the drawer");
    expect(dialog?.textContent).toContain("Properties");
  });

  it("closes from the close button", () => {
    const { onClose } = render();
    const closeButton = document.body.querySelector('[aria-label="Close task details"]');
    expect(closeButton).not.toBeNull();
    act(() => {
      (closeButton as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { onClose } = render();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requests full-page mode from the panel presentation", () => {
    const { onModeChange } = render();
    const toggle = document.body.querySelector('[aria-label="Expand to full page"]');
    expect(toggle).not.toBeNull();
    act(() => {
      (toggle as HTMLButtonElement).click();
    });
    expect(onModeChange).toHaveBeenCalledWith("full");
  });

  it("offers the collapse action in full mode", () => {
    const { onModeChange } = render({ mode: "full" });
    const toggle = document.body.querySelector('[aria-label="Collapse to side panel"]');
    expect(toggle).not.toBeNull();
    act(() => {
      (toggle as HTMLButtonElement).click();
    });
    expect(onModeChange).toHaveBeenCalledWith("panel");
  });

  it("restores focus to the opener after closing", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open task";
    document.body.append(opener);
    opener.focus();

    const { onClose } = render();
    // Radix moves focus into the dialog; the opener is remembered from mount.
    const closeButton = document.body.querySelector('[aria-label="Close task details"]');
    act(() => {
      (closeButton as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <TaskDrawer task={null} mode="panel" onClose={onClose} onModeChange={vi.fn()} />,
      ),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("does not dismiss a non-modal panel on an outside click", async () => {
    const { onClose } = render();
    // Radix attaches its pointerdown listener in a macrotask, and a non-modal
    // dialog defers dismissal to the following click, so the press must happen
    // after that listener exists.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => {
      // jsdom has no PointerEvent; Radix only needs an event of that type.
      outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    outside.remove();
  });

  it("still dismisses the modal presentation from the scrim", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    try {
      const { onClose } = render();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const overlay = document.body.querySelector('[class*="bg-[var(--ega-overlay)]"]');
      expect(overlay).not.toBeNull();
      act(() => {
        overlay?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("renders no dialog when no task is selected", () => {
    render({ task: null });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
