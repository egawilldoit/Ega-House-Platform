import assert from "node:assert/strict";
import test from "node:test";

import { applyTaskListQuery, sortTasksByValue } from "./task-list";

const sampleTasks = [
  {
    id: "task-1",
    due_date: "2026-04-20",
    status: "todo",
    updated_at: "2026-04-18T10:00:00.000Z",
  },
  {
    id: "task-2",
    due_date: null,
    status: "todo",
    updated_at: "2026-04-18T12:00:00.000Z",
  },
  {
    id: "task-3",
    due_date: "2026-04-18",
    status: "in_progress",
    updated_at: "2026-04-18T08:00:00.000Z",
  },
  {
    id: "task-4",
    due_date: "2026-04-15",
    status: "todo",
    updated_at: "2026-04-18T09:00:00.000Z",
  },
] as const;

test("sorts due date ascending with nulls last", () => {
  const sorted = sortTasksByValue([...sampleTasks], "due_date_asc");

  assert.deepEqual(
    sorted.map((task) => task.id),
    ["task-4", "task-3", "task-1", "task-2"],
  );
});

test("sorts due date descending with nulls last", () => {
  const sorted = sortTasksByValue([...sampleTasks], "due_date_desc");

  assert.deepEqual(
    sorted.map((task) => task.id),
    ["task-1", "task-3", "task-4", "task-2"],
  );
});

test("filters overdue tasks", () => {
  const filtered = applyTaskListQuery([...sampleTasks], {
    dueFilter: "overdue",
    today: "2026-04-18",
  });

  assert.deepEqual(filtered.map((task) => task.id), ["task-4"]);
});

test("filters due soon tasks and keeps today in range", () => {
  const filtered = applyTaskListQuery([...sampleTasks], {
    dueFilter: "due_soon",
    sortValue: "due_date_asc",
    today: "2026-04-18",
  });

  assert.deepEqual(filtered.map((task) => task.id), ["task-3", "task-1"]);
});

test("filters tasks without a due date", () => {
  const filtered = applyTaskListQuery([...sampleTasks], {
    dueFilter: "no_due_date",
  });

  assert.deepEqual(filtered.map((task) => task.id), ["task-2"]);
});
