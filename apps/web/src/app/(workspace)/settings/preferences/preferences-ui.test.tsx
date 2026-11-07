// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_USER_PREFERENCES } from "@ega/domain/preferences";

import { AppearanceForm } from "../appearance/appearance-form";
import {
  PersonalOperationsForm,
  type PersonalOperationsAction,
} from "./personal-operations-form";
import type { Schedule } from "./schedule-model";
import { WorkspaceDefaultsForm } from "./workspace-defaults-form";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

type FormAction = (formData: FormData) => Promise<void>;

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    ...structuredClone(DEFAULT_USER_PREFERENCES.personalOperations),
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
    input,
    value,
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function field<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit();
    await Promise.resolve();
  });
}

describe("PersonalOperationsForm", () => {
  it("hydrates saved values, including a saved Monday 450 target", async () => {
    const initial = schedule();
    initial.targets.monday.work = 450;
    const action = vi.fn<PersonalOperationsAction>(async () => ({
      ok: true,
      message: "Personal schedule saved.",
    }));

    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={initial}
          disabled={false}
          timezone="UTC"
          action={action}
        />,
      );
    });

    expect(field<HTMLInputElement>('input[aria-label="Monday work minutes"]').value).toBe(
      "450",
    );
    expect(container.textContent).toContain("47.5h");
    expect(container.textContent).toContain("2,850 minutes per week");
    expect(container.textContent).toContain("7.5h");
    expect(field<HTMLInputElement>('input[id="guidance-0-start"]').value).toBe("06:00");
  });

  it("shows the paused state without misleading upcoming text", async () => {
    const initial = schedule({ paused: true });
    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={initial}
          disabled={false}
          timezone="UTC"
          action={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Paused");
    expect(container.textContent).toContain(
      "Upcoming guidance is hidden while the schedule is paused.",
    );
    expect(container.textContent).not.toContain("Next: Job search");
  });

  it("selects a block with the keyboard and updates the planner preview immediately", async () => {
    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={vi.fn()}
        />,
      );
    });

    const lunch = field<HTMLButtonElement>(
      'button[aria-label="Lunch on Monday from 12:00 to 13:00"]',
    );
    await act(async () => {
      lunch.click();
    });

    expect(field<HTMLElement>("#guidance-2-title").textContent).toBe("Lunch");
    const startInput = field<HTMLInputElement>('input[id="guidance-2-start"]');
    expect(startInput.value).toBe("12:00");

    await act(async () => {
      setInputValue(startInput, "12:30");
    });

    expect(
      container.querySelector(
        'button[aria-label="Lunch on Monday from 12:30 to 13:00"]',
      ),
    ).toBeTruthy();
  });

  it("reports overlaps inline and keeps the invalid draft unsaveable", async () => {
    const initial = schedule();
    initial.guidance[5] = {
      ...initial.guidance[5]!,
      enabled: true,
      days: ["monday"],
      start: "06:15",
      end: "07:00",
    };

    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={initial}
          disabled={false}
          timezone="UTC"
          action={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Startup and Cooking overlap on Monday.",
    );

    const mondayWork = field<HTMLInputElement>(
      'input[aria-label="Monday work minutes"]',
    );
    await act(async () => {
      setInputValue(mondayWork, "450");
    });

    expect(buttonByText("Save changes").disabled).toBe(true);
  });

  it("saves the full schedule only after the server confirms it", async () => {
    const action = vi.fn<PersonalOperationsAction>(async () => ({
      ok: true,
      message: "Personal schedule saved.",
    }));

    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={action}
        />,
      );
    });

    const mondayWork = field<HTMLInputElement>(
      'input[aria-label="Monday work minutes"]',
    );
    await act(async () => {
      setInputValue(mondayWork, "450");
    });

    expect(container.textContent).toContain("47.5h");
    expect(container.textContent).toContain("Unsaved changes");

    await submit(field<HTMLFormElement>("form"));

    expect(action).toHaveBeenCalledTimes(1);
    const submitted = action.mock.calls[0]?.[1] as FormData;
    const payload = JSON.parse(String(submitted.get("schedule"))) as Schedule;
    expect(payload.targets.monday.work).toBe(450);
    expect(submitted.get("theme")).toBeNull();
    expect(container.textContent).toContain("Personal schedule saved.");
  });

  it("keeps edits and shows an accessible error when the server rejects a save", async () => {
    const action = vi.fn<PersonalOperationsAction>(async () => ({
      ok: false,
      message: "Check schedule targets and guidance; enabled blocks cannot overlap.",
    }));

    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={action}
        />,
      );
    });

    const mondayWork = field<HTMLInputElement>(
      'input[aria-label="Monday work minutes"]',
    );
    await act(async () => {
      setInputValue(mondayWork, "450");
    });
    await submit(field<HTMLFormElement>("form"));

    expect(mondayWork.value).toBe("450");
    const alert = field<HTMLElement>('[role="alert"]');
    expect(alert.textContent).toContain("enabled blocks cannot overlap");
    expect(buttonByText("Save changes").disabled).toBe(false);
  });

  it("keeps edits when the action itself rejects", async () => {
    const action = vi.fn<PersonalOperationsAction>(async () => {
      throw new Error("network unavailable");
    });

    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={action}
        />,
      );
    });

    const mondayWork = field<HTMLInputElement>(
      'input[aria-label="Monday work minutes"]',
    );
    await act(async () => {
      setInputValue(mondayWork, "450");
    });
    await submit(field<HTMLFormElement>("form"));

    expect(mondayWork.value).toBe("450");
    expect(container.textContent).toContain(
      "Unable to save the personal schedule right now. Your changes are still here.",
    );
    expect(buttonByText("Save changes").disabled).toBe(false);
  });

  it("discards unsaved edits back to the last confirmed values", async () => {
    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={vi.fn()}
        />,
      );
    });

    const mondayWork = field<HTMLInputElement>(
      'input[aria-label="Monday work minutes"]',
    );
    await act(async () => {
      setInputValue(mondayWork, "450");
    });
    expect(container.textContent).toContain("Unsaved changes");

    await act(async () => {
      buttonByText("Discard").click();
    });

    expect(mondayWork.value).toBe("480");
    expect(container.textContent).not.toContain("Unsaved changes");
  });

  it("toggles pause and resume from the summary strip", async () => {
    await act(async () => {
      root.render(
        <PersonalOperationsForm
          initial={schedule()}
          disabled={false}
          timezone="UTC"
          action={vi.fn()}
        />,
      );
    });

    const activeSwitch = field<HTMLInputElement>(
      'input[aria-label="Schedule active"]',
    );
    await act(async () => {
      activeSwitch.click();
    });

    expect(container.textContent).toContain("Paused");
    expect(container.textContent).toContain(
      "Upcoming guidance is hidden while the schedule is paused.",
    );

    await act(async () => {
      field<HTMLInputElement>('input[aria-label="Schedule active"]').click();
    });
    expect(container.textContent).toContain("Active");
  });
});

