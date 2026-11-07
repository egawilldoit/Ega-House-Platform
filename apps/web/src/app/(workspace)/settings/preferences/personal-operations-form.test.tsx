// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERSONAL_OPERATIONS } from "@ega/domain/preferences";

const serverAction = vi.hoisted(() =>
  vi.fn(async (_state: { message: string; ok: boolean }, _formData: FormData) => ({
    ok: true,
    message: "Personal schedule saved.",
  })),
);

vi.mock("./actions", () => ({
  updatePersonalOperationsAction: (state: { message: string; ok: boolean }, formData: FormData) =>
    serverAction(state, formData),
}));

import {
  PersonalOperationsForm,
  type PersonalOperationsAction,
  type PersonalOperationsTimeContext,
} from "./personal-operations-form";

const CASABLANCA_MONDAY: PersonalOperationsTimeContext = {
  timezone: "Africa/Casablanca",
  fallback: "none",
  localDate: "2026-02-16",
};

let container: HTMLDivElement;
let root: Root;

function dayGroup(day: string): HTMLFieldSetElement {
  const group = Array.from(container.querySelectorAll("fieldset")).find(
    (element) => element.querySelector("legend")?.textContent?.trim() === day,
  );
  if (!group) throw new Error(`Missing ${day} fieldset`);
  return group as HTMLFieldSetElement;
}

function labelledInput(scope: ParentNode, label: string): HTMLInputElement {
  const match = Array.from(scope.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(label),
  );
  const input = match?.querySelector("input");
  if (!input) throw new Error(`Missing ${label} input`);
  return input;
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(input: HTMLInputElement) {
  await act(async () => {
    input.click();
  });
}

async function renderForm({
  action,
  timeContext = CASABLANCA_MONDAY,
  disabled = false,
}: {
  action?: PersonalOperationsAction;
  timeContext?: PersonalOperationsTimeContext | null;
  disabled?: boolean;
} = {}) {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PersonalOperationsForm
        initial={DEFAULT_PERSONAL_OPERATIONS}
        disabled={disabled}
        timeContext={timeContext}
        action={action}
      />,
    );
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  serverAction.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe("PersonalOperationsForm", () => {
  it("renders defaults, the account time zone, today's plan and week totals", async () => {
    await renderForm();

    expect(container.textContent).toContain("Today in Africa/Casablanca: Monday");
    expect(container.textContent).toContain("480 min work, 90 min job search");
    // Enabled Monday guidance only, in start order.
    const guidance = Array.from(
      container.querySelectorAll('[aria-label="Today\'s guidance"] li'),
    ).map((element) => element.textContent);
    expect(guidance).toEqual([
      "Startup: 06:00–06:30",
      "Job search: 10:30–12:00",
      "Lunch: 12:00–13:00",
      "Leisure: 19:00–20:30",
    ]);

    expect(container.textContent).toContain("48 h work / 7 h 30 min job search");
    expect(container.textContent).toContain("2880 work, 450 job search");

    expect(dayGroup("monday")).toBeTruthy();
    expect(labelledInput(dayGroup("monday"), "Work minutes").value).toBe("480");
    expect(labelledInput(dayGroup("monday"), "Job-search minutes").value).toBe("90");
  });

  it("updates the today plan and weekly totals from the edited draft", async () => {
    await renderForm();

    await setInputValue(labelledInput(dayGroup("monday"), "Work minutes"), "240");

    expect(container.textContent).toContain("240 min work, 90 min job search");
    expect(container.textContent).toContain("44 h work / 7 h 30 min job search");
    expect(container.textContent).toContain("2640 work, 450 job search");
  });

  it("keeps typed values and shows an alert when the action rejects the save", async () => {
    const rejectAction = vi.fn(async () => ({
      ok: false,
      message: "Check schedule targets and guidance; enabled blocks cannot overlap.",
    })) as unknown as PersonalOperationsAction;
    await renderForm({ action: rejectAction });

    const mondayWork = labelledInput(dayGroup("monday"), "Work minutes");
    await setInputValue(mondayWork, "600");

    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    await act(async () => {
      form.requestSubmit();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(rejectAction).toHaveBeenCalledTimes(1);
    expect(labelledInput(dayGroup("monday"), "Work minutes").value).toBe("600");
    const alert = container.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("enabled blocks cannot overlap");
    expect(document.activeElement).toBe(alert);
  });

  it("pausing retains every target and still reports them", async () => {
    await renderForm();

    const pause = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("Pause schedule"),
    )?.querySelector("input");
    if (!pause) throw new Error("Missing pause checkbox");
    await click(pause);

    expect(pause.checked).toBe(true);
    expect(container.textContent).toContain("Paused. Your targets are retained.");
    expect(labelledInput(dayGroup("monday"), "Work minutes").value).toBe("480");
    expect(container.textContent).toContain("480 min work, 90 min job search (paused)");
    expect(container.textContent).toContain("48 h work / 7 h 30 min job search");
  });

  it("does not render an editable-looking form when preferences failed to load", async () => {
    await renderForm({ disabled: true });

    expect(container.textContent).toContain("Read-only until your preferences load");
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
  });
});
