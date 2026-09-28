import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, vi } from "vitest";

import { setDisplayTimezone } from "@/lib/presentation-format";
import { TaskDueDateLabel } from "./task-due-date-label";

afterEach(() => {
  vi.useRealTimers();
  setDisplayTimezone("UTC");
});

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

test("ega-661: due-state badges use the account local date, not the runtime-local date", () => {
  // Fixed instant 2026-04-20T16:00:00Z: the account day in Asia/Tokyo is
  // 2026-04-21 while the runtime-local day in UTC/America/New_York is 2026-04-20.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-20T16:00:00.000Z"));
  setDisplayTimezone("Asia/Tokyo");

  const dueTodayMarkup = renderToStaticMarkup(
    <TaskDueDateLabel dueDate="2026-04-21" status="todo" />,
  );
  assert.match(dueTodayMarkup, /Due today/);

  const overdueMarkup = renderToStaticMarkup(
    <TaskDueDateLabel dueDate="2026-04-20" status="todo" />,
  );
  assert.match(overdueMarkup, /Overdue/);
});
