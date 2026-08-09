import assert from "node:assert/strict";
import test from "node:test";

import { getNextFocusQueueTaskId, sortFocusQueueTasks } from "./focus-queue";

test("sorts pinned tasks by focus rank then update recency", () => {
  const sorted = sortFocusQueueTasks([
    {
      id: "task-1",
      focus_rank: 3,
      updated_at: "2026-04-18T09:00:00.000Z",
    },
    {
      id: "task-2",
      focus_rank: null,
      updated_at: "2026-04-18T10:00:00.000Z",
    },
    {
      id: "task-3",
      focus_rank: 1,
      updated_at: "2026-04-18T11:00:00.000Z",
    },
    {
      id: "task-4",
      focus_rank: 3,
      updated_at: "2026-04-18T12:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    sorted.map((task) => task.id),
    ["task-3", "task-4", "task-1"],
  );
});

test("returns next focus task id by skipping completed tasks in queue", () => {
  const nextTaskId = getNextFocusQueueTaskId([
    {
      id: "task-1",
      focus_rank: 1,
      status: "done",
      updated_at: "2026-04-18T08:00:00.000Z",
    },
    {
      id: "task-2",
      focus_rank: 2,
      status: "in_progress",
      updated_at: "2026-04-18T09:00:00.000Z",
    },
  ]);

  assert.equal(nextTaskId, "task-2");
});

test("falls back to first queued task when all queued tasks are completed", () => {
  const nextTaskId = getNextFocusQueueTaskId([
    {
      id: "task-1",
      focus_rank: 1,
      status: "done",
      updated_at: "2026-04-18T08:00:00.000Z",
    },
    {
      id: "task-2",
      focus_rank: 2,
      status: "completed",
      updated_at: "2026-04-18T09:00:00.000Z",
    },
  ]);

  assert.equal(nextTaskId, "task-1");
});
