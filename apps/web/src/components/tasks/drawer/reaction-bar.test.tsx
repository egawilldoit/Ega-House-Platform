// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReactionBar } from "./reaction-bar";

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

describe("ReactionBar", () => {
  it("shows counts, marks the viewer's reaction and applies the server summary", async () => {
    const toggleAction = vi.fn(async () => ({
      ok: true,
      errorMessage: null,
      reactions: [{ emoji: "👍", count: 2, reactedByViewer: true }],
    }));

    act(() =>
      root.render(
        <ReactionBar
          commentId="comment-1"
          taskId="task-1"
          returnTo="/tasks"
          reactions={[{ emoji: "👍", count: 1, reactedByViewer: false }]}
          toggleAction={toggleAction as never}
        />,
      ),
    );

    const button = container.querySelector('button[aria-label*="reaction"]')!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent).toContain("1");

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const updated = container.querySelector('button[aria-label*="reaction"]')!;
    expect(updated.getAttribute("aria-pressed")).toBe("true");
    expect(updated.textContent).toContain("2");
  });

  it("keeps the previous summary and reports a failed toggle", async () => {
    const toggleAction = vi.fn(async () => ({
      ok: false,
      errorMessage: "Unable to update the reaction right now.",
    }));

    act(() =>
      root.render(
        <ReactionBar
          commentId="comment-1"
          taskId="task-1"
          returnTo="/tasks"
          reactions={[{ emoji: "👀", count: 1, reactedByViewer: false }]}
          toggleAction={toggleAction as never}
        />,
      ),
    );

    const button = container.querySelector('button[aria-label*="reaction"]')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to update the reaction",
    );
    expect(button.textContent).toContain("1");
  });
});
