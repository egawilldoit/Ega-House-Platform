// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToastQueue } from "./toast-provider";
import { useUndoToast } from "./use-undo-toast";
import type { ToastActionResult } from "./toast-provider";

let container: HTMLDivElement;
let root: Root;

type Api = ReturnType<typeof useToastQueue> & { showUndo: ReturnType<typeof useUndoToast>["showUndo"] };

function Probe({ onReady }: { onReady: (api: Api) => void }) {
  const queue = useToastQueue();
  const { showUndo } = useUndoToast();
  onReady({ ...queue, showUndo });
  return null;
}

function render() {
  const api = {} as Api;
  act(() =>
    root.render(
      <ToastProvider>
        <Probe
          onReady={(next) => {
            Object.assign(api, next);
          }}
        />
      </ToastProvider>,
    ),
  );
  return api;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const region = () => document.body.querySelector('[role="region"][aria-label="Notifications"]');
const toasts = () => Array.from(document.body.querySelectorAll('[role="status"], [role="alert"]'));

describe("ToastProvider", () => {
  it("mounts the polite live region before any message exists", () => {
    const api = render();
    const live = document.body.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe("");

    act(() => {
      api.show({ message: "Task archived" });
    });
    expect(document.body.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "Task archived",
    );
  });

  it("shows a message and dismisses itself after the default duration", () => {
    const api = render();
    act(() => {
      api.show({ message: "Task archived" });
    });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].textContent).toContain("Task archived");
    expect(region()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(toasts()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toasts()).toHaveLength(0);
  });

  it("keeps at most three visible", () => {
    const api = render();
    act(() => {
      api.show({ message: "one" });
      api.show({ message: "two" });
      api.show({ message: "three" });
      api.show({ message: "four" });
    });
    const messages = toasts().map((toast) => toast.textContent);
    expect(messages).toHaveLength(3);
    expect(messages.join(" ")).not.toContain("one");
    expect(messages.join(" ")).toContain("four");
  });

  it("uses an alert role for errors", () => {
    const api = render();
    act(() => {
      api.show({ message: "Save failed", tone: "error" });
    });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Save failed");
  });

  it("dismisses from the close button", () => {
    const api = render();
    act(() => {
      api.show({ message: "Task archived" });
    });
    const close = document.body.querySelector('[aria-label="Dismiss notification"]');
    act(() => {
      (close as HTMLButtonElement).click();
    });
    expect(toasts()).toHaveLength(0);
  });
});

describe("useUndoToast", () => {
  it("runs the inverse once, disables duplicates while pending, and reports success", async () => {
    const api = render();
    let resolveUndo: (value: ToastActionResult) => void = () => {};
    const undo = vi.fn(
      () =>
        new Promise<ToastActionResult>((resolve) => {
          resolveUndo = resolve;
        }),
    );

    act(() => {
      api.showUndo({ message: "Task archived", undo });
    });
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Undo",
    ) as HTMLButtonElement;
    expect(button).not.toBeUndefined();

    act(() => {
      button.click();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Working…");

    act(() => {
      button.click();
    });
    expect(undo).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUndo("success");
      await Promise.resolve();
    });
    expect(toasts()[0].textContent).toContain("Done");
  });

  it("reports a conflict instead of claiming the undo worked", async () => {
    const api = render();
    act(() => {
      api.showUndo({
        message: "Task archived",
        undo: async (): Promise<ToastActionResult> => "conflict",
      });
    });
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Undo",
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(toasts()[0].textContent).toContain("changed since");
    expect(toasts()[0].textContent).not.toContain("Nothing was changed");
    // The inverse must not be offered a second time.
    expect(
      Array.from(document.body.querySelectorAll("button")).some(
        (button) => button.textContent === "Undo",
      ),
    ).toBe(false);
  });

  it("reports a thrown inverse as a failure", async () => {
    const api = render();
    act(() => {
      api.showUndo({
        message: "Task archived",
        undo: async () => {
          throw new Error("network");
        },
      });
    });
    const button = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Undo",
    ) as HTMLButtonElement;

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(toasts()[0].textContent).toContain("check the current state");
  });
});
