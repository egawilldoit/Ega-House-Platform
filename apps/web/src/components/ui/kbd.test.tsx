// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Kbd } from "./kbd";

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

describe("Kbd", () => {
  it("renders a semantic kbd element with the given content", () => {
    act(() => root.render(<Kbd>K</Kbd>));
    const kbd = container.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toBe("K");
  });

  it("merges caller class names", () => {
    act(() => root.render(<Kbd className="custom-cap">Esc</Kbd>));
    expect(container.querySelector("kbd")?.className).toContain("custom-cap");
  });
});
