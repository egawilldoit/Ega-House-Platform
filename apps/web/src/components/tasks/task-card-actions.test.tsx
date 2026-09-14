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
});
