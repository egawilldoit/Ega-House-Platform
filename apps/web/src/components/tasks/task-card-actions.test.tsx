import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

import type { UpdateTaskEditorFormState } from "@/app/tasks/actions";
import type { TaskReminderRecord } from "@/lib/services/task-service";
import { TaskCardActions } from "./task-card-actions";

let container: HTMLDivElement;
let root: Root;

const actions = {
  action: vi.fn(),
  updateEditorAction: vi.fn(
    async (
      _previous: UpdateTaskEditorFormState,
      formData: FormData,
    ): Promise<UpdateTaskEditorFormState> => ({
      errorMessage: null,
      successMessage: "Task updated.",
      taskId: String(formData.get("taskId") ?? ""),
    }),
  ),
  deleteAction: vi.fn(),
  archiveAction: vi.fn(),
  unarchiveAction: vi.fn(),
  startTimerAction: vi.fn(),
  createReminderAction: vi.fn(),
  cancelReminderAction: vi.fn(),
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await act(async () => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const mock of Object.values(actions)) mock.mockReset();
  refresh.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function remakeRoot() {
  await act(async () => root.unmount());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

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
        taskReminders={[]}
        archivedAt={null}
        error={null}
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

function dialog() {
  return document.body.querySelector('[role="dialog"]');
}

describe("TaskCardActions edit task modal redesign", () => {
  it("keeps primary actions visible and the editor hidden by default", async () => {
    await renderCard();

    expect(container.textContent).toContain("Start timer");
    expect(container.textContent).toContain("Mark done");
    expect(container.textContent).toContain("More options");

    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain("Edit task");
  });

  it("opens the centered Edit task modal for the correct task without mutating", async () => {
    await renderCard();

    const trigger = container.querySelector('[data-testid="task-more-options-task-1"]');
    expect(trigger).not.toBeNull();
    await click(trigger!);

    const opened = dialog();
    expect(opened).not.toBeNull();
    expect(opened!.getAttribute("aria-label")).toBe("Edit task Ship the polish stack");
    expect(opened!.textContent).toContain("Edit task");
    expect(opened!.textContent).toContain("Ship the polish stack");
    expect(opened!.textContent).toContain("Status");
    expect(opened!.textContent).toContain("Save changes");
    expect(opened!.textContent).toContain("Delete task");
    expect(opened!.textContent).toContain("Pin task");

    // Opening the editor must not submit anything.
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("exposes No reminder configured with an Add reminder control", async () => {
    await renderCard();

    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    const opened = dialog()!;
    expect(opened.textContent).toContain("No reminder configured.");

    const addReminder = opened.querySelector<HTMLButtonElement>(
      '[data-testid="task-reminder-add-task-1"]',
    );
    expect(addReminder).not.toBeNull();
    await click(addReminder!);
    expect(opened.querySelector('input[name="remindAt"]')).not.toBeNull();

    // The reminder form submits the canonical reminder action, not the save.
    expect(actions.createReminderAction).not.toHaveBeenCalled();
    expect(
      opened.querySelector<HTMLInputElement>('input[name="channel"][value="email"]'),
    ).not.toBeNull();
  });

  it("renders an existing pending reminder with Edit and Remove", async () => {
    await renderCard({
      taskReminders: [
        {
          id: "reminder-1",
          task_id: "task-1",
          remind_at: "2026-09-26T09:00:00.000Z",
          channel: "email",
          status: "pending",
          sent_at: null,
          failure_reason: null,
          created_at: "2026-09-25T08:00:00.000Z",
          updated_at: "2026-09-25T08:00:00.000Z",
        },
      ],
    });

    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    const opened = dialog()!;
    expect(opened.textContent).toContain("Email");
    expect(opened.textContent).toContain("Pending");
    expect(opened.textContent).not.toContain("No reminder configured.");

    const removeReminder = opened.querySelector<HTMLButtonElement>(
      '[data-testid="task-reminder-remove-task-1"]',
    );
    expect(removeReminder).not.toBeNull();
    await click(removeReminder!);
    expect(actions.cancelReminderAction).toHaveBeenCalledTimes(1);
    const formData = actions.cancelReminderAction.mock.calls[0][0] as FormData;
    expect(formData.get("reminderId")).toBe("reminder-1");
    expect(formData.get("status")).toBe("cancelled");

    expect(actions.archiveAction).not.toHaveBeenCalled();
    expect(actions.deleteAction).not.toHaveBeenCalled();
  });

  it("closes with Escape and restores focus to the triggering row control", async () => {
    await renderCard();
    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    expect(dialog()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(dialog()).toBeNull();
    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });

  it("keeps Save away from the danger zone and disables invalid schedule saves", async () => {
    await renderCard();

    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    const opened = dialog()!;

    const save = opened.querySelector<HTMLButtonElement>(
      '[data-testid="task-editor-save-task-1"]',
    );
    expect(save).not.toBeNull();
    expect((save as HTMLButtonElement).disabled).toBe(false);

    const deleteConfirmInput = document.body.querySelector<HTMLInputElement>(
      'input[name="confirmDelete"]',
    );
    expect(deleteConfirmInput).not.toBeNull();
    expect((deleteConfirmInput!.closest("form") as HTMLFormElement).action).toBeTruthy();

    // End before start blocks the save.
    const startInput = opened.querySelector<HTMLInputElement>('input[name="scheduledStartAt"]');
    const endInput = opened.querySelector<HTMLInputElement>('input[name="scheduledEndAt"]');
    expect(startInput).not.toBeNull();
    expect(endInput).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      valueSetter.call(startInput!, "2026-09-21T10:00");
      startInput!.dispatchEvent(new Event("input", { bubbles: true }));
      valueSetter.call(endInput!, "2026-09-21T09:00");
      endInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(
      (opened.querySelector(
        '[data-testid="task-editor-save-task-1"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(document.body.textContent).toContain("Scheduled end must be after scheduled start.");
  });

  it("delegates Archive inside the modal to the shared archive action", async () => {
    await renderCard({ defaultStatus: "done" });

    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);

    const archive = dialog()!.querySelector<HTMLButtonElement>(
      '[data-testid="task-editor-archive-task-1"]',
    );
    expect(archive).not.toBeNull();
    await click(archive!);
    expect(actions.archiveAction).toHaveBeenCalledTimes(1);
    const formData = actions.archiveAction.mock.calls[0][0] as FormData;
    expect(formData.get("taskId")).toBe("task-1");
    expect(formData.get("returnTo")).toBe("/tasks");
    expect(actions.action).not.toHaveBeenCalled();
    expect(actions.updateEditorAction).not.toHaveBeenCalled();
    expect(actions.deleteAction).not.toHaveBeenCalled();
  });

  it("omits the archive card while an archive shortcut is unavailable or already archived", async () => {
    await renderCard({ defaultStatus: "in_progress" });
    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    expect(document.body.querySelector('[data-testid="task-editor-archive-task-1"]')).toBeNull();
    await remakeRoot();

    await renderCard({
      defaultStatus: "done",
      archivedAt: "2026-09-01T00:00:00.000Z",
      unarchiveAction: actions.unarchiveAction,
    });
    await click(container.querySelector('[data-testid="task-more-options-task-1"]')!);
    expect(document.body.querySelector('[data-testid="task-editor-archive-task-1"]')).toBeNull();
    expect(document.body.textContent).toContain("This task is archived");
  });

  it("does not submit on open or cancel, and only the task carrying the error auto-opens", async () => {
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
      taskReminders: [] as TaskReminderRecord[],
      archivedAt: null,
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
    expect(dialogs[0].getAttribute("aria-label")).toBe("Edit task Second task");
  });
});
