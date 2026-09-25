import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateTaskEditorFormState } from "@/app/tasks/actions";
import type { TaskReminderRecord } from "@/lib/services/task-service";

import { EditTaskModal } from "./edit-task-modal";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

let container: HTMLDivElement;
let root: Root;

const reminder: TaskReminderRecord = {
  id: "reminder-1",
  task_id: "task-1",
  remind_at: "2026-09-26T09:00:00.000Z",
  channel: "email",
  status: "pending",
  sent_at: null,
  failure_reason: null,
  created_at: "2026-09-25T08:00:00.000Z",
  updated_at: "2026-09-25T08:00:00.000Z",
};

const baseProps = {
  taskId: "task-1",
  taskTitle: "saas meeting cdc",
  taskDescription: null,
  projectName: "SAAS project",
  goalTitle: "Ship the weekly review",
  defaultProjectId: "project-1",
  defaultGoalId: "goal-1",
  projectOptions: [
    { id: "project-1", name: "SAAS project" },
    { id: "project-2", name: "EGA House" },
  ],
  goalOptions: [
    { id: "goal-1", title: "Ship the weekly review", projectId: "project-1" },
    { id: "goal-2", title: "Polish tasks", projectId: "project-2" },
  ],
  returnTo: "/tasks",
  defaultStatus: "todo",
  defaultPriority: "high",
  defaultDueDate: "2026-09-30",
  defaultEstimateMinutes: 60,
  defaultScheduledStartAt: null,
  defaultScheduledEndAt: null,
  defaultCalendarSyncEnabled: false,
  defaultCalendarReminderMinutes: 30,
  defaultRecurrenceRule: null,
  defaultBlockedReason: null,
  archivedAt: null,
  taskReminders: [] as TaskReminderRecord[],
  createReminderAction: vi.fn(),
  updateReminderAction: vi.fn(),
  cancelReminderAction: vi.fn(),
  deleteAction: vi.fn(),
  archiveAction: vi.fn(),
  unarchiveAction: vi.fn(),
  overflowActions: null,
  error: null,
};

type SaveSpy = ReturnType<typeof vi.fn> & { nextErrorMessage: string | null };

function buildSaveAction(): SaveSpy {
  return Object.assign(
    vi.fn(
      (
        _previous: UpdateTaskEditorFormState,
        formData: FormData,
      ): Promise<UpdateTaskEditorFormState> =>
        Promise.resolve({
          errorMessage: saveAction.nextErrorMessage,
          successMessage: saveAction.nextErrorMessage ? null : "Task updated.",
          taskId: String(formData.get("taskId") ?? ""),
        }),
    ),
    { nextErrorMessage: null as string | null },
  ) as SaveSpy;
}

let saveAction: SaveSpy;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await act(async () => container?.parentElement && root?.unmount());
  container?.remove();
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

let initialOpen = false;

function EditorHarness({
  overrides,
  updateAction,
}: {
  overrides: Partial<Parameters<typeof EditTaskModal>[0]>;
  updateAction: Parameters<typeof EditTaskModal>[0]["updateAction"];
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <EditTaskModal
      {...baseProps}
      {...overrides}
      updateAction={updateAction}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" aria-label="Edit task">
          Edit
        </button>
      }
    />
  );
}

function renderModal(overrides: Partial<Parameters<typeof EditTaskModal>[0]> = {}) {
  initialOpen = false;
  return act(async () => {
    root.render(
      <EditorHarness
        overrides={overrides}
        updateAction={saveAction as unknown as Parameters<typeof EditTaskModal>[0]["updateAction"]}
      />,
    );
  });
}

function dialog() {
  return document.body.querySelector('[role="dialog"]');
}

async function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

function input(name: string) {
  const found = document.body.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  expect(found).not.toBeNull();
  return found!;
}

function saveButton() {
  const button = document.body.querySelector<HTMLButtonElement>(
    '[data-testid="task-editor-save-task-1"]',
  );
  expect(button).not.toBeNull();
  return button!;
}

