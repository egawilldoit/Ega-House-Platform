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

  it("renders no dialog when no task is selected", () => {
    render({ task: null });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
