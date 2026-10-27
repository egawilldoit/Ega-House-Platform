// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PriorityIcon, taskPriorityLabel } from "./priority-icon";
import { StatusIcon, taskStatusLabel } from "./status-icon";

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

describe("StatusIcon", () => {
  it.each(["todo", "in_progress", "done", "blocked"] as const)(
    "exposes %s as a named image for assistive tech",
    (status) => {
      act(() => root.render(<StatusIcon status={status} />));
      const icon = container.querySelector("svg");
      expect(icon?.getAttribute("role")).toBe("img");
      expect(icon?.getAttribute("aria-label")).toBe(taskStatusLabel(status));
      expect(icon?.getAttribute("aria-hidden")).toBeNull();
    },
  );

  it("can be hidden when a visible label already names the status", () => {
    act(() => root.render(<StatusIcon status="done" decorative />));
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.getAttribute("aria-label")).toBeNull();
    expect(icon?.getAttribute("role")).toBeNull();
  });
});

describe("PriorityIcon", () => {
  it.each(["low", "medium", "high", "urgent"] as const)(
    "exposes %s as a named image for assistive tech",
    (priority) => {
      act(() => root.render(<PriorityIcon priority={priority} />));
      const icon = container.querySelector("svg");
      expect(icon?.getAttribute("role")).toBe("img");
      expect(icon?.getAttribute("aria-label")).toBe(taskPriorityLabel(priority));
    },
  );

  it("honours an explicit label override", () => {
    act(() => root.render(<PriorityIcon priority="high" label="P1" />));
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("P1");
  });
});