describe("EditTaskModal centered editor", () => {
  it("opens the editor populated with the task's saved values", async () => {
    await renderModal({ taskReminders: [reminder] });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    const opened = dialog()!;
    expect(opened.getAttribute("aria-label")).toBe("Edit task saas meeting cdc");
    expect(opened.textContent).toContain("Edit task");
    expect(opened.textContent).toContain("saas meeting cdc");
    expect(opened.textContent).toContain("SAAS project");
    expect(input("title").value).toBe("saas meeting cdc");
    expect(document.body.querySelector<HTMLSelectElement>('select[name="projectId"]')?.value).toBe(
      "project-1",
    );
    expect(document.body.querySelector<HTMLSelectElement>('select[name="goalId"]')?.value).toBe(
      "goal-1",
    );
    expect(input("dueDate").value).toBe("2026-09-30");
    expect(input("estimateMinutes").value).toBe("60");
    expect(input("calendarReminderMinutes").value).toBe("30");
    const statusSelect = document.body.querySelector<HTMLSelectElement>('select[name="status"]');
    expect(statusSelect?.value).toBe("todo");
    const prioritySelect = document.body.querySelector<HTMLSelectElement>(
      'select[name="priority"]',
    );
    expect(prioritySelect?.value).toBe("high");

    expect(saveAction).not.toHaveBeenCalled();
  });

  it("persists title, project, goal and description through the canonical edit action", async () => {
    await renderModal({ taskDescription: "Original context" });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("title"), "Updated task title");
    const description = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[name="description"]',
    )!;
    await act(async () => {
      description.value = "Updated context";
      description.dispatchEvent(new Event("input", { bubbles: true }));
      description.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const project = document.body.querySelector<HTMLSelectElement>('select[name="projectId"]')!;
    await act(async () => {
      project.value = "project-2";
      project.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const goal = document.body.querySelector<HTMLSelectElement>('select[name="goalId"]')!;
    await act(async () => {
      goal.value = "goal-2";
      goal.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await click(saveButton());
    const formData = (saveAction.mock.calls.at(-1) as unknown[]).find(
      (arg) => arg instanceof FormData,
    ) as FormData;
    expect(formData.get("title")).toBe("Updated task title");
    expect(formData.get("description")).toBe("Updated context");
    expect(formData.get("projectId")).toBe("project-2");
    expect(formData.get("goalId")).toBe("goal-2");
  });

  it("save failure keeps the modal open with the error and the edits preserved", async () => {
    saveAction.nextErrorMessage = "Unable to update this task right now.";
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("estimateMinutes"), "90");

    await click(saveButton());

    await act(async () => {});
    expect(dialog()).not.toBeNull();
    expect(document.body.textContent).toContain("Unable to update this task right now.");
    expect(input("estimateMinutes").value).toBe("90");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("success closes the modal and refreshes the row data without reload", async () => {
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("estimateMinutes"), "45");
    await click(saveButton());

    await act(async () => {});
    expect(refresh).toHaveBeenCalled();
    expect(dialog()).toBeNull();
    const formData = (saveAction.mock.calls.at(-1) as unknown[]).find(
      (arg) => arg instanceof FormData,
    ) as FormData;
    expect(formData.get("taskId")).toBe("task-1");
    expect(formData.get("estimateMinutes")).toBe("45");
  });

  it("cancel does not mutate and reopening shows the saved values again", async () => {
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("estimateMinutes"), "90");

    const cancel = Array.from(document.body.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Cancel",
    );
    await click(cancel!);
    expect(dialog()).toBeNull();
    expect(saveAction).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await click(container.querySelector('button[aria-label="Edit task"]')!);
    expect(input("estimateMinutes").value).toBe("60");
  });

  it("an invalid scheduled range prevents the save and shows the inline error", async () => {
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("scheduledStartAt"), "2026-09-21T10:00");
    await setInputValue(input("scheduledEndAt"), "2026-09-21T09:00");

    expect(saveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("Scheduled end must be after scheduled start.");
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("persists a valid schedule update through the canonical form fields", async () => {
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    await setInputValue(input("scheduledStartAt"), "2026-09-21T10:00");
    await setInputValue(input("scheduledEndAt"), "2026-09-21T12:00");
    await click(saveButton());

    const formData = (saveAction.mock.calls.at(-1) as unknown[]).find(
      (arg) => arg instanceof FormData,
    ) as FormData;
    expect(formData.get("scheduledStartAt")).toBe("2026-09-21T10:00");
    expect(formData.get("scheduledEndAt")).toBe("2026-09-21T12:00");
    expect(String(formData.get("scheduleTimezoneOffsetMinutes"))).not.toBe("");
    // Editing scheduling never drops the calendar reminder configuration.
    expect(formData.get("calendarReminderMinutes")).toBe("30");
  });

  it("an existing reminder renders its local date and edits the existing reminder instead of creating another", async () => {
    const createReminderAction = vi.fn();
    const updateReminderAction = vi.fn();
    await renderModal({
      taskReminders: [reminder],
      createReminderAction,
      updateReminderAction,
    });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    const opened = dialog()!;
    expect(opened.textContent).not.toContain("No reminder configured.");
    expect(opened.textContent).toContain("Email");
    expect(opened.textContent).toContain("Pending");
    expect(
      document.body.querySelector('[data-testid="task-reminder-display-task-1"]')?.textContent,
    ).not.toBe("");

    const edit = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="task-reminder-edit-task-1"]',
    );
    await click(edit!);
    const remindInput = document.body.querySelector<HTMLInputElement>(
      'input[name="remindAt"]',
    ) as HTMLInputElement;
    const reminderDate = new Date(reminder.remind_at);
    const pad = (part: number) => String(part).padStart(2, "0");
    const expectedLocalValue = `${reminderDate.getFullYear()}-${pad(
      reminderDate.getMonth() + 1,
    )}-${pad(reminderDate.getDate())}T${pad(reminderDate.getHours())}:${pad(
      reminderDate.getMinutes(),
    )}`;
    expect(remindInput.value).toBe(expectedLocalValue);
    expect(saveAction).not.toHaveBeenCalled();

    const reminderForm = remindInput.closest("form") as HTMLFormElement;
    const update = Array.from(reminderForm.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Update reminder",
    );
    await click(update!);

    expect(updateReminderAction).toHaveBeenCalledTimes(1);
    expect(createReminderAction).not.toHaveBeenCalled();
    const formData = updateReminderAction.mock.calls[0][0] as FormData;
    expect(formData.get("reminderId")).toBe("reminder-1");
    expect(formData.get("taskId")).toBe("task-1");
  });

  it("adding a reminder from the no-reminder state submits once through the create action", async () => {
    const createReminderAction = vi.fn();
    await renderModal({ createReminderAction });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    expect(dialog()!.textContent).toContain("No reminder configured.");
    await click(
      dialog()!.querySelector<HTMLButtonElement>('[data-testid="task-reminder-add-task-1"]')!,
    );

    const reminderForm = dialog()!.querySelector<HTMLFormElement>(
      'form:has(input[name="remindAt"])',
    ) as HTMLFormElement;
    const remindInput = reminderForm.querySelector<HTMLInputElement>('input[name="remindAt"]')!;
    await setInputValue(remindInput, "2026-09-26T09:00");
    await click(
      Array.from(reminderForm.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Save reminder",
      )!,
    );
    expect(createReminderAction).toHaveBeenCalledTimes(1);
    const formData = createReminderAction.mock.calls[0][0] as FormData;
    expect(formData.get("channel")).toBe("email");
    expect(formData.get("status")).toBe("pending");
    expect(formData.get("taskId")).toBe("task-1");
  });

  it("archive inside the modal delegates to the shared archive action per row eligibility", async () => {
    const archiveAction = vi.fn();
    await renderModal({ defaultStatus: "done", archiveAction });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    expect(dialog()!.textContent).toContain(
      "Move this completed task out of Current while preserving its history.",
    );
    await click(
      document.body.querySelector<HTMLButtonElement>('[data-testid="task-editor-archive-task-1"]')!,
    );
    expect(archiveAction).toHaveBeenCalledTimes(1);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("delete lives in the danger zone with confirmation and never submits on open", async () => {
    const deleteAction = vi.fn();
    await renderModal({ deleteAction });
    await click(container.querySelector('button[aria-label="Edit task"]')!);

    expect(dialog()!.textContent).toContain("Danger zone");
    expect(document.body.querySelector<HTMLInputElement>('input[name="confirmDelete"]')).not.toBeNull();
    expect(deleteAction).not.toHaveBeenCalled();
  });

  it("closes with Escape and restores focus to the originating trigger", async () => {
    await renderModal();
    await click(container.querySelector('button[aria-label="Edit task"]')!);
    expect(dialog()).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialog()).toBeNull();
    await act(async () => {});
    const activeElement = document.activeElement;
    expect(activeElement).toBe(container.querySelector('button[aria-label="Edit task"]'));
  });
});
