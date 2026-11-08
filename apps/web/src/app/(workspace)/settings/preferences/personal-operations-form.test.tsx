// @vitest-environment jsdom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

function labelledInput(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
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
  action = serverAction,
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-16T12:00:00Z"));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.sessionStorage.clear();
  serverAction.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  vi.useRealTimers();
  container.remove();
  window.sessionStorage.clear();
});

describe("PersonalOperationsForm", () => {
  it("updates today at Casablanca midnight and after a suspended tab resumes", async () => {
    vi.setSystemTime(new Date("2026-03-21T23:59:59Z"));
    await renderForm({ timeContext: { ...CASABLANCA_MONDAY, localDate: "2026-03-21" } });
    expect(container.textContent).toContain("Today in Africa/Casablanca: Saturday");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).toContain("Today in Africa/Casablanca: Sunday");

    vi.setSystemTime(new Date("2026-03-23T12:00:00Z"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(container.textContent).toContain("Today in Africa/Casablanca: Monday");
  });

  it("renders defaults, the account time zone, today's plan and week totals", async () => {
    await renderForm();

    expect(container.textContent).toContain("Account time zone: Africa/Casablanca");
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

    expect(container.textContent).toContain("48h");
    expect(container.textContent).toContain("2,880 minutes per week");
    expect(container.textContent).toContain("7.5h");
    expect(container.textContent).toContain("450 minutes per week");

    expect(labelledInput("Monday work minutes").value).toBe("480");
    expect(labelledInput("Monday job-search minutes").value).toBe("90");
  });

  it("updates the today plan and weekly totals from the edited draft", async () => {
    await renderForm();

    await setInputValue(labelledInput("Monday work minutes"), "240");

    expect(container.textContent).toContain("240 min work, 90 min job search");
    expect(container.textContent).toContain("44h");
    expect(container.textContent).toContain("2,640 minutes per week");
    expect(container.textContent).toContain("450 minutes per week");
  });

  it("keeps typed values and shows an alert when the action rejects the save", async () => {
    const rejectAction = vi.fn(async () => ({
      ok: false,
      message: "Check schedule targets and guidance; enabled blocks cannot overlap.",
    })) as unknown as PersonalOperationsAction;
    await renderForm({ action: rejectAction });

    const mondayWork = labelledInput("Monday work minutes");
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
    expect(labelledInput("Monday work minutes").value).toBe("600");
    const alert = container.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("enabled blocks cannot overlap");
    expect(document.activeElement).toBe(alert);
  });

  it("pausing retains every target and still reports them", async () => {
    await renderForm();

    const pause = container.querySelector<HTMLInputElement>(
      'input[aria-label="Schedule active"]',
    );
    if (!pause) throw new Error("Missing schedule active switch");
    await click(pause);

    expect(pause.checked).toBe(false);
    expect(container.textContent).toContain("Paused");
    expect(labelledInput("Monday work minutes").value).toBe("480");
    expect(container.textContent).toContain("480 min work, 90 min job search (paused)");
    expect(container.textContent).toContain("48h");
  });

  it("shows a fallback notice when the account has no stored time zone", async () => {
    await renderForm({
      timeContext: {
        timezone: "UTC",
        persistedTimezone: null,
        fallback: "missing_timezone",
        localDate: "2026-02-16",
      },
    });

    expect(container.textContent).toContain("No time zone is stored for this account");
    expect(container.textContent).toContain("Today in UTC: Monday");
  });

  it("keeps the schedule editable when the time context is unavailable", async () => {
    await renderForm({ timeContext: null });

    expect(container.textContent).toContain(
      "The account time zone could not be loaded right now",
    );
    expect(container.textContent).toContain("Today's plan is unavailable");
    expect(labelledInput("Monday work minutes").value).toBe("480");
  });

  it("does not render an editable-looking form when preferences failed to load", async () => {
    await renderForm({ disabled: true });

    expect(container.textContent).toContain("Read-only until your preferences load");
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
  });
});

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const ARCHIVED_TASK_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_TASK_ID = "33333333-3333-4333-8333-333333333333";

function renderReferenceForm(
  initialReference: { kind: "task"; id: string } | null = null,
) {
  return (
    <PersonalOperationsForm
      initial={DEFAULT_PERSONAL_OPERATIONS}
      initialReference={initialReference}
      referenceOptions={{
        tasks: [
          { id: TASK_ID, title: "Apply to roles", archivedAt: null },
          { id: ARCHIVED_TASK_ID, title: "Old applications", archivedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }}
      disabled={false}
      timeContext={CASABLANCA_MONDAY}
      action={serverAction}
    />
  );
}

describe("PersonalOperationsForm job-search reference", () => {
  it("offers task options, labels archived tasks, and the schedule JSON is 3-key", () => {
    const markup = renderToStaticMarkup(renderReferenceForm());

    expect(markup).toContain("Job-search work reference");
    expect(markup).toContain('<optgroup label="Tasks">');
    expect(markup).not.toContain('<optgroup label="Projects">');
    expect(markup).toContain("Old applications (archived)");
    expect(markup).toContain(`task:${TASK_ID}`);
    expect(markup).toContain('name="jobSearchReferenceDirty" value="false"');
    const scheduleJson = markup.match(/name="schedule" value="([^"]+)"/)?.[1] ?? "";
    expect(scheduleJson).not.toContain("jobSearchReference");
  });

  it("keeps a configured task that is missing from the fetched options", () => {
    const markup = renderToStaticMarkup(renderReferenceForm({ kind: "task", id: MISSING_TASK_ID }));

    expect(markup).toContain('<optgroup label="Current selection">');
    expect(markup).toContain(`task:${MISSING_TASK_ID}`);
    expect(markup).toContain("not in the current list");
  });

  it("marks the reference dirty only when the owner changes it", async () => {
    const referenceRoot = createRoot(container);
    await act(async () => {
      referenceRoot.render(renderReferenceForm());
    });

    const dirty = () => container.querySelector<HTMLInputElement>('input[name="jobSearchReferenceDirty"]')!;
    const select = () => container.querySelector<HTMLSelectElement>('select[name="jobSearchReference"]')!;
    expect(dirty().value).toBe("false");

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(select(), `task:${TASK_ID}`);
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dirty().value).toBe("true");
    expect(select().value).toBe(`task:${TASK_ID}`);

    await act(async () => {
      setter.call(select(), "");
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dirty().value).toBe("true");
    expect(select().value).toBe("");

    await act(async () => {
      referenceRoot.unmount();
    });
  });
});
