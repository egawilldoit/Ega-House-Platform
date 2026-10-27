// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MenuList, type MenuListItem } from "./menu-list";

const ITEMS: MenuListItem[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "blocked", label: "Blocked", disabled: true },
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

function renderList(props: Partial<Parameters<typeof MenuList>[0]> = {}) {
  const onSelect = vi.fn();
  act(() =>
    root.render(
      <MenuList label="Status" items={ITEMS} value="todo" onSelect={onSelect} {...props} />,
    ),
  );
  return { onSelect, listbox: container.querySelector('[role="listbox"]') as HTMLElement };
}

function press(key: string, target: HTMLElement = container.querySelector('[role="listbox"]') as HTMLElement) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("MenuList", () => {
  it("renders listbox semantics with the selected option marked", () => {
    const { listbox } = renderList();
    expect(listbox.getAttribute("aria-label")).toBe("Status");
    expect(listbox.getAttribute("tabindex")).toBe("0");

    const options = container.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(4);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
    expect(options[2].getAttribute("aria-disabled")).toBe("true");
  });

  it("focuses the listbox on mount and tracks the active option", () => {
    const { listbox } = renderList();
    expect(document.activeElement).toBe(listbox);
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelector('[role="option"]')?.id,
    );

    press("ArrowDown");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[1].id,
    );
  });

  it("wraps at the ends and skips disabled options", () => {
    const { listbox } = renderList();
    press("ArrowUp");
    // wraps from the first to the last enabled option, skipping nothing at the end
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[3].id,
    );

    press("ArrowDown");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[0].id,
    );

    press("ArrowDown");
    press("ArrowDown");
    // 0 -> 1 -> 3 (blocked at index 2 is skipped)
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[3].id,
    );
  });

  it("supports Home and End", () => {
    const { listbox } = renderList();
    press("End");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[3].id,
    );
    press("Home");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[0].id,
    );
  });

  it("selects the active option with Enter and Space", () => {
    const { onSelect } = renderList();
    press("ArrowDown");
    press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "in_progress" });

    press(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("does not select a disabled option", () => {
    const { onSelect } = renderList();
    for (let i = 0; i < 3; i += 1) press("ArrowDown");
    // active is now the last option (index 3); jump explicitly onto the disabled one
    act(() => {
      container
        .querySelectorAll('[role="option"]')[2]
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves with type-ahead", () => {
    const { listbox } = renderList();
    press("d");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      container.querySelectorAll('[role="option"]')[3].id,
    );
  });

  it("renders an empty message when there are no options", () => {
    act(() => root.render(<MenuList label="Status" items={[]} onSelect={vi.fn()} />));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.textContent).toContain("No options");
  });
});
