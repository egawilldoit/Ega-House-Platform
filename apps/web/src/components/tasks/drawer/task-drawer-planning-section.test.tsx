// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskDrawerPlanningSection } from "./task-drawer-planning-section";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  const updateInlineAction = vi.fn();
  const createReminderAction = vi.fn();
  const cancelReminderAction = vi.fn();

  await act(async () => {
    root.render(
      <TaskDrawerPlanningSection
        taskId="task-1"
        status="in_progress"
        priority="high"
        dueDate="2026-05-01"
        estimateMinutes={60}
        blockedReason={null}
        planning={{
          projectId: "project-1",
          goalId: null,
          projectName: "EGA House",
          goalName: null,
          dueDate: "2026-05-01",
          scheduledStartAt: "2026-05-01T09:00:00.000Z",
          scheduledEndAt: "2026-05-01T10:00:00.000Z",
          calendarSyncEnabled: true,
          calendarReminderMinutes: 15,
          recurrenceRule: "weekly:monday",
          reminders: [],
          projectOptions: [{ id: "project-1", name: "EGA House" }],
        }}
        projectOptions={[{ id: "project-1", name: "EGA House" }]}
        returnTo="/tasks?task=task-1"
        updateInlineAction={updateInlineAction}
        createReminderAction={createReminderAction}
        cancelReminderAction={cancelReminderAction}
      />,
    );
  });

  return { updateInlineAction };
}

describe("TaskDrawerPlanningSection", () => {
  it("edits project, schedule, recurrence, calendar sync and reminders", async () => {
    await render();

    expect(
      container.querySelector<HTMLSelectElement>('select[name="projectId"]')
        ?.value,
    ).toBe("project-1");
    expect(
      container.querySelector<HTMLSelectElement>('select[name="recurrenceRule"]')
        ?.value,
    ).toBe("weekly:monday");
    expect(
      container.querySelector('input[name="scheduledStartAt"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('input[name="scheduledEndAt"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[name="calendarSyncEnabled"]',
      )?.checked,
    ).toBe(true);
    expect(container.textContent).toContain("Save planning");
    expect(container.textContent).toContain("Email reminder");
  });

  it("carries every required value as a hidden field so planning never clears status, priority, due date or estimate", async () => {
    await render();

    const form = container.querySelector("form")!;
    expect(
      form.querySelector<HTMLInputElement>('input[type="hidden"][name="status"]')
        ?.value,
    ).toBe("in_progress");
    expect(
      form.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="priority"]',
      )?.value,
    ).toBe("high");
    expect(
      form.querySelector<HTMLInputElement>('input[type="hidden"][name="dueDate"]')
        ?.value,
    ).toBe("2026-05-01");
    expect(
      form.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="estimateMinutes"]',
      )?.value,
    ).toBe("60");
  });

  it("uses the full-form patch action, not the one-field patch path", async () => {
    const { updateInlineAction } = await render();

    const form = container.querySelector<HTMLFormElement>("form")!;
    expect(updateInlineAction).toBeTypeOf("function");
    expect(
      form.querySelector('input[name="returnTo"]')?.getAttribute("value"),
    ).toBe("/tasks?task=task-1");
  });
});
