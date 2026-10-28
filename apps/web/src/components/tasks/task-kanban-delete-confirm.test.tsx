// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskKanbanCard } from "./task-kanban-card";
import type { TaskRecord } from "@/lib/services/task-service";

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

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "high",
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: null,
    updated_at: "2026-04-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    board_rank: null,
    archived_at: null,
    archived_by: null,
    projects: null,
    goals: null,
    task_reminders: [],
    task_recurrences: [],
    ...overrides,
  };
}

function textButton(label: string) {
  return Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  ) as HTMLButtonElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TaskKanbanCard delete confirmation", () => {
  it("active card: Cancel does not delete, Confirm calls delete action", async () => {
    const deleteAction = vi.fn();
    await act(async () => {
      root.render(
        <TaskKanbanCard
          task={buildTask()}
          signalTone="bg-test"
          deleteAction={deleteAction}
          returnTo="/tasks?layout=kanban"
        />,
      );
    });

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="task-kanban-delete-task-1"]',
    )!;
    await click(trigger);
    expect(document.body.textContent).toContain("Draft weekly execution review");

    const cancel = textButton("Cancel");
    await click(cancel);
    await act(async () => {});
    expect(deleteAction).not.toHaveBeenCalled();

    await click(trigger);
    const confirm = textButton("Confirm");
    await click(confirm);
    await act(async () => {});
    expect(deleteAction).toHaveBeenCalled();
  });

  it("archived card: Confirm calls delete action", async () => {
    const deleteAction = vi.fn();
    await act(async () => {
      root.render(
        <TaskKanbanCard
          task={buildTask({ archived_at: "2026-04-27T10:00:00.000Z" })}
          signalTone="bg-test"
          deleteAction={deleteAction}
          returnTo="/tasks?layout=kanban"
        />,
      );
    });

    const trigger = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="task-kanban-delete-task-1"]',
    )!;
    await click(trigger);
    const confirm = textButton("Confirm");
    await click(confirm);
    await act(async () => {});
    expect(deleteAction).toHaveBeenCalled();
  });
});
