// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SHORTCUT_HELP_EVENT } from "@/lib/workspace-events";

import { ShortcutHelpButton } from "./shortcut-help-button";

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

describe("ShortcutHelpButton", () => {
  it("opens the shared question-mark shortcut sheet", async () => {
    const listener = vi.fn();
    window.addEventListener(SHORTCUT_HELP_EVENT, listener);

    await act(async () => root.render(<ShortcutHelpButton />));
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Keyboard shortcuts");

    await act(async () => {
      button?.click();
    });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHORTCUT_HELP_EVENT, listener);
  });
});
