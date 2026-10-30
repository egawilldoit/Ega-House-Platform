// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "@/lib/services/task-service";
import { ToastProvider } from "@/components/ui/toast-provider";
import { QUICK_TASK_EVENT } from "@/lib/workspace-events";

const routerMock = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { KanbanBoard } from "./kanban-board";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  routerMock.refresh.mockClear();
  routerMock.push.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function task(id: string, status: string, rank: string): TaskRecord {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    blocked_reason: null,
    status,
    priority: "medium",
    start_date: null,
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    estimate_minutes: null,
    updated_at: "2026-10-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    board_rank: rank,
    archived_at: null,
    archived_by: null,
    projects: null,
    goals: null,
    task_reminders: [],
    task_recurrences: [],
  };
}

function cardProps() {
  return {
    updateAction: vi.fn(),
    archiveAction: vi.fn(),
    pinAction: vi.fn(),
    unpinAction: vi.fn(),
    deleteAction: vi.fn(),
    projectOptions: [],
    goalOptions: [],
    returnTo: "/tasks?layout=kanban",
  };
}

function renderBoard(boardOrder: "manual" | "priority" | null) {
  return act(async () => {
    root.render(
      <ToastProvider>
        <KanbanBoard
          columns={[
            { status: "todo", label: "Todo" },
            { status: "in_progress", label: "In Progress" },
          ]}
          tasksByStatus={{
            todo: [task("t1", "todo", "A"), task("t2", "todo", "B")],
            in_progress: [],
            review: [],
            blocked: [],
            done: [],
          }}
          boardOrder={boardOrder}
          activeView="active"
          ownerId="owner-1"
          returnTo="/tasks?layout=kanban"
          manualHref="/tasks?layout=kanban&boardOrder=manual"
          priorityHref="/tasks?layout=kanban&boardOrder=priority"
          defaultOrderHref="/tasks?layout=kanban"
          moveAction={vi.fn(async () => ({
            ok: true as const,
            taskId: "t1",
            status: "in_progress" as const,
            boardRank: "A",
          }))}
          bulkActions={{
            bulkFieldAction: vi.fn(),
            bulkArchiveAction: vi.fn(),
            undoAction: vi.fn(),
          }}
          cardProps={cardProps()}
          taskTotalDurations={{}}
          subtaskCounts={{}}
          taskUpdateTaskId={null}
          taskUpdateError={null}
        />
      </ToastProvider>,
    );
  });
}

describe("kanban board manual-order gating", () => {
  it("non-manual sort explains the switch and offers no ordering drag handles", async () => {
    await renderBoard("priority");
    expect(container.textContent).toContain("Switch to manual order");
    expect(container.textContent).toContain("dragging needs manual order");
    expect(container.querySelector('[aria-label="Drag Task t1"]')).toBeNull();
    expect(container.querySelector('[aria-label="Move Task t1 up"]')).toBeNull();
    // Tap/status alternative remains available.
    expect(
      container.querySelector('[aria-label="Move Task t1 to another status"]'),
    ).not.toBeNull();
  });

  it("manual order exposes drag, up/down and the explicit sort links", async () => {
    await renderBoard("manual");
    expect(container.querySelector('[aria-label="Drag Task t1"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Move Task t1 down"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Move Task t2 up"]')).not.toBeNull();
    expect(container.textContent).toContain("Manual order");
    expect(container.textContent).toContain("Sort by priority");
  });

  it("column menu and empty column add a task into that status", async () => {
    await renderBoard("manual");
    expect(
      container.querySelector('[aria-label="Todo column actions"]'),
    ).not.toBeNull();

    const received: Array<string | undefined> = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<{ status?: string }>).detail?.status);
    };
    window.addEventListener(QUICK_TASK_EVENT, listener);

    const column = container.querySelector('[data-testid="kanban-column-in_progress"]');
    const addButton = Array.from(
      column?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.includes("Add task here"));
    expect(addButton).toBeDefined();
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    window.removeEventListener(QUICK_TASK_EVENT, listener);
    expect(received).toContain("in_progress");
  });
});
