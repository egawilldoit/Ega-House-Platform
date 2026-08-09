import assert from "node:assert/strict";
import test from "node:test";

import { getFocusPanelCandidateState, type FocusPanelTask } from "./focus-panel";

function buildTask(overrides: Partial<FocusPanelTask>): FocusPanelTask {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Task",
    status: overrides.status ?? "todo",
    priority: overrides.priority ?? "medium",
    dueDate: overrides.dueDate ?? null,
    focusRank: overrides.focusRank ?? null,
    updatedAt: overrides.updatedAt ?? "2026-04-18T09:00:00.000Z",
    estimateMinutes: overrides.estimateMinutes ?? null,
    projectName: overrides.projectName ?? "Alpha",
    projectSlug: overrides.projectSlug ?? "alpha",
    goalTitle: overrides.goalTitle ?? null,
  };
}

test("returns empty when no open tasks remain", () => {
  const state = getFocusPanelCandidateState([
    buildTask({ id: "task-1", status: "done" }),
    buildTask({ id: "task-2", status: "completed" }),
  ]);

  assert.deepEqual(state, { state: "empty" });
});

test("returns blocked-only when all open tasks are blocked", () => {
  const state = getFocusPanelCandidateState([
    buildTask({ id: "task-1", status: "blocked", focusRank: 1 }),
    buildTask({ id: "task-2", status: "blocked" }),
  ]);

  assert.equal(state.state, "blocked_only");

  if (state.state === "blocked_only") {
    assert.equal(state.blockedTaskCount, 2);
    assert.equal(state.openTaskCount, 2);
    assert.equal(state.pinnedTaskCount, 1);
  }
});

test("prefers pinned tasks while still surfacing due and recency signals", () => {
  const nowIso = "2026-04-18T10:00:00.000Z";
  const state = getFocusPanelCandidateState(
    [
      buildTask({
        id: "task-pinned",
        title: "Pinned task",
        focusRank: 1,
        dueDate: "2026-04-18",
        priority: "high",
        updatedAt: "2026-04-18T08:50:00.000Z",
      }),
      buildTask({
        id: "task-overdue",
        title: "Overdue unpinned",
        dueDate: "2026-04-16",
        priority: "urgent",
        updatedAt: "2026-04-18T08:59:00.000Z",
      }),
    ],
    nowIso,
  );

  assert.equal(state.state, "recommended");

  if (state.state === "recommended") {
    assert.equal(state.recommendation.task.id, "task-pinned");
    assert.deepEqual(state.recommendation.signals, [
      "Pinned #1",
      "Due today",
      "High priority",
      "Recently touched",
    ]);
  }
});

test("surfaces in-progress urgency and workload counts for recommendations", () => {
  const state = getFocusPanelCandidateState([
    buildTask({
      id: "task-in-progress",
      title: "Continue implementing",
      status: "in_progress",
      priority: "urgent",
      updatedAt: "2026-04-18T09:10:00.000Z",
    }),
    buildTask({
      id: "task-blocked",
      status: "blocked",
      focusRank: 2,
    }),
  ]);

  assert.equal(state.state, "recommended");

  if (state.state === "recommended") {
    assert.equal(state.recommendation.task.id, "task-in-progress");
    assert.equal(state.recommendation.openTaskCount, 2);
    assert.equal(state.recommendation.blockedTaskCount, 1);
    assert.equal(state.recommendation.pinnedTaskCount, 1);
    assert.ok(state.recommendation.signals.includes("In progress"));
    assert.ok(state.recommendation.signals.includes("Urgent"));
  }
});
