import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskKanbanCard } from "./task-kanban-card";
import type { TaskRecord } from "@/lib/services/task-service";

function buildTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    title: "Draft weekly execution review",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "high",
    due_date: null,
    estimate_minutes: null,
    updated_at: "2026-04-28T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    archived_at: null,
    archived_by: null,
    projects: null,
    goals: null,
    ...overrides,
  };
}

function renderCard(task: TaskRecord, trackedSeconds?: number) {
  return renderToStaticMarkup(
    React.createElement(TaskKanbanCard, {
      task,
      signalTone: "bg-test",
      trackedSeconds,
    }),
  );
}

function renderActionableCard(task: TaskRecord) {
  return renderToStaticMarkup(
    React.createElement(TaskKanbanCard, {
      task,
      signalTone: "bg-test",
      updateAction: () => undefined,
      startTimerAction: () => undefined,
      pinAction: () => undefined,
      unpinAction: () => undefined,
      archiveAction: () => undefined,
      unarchiveAction: () => undefined,
      deleteAction: () => undefined,
      returnTo:
        "/tasks?status=todo&project=project-1&goal=goal-1&due=overdue&sort=due_date_desc&archive=all&layout=kanban",
    }),
  );
}

test("kanban card renders compact task title and priority", () => {
  const markup = renderCard(buildTask());

  assert.match(markup, /Draft weekly execution review/);
  assert.match(markup, /High/);
});

test("kanban card renders optional project, goal, due, estimate, and tracked metadata when present", () => {
  const markup = renderCard(
    buildTask({
      projects: { name: "EGA House" },
      goals: { title: "Tighten weekly review" },
      due_date: "2026-05-01",
      estimate_minutes: 75,
    }),
    3661,
  );

  assert.match(markup, /EGA House/);
  assert.match(markup, /Tighten weekly review/);
  assert.match(markup, /Due May 1, 2026/);
  assert.match(markup, /Est\. 1h 15m/);
  assert.match(markup, /Tracked 1h 1m 1s/);
});

test("kanban card hides optional metadata when missing", () => {
  const markup = renderCard(buildTask());

  assert.doesNotMatch(markup, /No project/);
  assert.doesNotMatch(markup, /Due /);
  assert.doesNotMatch(markup, /Est\./);
  assert.doesNotMatch(markup, /Tracked/);
  assert.doesNotMatch(markup, /Blocked:/);
  assert.doesNotMatch(markup, /Pinned/);
  assert.doesNotMatch(markup, /Archived/);
});

test("kanban card renders blocked reason for blocked tasks", () => {
  const markup = renderCard(
    buildTask({
      status: "blocked",
      blocked_reason: "Waiting on stakeholder signoff",
    }),
  );

  assert.match(markup, /Blocked: Waiting on stakeholder signoff/);
});

test("kanban card renders pinned and archived badges", () => {
  const markup = renderCard(
    buildTask({
      focus_rank: 2,
      archived_at: "2026-04-27T10:00:00.000Z",
    }),
  );

  assert.match(markup, /Pinned/);
  assert.match(markup, /Archived/);
});

test("kanban card renders active status controls for todo tasks", () => {
  const markup = renderActionableCard(buildTask({ status: "todo" }));

  assert.match(markup, /Move/);
  assert.match(markup, /In Progress/);
  assert.match(markup, /Block/);
  assert.match(markup, /Done/);
});

test("kanban card renders active status controls for in progress tasks", () => {
  const markup = renderActionableCard(buildTask({ status: "in_progress" }));

  assert.match(markup, />Todo</);
  assert.match(markup, /Block/);
  assert.match(markup, /Done/);
});

test("kanban card renders active status controls for blocked tasks", () => {
  const markup = renderActionableCard(
    buildTask({
      status: "blocked",
      blocked_reason: "Waiting on stakeholder signoff",
    }),
  );

  assert.match(markup, />Todo</);
  assert.match(markup, /In Progress/);
  assert.match(markup, /Done/);
  assert.doesNotMatch(markup, /Save Blocked/);
});

