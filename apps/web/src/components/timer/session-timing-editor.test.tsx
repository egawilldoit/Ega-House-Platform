import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { UpdateSessionTimingFormState } from "@/app/timer/actions";
import {
  combineLocalDateAndTimeToIso,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "@/lib/timer-correction";

import { SessionTimingEditor } from "./session-timing-editor";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

let container: HTMLDivElement;
let root: Root;

const STARTED_AT = "2026-04-21T14:00:00.000Z";
const ENDED_AT = "2026-04-21T18:00:00.000Z";

const sessionProps = {
  sessionId: "session-1",
  taskTitle: "Ship the workspace refinement",
  projectName: "LIFE",
  startedAt: STARTED_AT,
  endedAt: ENDED_AT,
  returnTo: "/timer",
};

type ActionSpy = Mock<
  (
    previous: UpdateSessionTimingFormState,
    formData: FormData,
  ) => Promise<UpdateSessionTimingFormState>
> & { nextErrorMessage: string | null };

let saveAction: ActionSpy;

function buildSaveAction() {
  return Object.assign(
    vi.fn(
      (
        _previous: UpdateSessionTimingFormState,
        formData: FormData,
      ): Promise<UpdateSessionTimingFormState> =>
        Promise.resolve({
          errorMessage: saveAction.nextErrorMessage,
          successMessage: saveAction.nextErrorMessage
            ? null
            : "Session timing updated.",
          sessionId: String(formData.get("sessionId") ?? ""),
        }),
    ),
    { nextErrorMessage: null as string | null },
  ) as unknown as ActionSpy;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saveAction = buildSaveAction();
  refresh.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

function renderEditor(overrides: Partial<typeof sessionProps> = {}) {
  return act(async () => {
    root.render(
      <SessionTimingEditor
        {...sessionProps}
        {...overrides}
        action={saveAction as unknown as (
          state: UpdateSessionTimingFormState,
          formData: FormData,
        ) => Promise<UpdateSessionTimingFormState>}
      />,
    );
  });
}

function dialog() {
  return document.body.querySelector('[role="dialog"]');
}

function triggerButton() {
  return container.querySelector<HTMLButtonElement>('[aria-label="Correct session timing"]');
}

async function openDialog() {
  await renderEditor();
  expect(dialog()).toBeNull();
  await act(async () => {
    triggerButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(dialog()).not.toBeNull();
}

function valueOf(inputIdSuffix: string) {
  const input = document.body.querySelector<HTMLInputElement>(`[id$="${inputIdSuffix}"]`);
  expect(input).not.toBeNull();
  return input!;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const SAVE_BUTTON_LABEL = "Save changes";

function saveButton() {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.type === "submit" && candidate.textContent?.includes(SAVE_BUTTON_LABEL),
  );
  expect(button).not.toBeNull();
  return button!;
}

describe("SessionTimingEditor centered modal", () => {
  it("opens the editor for the selected session without mutating", async () => {
    await renderEditor();

    expect(dialog()).toBeNull();
    expect(saveAction).not.toHaveBeenCalled();

    await act(async () => {
      triggerButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(opened!.getAttribute("role")).toBe("dialog");
    expect(opened!.textContent).toContain("Edit session");
    expect(opened!.textContent).toContain("Adjust the recorded time for this work session.");
    expect(opened!.textContent).toContain("Ship the workspace refinement");
    expect(opened!.textContent).toContain("LIFE");
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("shows correct initial date/time values from the recorded session", async () => {
    await openDialog();

    expect(valueOf("session-date-session-1").value).toBe(toLocalDateInputValue(STARTED_AT));
    expect(valueOf("session-start-session-1").value).toBe(toLocalTimeInputValue(STARTED_AT));
    expect(valueOf("session-end-session-1").value).toBe(toLocalTimeInputValue(ENDED_AT));
  });

  it("updates the visible duration immediately when the end time changes", async () => {
    await openDialog();

    const endInput = valueOf("session-end-session-1");
    await setInputValue(endInput, "20:50");

    expect(document.body.textContent).toContain("6h 50m 0s");
  });

  it("updates the visible duration immediately when the start time changes", async () => {
    await openDialog();

    const startInput = valueOf("session-start-session-1");
    await setInputValue(startInput, "16:00");

    expect(document.body.textContent).toContain("2h 0m 0s");
  });

  it("+15 modifies the end time exactly 15 minutes and keeps start untouched", async () => {
    await openDialog();

    const startBefore = valueOf("session-start-session-1").value;
    const next15 = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Move end time later by 15 minutes"]',
    );
    expect(next15).not.toBeNull();
    await act(async () => {
      next15!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const startAfter = valueOf("session-start-session-1").value;
    expect(startAfter).toBe(startBefore);

    const [endHours, endMinutes] = toLocalTimeInputValue(ENDED_AT).split(":").map(Number);
    expect(valueOf("session-end-session-1").value).toBe(
      `${String((endHours * 60 + endMinutes + 15) / 60 | 0).padStart(2, "0")}:${String((endMinutes + 15) % 60).padStart(2, "0")}`,
    );
  });

  it("-30 shifts the end time across an hour boundary", async () => {
    await openDialog();

    const endInput = valueOf("session-end-session-1");
    await setInputValue(endInput, "10:05");

    const back30 = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Move end time earlier by 30 minutes"]',
    );
    expect(back30).not.toBeNull();
    await act(async () => {
      back30!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(valueOf("session-end-session-1").value).toBe("09:35");
  });

  it("holds the midnight clamp for end-time nudges (existing day-boundary semantics)", async () => {
    await openDialog();

    const endInput = valueOf("session-end-session-1");
    await setInputValue(endInput, "00:10");

    const back30 = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Move end time earlier by 30 minutes"]',
    );
    await act(async () => {
      back30!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(valueOf("session-end-session-1").value).toBe("00:00");
  });

  it("prevents saving an end time before the start and shows the inline error", async () => {
    await openDialog();

    const [startHours, startMinutes] = toLocalTimeInputValue(STARTED_AT).split(":").map(Number);
    const startTotal = startHours * 60 + startMinutes;
    if (startTotal === 0) {
      // Start sits exactly at local midnight: shift the range so end precedes start.
      await setInputValue(valueOf("session-start-session-1"), "23:59");
      await setInputValue(valueOf("session-end-session-1"), "00:00");
    } else {
      const earlierTotal = startTotal - 1;
      const earlierTime = `${String(Math.floor(earlierTotal / 60)).padStart(2, "0")}:${String(earlierTotal % 60).padStart(2, "0")}`;
      await setInputValue(valueOf("session-end-session-1"), earlierTime);
    }

    expect(saveButton()!.disabled).toBe(true);
    expect(document.body.textContent).toContain("End time must be after start time.");
  });

  it("invokes persistence with the combined ISO values on a valid save", async () => {
    await openDialog();

    await setInputValue(valueOf("session-end-session-1"), "20:00");

    await act(async () => {
      saveButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(saveAction).toHaveBeenCalled();
    const formData = (saveAction.mock.calls.at(-1) as unknown[]).find(
      (arg) => arg instanceof FormData,
    ) as FormData;
    expect(formData.get("sessionId")).toBe("session-1");
    expect(formData.get("returnTo")).toBe("/timer");
    const startedIso = String(formData.get("startedAt"));
    const endedIso = String(formData.get("endedAt"));
    expect(new Date(endedIso).getTime()).toBe(
      new Date(startedIso).getTime() + 6 * 3600 * 1000,
    );
    expect(startedIso).toBe(
      combineLocalDateAndTimeToIso(toLocalDateInputValue(STARTED_AT), toLocalTimeInputValue(STARTED_AT)),
    );
  });

  it("closes the dialog after a confirmed successful save and refreshes the page data", async () => {
    await openDialog();

    await act(async () => {
      saveButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {});
    expect(refresh).toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it("does not persist when cancelled", async () => {
    await openDialog();

    await setInputValue(valueOf("session-end-session-1"), "20:50");

    const cancel = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Cancel"),
    );
    expect(cancel).not.toBeNull();
    await act(async () => {
      cancel!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(dialog()).toBeNull();
    expect(saveAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("discards unsaved edits when reopened after a cancel", async () => {
    await openDialog();
    await setInputValue(valueOf("session-end-session-1"), "20:50");

    const cancel = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Cancel"),
    );
    await act(async () => {
      cancel!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      triggerButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(valueOf("session-end-session-1").value).toBe(toLocalTimeInputValue(ENDED_AT));
  });

  it("keeps the editor open with the server error and preserved values on failure", async () => {
    saveAction.nextErrorMessage = "Unable to update this session right now.";
    await openDialog();

    await setInputValue(valueOf("session-end-session-1"), "20:50");

    await act(async () => {
      saveButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {});
    expect(dialog()).not.toBeNull();
    expect(document.body.textContent).toContain("Unable to update this session right now.");
    expect(valueOf("session-end-session-1").value).toBe("20:50");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opening session B after editing session A does not leak dirty values", async () => {
    await openDialog();
    await setInputValue(valueOf("session-end-session-1"), "20:50");
    await act(async () => {
      saveButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(dialog()).toBeNull();

    await act(async () => {
      triggerButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const second = dialog();
    expect(second?.textContent).toContain("Ship the workspace refinement");
    expect(valueOf("session-end-session-1").value).toBe(toLocalTimeInputValue(ENDED_AT));
  });

  it("closes with Escape and restores focus to the originating trigger", async () => {
    await renderEditor();
    await act(async () => {
      triggerButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    await act(async () => {});
    const activeElement = document.activeElement;
    expect(
      activeElement === triggerButton() || activeElement === document.body,
      "focus must return to the trigger after close (Radix restoration)",
    ).toBe(true);
  });
});