describe("AppearanceForm", () => {
  it("renders the saved selection and changes it with native radio semantics", async () => {
    const action = vi.fn<FormAction>(async () => undefined);
    await act(async () => {
      root.render(
        <AppearanceForm
          preferences={{
            theme: "dark",
            accent: "violet",
            density: "compact",
            reducedMotion: true,
          }}
          action={action}
        />,
      );
    });

    const dark = field<HTMLInputElement>('input[name="theme"][value="dark"]');
    const violet = field<HTMLInputElement>('input[name="accent"][value="violet"]');
    const compact = field<HTMLInputElement>('input[name="density"][value="compact"]');
    const motion = field<HTMLInputElement>('input[name="reducedMotion"]');

    expect(dark.checked).toBe(true);
    expect(violet.checked).toBe(true);
    expect(compact.checked).toBe(true);
    expect(motion.checked).toBe(true);

    const blue = field<HTMLInputElement>('input[name="accent"][value="blue"]');
    await act(async () => {
      blue.click();
    });

    expect(blue.checked).toBe(true);
    expect(violet.checked).toBe(false);
  });

  it("submits only appearance fields and nothing from the schedule", async () => {
    const action = vi.fn<FormAction>(async () => undefined);
    await act(async () => {
      root.render(
        <AppearanceForm
          preferences={{
            theme: "system",
            accent: "neutral",
            density: "comfortable",
            reducedMotion: false,
          }}
          action={action}
        />,
      );
    });

    const fieldNames = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    ).map((input) => input.name);
    expect(new Set(fieldNames)).toEqual(
      new Set(["theme", "accent", "density", "reducedMotion"]),
    );
    expect(fieldNames).not.toContain("schedule");

    await act(async () => {
      field<HTMLInputElement>('input[name="theme"][value="light"]').click();
    });
    await submit(field<HTMLFormElement>("form"));

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0]?.[0] as FormData;
    expect(formData.get("theme")).toBe("light");
    expect(formData.get("accent")).toBe("neutral");
    expect(formData.get("schedule")).toBeNull();
  });
});

describe("WorkspaceDefaultsForm", () => {
  it("keeps workspace choices on their own action and fields", async () => {
    const action = vi.fn<FormAction>(async () => undefined);
    await act(async () => {
      root.render(
        <WorkspaceDefaultsForm
          preferences={{
            launchPage: "today",
            taskLayout: "kanban",
            taskOpenMode: "full",
          }}
          action={action}
        />,
      );
    });

    expect(
      field<HTMLInputElement>('input[name="launchPage"][value="today"]').checked,
    ).toBe(true);
    expect(
      field<HTMLInputElement>('input[name="taskLayout"][value="kanban"]').checked,
    ).toBe(true);
    expect(
      field<HTMLInputElement>('input[name="taskOpenMode"][value="full"]').checked,
    ).toBe(true);
    expect(container.querySelector('input[name="schedule"]')).toBeNull();

    await act(async () => {
      field<HTMLInputElement>('input[name="launchPage"][value="home"]').click();
    });
    await submit(field<HTMLFormElement>("form"));

    expect(action).toHaveBeenCalledTimes(1);
    const formData = action.mock.calls[0]?.[0] as FormData;
    expect(formData.get("launchPage")).toBe("home");
    expect(formData.get("taskLayout")).toBe("kanban");
    expect(formData.get("taskOpenMode")).toBe("full");
    expect(formData.get("schedule")).toBeNull();
  });
});
