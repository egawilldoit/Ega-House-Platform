// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useActiveTimer: vi.fn(),
}));

vi.mock("@/components/timer/floating-timer/active-timer-provider", () => ({
  useActiveTimer: mocks.useActiveTimer,
}));

import { QuickNotesLauncher } from "./quick-notes-launcher";

function makeQuickNotes(overrides: Record<string, unknown> = {}) {
  return {
    text: "",
    status: "saved-locally",
    error: null,
    panelOpen: false,
    confirmNewNote: false,
    setText: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    save: vi.fn(),
    requestNewNote: vi.fn(),
    confirmNewNoteAction: vi.fn(),
    cancelNewNote: vi.fn(),
    dismissError: vi.fn(),
    popoutSupported: false,
    popoutOpen: false,
    popoutError: null,
    popOut: vi.fn(),
    dismissPopoutError: vi.fn(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

function render(quickNotes = makeQuickNotes()) {
  mocks.useActiveTimer.mockReturnValue({ quickNotes });
  act(() => {
    root.render(<QuickNotesLauncher />);
  });
  return quickNotes;
}

function openPanel(quickNotes: ReturnType<typeof makeQuickNotes>) {
  return render({ ...quickNotes, panelOpen: true });
}

function byText(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
}

function byLabel(label: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => button.getAttribute("aria-label") === label,
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.useActiveTimer.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("quick notes launcher", () => {
  it("is available globally and opens an editable in-app panel", () => {
    const quickNotes = render();
    const launcher = document.querySelector('[data-testid="quick-notes-launcher"]');
    expect(launcher?.textContent).toContain("Quick notes");

    act(() => {
      (launcher as HTMLButtonElement).click();
    });
    expect(quickNotes.openPanel).toHaveBeenCalledTimes(1);

    openPanel(quickNotes);
    expect(document.querySelector('[data-testid="quick-notes-panel"]')).not.toBeNull();
    expect(
      document.querySelector('textarea[aria-label="Quick notes scratchpad"]'),
    ).not.toBeNull();
    expect(byLabel("Save note to Backlog")).not.toBeUndefined();
    expect(byLabel("New note or clear draft")).not.toBeUndefined();
  });

  it("does not advertise always-on-top when the browser is unsupported", () => {
    render();
    openPanel(makeQuickNotes());

    expect(byLabel("Pop out Quick Notes to an always-on-top window")).toBeUndefined();
    expect(document.body.textContent).toContain(
      "Always-on-top is unavailable in this browser",
    );
  });

  it("offers the popout control on supported browsers with truthful status", () => {
    render();
    openPanel(
      makeQuickNotes({ popoutSupported: true, text: "draft", status: "unsaved" }),
    );

    expect(byLabel("Pop out Quick Notes to an always-on-top window")).not.toBeUndefined();
    expect(document.body.textContent).toContain("Unsaved changes");
    expect(document.body.textContent).not.toContain(
      "Always-on-top is unavailable",
    );
  });

  it("shows save, error and discard-confirmation states", () => {
    render();
    const quickNotes = openPanel(
      makeQuickNotes({
        text: "important draft",
        status: "error",
        error: "Network unavailable.",
        confirmNewNote: true,
      }),
    );

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Network unavailable.",
    );
    expect(document.body.textContent).toContain("Discard this unsaved note?");
    expect(byText("Discard draft")).not.toBeUndefined();

    act(() => {
      byText("Discard draft")?.click();
    });
    expect(quickNotes.confirmNewNoteAction).toHaveBeenCalledTimes(1);

    act(() => {
      byText("Keep editing")?.click();
    });
    expect(quickNotes.cancelNewNote).toHaveBeenCalledTimes(1);
  });

  it("disables save until there is text and reports saved-to-backlog", () => {
    render();
    const empty = openPanel(makeQuickNotes());
    const saveButton = byLabel("Save note to Backlog") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    act(() => {
      saveButton.click();
    });
    expect(empty.save).not.toHaveBeenCalled();

    render({ ...empty, text: "note", panelOpen: true, status: "saved-to-backlog" });
    expect((byLabel("Save note to Backlog") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(document.body.textContent).toContain("Saved to Backlog");
  });
});
