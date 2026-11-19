// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tooltip } from "./tooltip";

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

describe("Tooltip interactions", () => {
  it("opens on focus and closes on Escape while retaining focus", async () => {
    await act(async () => {
      root.render(
        <Tooltip content="Helpful tip" delayMs={0}>
          <button type="button">Trigger</button>
        </Tooltip>,
      );
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("Helpful tip");
    expect(document.activeElement).toBe(button);

    await act(async () => {
      button?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.body.textContent).not.toContain("Helpful tip");
    expect(document.activeElement).toBe(button);
  });

  it("cleans up its portal on unmount", async () => {
    await act(async () => {
      root.render(
        <Tooltip content="Helpful tip" delayMs={0}>
          <button type="button">Trigger</button>
        </Tooltip>,
      );
    });

    const button = container.querySelector("button");

    await act(async () => {
      button?.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("Helpful tip");

    await act(async () => root.unmount());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
