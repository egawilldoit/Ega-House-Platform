// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PropertyPill } from "./property-pill";
import type { MenuListItem } from "./menu-list";

const ITEMS: MenuListItem[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

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
});

async function renderPill(value: string | null = "todo") {
  const onSelect = vi.fn();
  await act(async () => {
    root.render(
      <PropertyPill label="Status" value={value} items={ITEMS} onSelect={onSelect} />,
    );
  });
  const trigger = container.querySelector("button") as HTMLButtonElement;
  return { onSelect, trigger };
}

// jsdom has no PointerEvent; Radix opens on click and dismisses on pointerdown,
// so a cancelable mouse click exercises the trigger path this component uses.
// Radix restores focus in a setTimeout(0) during popover unmount, so a plain
// await act() can observe the pre-restore state. Drain one macrotask.
async function flushCloseFocus() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function pointerClick(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("PropertyPill", () => {
  it("renders the current value and advertises a listbox popup", async () => {
    const { trigger } = await renderPill();
    expect(trigger.textContent).toContain("To do");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows an em dash when the value is unset", async () => {
    const { trigger } = await renderPill(null);
    expect(trigger.textContent).toContain("—");
  });

  it("opens a labelled listbox and reports the selection, then closes", async () => {
    const { onSelect, trigger } = await renderPill();

    await pointerClick(trigger);
    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute("aria-label")).toBe("Status");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const option = document.body.querySelectorAll('[role="option"]')[1] as HTMLElement;
    await pointerClick(option);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "in_progress" });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("is a named listbox popup, not an unnamed dialog", async () => {
    const { trigger } = await renderPill();
    trigger.focus();
    await pointerClick(trigger);

    const popup = document.body.querySelector("[data-radix-popper-content-wrapper] > *") as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.getAttribute("role")).not.toBe("dialog");

    const listbox = document.body.querySelector('[role="listbox"]');
    expect(listbox?.getAttribute("aria-label")).toBe("Status");
  });

  it("moves focus into the list and selects with the keyboard", async () => {
    const { onSelect, trigger } = await renderPill();
    trigger.focus();
    await pointerClick(trigger);

    const listbox = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(document.activeElement).toBe(listbox);

    await act(async () => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      listbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "in_progress" });
    await flushCloseFocus();
    expect(document.activeElement).toBe(trigger);
  });

  it("names a node display value from the selected label", async () => {
    await act(async () => {
      root.render(
        <PropertyPill
          label="Status"
          value="in_progress"
          items={ITEMS}
          onSelect={vi.fn()}
          displayValue={<span>In progress (2)</span>}
        />,
      );
    });
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.textContent).toContain("In progress (2)");
    expect(trigger.getAttribute("aria-label")).toBe("Status: In progress");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { trigger } = await renderPill();
    await pointerClick(trigger);
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    await flushCloseFocus();
    expect(document.activeElement).toBe(trigger);
  });

  it("does not open when disabled", async () => {
    await act(async () => {
      root.render(
        <PropertyPill label="Status" value="todo" items={ITEMS} onSelect={vi.fn()} disabled />,
      );
    });
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await pointerClick(trigger);
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });
});
