// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { CommentComposer } from "./comment-composer";

const CANDIDATES = [
  { kind: "owner" as const, ref: "owner", handle: "owner", label: "You (owner)" },
  { kind: "agent" as const, ref: "agent:codex", handle: "codex", label: "Codex" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

function setNativeValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function render(options?: {
  ownerId?: string;
  taskId?: string;
  createAction?: (state: unknown, formData: FormData) => Promise<{
    ok: boolean;
    errorMessage: string | null;
    requestId?: string;
  }>;
}) {
  const createAction =
    options?.createAction ??
    vi.fn(async () => ({ ok: true, errorMessage: null, requestId: "req-1" }));

  act(() =>
    root.render(
      <CommentComposer
        taskId={options?.taskId ?? "task-1"}
        ownerId={options?.ownerId ?? "owner-a"}
        returnTo="/tasks?task=task-1"
        mentionCandidates={CANDIDATES}
        createAction={createAction as never}
      />,
    ),
  );
  return createAction;
}

describe("CommentComposer", () => {
  it("shows the shortcut hint and a labelled composer", () => {
    render();
    const textarea = document.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter Control+Enter");
    expect(container.textContent).toContain("to send");
  });

  it("filters and inserts an authorized mention with the keyboard", () => {
    render();
    const textarea = document.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      setNativeValue(textarea, "Hand off to @co");
    });

    const options = document.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("@codex");

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(textarea.value).toBe("Hand off to @codex ");
  });

  it("does not offer an unconfigured agent", () => {
    render();
    const textarea = document.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      setNativeValue(textarea, "@ghost");
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("submits with Ctrl+Enter and keeps one idempotency key on retry", async () => {
    const action = vi.fn(async (_state: unknown, formData: FormData) => ({
      ok: false,
      errorMessage: "Network error",
      requestId: String(formData.get("clientRequestId")),
    }));
    render({ createAction: action as never });
    const textarea = document.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      setNativeValue(textarea, "A note");
    });

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(action).toHaveBeenCalledTimes(1);
    const first = action.mock.calls[0]![1] as FormData;
    expect(first.get("body")).toBe("A note");
    const requestId = String(first.get("clientRequestId"));
    expect(requestId.length).toBeGreaterThan(0);

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });

    const second = action.mock.calls[1]?.[1] as FormData;
    expect(String(second.get("clientRequestId"))).toBe(requestId);
  });


  it("posts with Ctrl+Enter even while the mention menu is open", async () => {
    const action = vi.fn(async () => ({ ok: true, errorMessage: null, requestId: "req-1" }));
    render({ createAction: action as never });
    const textarea = document.querySelector("textarea")!;
    act(() => {
      textarea.focus();
      setNativeValue(textarea, "@co");
    });
    expect(document.querySelectorAll('[role="option"]').length).toBe(1);

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(action).toHaveBeenCalledTimes(1);
  });


  it("uses a fresh retry id per mounted composition, not a reused page-load id", () => {
    render({ ownerId: "owner-a", taskId: "task-1" });
    const first = document.querySelector<HTMLInputElement>(
      'input[name="clientRequestId"]',
    )?.value;
    expect(first).toBeTruthy();

    act(() => root.unmount());
    root = createRoot(container);
    render({ ownerId: "owner-a", taskId: "task-1" });
    const second = document.querySelector<HTMLInputElement>(
      'input[name="clientRequestId"]',
    )?.value;

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("keeps drafts per task and never exposes another owner's draft", () => {
    render({ ownerId: "owner-a", taskId: "task-1" });
    let textarea = document.querySelector("textarea")!;
    act(() => setNativeValue(textarea, "owner a note"));

    act(() => root.unmount());
    root = createRoot(container);
    render({ ownerId: "owner-a", taskId: "task-1" });
    textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("owner a note");

    act(() => root.unmount());
    root = createRoot(container);
    render({ ownerId: "owner-b", taskId: "task-1" });
    textarea = document.querySelector("textarea")!;
    expect(textarea.value).toBe("");
  });
});
