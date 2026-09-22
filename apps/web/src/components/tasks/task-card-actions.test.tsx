import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskCardActions } from "./task-card-actions";

let container: HTMLDivElement;
let root: Root;

const actions = {
  action: vi.fn(),
  deleteAction: vi.fn(),
  archiveAction: vi.fn(),
  unarchiveAction: vi.fn(),
  startTimerAction: vi.fn(),
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const mock of Object.values(actions)) mock.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function renderCard(overrides: Partial<Parameters<typeof TaskCardActions>[0]> = {}) {
  return act(async () => {
    root.render(
      <TaskCardActions
        {...actions}
        taskId="task-1"
        taskTitle="Ship the polish stack"
        returnTo="/tasks"
        defaultStatus="todo"
        defaultPriority="high"
        defaultDueDate="2026-09-20"
        defaultEstimateMinutes={60}
        defaultScheduledStartAt={null}
        defaultScheduledEndAt={null}
        defaultCalendarSyncEnabled={false}
        defaultCalendarReminderMinutes={30}
        defaultBlockedReason={null}
        defaultRecurrenceRule={null}
        archivedAt={null}
        error={null}
        reminders={<p data-testid="reminders-slot">Reminder controls</p>}
        overflowActions={<button type="button">Pin task</button>}
        {...overrides}
      />,
    );
  });
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TaskCardActions progressive disclosure (EGA-651)", () => {
  it("keeps primary actions visible and the editor hidden by default", async () => {
    await renderCard();

    expect(container.textContent).toContain("Start timer");
    expect(container.textContent).toContain("Mark done");
    expect(container.textContent).toContain("More options");

    // Advanced editor not mounted until requested.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("Advanced settings");
  });

  it("opens the focused editor for the correct task without mutating", async () => {
    await renderCard();

    const trigger = container.querySelector('[data-testid="task-more-options-task-1"]');
    expect(trigger).not.toBeNull();
    await click(trigger!);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe("Advanced task settings for Ship the polish stack");

    // Advanced editing capabilities remain reachable.
    expect(dialog?.textContent).toContain("Advanced settings");
    expect(dialog?.textContent).toContain("Status");
    expect(dialog?.textContent).toContain("Save");
    expect(dialog?.textContent).toContain("Archive");
    expect(dialog?.textContent).toContain("Delete task");
    expect(dialog?.textContent).toContain("Reminder controls");
    expect(dialog?.textContent).toContain("Pin task");

    // Opening the editor must not submit anything.
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("closes with Escape without mutating", async () => {
    await renderCard();
    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("hides Mark done for completed tasks and Start timer for archived tasks", async () => {
    await renderCard({ defaultStatus: "done" });
    expect(container.textContent).not.toContain("Mark done");

    await renderCard({ archivedAt: "2026-09-01T00:00:00.000Z" });
    expect(container.textContent).not.toContain("Start timer");
    expect(container.textContent).toContain("More options");
  });

  it("EGA-651: opens the advanced editor with a visible, announced alert when this task has a save error", async () => {
    await renderCard({ error: "Could not save task" });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe("Advanced task settings for Ship the polish stack");
    expect(dialog?.textContent).toContain("Advanced settings");
    expect(dialog?.textContent).toContain("Ship the polish stack");

    const alert = dialog?.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Could not save task");

    // Opening the editor because of an error must not mutate anything.
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("EGA-651: no error keeps the advanced editor closed by default", async () => {
    await renderCard({ error: null });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("EGA-651: only the task carrying the error opens its editor", async () => {
    const base = {
      ...actions,
      returnTo: "/tasks",
      defaultStatus: "todo",
      defaultPriority: "high",
      defaultDueDate: null,
      defaultEstimateMinutes: null,
      defaultScheduledStartAt: null,
      defaultScheduledEndAt: null,
      defaultCalendarSyncEnabled: false,
      defaultCalendarReminderMinutes: 30,
      defaultBlockedReason: null,
      defaultRecurrenceRule: null,
      archivedAt: null,
      reminders: null,
      overflowActions: null,
    };

    await act(async () => {
      root.render(
        <>
          <TaskCardActions {...base} taskId="task-1" taskTitle="First task" error={null} />
          <TaskCardActions {...base} taskId="task-2" taskTitle="Second task" error="Save failed" />
        </>,
      );
    });

    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(dialogs[0].getAttribute("aria-label")).toBe("Advanced task settings for Second task");
  });
});

describe("TaskCardActions compact dense rows", () => {
  it("renders icon-only controls with explicit aria-labels and no visible labels", async () => {
    await renderCard({ compact: true });

    expect(container.textContent).not.toContain("Start timer");
    expect(container.textContent).not.toContain("Mark done");
    expect(container.textContent).not.toContain("More options");

    const startTimer = container.querySelector(
      'button[aria-label="Start timer for Ship the polish stack"]',
    );
    expect(startTimer).not.toBeNull();
    expect(startTimer?.getAttribute("data-testid")).toBe("task-start-timer-task-1");

    const markDone = container.querySelector(
      'button[aria-label="Mark Ship the polish stack done"]',
    );
    expect(markDone).not.toBeNull();

    const moreOptions = container.querySelector('[data-testid="task-more-options-task-1"]');
    expect(moreOptions?.getAttribute("aria-label")).toBe(
      "More options for Ship the polish stack",
    );
  });

  it("opens the same canonical editor from the compact trigger without mutating", async () => {
    await renderCard({ compact: true });
    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toBe(
      "Advanced task settings for Ship the polish stack",
    );
    expect(dialog?.textContent).toContain("Advanced settings");
    expect(dialog?.textContent).toContain("Status");
    expect(dialog?.textContent).toContain("Save");
    expect(dialog?.textContent).toContain("Archive");
    expect(dialog?.textContent).toContain("Delete task");
    expect(dialog?.textContent).toContain("Reminder controls");
    expect(dialog?.textContent).toContain("Pin task");

    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("keeps the compact trigger hidden for completed tasks and the timer hidden when archived", async () => {
    await renderCard({ compact: true, defaultStatus: "done" });
    expect(
      container.querySelector('button[aria-label="Mark Ship the polish stack done"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Start timer for Ship the polish stack"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="task-more-options-task-1"]')).not.toBeNull();

    await renderCard({ compact: true, archivedAt: "2026-09-01T00:00:00.000Z" });
    expect(
      container.querySelector('button[aria-label="Start timer for Ship the polish stack"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[aria-label="Mark Ship the polish stack done"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="task-more-options-task-1"]')).not.toBeNull();
  });
});