test("kanban card renders reopen action for done tasks", () => {
  const markup = renderActionableCard(buildTask({ status: "done" }));

  assert.match(markup, /Reopen/);
  assert.doesNotMatch(markup, /In Progress/);
  assert.doesNotMatch(markup, /Save Blocked/);
});

test("kanban card block action renders required blocked reason input", () => {
  const markup = renderActionableCard(buildTask({ status: "todo" }));

  assert.match(markup, /name="blockedReason" required=""/);
  assert.match(markup, /Save Blocked/);
});

test("kanban card hides status controls for archived tasks", () => {
  const markup = renderActionableCard(
    buildTask({
      archived_at: "2026-04-27T10:00:00.000Z",
    }),
  );

  assert.doesNotMatch(markup, /Move/);
  assert.doesNotMatch(markup, /Save Blocked/);
});

test("active kanban card renders timer pin archive and delete actions", () => {
  const markup = renderActionableCard(buildTask({ status: "todo" }));

  assert.match(markup, /Actions/);
  assert.match(markup, /Start timer/);
  assert.match(markup, />Pin</);
  assert.match(markup, />Archive</);
  assert.match(markup, />Delete</);
  assert.doesNotMatch(markup, /Restore/);
});

test("active kanban card renders unpin action for pinned tasks", () => {
  const markup = renderActionableCard(buildTask({ focus_rank: 1 }));

  assert.match(markup, />Unpin</);
  assert.doesNotMatch(markup, />Pin</);
});

test("done active kanban card hides timer action", () => {
  const markup = renderActionableCard(buildTask({ status: "done" }));

  assert.doesNotMatch(markup, /Start timer/);
  assert.match(markup, />Archive</);
  assert.match(markup, />Delete</);
});

test("archived kanban card renders restore and delete only", () => {
  const markup = renderActionableCard(
    buildTask({
      status: "todo",
      focus_rank: 1,
      archived_at: "2026-04-27T10:00:00.000Z",
    }),
  );

  assert.match(markup, /Archived actions/);
  assert.match(markup, /Restore/);
  assert.match(markup, />Delete</);
  assert.doesNotMatch(markup, /Actions/);
  assert.doesNotMatch(markup, /Move/);
  assert.doesNotMatch(markup, /Start timer/);
  assert.doesNotMatch(markup, />Pin</);
  assert.doesNotMatch(markup, />Unpin</);
  assert.doesNotMatch(markup, />Archive</);
  assert.doesNotMatch(markup, /Save Blocked/);
});

test("kanban status forms preserve return path and unchanged task fields", () => {
  const markup = renderActionableCard(
    buildTask({
      priority: "urgent",
      due_date: "2026-05-02",
      estimate_minutes: 90,
    }),
  );

  assert.match(
    markup,
    /name="returnTo" value="\/tasks\?status=todo&amp;project=project-1&amp;goal=goal-1&amp;due=overdue&amp;sort=due_date_desc&amp;archive=all&amp;layout=kanban"/,
  );
  assert.match(markup, /name="priority" value="urgent"/);
  assert.match(markup, /name="dueDate" value="2026-05-02"/);
  assert.match(markup, /name="estimateMinutes" value="90"/);
});

test("kanban lifecycle action forms preserve return path and confirmation inputs", () => {
  const markup = renderActionableCard(buildTask());

  assert.match(
    markup,
    /name="returnTo" value="\/tasks\?status=todo&amp;project=project-1&amp;goal=goal-1&amp;due=overdue&amp;sort=due_date_desc&amp;archive=all&amp;layout=kanban"/,
  );
  assert.match(markup, /name="taskId" value="task-1"/);
  assert.match(markup, /name="confirmDelete" value="true"/);
});
