import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTaskListQuery,
  buildTaskKanbanBoard,
  buildTaskListUrl,
  normalizeTaskLayout,
  sortTasksByValue,
} from "./task-list";

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

test("filters due-today tasks separately from the broader due-soon range", () => {
  const filtered = applyTaskListQuery([...sampleTasks], {
    dueFilter: "due_today",
    today: "2026-04-18",
  });

  assert.deepEqual(filtered.map((task) => task.id), ["task-3"]);
});

test("filters tasks without a due date", () => {
  const filtered = applyTaskListQuery([...sampleTasks], {
    dueFilter: "no_due_date",
  });

  assert.deepEqual(filtered.map((task) => task.id), ["task-2"]);
});

test("normalizes missing or unknown task layout to list", () => {
  assert.equal(normalizeTaskLayout(undefined), "list");
  assert.equal(normalizeTaskLayout(null), "list");
  assert.equal(normalizeTaskLayout("grid"), "list");
  assert.equal(normalizeTaskLayout("kanban"), "kanban");
});

test("builds list task URLs without layout=list", () => {
  assert.equal(
    buildTaskListUrl("/tasks", {
      status: "todo",
      project: "project-1",
      goal: "goal-1",
      due: "due_today",
      sort: "due_date_asc",
      view: "archived",
      layout: "list",
    }),
    "/tasks?status=todo&project=project-1&goal=goal-1&due=due_today&sort=due_date_asc&archive=archived",
  );
});

test("builds kanban task URLs and preserves existing filters", () => {
  assert.equal(
    buildTaskListUrl("/tasks", {
      status: "in_progress",
      project: "project-2",
      goal: "goal-2",
      due: "overdue",
      sort: "due_date_desc",
      view: "all",
      layout: "kanban",
    }),
    "/tasks?status=in_progress&project=project-2&goal=goal-2&due=overdue&sort=due_date_desc&archive=all&layout=kanban",
  );
});

test("builds task URLs with saved-view definition filters", () => {
  assert.equal(
    buildTaskListUrl("/tasks", {
      estimateMax: 15,
      dueWithin: 7,
      activeTasks: true,
      layout: "kanban",
    }),
    "/tasks?tasks=active&estimateMax=15&dueWithin=7&layout=kanban",
  );
});

test("kanban board without active status returns all columns", () => {
  const board = buildTaskKanbanBoard([]);

  assert.deepEqual(
    board.columns.map((column) => column.status),
    ["todo", "in_progress", "blocked", "done"],
  );
});

test("kanban board with active status returns only matching column", () => {
  const board = buildTaskKanbanBoard([], "blocked");

  assert.deepEqual(
    board.columns.map((column) => column.status),
    ["blocked"],
  );
});

test("kanban board groups tasks into correct columns", () => {
  const board = buildTaskKanbanBoard([
    { id: "task-1", status: "todo" },
    { id: "task-2", status: "blocked" },
    { id: "task-3", status: "in_progress" },
    { id: "task-4", status: "done" },
  ]);

  assert.deepEqual(board.tasksByStatus.todo.map((task) => task.id), ["task-1"]);
  assert.deepEqual(board.tasksByStatus.in_progress.map((task) => task.id), ["task-3"]);
  assert.deepEqual(board.tasksByStatus.blocked.map((task) => task.id), ["task-2"]);
  assert.deepEqual(board.tasksByStatus.done.map((task) => task.id), ["task-4"]);
});

test("kanban board preserves incoming task order inside each column", () => {
  const board = buildTaskKanbanBoard([
    { id: "task-1", status: "todo" },
    { id: "task-2", status: "todo" },
    { id: "task-3", status: "blocked" },
    { id: "task-4", status: "todo" },
    { id: "task-5", status: "blocked" },
  ]);

  assert.deepEqual(board.tasksByStatus.todo.map((task) => task.id), [
    "task-1",
    "task-2",
    "task-4",
  ]);
  assert.deepEqual(board.tasksByStatus.blocked.map((task) => task.id), [
    "task-3",
    "task-5",
  ]);
});
