import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskDueDateLabel } from "./task-due-date-label";

test("renders nothing when a task has no due date", () => {
  const markup = renderToStaticMarkup(<TaskDueDateLabel dueDate={null} status="todo" />);

  assert.equal(markup, "");
});

test("renders the formatted due date when present", () => {
  const markup = renderToStaticMarkup(
    <TaskDueDateLabel dueDate="2026-04-24" status="todo" />,
  );

  assert.match(markup, /Due Apr 24, 2026/);
});

test("renders overdue styling for overdue tasks", () => {
  const markup = renderToStaticMarkup(
    <TaskDueDateLabel dueDate="2000-01-01" status="todo" />,
  );

  assert.match(markup, /Overdue/);
});
