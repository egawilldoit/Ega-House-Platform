import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskReminderPanel } from "./task-reminder-panel";
import type { TaskReminderRecord } from "@/lib/services/task-service";

const pendingReminder: TaskReminderRecord = {
  id: "reminder-pending",
  task_id: "task-1",
  remind_at: "2026-05-02T14:00:00.000Z",
  channel: "email",
  status: "pending",
  sent_at: null,
  failure_reason: null,
  created_at: "2026-05-01T10:00:00.000Z",
  updated_at: "2026-05-01T10:00:00.000Z",
};

test("task reminder panel renders pending state and cancel action", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TaskReminderPanel, {
      taskId: "task-1",
      reminders: [pendingReminder],
      returnTo: "/tasks",
      createAction: () => undefined,
      cancelAction: () => undefined,
    }),
  );

  assert.match(markup, /Email reminder/);
  assert.match(markup, /Pending/);
  assert.match(markup, /name="remindAt"/);
  assert.match(markup, /name="reminderId" value="reminder-pending"/);
  assert.match(markup, />Cancel</);
});

test("task reminder panel hides cancel action without a pending reminder", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TaskReminderPanel, {
      taskId: "task-1",
      reminders: [{ ...pendingReminder, id: "reminder-cancelled", status: "cancelled" }],
      returnTo: "/tasks",
      createAction: () => undefined,
      cancelAction: () => undefined,
    }),
  );

  assert.match(markup, /No pending reminder/);
  assert.doesNotMatch(markup, /name="reminderId"/);
  assert.doesNotMatch(markup, />Cancel</);
});
